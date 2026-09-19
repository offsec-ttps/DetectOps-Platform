locals {
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

  windows_user_data_template = <<EOF
$admin = [adsi]("WinNT://./%USERNAME%, user")
$admin.PSBase.Invoke("SetPassword", "${var.general.attack_range_password}")
if ($?) {
    Add-Content -Path C:\startup_log.txt -Value "Password set successfully for Administrator."
} else {
    Add-Content -Path C:\startup_log.txt -Value "Failed to set password for Administrator."
}
net user Administrator /active:yes
if ($admin.AccountDisabled -eq $false) {
    Add-Content -Path C:\startup_log.txt -Value "Administrator account enabled."
} else {
    Add-Content -Path C:\startup_log.txt -Value "Administrator account NOT enabled."
}
winrm quickconfig -q

# Enable Debugging mode
# winrm set winrm/config/service @{EnableDebugLogging="true"}

# Increase Max Concurrent Requests
winrm set winrm/config/service '@{MaxConcurrentUsers="50"}'

# Increase Max Connections per Shell
winrm set winrm/config/winrs '@{MaxShellsPerUser="50"}'

# Increase Memory Limit per Shell
# winrm set winrm/config/winrs '@{MaxMemoryPerShellMB="4096"}'

# Set operation timeout to 10 minutes
winrm set winrm/config '@{MaxTimeoutms="3600000"}'
# winrm set winrm/config/winrs '@{IdleTimeout="600000"}'

# Increase the request queue limit
# winrm set winrm/config/winrs '@{MaxProcessesPerShell="25"}'

# Increase Max Concurrent Operations for WinRS
# winrm set winrm/config/service '@{MaxConcurrentOperations="4294967295"}'
# winrm set winrm/config/service '@{MaxConcurrentOperationsPerUser="4294967295"}'
winrm set winrm/config/service '@{MaxConcurrentOperations="4294967295"; MaxConcurrentOperationsPerUser="4294967295"; MaxConnections="4294967295"}'
winrm set winrm/config/winrs '@{MaxMemoryPerShellMB="4096"; MaxProcessesPerShell="50"; IdleTimeout="3600000"}'

winrm set winrm/config/service '@{AllowUnencrypted="true"}' 

Set-Item -Path WSMan:\localhost\Service\AllowUnencrypted -Value true

# Add the Ansible controller to trusted hosts
Set-Item WSMan:\localhost\Client\TrustedHosts -Value "*" -Force

# Enable KeepAlive for the HTTPS Listener
if (Test-Path WSMan:\localhost\Service\KeepAlive) {
    Write-Host "Keep alive true"
    Set-Item -Path WSMan:\localhost\Service\KeepAlive -Value $true
} else {
    Write-Host "KeepAlive path does not exist."
}

winrm set winrm/config/service/auth '@{Basic="true"}'
$ExternalIP = Invoke-RestMethod -Uri "http://ifconfig.me/ip"
# $ExternalIP = (Invoke-WebRequest -uri http://metadata.google.internal/computeMetadata/v1/instances/external_ip -Headers @{"Metadata-Flavor"="Google"}) | Select-Object -ExpandProperty Content # Get external IP
$InternalIP = (Get-NetIPAddress | Where-Object {$_.InterfaceAlias -like "*Ethernet*" -and $_.AddressFamily -eq 'IPv4'}).IPAddress  # Get internal IP

# Use internal IP or hostname for the certificate
$hostname = [System.Net.Dns]::GetHostName()
# $Cert = New-SelfSignedCertificate -DnsName $hostname -CertStoreLocation "Cert:\LocalMachine\My"
$Cert = New-SelfSignedCertificate -DnsName $hostname, $ExternalIP, $InternalIP -CertStoreLocation "Cert:\LocalMachine\My"  # Use external and internal IPs
$CertDetails = @{
  Thumbprint = $Cert.Thumbprint
  Subject = $Cert.Subject
  DnsNameList = $Cert.DnsNameList
}
$CertDetails | Out-File -FilePath C:\certificate_details.txt
$Thumbprint = $Cert.Thumbprint

# Check and create HTTP listener on port 5985
$existingHttpListener = (winrm enumerate winrm/config/Listener | Select-String -Pattern "Transport=HTTP")
if (-not $existingHttpListener) {
    winrm create winrm/config/Listener?Address=*+Transport=HTTP+Port=5985
    Write-Host "HTTP listener created on port 5985."
} else {
    Write-Host "HTTP listener already exists on port 5985."
}

# Check and create HTTPS listener on port 5986
$existingHttpsListener = (winrm enumerate winrm/config/Listener | Select-String -Pattern "Transport=HTTPS")
if (-not $existingHttpsListener) {
    winrm create winrm/config/Listener?Address=*+Transport=HTTPS @{Hostname="$hostname"; CertificateThumbprint="$Thumbprint"}
    Write-Host "HTTPS listener created on port 5986."
} else {
    Write-Host "HTTPS listener already exists on port 5986."
}

netsh advfirewall firewall add rule name="WinRM HTTP" protocol=TCP dir=in localport=5985 action=allow
netsh advfirewall firewall add rule name="WinRM HTTPS" protocol=TCP dir=in localport=5986 action=allow

# Add firewall rule for RDP (port 3389)
netsh advfirewall firewall add rule name="RDP" protocol=TCP dir=in localport=3389 action=allow

net stop winrm
sc.exe config winrm start=auto

# Set WinRM to restart automatically on failure
sc.exe failure winrm reset= 0 actions= restart/5000/restart/5000/restart/5000

# Define task name
$taskName = "Restart WinRM Service"

# Check if the task already exists
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    # Remove the existing task
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Existing task '$taskName' removed."
}

