# Documentation

**Route:** `/docs` · **Sidebar:** System → Documentation

The in-app documentation view surfaces the machine-generated reference produced by the platform's docs-agent.

## What it does

- Renders generated docs on demand (`/api/docs/generate`).
- Complements this MkDocs site — the same generated artifacts (`docs/generated/*`) power the [API Reference](../reference/api.md).

## Regenerating

```bash
npm run docs:generate      # writes docs/generated/*
```

This also runs automatically on `npm run build` (`postbuild`). See [Architecture → Auto-generated reference](../getting-started/architecture.md#auto-generated-reference).
