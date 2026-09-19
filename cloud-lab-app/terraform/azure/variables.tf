variable "general" {
  description = "General configuration settings"
  type        = any
}

variable "azure" {
  description = "Azure-specific configuration settings"
  type        = any
}

variable "attack_range" {
  description = "Attack range server configurations"
  type        = any
  default     = []
}