# Define the action and trigger
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-Command "Restart-Service winrm"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 365) # 1 year

# Register the new task
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName $taskName -Description "Restarts WinRM if it crashes"

Write-Host "Task '$taskName' created or recreated successfully."
Get-ScheduledTask | Where-Object { $_.TaskName -eq "Restart WinRM Service" }

net start winrm
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -name "fDenyTSConnections" -value 0
Enable-PSRemoting -SkipNetworkProfileCheck -Force

# Get the system drive dynamically
# $drive_letter = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -gt 0 }).Name[0]
# Get the drive letter of the first drive with free space
$drive_letter = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 }).Name[0]

# Get the partition size details
try {
    # Get the drive letter of the first drive with free space
    $drive_letter = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 }).Name[0]

    # Get the partition size details
    $size = Get-PartitionSupportedSize -DriveLetter $drive_letter
    Write-Host "Size Left: Min = $($size.SizeMin), Max = $($size.SizeMax)"

    # Check if the maximum available size is greater than or equal to 1GB
    if ($size.SizeMax -ge (1GB)) {
        # Ensure the new size is valid and larger than the current partition size
        $currentPartitionSize = (Get-Partition -DriveLetter $drive_letter).Size
        Write-Host "Current Partition Size: $currentPartitionSize bytes"

        if ($size.SizeMax -gt $currentPartitionSize) {
            try {
                # Resize the partition to the maximum supported size
                Resize-Partition -DriveLetter $drive_letter -Size $size.SizeMax
                Write-Host "Partition resized to $($size.SizeMax) bytes."
            } catch {
                Write-Host "Error resizing partition: $($_.Exception.Message)"
            }
        } else {
            Write-Host "No resize needed. Maximum size is equal to or less than the current partition size."
        }
    } else {
        Write-Host "Insufficient space to resize the partition. Maximum available is $($size.SizeMax) bytes. Minimum required is 1GB."
    }
} catch {
    Write-Host "Error during partition resize operation: $($_.Exception.Message)"
}
winrm enumerate winrm/config/Listener | Out-File -FilePath C:\winrm_listener_status.txt
EOF

  # Image map - dynamically created from attack_range configuration
  image_map = {
    for k, v in data.google_compute_image.dynamic : k => v.self_link
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

  # Create a map of server names to priority numbers for packet mirroring
  packet_mirror_priorities = {
    for idx, server in var.attack_range :
    server.name => 100 + idx
    if try(server.zeek_monitor, false)
  }
}

