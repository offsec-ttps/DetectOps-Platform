variable "zeek_server" {
  type        = bool
  default     = false
}

variable "image_self_link" {
  description = "Image self link to use for the instance."
  type        = string
}

variable "machine_type" {
  description = "GCE machine type."
  type        = string
}

variable "key_name" {
  description = "SSH key name."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Subnet ID for the instances."
  type        = string
}

variable "private_ip" {
  description = "Private IP for the instance."
  type        = string
}

variable "root_volume_size" {
  description = "Root volume size in GB."
  type        = number
  default     = 60
}

variable "server_name" {
  description = "Server Name"
  type        = string
}

variable "attack_range_id" {
  description = "Attack Range ID (UUID)"
  type        = string
}

variable "attack_range_password" {
  description = "Attack Range Password"
  type        = string
}

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = null
}

variable "zone" {
  description = "GCP Zone"
  type        = string
}

variable "network_name" {
  description = "Network name"
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
