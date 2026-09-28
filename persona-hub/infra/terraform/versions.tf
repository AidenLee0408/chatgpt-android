terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
  # PLACEHOLDER: bucket/table 생성 후 `terraform init -backend-config=envs/<env>.backend.hcl`
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "persona-hub"
      Environment = var.env
      ManagedBy   = "terraform"
    }
  }
}
