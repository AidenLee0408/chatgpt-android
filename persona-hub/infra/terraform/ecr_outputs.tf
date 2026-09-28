resource "aws_ecr_repository" "server" {
  count                = var.env == "staging" ? 1 : 0 # shared repo lives with staging stack
  name                 = "persona-hub-server"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
  }
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "ecs_cluster" {
  value = aws_ecs_cluster.this.name
}

output "ecs_services" {
  value = { for k, s in aws_ecs_service.svc : k => s.name }
}

output "envelope_kms_key_arn" {
  value = aws_kms_key.envelope.arn
}

output "rds_endpoint" {
  value = aws_db_instance.this.address
}
