# This file is AUTO-GENERATED based on the template/config file.
# DO NOT EDIT MANUALLY - changes will be overwritten.
#
# Generated from: 6120688c-fe85-471c-88f1-b6e384c5805f.yml
# Attack Range ID: 6120688c-fe85-471c-88f1-b6e384c5805f
# Location: West Europe (from azure.location in config)
# Storage Account: terraformstate6120688cfe (derived from attack_range_id)
# Container: tfstate
# Resource Group: rg-terraform-state-6120688c-fe85-471c-88f1-b6e384c5805f
#
# To regenerate this file, run: python main.py build -t <template>
#
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-terraform-state-6120688c-fe85-471c-88f1-b6e384c5805f"
    storage_account_name = "terraformstate6120688cfe"
    container_name       = "tfstate"
    key                  = "terraform.tfstate"
  }
}
