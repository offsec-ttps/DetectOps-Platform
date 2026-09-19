variable "image_publisher" {
  description = "Image publisher (e.g., 'canonical', 'MicrosoftWindowsServer')"
  type        = string
}

variable "image_offer" {
  description = "Image offer (e.g., '0001-com-ubuntu-server-jammy', 'WindowsServer')"
  type        = string
}

variable "image_sku" {
  description = "Image SKU (e.g., '22_04-lts', '2022-datacenter')"
  type        = string
}

variable "instance_type" {
  description = "VM size (e.g., 'Standard_D4s_v3')"
  type        = string
}

variable "key_name" {
  description = "SSH key name (used for naming, null for Windows)"
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Subnet ID for the VM."
  type        = string
}

variable "private_ip" {
  description = "Private IP for the VM."
  type        = string
}

variable "root_volume_size" {
  description = "Root volume size in GB."
  type        = number
  default     = 130
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

variable "resource_group_name" {
  description = "Resource group name"
  type        = string
}

variable "location" {
  description = "Azure location/region"
  type        = string
}

variable "user_data" {
  description = "User data script to run when the VM launches (for Windows and Linux)."
  type        = string
  default     = null
}

variable "public_key_path" {
  description = "Path to public SSH key"
  type        = string
}

variable "private_key_path" {
  description = "Path to private SSH key"
  type        = string
}

variable "user_name" {
  description = "Username for the VM (Linux or Windows)"
  type        = string
  default     = null
}
