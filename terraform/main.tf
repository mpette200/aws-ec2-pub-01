terraform {
  backend "s3" {
    bucket = "github-tf-state-01"
    key    = "tf-state-01/key"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.56.0"
    }
  }

  required_version = ">= 1.3.0"
}

provider "aws" {
  assume_role_with_web_identity {
    role_arn                = var.role_arn
    session_name            = var.session_name
    web_identity_token_file = var.web_identity_token_file
  }
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 3.19.0"

  name = "my-vpc"
  cidr = "10.0.0.0/16"

}
