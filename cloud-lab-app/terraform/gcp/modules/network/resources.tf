
locals {
  network_name = "ar-vpc-${var.attack_range_id}"
}

# VPC Network
resource "google_compute_network" "vpc" {
  name                    = local.network_name
  auto_create_subnetworks = false
  project                 = var.project_id
}

# Public subnet
resource "google_compute_subnetwork" "public" {
  name          = "ar-public-subnet-${var.attack_range_id}"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
  project       = var.project_id

  # Enable private Google access for instances without external IPs
  private_ip_google_access = true
}

# Private subnet
resource "google_compute_subnetwork" "private" {
  name          = "ar-private-subnet-${var.attack_range_id}"
  ip_cidr_range = "10.0.2.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
  project       = var.project_id

  # Enable private Google access for instances without external IPs
  private_ip_google_access = true
}

# Cloud Router for NAT
resource "google_compute_router" "router" {
  name    = "ar-nat-router-${var.attack_range_id}"
  region  = var.region
  network = google_compute_network.vpc.id
  project = var.project_id
}

# Cloud NAT for private subnet internet access
resource "google_compute_router_nat" "nat" {
  name                               = "ar-nat-${var.attack_range_id}"
  router                             = google_compute_router.router.name
  region                             = google_compute_router.router.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  project                            = var.project_id

  subnetwork {
    name                    = google_compute_subnetwork.private.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
}

# Firewall rule to allow internal communication
resource "google_compute_firewall" "allow_internal" {
  name    = "ar-allow-internal-${var.attack_range_id}"
  network = google_compute_network.vpc.name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "icmp"
  }

  source_ranges = ["10.0.0.0/16"]
}

# Firewall rule to allow SSH from IP whitelist to public subnet
resource "google_compute_firewall" "allow_ssh_public" {
  name    = "ar-allow-ssh-public-${var.attack_range_id}"
  network = google_compute_network.vpc.name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = [var.ip_whitelist]
  target_tags   = ["router"]
}

# Firewall rule to allow WireGuard from IP whitelist to router
resource "google_compute_firewall" "allow_wireguard" {
  name    = "ar-allow-wireguard-${var.attack_range_id}"
  network = google_compute_network.vpc.name
  project = var.project_id

  allow {
    protocol = "udp"
    ports    = ["51820"]
  }

  source_ranges = [var.ip_whitelist]
  target_tags   = ["router"]
}
