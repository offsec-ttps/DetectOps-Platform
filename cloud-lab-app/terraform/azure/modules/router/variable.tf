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
  description = "VM size for the WireGuard router."
  type        = string
  default     = "Standard_B2s"
}

variable "attack_range_id" {
  description = "Attack Range ID (UUID)"
  type        = string
}

variable "resource_group_name" {
  description = "Resource group name"
  type        = string
}

variable "location" {
  description = "Azure location/region"
  type        = string
}

variable "key_name" {
  description = "SSH key name (used for naming)"
  type        = string
}

variable "public_key_path" {
  description = "Path to public SSH key"
  type        = string
}

variable "private_key_path" {
  description = "Path to private SSH key"
  type        = string
}

