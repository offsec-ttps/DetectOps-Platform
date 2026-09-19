locals {
  windows_user_data_template = "windows"

  linux_user_data_template = <<EOF
#!/bin/bash
set -e
# Set password for %USERNAME% user
# Create a temporary file to avoid shell quoting issues with special characters
TMPFILE=$(mktemp)
echo '%USERNAME%:%PASSWORD%' > "$TMPFILE"
/usr/sbin/chpasswd < "$TMPFILE"
rm -f "$TMPFILE"

# Verify password was set
if [ $? -eq 0 ]; then
  echo "Password set successfully for %USERNAME%"
else
  echo "Failed to set password for %USERNAME%" >&2
  exit 1
fi

# Unlock the user account (important for Ubuntu cloud images)
usermod -U %USERNAME% 2>/dev/null || true

# Remove password expiration
chage -E -1 -m 0 -M 99999 -I -1 -W 7 %USERNAME% 2>/dev/null || passwd -u %USERNAME% 2>/dev/null || true

# Create a higher priority SSH config file to override cloud-init settings
# Cloud-init creates /etc/ssh/sshd_config.d/60-cloudimg-settings.conf which disables password auth
# We create 99-enable-password.conf which loads after it and overrides those settings
cat > /etc/ssh/sshd_config.d/99-enable-password.conf <<'SSHCONF'
PasswordAuthentication yes
KbdInteractiveAuthentication yes
PubkeyAuthentication yes
UsePAM yes
SSHCONF

# Ensure the config directory exists and has correct permissions
chmod 644 /etc/ssh/sshd_config.d/99-enable-password.conf

# Restart SSH service
systemctl restart sshd || service ssh restart

# Wait a moment for SSH to fully restart
sleep 2

# Verify the configuration
echo "SSH PasswordAuthentication (effective): $(sshd -T | grep -i passwordauthentication || echo 'check failed')"
echo "User %USERNAME% account status: $(passwd -S %USERNAME% 2>/dev/null || echo 'unknown')"
EOF
}

module "networkModule" {
  source = "./modules/network"
  attack_range_id = var.general.attack_range_id
  location = var.azure.location
  router_private_ip = "10.0.1.10"
  ip_whitelist = var.general.ip_whitelist
}

module "router" {
  source = "./modules/router"
  subnet_id = module.networkModule.public_subnet_id
  attack_range_id = var.general.attack_range_id
  location = var.azure.location
  resource_group_name = module.networkModule.resource_group_name
  key_name = var.general.key_name
  private_ip = "10.0.1.10"
  public_key_path = var.azure.public_key_path
  private_key_path = var.azure.private_key_path
}

# Dynamic module creation based on attack_range configuration
module "attack_range_servers" {
  source   = "./modules/generic-server"
  for_each = {
    for server in var.attack_range : server.name => server
  }

  server_name                    = each.value.name
  attack_range_id                = var.general.attack_range_id
  attack_range_password          = var.general.attack_range_password
  image_publisher                = try(each.value.image_publisher, try(each.value.windows, false) ? "MicrosoftWindowsServer" : "canonical")
  image_offer                    = try(each.value.image_offer, try(each.value.windows, false) ? "WindowsServer" : "0001-com-ubuntu-server-jammy")
  image_sku                      = try(each.value.image_sku, try(each.value.windows, false) ? "2022-datacenter" : "22_04-lts")
  instance_type                  = each.value.instance_type
  key_name                       = try(each.value.windows, false) ? null : var.general.key_name
  subnet_id                      = module.networkModule.private_subnet_id
  private_ip                     = "10.0.2.${each.value.ip_last_octet}"
  resource_group_name            = module.networkModule.resource_group_name
  location                       = var.azure.location
  user_data                      = try(each.value.windows, false) == true ? local.windows_user_data_template : replace(replace(local.linux_user_data_template, "%USERNAME%", try(each.value.user_name, "ubuntu")), "%PASSWORD%", var.general.attack_range_password)
  public_key_path                = var.azure.public_key_path
  private_key_path               = var.azure.private_key_path
  user_name                      = try(each.value.user_name, null)
}

