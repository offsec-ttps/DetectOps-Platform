output "router_instance_id" {
  description = "ID of the WireGuard router VM."
  value       = azurerm_linux_virtual_machine.router.id
}

output "router_public_ip" {
  description = "Public IP address of the WireGuard router."
  value       = azurerm_public_ip.router-publicip.ip_address
}

output "router_private_ip" {
  description = "Private IP address of the WireGuard router."
  value       = azurerm_network_interface.router-nic.private_ip_address
}

