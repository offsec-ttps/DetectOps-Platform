output "traffic_mirror_filter_id" {
  description = "The ID of the traffic mirror filter"
  value       = var.zeek_server ? aws_ec2_traffic_mirror_filter.zeek_filter[0].id : null
}

output "traffic_mirror_target_id" {
  description = "The ID of the traffic mirror target"
  value       = var.zeek_server ? aws_ec2_traffic_mirror_target.zeek_target[0].id : null
}
