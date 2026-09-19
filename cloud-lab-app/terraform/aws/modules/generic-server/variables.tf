variable "ami_id" {
  description = "AMI ID to use for the instance."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type."
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

variable "root_volume_type" {
  description = "Root volume type."
  type        = string
  default     = "gp3"
}

variable "root_volume_size" {
  description = "Root volume size in GB."
  type        = number
  default     = 60
}

variable "root_volume_delete_on_termination" {
  description = "Whether to delete the root volume on instance termination."
  type        = bool
  default     = true
}

variable "root_volume_encrypted" {
  description = "Whether the root volume is encrypted."
  type        = bool
  default     = true
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

variable "vpc_id" {
  description = "VPC ID for the security group."
  type        = string
}

variable "user_data" {
  description = "User data script to run when the instance launches."
  type        = string
  default     = null
}

variable "zeek_monitor" {
  description = "Whether to enable Zeek traffic mirroring for this server"
  type        = bool
  default     = false
}

variable "zeek_traffic_mirror_filter_id" {
  description = "The ID of the Zeek traffic mirror filter"
  type        = string
  default     = null
}

variable "zeek_traffic_mirror_target_id" {
  description = "The ID of the Zeek traffic mirror target"
  type        = string
  default     = null
}

variable "zeek_session_number" {
  description = "Session number for the traffic mirror session (must be unique per target)"
  type        = number
  default     = null
}

