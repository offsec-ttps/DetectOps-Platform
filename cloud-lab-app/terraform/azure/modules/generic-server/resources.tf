locals {
  is_windows = var.user_data != null && var.user_data == "windows"
}

resource "azurerm_network_interface" "this" {
  name                = "ar-${var.server_name}-nic-${var.attack_range_id}"
  location            = var.location
  resource_group_name = var.resource_group_name

  ip_configuration {
    name                          = "ar-${var.server_name}-nic-conf-${var.attack_range_id}"
    subnet_id                     = var.subnet_id
    private_ip_address_allocation = "Static"
    private_ip_address            = var.private_ip
  }

  tags = {
    Name = "ar-${var.server_name}-nic-${var.attack_range_id}"
  }
}

resource "azurerm_linux_virtual_machine" "this" {
  count               = local.is_windows ? 0 : 1
  name                = "ar-${var.server_name}-${var.attack_range_id}"
  location            = var.location
  resource_group_name = var.resource_group_name
  size                = var.instance_type
  admin_username      = var.user_name != null ? var.user_name : "ubuntu"

  network_interface_ids = [azurerm_network_interface.this.id]

  admin_ssh_key {
    username   = var.user_name != null ? var.user_name : "ubuntu"
    public_key = file(var.public_key_path)
  }

  custom_data = var.user_data != null && !local.is_windows ? base64encode(var.user_data) : null

  os_disk {
    name                 = "disk-${var.server_name}-${var.attack_range_id}"
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
    disk_size_gb         = var.root_volume_size
  }

  source_image_reference {
    publisher = var.image_publisher
    offer     = var.image_offer
    sku       = var.image_sku
    version   = "latest"
  }

  tags = {
    Name = "ar-${var.server_name}-${var.attack_range_id}"
  }
}

# Use azurerm_virtual_machine for Windows to support os_profile_windows_config
# This allows us to use additional_unattend_config for FirstLogonCommands
resource "azurerm_virtual_machine" "windows" {
  count               = local.is_windows ? 1 : 0
  name                = "ar-${var.server_name}-${var.attack_range_id}"
  location            = var.location
  resource_group_name = var.resource_group_name
  network_interface_ids = [azurerm_network_interface.this.id]
  vm_size               = var.instance_type

  delete_os_disk_on_termination = true

  storage_image_reference {
    publisher = var.image_publisher
    offer     = var.image_offer
    sku       = var.image_sku
    version   = "latest"
  }

  os_profile {
    computer_name  = "ar-${var.server_name}"
    admin_username = var.user_name != null ? var.user_name : "AzureAdmin"
    admin_password = var.attack_range_password
    custom_data    = file("${path.module}/files/winrm.ps1")
  }

  os_profile_windows_config {
    provision_vm_agent        = true
    enable_automatic_upgrades = false

    additional_unattend_config {
        pass         = "oobeSystem"
        component    = "Microsoft-Windows-Shell-Setup"
        setting_name = "AutoLogon"
        content      = "<AutoLogon><Password><Value>${var.attack_range_password}</Value></Password><Enabled>true</Enabled><LogonCount>1</LogonCount><Username>${var.user_name != null ? var.user_name : "AzureAdmin"}</Username></AutoLogon>"
    }

    additional_unattend_config {
      pass         = "oobeSystem"
      component    = "Microsoft-Windows-Shell-Setup"
      setting_name = "FirstLogonCommands"
      content      = file("${path.module}/files/FirstLogonCommands.xml")
    }
  }

  storage_os_disk {
    name              = "disk-${var.server_name}-${var.attack_range_id}"
    caching           = "ReadWrite"
    create_option     = "FromImage"
    managed_disk_type = "Standard_LRS"
    disk_size_gb      = var.root_volume_size
  }

  tags = {
    Name = "ar-${var.server_name}-${var.attack_range_id}"
  }
}

output "instance_id" {
  description = "ID of the created VM."
  value       = local.is_windows ? azurerm_virtual_machine.windows[0].id : azurerm_linux_virtual_machine.this[0].id
}

output "instance" {
  description = "The VM object."
  value       = local.is_windows ? azurerm_virtual_machine.windows[0] : azurerm_linux_virtual_machine.this[0]
}

output "private_ip" {
  description = "Private IP address of the VM."
  value       = azurerm_network_interface.this.private_ip_address
}

