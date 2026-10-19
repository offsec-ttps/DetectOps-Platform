# Use the account's default VPC + subnets (no new VPC needed for one appliance).
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Security group: SSH + app ports reachable ONLY from the analyst's IP.
resource "aws_security_group" "lab" {
  name        = "${var.name}-sg"
  description = "Behavior Analysis Workstation — analyst-IP-locked access"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH (analyst IP only)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  dynamic "ingress" {
    for_each = toset(var.app_ports)
    content {
      description = "Appliance app port (analyst IP only)"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = [var.allowed_cidr]
    }
  }

  # Egress open so the HOST can install CAPE/Ollama/tools. The CAPE ANALYSIS
  # GUEST is isolated separately inside the box (route=none) — not via this SG.
  egress {
    description = "All outbound (host tooling install)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name}-sg", managed_by = "detectops-hbl" }
}
