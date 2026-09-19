
variable "subnet_id" {
  description = "Subnet ID where the WireGuard router will be deployed (public subnet)."
  type        = string
}

variable "private_ip" {
  description = "Static private IP for the WireGuard router within the public subnet."
  type        = string
  default     = "10.0.1.10"
}

variable "machine_type" {
  description = "Machine type for the WireGuard router."
  type        = string
  default     = "e2-small"
}

variable "image_self_link" {
  description = "Image self link."
  type        = string
}

variable "attack_range_id" {
  description = "Attack Range ID (UUID)"
  type        = string
}

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "zone" {
  description = "GCP Zone"
  type        = string
}

variable "network_name" {
  description = "Network name"
  type        = string
}

variable "key_name" {
  description = "SSH key name"
  type        = string
}

variable "public_key_path" {
  description = "Path to SSH public key"
  type        = string
}

variable "private_key_path" {
  description = "Path to SSH private key"
  type        = string
}

variable "ip_whitelist" {
  description = "IP whitelist for router access (SSH and WireGuard)"
  type        = string
  default     = "0.0.0.0/0"
}
