data "aws_caller_identity" "current" {}

locals {
  account_root = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
  secret_names = ["database-url", "oauth-signing-key", "session-secret", "redis-auth-token"]
}

# Envelope encryption KEK for fact bodies. Only the ECS task role may use it for crypto;
# the account root keeps admin rights (key management only, no Decrypt).
data "aws_iam_policy_document" "envelope" {
  statement {
    sid = "KeyAdministration"
    actions = [
      "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*",
      "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource",
      "kms:UntagResource", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
    ]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.account_root]
    }
  }
  statement {
    sid       = "TaskRoleCryptoOnly"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.task.arn]
    }
  }
}

resource "aws_kms_key" "envelope" {
  description             = "${local.name} envelope encryption (fact bodies)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.envelope.json
}

resource "aws_kms_alias" "envelope" {
  name          = "alias/${local.name}-envelope"
  target_key_id = aws_kms_key.envelope.key_id
}

# Separate key for infra-at-rest (RDS, Redis, Secrets Manager).
resource "aws_kms_key" "secrets" {
  description             = "${local.name} infra at-rest encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

data "aws_iam_policy_document" "logs_key" {
  statement {
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.account_root]
    }
  }
  statement {
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "logs" {
  description         = "${local.name} CloudWatch Logs"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.logs_key.json
}

# Values are set out-of-band (console/CLI), never in Terraform state.
resource "aws_secretsmanager_secret" "app" {
  for_each   = toset(local.secret_names)
  name       = "persona-hub/${var.env}/${each.key}"
  kms_key_id = aws_kms_key.secrets.arn
}
