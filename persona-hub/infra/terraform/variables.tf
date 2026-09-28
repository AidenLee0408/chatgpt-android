variable "env" {
  type = string
}

variable "region" {
  type    = string
  default = "ap-northeast-2"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "acm_certificate_arn" {
  description = "ACM cert ARN for the ALB HTTPS listener (PLACEHOLDER per env)"
  type        = string
}

variable "image_uri" {
  description = "ECR image URI incl. tag; overridden by the deploy pipeline"
  type        = string
}

variable "service_scaling" {
  description = "Per-service desired/min/max counts and task size"
  type = map(object({
    cpu     = number
    memory  = number
    desired = number
    min     = number
    max     = number
  }))
}

variable "db_instance_class" {
  type = string
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "redis_node_type" {
  type = string
}

variable "redis_replicas" {
  description = "Number of replica nodes (0 = single node)"
  type        = number
  default     = 1
}

variable "alarm_sns_email" {
  description = "Alert recipient (PLACEHOLDER)"
  type        = string
}

variable "deletion_protection" {
  type    = bool
  default = true
}
