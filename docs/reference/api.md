# API Reference

DetectOps exposes its functionality through Next.js API routes under `/api/`. A machine-generated, always-current reference is produced by the in-app **docs-agent** (`npm run docs:generate`, also run on `postbuild`) into `docs/generated/`.

## Auto-generated reference

These pages regenerate on every build — treat them as living reference:

- **API reference** — `generated/api-reference.md`
- **Routes map** — `generated/routes-map.md`
- **Architecture** — `generated/architecture.md`
- **Service map** — `generated/service-map.md`
- **Data flows** — `generated/data-flows.md`
- **Components** — `generated/components.md`
- **Types** — `generated/types.md`
- **Dependencies** — `generated/dependencies.md`

!!! note
    `docs/generated/analysis.json` is the raw data behind these pages and is excluded from the site. If the generated pages are missing, run `npm run docs:generate`.

## Key API groups

| Group | Base path | Covered in |
|-------|-----------|-----------|
| Detection lab (local) | `/api/detection-lab/*` | [Local Lab](../labs/local-lab.md) |
| Cloud lab (SAR proxy) | `/api/detection-lab/cloud/*` | [Cloud Lab](../labs/cloud-lab.md) |
| Fleet (dashboard) | `/api/fleets/*` | [Fleet Server](../labs/fleet-server.md) |
| Fleet (agent) | `/api/v1/*` | [Fleet Server](../labs/fleet-server.md) |
| SAR simulation | `/api/sar/*` | [Campaign Designer](../simulation/campaign-designer.md) |
| Enterprise use cases | `/api/enterprise-use-cases/*` | [Enterprise Use-Case Validation](../simulation/enterprise-use-cases.md) |
| Environment targets | `/api/environment-targets/*` | [Enterprise Environments](../simulation/enterprise-environments.md) |
| Use cases (builder) | `/api/use-cases/*` | [Custom Simulation Builder](../simulation/custom-simulation-builder.md) |
| Atomic tests | `/api/atomic-tests/*` | [Atomic Test Library](../content/atomic-test-library.md) |
| Community content | `/api/community/*` | [Community Content](../content/community-content.md) |
| Threat intel | `/api/threat-intel/*` | [Threat Aggregator](../content/threat-aggregator.md) |
| SigmaGen | `/api/sigmagen/*` | [SigmaGen AI](../content/sigmagen-ai.md) |
| Detection packs | `/api/detection-packs/*` | [Detection Packs](../detection/detection-packs.md) |
| Modules | `/api/modules/*` | [Module Marketplace](../system/module-marketplace.md) |
| MCP server | `/api/mcp/*` | [MCP Server](../system/mcp-server.md) |
| Replay | `/api/replay/*` | [Replay Catalog](../simulation/replay-catalog.md) |

## Auth

Dashboard/admin routes are session-gated when `AUTH_ENFORCED=true` (`requireUser` / `requireRole` / `ownsOr404` in `src/lib/auth-guard.ts`). The public MCP endpoint (`/api/mcp`) is always gated by an issued `dmcp_` API key.
