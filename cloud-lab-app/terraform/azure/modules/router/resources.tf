resource "azurerm_public_ip" "router-publicip" {
  name                = "ar-router-ip-${var.attack_range_id}"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = {
    Name = "ar-router-ip-${var.attack_range_id}"
  }
}

resource "azurerm_network_interface" "router-nic" {
  name                  = "ar-router-nic-${var.attack_range_id}"
  location              = var.location
  resource_group_name   = var.resource_group_name
  ip_forwarding_enabled = true

  ip_configuration {
    name                          = "ar-router-nic-conf-${var.attack_range_id}"
    subnet_id                     = var.subnet_id
    private_ip_address_allocation = "Static"
    private_ip_address            = var.private_ip
    public_ip_address_id          = azurerm_public_ip.router-publicip.id
  }

  tags = {
    Name = "ar-router-nic-${var.attack_range_id}"
  }
}

resource "azurerm_linux_virtual_machine" "router" {
  name                = "ar-router-${var.attack_range_id}"
  location            = var.location
  resource_group_name = var.resource_group_name
  size                = var.instance_type
  admin_username      = "ubuntu"

  network_interface_ids = [azurerm_network_interface.router-nic.id]

  admin_ssh_key {
    username   = "ubuntu"
    public_key = file(var.public_key_path)
  }

  os_disk {
    name                 = "disk-router-${var.attack_range_id}"
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
    disk_size_gb         = 30
  }

  source_image_reference {
    publisher = "canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts"
    version   = "latest"
  }

  tags = {
    Name = "ar-router-${var.attack_range_id}"
  }
}

