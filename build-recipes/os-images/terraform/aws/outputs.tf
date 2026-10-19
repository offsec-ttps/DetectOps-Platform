output "public_ip" {
  description = "Public IP the platform SSH-provisions and the analyst reaches (app ports, analyst-IP-locked)."
  value       = aws_instance.lab.public_ip
}

output "instance_id" {
  description = "EC2 instance id (for start/stop/destroy)."
  value       = aws_instance.lab.id
}

output "ssh_user" {
  description = "Default SSH user for the Ubuntu AMI."
  value       = "ubuntu"
}
