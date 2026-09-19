# Settings

**Route:** `/settings` · **Sidebar:** System → Settings

Settings & Administration — general platform configuration plus cloud credentials. The AI and outbound-MCP configuration have their own pages: [LLM Providers](llm-providers.md) and [MCP Servers](mcp-servers.md).

## Cloud Credentials — `/settings/cloud-credentials`

Store AWS / Azure / GCP credentials for [Cloud Lab](../labs/cloud-lab.md) builds and [Stratus](../simulation/enterprise-use-cases.md) cloud detonation.

- Encrypted at rest with `CREDENTIAL_VAULT_KEY` (`src/lib/crypto/credential-vault.ts`) — set that env var before storing creds you want to persist across restarts.
- APIs: `/api/cloud-credentials` (+ `/[id]`).

## Related settings pages

| Page | Purpose |
|------|---------|
| [LLM Providers](llm-providers.md) | Configure the LLM providers/models behind AI features. |
| [MCP Servers](mcp-servers.md) | Register outbound MCP servers for enrichment. |
| [Integrations](integrations.md) | Connect SIEMs/ticketing with connection testing + SSO. |

See the full environment reference in [Configuration](../getting-started/configuration.md).
