output "router_instance_id" {
  description = "ID of the WireGuard router instance."
  value       = aws_instance.router.id
}

output "router_public_ip" {
  description = "Public IP address of the WireGuard router."
  value       = aws_instance.router.public_ip
}

output "router_private_ip" {
  description = "Private IP address of the WireGuard router."
  value       = aws_instance.router.private_ip
}


