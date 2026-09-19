
data "aws_availability_zones" "available" {}

locals {
  cluster_name = "ar_cluster_${var.attack_range_id}"
}

module "vpc" {
  source = "terraform-aws-modules/vpc/aws"

  name   = "ar_vpc_${var.attack_range_id}"
  cidr   = "10.0.0.0/16"
  azs    = data.aws_availability_zones.available.names

  # One public and one private subnet
  public_subnets  = ["10.0.1.0/24"]
  private_subnets = ["10.0.2.0/24"]

  # DNS + NAT for private subnet internet access
  enable_dns_hostnames = true
  enable_nat_gateway   = true
  single_nat_gateway   = true
}
