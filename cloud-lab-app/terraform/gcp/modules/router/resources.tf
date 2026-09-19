
resource "google_compute_instance" "router" {
  name         = "ar-router-${var.attack_range_id}"
  machine_type = var.machine_type
  zone         = var.zone
  project      = var.project_id

  boot_disk {
    initialize_params {
      image = var.image_self_link
      size  = 20
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = var.subnet_id
    network_ip = var.private_ip

    access_config {
      // Ephemeral public IP
    }
  }

  metadata = {
    ssh-keys = "ubuntu:${file(var.public_key_path)}"
  }
  
  metadata_startup_script = <<-EOF
    #!/bin/bash
    # Ensure SSH is enabled and running
    systemctl enable ssh
    systemctl start ssh
  EOF

  tags = ["router"]

  labels = {
    attack_range_id = replace(var.attack_range_id, "-", "_")
  }

  allow_stopping_for_update = true
}
