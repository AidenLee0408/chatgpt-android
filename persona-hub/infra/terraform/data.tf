resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "this" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    # Never log statement bodies (could contain fact contents).
    name  = "log_statement"
    value = "none"
  }
}

resource "aws_db_instance" "this" {
  identifier                      = local.name
  engine                          = "postgres"
  engine_version                  = "16"
  instance_class                  = var.db_instance_class
  allocated_storage               = var.db_allocated_storage
  max_allocated_storage           = var.db_allocated_storage * 5
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.secrets.arn
  db_name                         = "personahub"
  username                        = "personahub_admin"
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = aws_kms_key.secrets.arn
  multi_az                        = var.db_multi_az
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  parameter_group_name            = aws_db_parameter_group.this.name
  backup_retention_period         = 7
  backup_window                   = "17:00-18:00"
  maintenance_window              = "sun:18:30-sun:19:30"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = !var.deletion_protection
  final_snapshot_identifier       = "${local.name}-final"
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.secrets.arn
  auto_minor_version_upgrade      = true
}

resource "aws_elasticache_subnet_group" "this" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

data "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id = aws_secretsmanager_secret.app["redis-auth-token"].id
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = local.name
  description                = "persona-hub ${var.env} cache / rate limit"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 1 + var.redis_replicas
  automatic_failover_enabled = var.redis_replicas > 0
  multi_az_enabled           = var.redis_replicas > 0
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.secrets.arn
  transit_encryption_enabled = true
  auth_token                 = data.aws_secretsmanager_secret_version.redis_auth.secret_string
  snapshot_retention_limit   = 1
}
