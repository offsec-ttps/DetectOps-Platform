output "router_public_ip" {
  description = "Public IP address of the WireGuard router."
  value       = module.router.router_public_ip
}

