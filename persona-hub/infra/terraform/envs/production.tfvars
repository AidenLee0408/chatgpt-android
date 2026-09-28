env                 = "production"
acm_certificate_arn = "arn:aws:acm:ap-northeast-2:000000000000:certificate/PLACEHOLDER-production"
image_uri           = "000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/persona-hub-server:PLACEHOLDER"
alarm_sns_email     = "oncall@example.com"
deletion_protection = true
vpc_cidr            = "10.50.0.0/16"

db_instance_class = "db.t4g.medium"
db_multi_az       = true
redis_node_type   = "cache.t4g.small"
redis_replicas    = 1

service_scaling = {
  api   = { cpu = 512, memory = 1024, desired = 2, min = 2, max = 6 }
  oauth = { cpu = 256, memory = 512, desired = 2, min = 2, max = 4 }
  mcp   = { cpu = 512, memory = 1024, desired = 2, min = 2, max = 8 }
}
