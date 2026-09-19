
resource "google_compute_firewall" "this" {
  name        = "ar-${var.attack_range_id}-${var.server_name}-fw"
  network     = var.network_name
  project     = var.project_id
  description = "Firewall rule allowing all ingress and egress traffic"

  allow {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["ar-${var.attack_range_id}-${var.server_name}"]
}

locals {
  # Build tags list: always include server-specific tag, add packet-mirror if zeek_monitor is enabled
  instance_tags = concat(
    ["ar-${var.attack_range_id}-${var.server_name}"],
    var.zeek_monitor ? ["packet-mirror"] : []
  )
}

resource "google_compute_instance" "this" {
  name         = "ar-${var.attack_range_id}-${var.server_name}"
  machine_type = var.machine_type
  zone         = var.zone
  project      = var.project_id

  boot_disk {
    initialize_params {
      image = var.image_self_link
      size  = var.root_volume_size
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = var.subnet_id
    network_ip = var.private_ip
  }

  metadata = merge(
    {
      ssh-keys = var.key_name != null ? "${var.user_name != null ? var.user_name : "ubuntu"}:${file(var.public_key_path)}" : ""
    },
    var.user_data != null && can(regex("^<powershell>|\\$admin|\\$hostname|winrm", var.user_data)) ? {
      windows-startup-script-ps1 = var.user_data
    } : {},
    var.user_data != null && !can(regex("^<powershell>|\\$admin|\\$hostname|winrm", var.user_data)) ? {
      startup-script = var.user_data
    } : {}
  )

  tags = local.instance_tags

  labels = {
    attack_range_id = replace(var.attack_range_id, "-", "_")
    server_name     = var.server_name
  }

  allow_stopping_for_update = true
}

output "instance_id" {
  description = "ID of the created instance."
  value       = google_compute_instance.this.instance_id
}

output "instance" {
  description = "The GCE instance object."
  value       = google_compute_instance.this
}
