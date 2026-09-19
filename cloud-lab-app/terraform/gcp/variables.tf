variable "general" {
  description = "General configuration settings"
  type        = any
}

variable "gcp" {
  description = "GCP-specific configuration settings"
  type        = any
}

variable "attack_range" {
  description = "Attack range server configurations"
  type        = any
  default     = []
}
