
variable "subnet_id" {
  description = "Subnet ID where the WireGuard router will be deployed (public subnet)."
  type        = string
}

variable "private_ip" {
  description = "Static private IP for the WireGuard router within the public subnet."
  type        = string
  default     = "10.0.1.10"
}

variable "instance_type" {
  description = "Instance type for the WireGuard router."
  type        = string
  default     = "t3.small"
}

variable "ami_id" {
  description = "AMI ID."
  type        = string
}

variable "attack_range_id" {
  description = "Attack Range ID (UUID)"
  type        = string
}

variable "vpc_id" {
  description = "VPC id"
  type        = string
}

variable "key_name" {
  description = "SSH key name"
  type        = string
}

variable "ip_whitelist" {
  description = "IP whitelist for router access (SSH and WireGuard)"
  type        = string
  default     = "0.0.0.0/0"
}