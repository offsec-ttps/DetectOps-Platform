variable "general" {
  description = "General configuration settings"
  type        = any
}

variable "aws" {
  description = "AWS-specific configuration settings"
  type        = any
}

variable "attack_range" {
  description = "Attack range server configurations"
  type        = any
  default     = []
}