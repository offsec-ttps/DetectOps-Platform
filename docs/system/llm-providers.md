# LLM Providers

**Route:** `/settings/llm-providers` · **Sidebar:** System → LLM Providers

Configure the LLM providers and models that power [SigmaGen AI](../content/sigmagen-ai.md), [Detection Packs](../detection/detection-packs.md), and the AI assistants throughout the app.

## Supported providers

Anthropic, OpenAI, OpenRouter, NVIDIA, and Ollama (local). Default provider resolution: `LLM_PROVIDER_DEFAULT` if set, otherwise **Anthropic → OpenAI → OpenRouter → NVIDIA → Ollama** (Ollama last so a local daemon isn't auto-selected).

## What it does

- Add, edit, and **test** provider configs and list their models.
- DB-managed keys are stored encrypted at rest and take precedence over environment variables.

## APIs

`/api/llm-providers` (+ `/test`, `/configs` + `/[id]`, `/[id]/models`, `/[id]/test`, `/test-unsaved`).

## Related

- [Configuration → LLM providers](../getting-started/configuration.md#llm-providers) — the env-var equivalents.
- [MCP Servers](mcp-servers.md) — outbound MCP enrichment used alongside LLMs.
