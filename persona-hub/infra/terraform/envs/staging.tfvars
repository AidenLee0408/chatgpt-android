env                 = "staging"
acm_certificate_arn = "arn:aws:acm:ap-northeast-2:000000000000:certificate/PLACEHOLDER-staging"
image_uri           = "000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/persona-hub-server:PLACEHOLDER"
alarm_sns_email     = "oncall-staging@example.com"
deletion_protection = false
vpc_cidr            = "10.40.0.0/16"

db_instance_class = "db.t4g.micro"
db_multi_az       = true # spec: multi-AZ; set false to save ~50% in staging if acceptable
redis_node_type   = "cache.t4g.micro"
redis_replicas    = 0

service_scaling = {
  api   = { cpu = 256, memory = 512, desired = 1, min = 1, max = 2 }
  oauth = { cpu = 256, memory = 512, desired = 1, min = 1, max = 2 }
  mcp   = { cpu = 256, memory = 512, desired = 1, min = 1, max = 2 }
}
