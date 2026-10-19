# Behavior Analysis Workstation — AWS deploy (single analyst appliance).
#
# Provisions ONE Ubuntu 22.04 instance sized for CAPE full mode (nested virt is
# available on modern Intel families, e.g. m7i). Security is locked down: SSH +
# app ports are reachable ONLY from the analyst's own IP (var.allowed_cidr),
# never 0.0.0.0. After apply, the platform SSH-provisions it with provision.sh.
#
# Credentials come from the environment (AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN/
# AWS_REGION), injected by the platform from the encrypted vault — never written
# into these files or the state.

terraform {
  required_version = ">= 1.3"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}