# Dynamic image data source - uses image_family and image_project from attack_range configuration
data "google_compute_image" "dynamic" {
  for_each = {
    for server in var.attack_range : server.name => server
    if try(server.image_family, null) != null && try(server.image_project, null) != null
  }
  family  = each.value.image_family
  project = each.value.image_project
}

# Data source for router Ubuntu image (always Ubuntu 22.04 LTS)
data "google_compute_image" "router_ubuntu" {
  family  = "ubuntu-2204-lts"
  project = "ubuntu-os-cloud"
}

module "networkModule" {
  source = "./modules/network"
  attack_range_id = var.general.attack_range_id
  project_id = var.gcp.project_id
  region = var.gcp.region
  router_private_ip = "10.0.1.10"
  ip_whitelist = var.general.ip_whitelist
}

module "router" {
  source = "./modules/router"
  subnet_id = module.networkModule.public_subnet_id
  image_self_link = data.google_compute_image.router_ubuntu.self_link
  attack_range_id = var.general.attack_range_id
  project_id = var.gcp.project_id
  region = var.gcp.region
  zone = var.gcp.zone
  network_name = module.networkModule.network_name
  key_name = var.general.key_name
  private_ip = "10.0.1.10"
  public_key_path = var.gcp.public_key_path
  private_key_path = var.gcp.private_key_path
  ip_whitelist = var.general.ip_whitelist
}

# Zeek server module (created before attack_range_servers to provide packet mirror policy)
# Uses the zeek server configuration from attack_range when zeek: true is set
module "zeek_server" {
  source = "./modules/zeek-server"

  zeek_server           = local.zeek_server_enabled
  image_self_link       = local.zeek_server_config != null ? local.image_map[local.zeek_server_config.name] : ""
  machine_type          = local.zeek_server_config != null ? local.zeek_server_config.instance_type : "n1-standard-8"
  key_name              = local.zeek_server_config != null && !try(local.zeek_server_config.windows, false) ? var.general.key_name : null
  subnet_id             = module.networkModule.private_subnet_id
  private_ip            = local.zeek_server_config != null ? "10.0.2.${local.zeek_server_config.ip_last_octet}" : "10.0.2.50"
  attack_range_id       = var.general.attack_range_id
  attack_range_password = var.general.attack_range_password
  server_name           = local.zeek_server_config != null ? local.zeek_server_config.name : "zeek"
  project_id            = var.gcp.project_id
  region                = var.gcp.region
  zone                  = var.gcp.zone
  network_name          = module.networkModule.network_name
  public_key_path       = var.gcp.public_key_path
  private_key_path      = var.gcp.private_key_path
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
  image_self_link                = local.image_map[each.value.name]
  machine_type                   = each.value.instance_type
  key_name                       = try(each.value.windows, false) ? null : var.general.key_name
  subnet_id                      = module.networkModule.private_subnet_id
  private_ip                     = "10.0.2.${each.value.ip_last_octet}"
  project_id                     = var.gcp.project_id
  zone                           = var.gcp.zone
  network_name                   = module.networkModule.network_name
  user_data                      = try(each.value.windows, false) == true ? replace(local.windows_user_data_template, "%USERNAME%", try(each.value.user_name, "Administrator")) : replace(replace(local.linux_user_data_template, "%USERNAME%", try(each.value.user_name, "ubuntu")), "%PASSWORD%", var.general.attack_range_password)
  public_key_path                = var.gcp.public_key_path
  private_key_path               = var.gcp.private_key_path
  zeek_monitor                   = try(each.value.zeek_monitor, false)
  zeek_packet_mirror_policy_id   = local.zeek_server_enabled ? module.zeek_server.packet_mirror_policy_id : null
  zeek_priority                  = try(local.packet_mirror_priorities[each.value.name], null)
  user_name                      = try(each.value.user_name, null)
}
