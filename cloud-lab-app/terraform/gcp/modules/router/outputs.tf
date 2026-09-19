output "router_instance_id" {
  description = "ID of the WireGuard router instance."
  value       = google_compute_instance.router.instance_id
}

output "router_public_ip" {
  description = "Public IP address of the WireGuard router."
  value       = google_compute_instance.router.network_interface[0].access_config[0].nat_ip
}

output "router_private_ip" {
  description = "Private IP address of the WireGuard router."
  value       = google_compute_instance.router.network_interface[0].network_ip
}


