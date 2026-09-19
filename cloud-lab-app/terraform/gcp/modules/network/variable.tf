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

variable "router_private_ip" {
  description = "Private IP for the router"
  type        = string
  default     = "10.0.1.10"
}

variable "ip_whitelist" {
  description = "IP whitelist for router access (SSH and WireGuard)"
  type        = string
  default     = "0.0.0.0/0"
}
