variable "region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "us-east-1"
}

variable "name" {
  type        = string
  description = "Name tag / identifier for the instance + key pair + SG."
  default     = "behavior-lab"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type. Use a nested-virt-capable Intel family (m7i/c7i/r7i/m8i) for CAPE full mode; a smaller type falls back to in-guest Sysmon mode."
  default     = "m7i.2xlarge"
}

variable "disk_gb" {
  type        = number
  description = "Root EBS volume size (GiB). CAPE + a Windows analysis guest need headroom."
  default     = 200
}

variable "allowed_cidr" {
  type        = string
  description = "The ONLY CIDR allowed to reach SSH + the app ports. Default to the analyst's IP /32; never 0.0.0.0/0."

  validation {
    condition     = var.allowed_cidr != "0.0.0.0/0"
    error_message = "allowed_cidr must not be 0.0.0.0/0 — lock access to the analyst's own IP."
  }
}

variable "public_key" {
  type        = string
  description = "SSH public key (openssh format) authorized on the instance; the platform holds the matching private key."
}

variable "app_ports" {
  type        = list(number)
  description = "Appliance ports to expose to allowed_cidr only (CAPE 8000, hbl 8888, Ollama 11434)."
  default     = [8000, 8888, 11434]
}
