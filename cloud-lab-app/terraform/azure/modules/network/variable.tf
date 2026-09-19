variable "attack_range_id" {
  description = "Attack Range ID (UUID)"
  type        = string
}

variable "location" {
  description = "Azure location/region"
  type        = string
}

variable "router_private_ip" {
  description = "Private IP address of the router (for routing configuration)"
  type        = string
  default     = "10.0.1.10"
}

variable "ip_whitelist" {
  description = "IP whitelist for router access (SSH and WireGuard)"
  type        = string
  default     = "0.0.0.0/0"
}

