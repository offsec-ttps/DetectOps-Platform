resource "google_compute_firewall" "zeek_server" {
  count       = var.zeek_server ? 1 : 0
  name        = "ar-${var.attack_range_id}-${var.server_name}-fw"
  network     = var.network_name
  project     = var.project_id
  description = "Firewall rule allowing all ingress and egress traffic for Zeek server"

  allow {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["zeek-server"]
}

resource "google_compute_instance" "zeek_sensor" {
  count        = var.zeek_server ? 1 : 0
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

  metadata = {
    ssh-keys = var.key_name != null ? "ubuntu:${file(var.public_key_path)}" : ""
  }

  tags = ["zeek-server"]

  labels = {
    attack_range_id = replace(var.attack_range_id, "-", "_")
    server_name     = var.server_name
  }

  allow_stopping_for_update = true
}

# Packet Mirroring Policy for Zeek
# This will be used by other instances to mirror traffic to the Zeek server
resource "google_compute_packet_mirroring" "zeek_mirror" {
  count       = var.zeek_server ? 1 : 0
  name        = "ar-${var.attack_range_id}-zeek-mirror"
  region      = var.region
  project     = var.project_id
  description = "Packet mirroring for Zeek monitoring"

  network {
    url = "projects/${var.project_id}/global/networks/${var.network_name}"
  }

  collector_ilb {
    url = google_compute_forwarding_rule.zeek_ilb[0].id
  }

  mirrored_resources {
    tags = ["packet-mirror"]
  }

  filter {
    ip_protocols = []
    cidr_ranges  = []
  }
}

# Internal Load Balancer for Zeek (required for packet mirroring)
resource "google_compute_forwarding_rule" "zeek_ilb" {
  count                 = var.zeek_server ? 1 : 0
  name                  = "ar-${var.attack_range_id}-zeek-ilb"
  region                = var.region
  project               = var.project_id
  load_balancing_scheme = "INTERNAL"
  backend_service       = google_compute_region_backend_service.zeek_backend[0].id
  all_ports             = true
  network               = var.network_name
  subnetwork            = var.subnet_id
  is_mirroring_collector = true
}

resource "google_compute_region_backend_service" "zeek_backend" {
  count                 = var.zeek_server ? 1 : 0
  name                  = "ar-${var.attack_range_id}-zeek-backend"
  region                = var.region
  project               = var.project_id
  protocol              = "TCP"
  load_balancing_scheme = "INTERNAL"

  backend {
    group          = google_compute_instance_group.zeek_group[0].id
    balancing_mode = "CONNECTION"
  }

  health_checks = [google_compute_region_health_check.zeek_health[0].id]
}

resource "google_compute_instance_group" "zeek_group" {
  count       = var.zeek_server ? 1 : 0
  name        = "ar-${var.attack_range_id}-zeek-group"
  zone        = var.zone
  project     = var.project_id
  description = "Instance group for Zeek server"

  instances = [
    google_compute_instance.zeek_sensor[0].id
  ]

  # Named ports for packet mirroring - using SSH port as a health check port
  named_port {
    name = "ssh"
    port = 22
  }
}

resource "google_compute_region_health_check" "zeek_health" {
  count               = var.zeek_server ? 1 : 0
  name                = "ar-${var.attack_range_id}-zeek-health"
  region              = var.region
  project             = var.project_id
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  tcp_health_check {
    port = 22
  }
}
