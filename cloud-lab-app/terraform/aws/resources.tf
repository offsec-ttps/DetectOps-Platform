locals {
  windows_user_data_template = <<EOF
<powershell>
$admin = [adsi]("WinNT://./%USERNAME%, user")
$admin.PSBase.Invoke("SetPassword", "${var.general.attack_range_password}")

# Stop WinRM service first
net stop winrm

# Configure WinRM from scratch
winrm quickconfig -q
winrm set winrm/config '@{MaxTimeoutms="1800000"}'
winrm set winrm/config/winrs '@{MaxMemoryPerShellMB="1024"}'
winrm set winrm/config/service '@{AllowUnencrypted="true"}'
winrm set winrm/config/service/auth '@{Basic="true"}'
winrm set winrm/config/client/auth '@{Basic="true"}'
winrm set winrm/config/listener?Address=*+Transport=HTTP '@{Port="5985"}'

# Configure firewall rules
netsh advfirewall firewall add rule name="WinRM 5985" protocol=TCP dir=in localport=5985 action=allow
netsh advfirewall firewall add rule name="WinRM 5986" protocol=TCP dir=in localport=5986 action=allow

# Enable PSRemoting and skip network profile check
Enable-PSRemoting -SkipNetworkProfileCheck -Force

# Configure WinRM service
sc.exe config winrm start=auto
net start winrm

# Enable RDP
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -name "fDenyTSConnections" -value 0

# Extend C drive
$drive_letter = "C"
$size = (Get-PartitionSupportedSize -DriveLetter $drive_letter)
Resize-Partition -DriveLetter $drive_letter -Size $size.SizeMax
</powershell>
EOF

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


  # AMI map - dynamically created from attack_range configuration
  ami_map = {
    for k, v in data.aws_ami.dynamic : k => v.id
  }

  # Check if zeek server should be enabled (if there's a server with zeek: true or name == "zeek")
  zeek_server_enabled = length([
    for server in var.attack_range : server 
    if try(server.zeek, false) || server.name == "zeek"
  ]) > 0

  # Find the zeek server configuration
  zeek_server_config = try(
    [for server in var.attack_range : server if try(server.zeek, false) || server.name == "zeek"][0],
    null
  )

  # Create a map of server names to session numbers for zeek monitoring
  zeek_session_numbers = {
    for idx, server in var.attack_range :
    server.name => 100 + idx
    if try(server.zeek_monitor, false)
  }
}

# Dynamic AMI data source - uses ami_name_filter and ami_owner from attack_range configuration
data "aws_ami" "dynamic" {
  for_each = {
    for server in var.attack_range : server.name => server
    if try(server.ami_name_filter, null) != null && try(server.ami_owner, null) != null
  }
  most_recent = true
  owners      = [each.value.ami_owner]

  filter {
    name   = "name"
    values = [each.value.ami_name_filter]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Data source for router Ubuntu AMI (always Ubuntu Jammy 22.04)
data "aws_ami" "router_ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Data source for Zeek server AMI (uses the zeek server's configuration from attack_range)
# The AMI will be looked up from the existing ami_map using the zeek server's name

module "networkModule" {
  source = "./modules/network"
  attack_range_id = var.general.attack_range_id
}

module "router" {
  source = "./modules/router"
  subnet_id = module.networkModule.public_subnet_id
  ami_id = data.aws_ami.router_ubuntu.id
  attack_range_id = var.general.attack_range_id
  vpc_id = module.networkModule.vpc_id
  key_name = var.general.key_name
  private_ip = "10.0.1.10"
  ip_whitelist = var.general.ip_whitelist
}

# Zeek server module (created before attack_range_servers to provide filter/target IDs)
# Uses the zeek server configuration from attack_range when zeek: true is set
module "zeek_server" {
  source = "./modules/zeek-server"

  zeek_server           = local.zeek_server_enabled
  ami_id                = local.zeek_server_config != null ? local.ami_map[local.zeek_server_config.name] : ""
  instance_type         = local.zeek_server_config != null ? local.zeek_server_config.instance_type : "m5.2xlarge"
  key_name              = local.zeek_server_config != null && !try(local.zeek_server_config.windows, false) ? var.general.key_name : null
  subnet_id             = module.networkModule.private_subnet_id
  private_ip            = local.zeek_server_config != null ? "10.0.2.${local.zeek_server_config.ip_last_octet}" : "10.0.2.50"
  attack_range_id       = var.general.attack_range_id
  attack_range_password = var.general.attack_range_password
  server_name           = local.zeek_server_config != null ? local.zeek_server_config.name : "zeek"
  vpc_id                = module.networkModule.vpc_id
}

# Dynamic module creation based on attack_range configuration
# Exclude zeek servers (they are handled by the zeek_server module)
module "attack_range_servers" {
  source   = "./modules/generic-server"
  for_each = {
    for server in var.attack_range : server.name => server
    if !try(server.zeek, false) && server.name != "zeek"
  }

  server_name                    = each.value.name
  attack_range_id                = var.general.attack_range_id
  attack_range_password          = var.general.attack_range_password
  ami_id                         = local.ami_map[each.value.name]
  instance_type                  = each.value.instance_type
  key_name                       = try(each.value.windows, false) ? null : var.general.key_name
  subnet_id                      = module.networkModule.private_subnet_id
  private_ip                     = "10.0.2.${each.value.ip_last_octet}"
  vpc_id                         = module.networkModule.vpc_id
  user_data                      = try(each.value.windows, false) == true ? replace(local.windows_user_data_template, "%USERNAME%", try(each.value.user_name, "Administrator")) : replace(replace(local.linux_user_data_template, "%USERNAME%", try(each.value.user_name, "ubuntu")), "%PASSWORD%", var.general.attack_range_password)
  zeek_monitor                   = try(each.value.zeek_monitor, false)
  zeek_traffic_mirror_filter_id  = local.zeek_server_enabled ? module.zeek_server.traffic_mirror_filter_id : null
  zeek_traffic_mirror_target_id  = local.zeek_server_enabled ? module.zeek_server.traffic_mirror_target_id : null
  zeek_session_number            = try(local.zeek_session_numbers[each.value.name], null)
}