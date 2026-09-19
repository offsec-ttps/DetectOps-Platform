
provider "aws" {
  region = var.aws.region

  default_tags {
    tags = var.aws.aws_default_tags
  }

}
