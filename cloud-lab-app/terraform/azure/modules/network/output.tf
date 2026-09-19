output "resource_group_name" {
  value = azurerm_resource_group.attackrange.name
}

output "vnet_id" {
  value = azurerm_virtual_network.attackrange-network.id
}

output "public_subnet_id" {
  value = azurerm_subnet.attackrange-public-subnet.id
}

output "private_subnet_id" {
  value = azurerm_subnet.attackrange-private-subnet.id
}

