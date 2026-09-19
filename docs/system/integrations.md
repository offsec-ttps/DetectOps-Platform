# Integrations

**Route:** `/integrations` · **Sidebar:** System → Integrations

Configure the external systems DetectOps talks to — SIEMs, ticketing, and other tools — with connection testing and SSO.

## What it does

- Register integrations and test connectivity (`/api/integrations`, `/[id]`, `/[id]/test`).
- Configure SSO for an integration (`/[id]/sso`).

## Why it matters

- **Detection validation** queries the SIEM you configure here (e.g. Splunk) to check whether detections fire — see [Detection Validation](../detection/detection-validation.md) and [Enterprise Use-Case Validation](../simulation/enterprise-use-cases.md).
- Ticketing/collaboration integrations back reporting and PR/issue workflows.

Secrets are encrypted at rest (`CREDENTIAL_VAULT_KEY`). For cloud provider credentials specifically, use [Settings → Cloud Credentials](settings.md).
