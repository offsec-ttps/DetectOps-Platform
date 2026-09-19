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

variable "zone" {
  description = "GCP Zone"
  type        = string
}

variable "network_name" {
  description = "Network name"
  type        = string
}

variable "user_data" {
  description = "User data script to run when the instance launches."
  type        = string
  default     = null
}

variable "public_key_path" {
  description = "Path to SSH public key"
  type        = string
}

variable "private_key_path" {
  description = "Path to SSH private key"
  type        = string
}

variable "zeek_monitor" {
  description = "Whether to enable Zeek packet mirroring for this server"
  type        = bool
  default     = false
}

variable "zeek_packet_mirror_policy_id" {
  description = "The ID of the Zeek packet mirror policy (not used in GCP, kept for consistency)"
  type        = string
  default     = null
}

variable "zeek_priority" {
  description = "Priority for packet mirroring (not used in GCP, kept for consistency)"
  type        = number
  default     = null
}

variable "user_name" {
  description = "Username for the VM (Linux or Windows)"
  type        = string
  default     = null
}
