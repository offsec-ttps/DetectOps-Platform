resource "azurerm_resource_group" "attackrange" {
  name     = "ar-rg-${var.attack_range_id}"
  location = var.location

  tags = {
    Name = "ar-rg-${var.attack_range_id}"
  }
}

resource "azurerm_virtual_network" "attackrange-network" {
  name                = "ar-vnet-${var.attack_range_id}"
  address_space       = ["10.0.0.0/16"]
  location            = var.location
  resource_group_name = azurerm_resource_group.attackrange.name

  tags = {
    Name = "ar-vnet-${var.attack_range_id}"
  }
}

resource "azurerm_subnet" "attackrange-public-subnet" {
  name                 = "ar-subnet-public-${var.attack_range_id}"
  resource_group_name  = azurerm_resource_group.attackrange.name
  virtual_network_name = azurerm_virtual_network.attackrange-network.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "attackrange-private-subnet" {
  name                 = "ar-subnet-private-${var.attack_range_id}"
  resource_group_name  = azurerm_resource_group.attackrange.name
  virtual_network_name = azurerm_virtual_network.attackrange-network.name
  address_prefixes     = ["10.0.2.0/24"]
}

resource "azurerm_network_security_group" "attackrange-nsg" {
  name                = "ar-nsg-${var.attack_range_id}"
  location            = var.location
  resource_group_name = azurerm_resource_group.attackrange.name

  security_rule {
    name                       = "SSH"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.ip_whitelist
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "WireGuard"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Udp"
    source_port_range          = "*"
    destination_port_range     = "51820"
    source_address_prefix      = var.ip_whitelist
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowAllInbound"
    priority                   = 1003
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowAllOutbound"
    priority                   = 1004
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = {
    Name = "ar-nsg-${var.attack_range_id}"
  }
}

resource "azurerm_subnet_network_security_group_association" "attackrange-public-nsga" {
  subnet_id                 = azurerm_subnet.attackrange-public-subnet.id
  network_security_group_id = azurerm_network_security_group.attackrange-nsg.id
}

resource "azurerm_subnet_network_security_group_association" "attackrange-private-nsga" {
  subnet_id                 = azurerm_subnet.attackrange-private-subnet.id
  network_security_group_id = azurerm_network_security_group.attackrange-nsg.id
}

# Route table for private subnet to route VPN traffic through router
resource "azurerm_route_table" "attackrange-private-rt" {
  name                = "ar-rt-private-${var.attack_range_id}"
  location            = var.location
  resource_group_name = azurerm_resource_group.attackrange.name

  route {
    name                   = "vpn-route"
    address_prefix         = "10.0.1.0/24"
    next_hop_type          = "VirtualAppliance"
    next_hop_in_ip_address = var.router_private_ip
  }

  tags = {
    Name = "ar-rt-private-${var.attack_range_id}"
  }
}

resource "azurerm_subnet_route_table_association" "attackrange-private-rta" {
  subnet_id      = azurerm_subnet.attackrange-private-subnet.id
  route_table_id = azurerm_route_table.attackrange-private-rt.id
}

