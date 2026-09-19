output "packet_mirror_policy_id" {
  description = "The ID of the packet mirroring policy"
  value       = var.zeek_server ? google_compute_packet_mirroring.zeek_mirror[0].id : null
}

output "zeek_instance_id" {
  description = "The ID of the Zeek instance"
  value       = var.zeek_server ? google_compute_instance.zeek_sensor[0].id : null
}
