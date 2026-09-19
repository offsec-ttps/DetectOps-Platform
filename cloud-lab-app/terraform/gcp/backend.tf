# This file is AUTO-GENERATED based on the template/config file.
# DO NOT EDIT MANUALLY - changes will be overwritten.
#
# Generated from: d59574fe-6313-4455-90c1-c16a0c334675.yml
# Attack Range ID: d59574fe-6313-4455-90c1-c16a0c334675
# Project ID: attack-range-483713 (from gcp.project_id in config)
# Bucket: terraform-state-d59574fe-6313-4455-90c1-c16a0c334675 (derived from attack_range_id)
#
# To regenerate this file, run: python main.py build -t <template>
#
terraform {
  backend "gcs" {
    bucket = "terraform-state-d59574fe-6313-4455-90c1-c16a0c334675"
    prefix = "terraform/state"
  }
}
