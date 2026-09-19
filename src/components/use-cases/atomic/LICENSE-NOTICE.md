# NOTICE — Atomic Red Team Builder

The UI under this directory is derived from **atomicgen.io**
(https://github.com/krdmnbrk/atomicgen.io), licensed under **Apache License 2.0**.

The full Apache 2.0 license is available at https://www.apache.org/licenses/LICENSE-2.0.

Copyright (c) 2024 Kerem Burak
Adaptations © 2026 DetectOps contributors.

## Adaptations from upstream

- Ported from JavaScript/CRA to TypeScript inside this Next.js 16 project.
- Replaced `react-ace` (does not support React 19) with `@uiw/react-codemirror`
  + `@codemirror/lang-yaml` for the YAML preview AND the inline command /
  cleanup editors. CodeMirror also drives the editable Attack Command box.
- Replaced the upstream landing-page `Navbar` + `ConfirmDialog` provider with
  the platform's existing chrome; the builder mounts inside our dashboard.
- Scoped MUI's `ThemeProvider` to this subtree only; the rest of the platform
  continues to use Tailwind. Theme switched to dark.
- AI assistant now calls the platform's server-side Anthropic helper at
  `POST /api/use-cases/ai/atomic-test` (Phase 2). Upstream BYO-key dialog
  removed because the platform has a unified provider.
- "Save to platform" button persists the test to the new `UseCase` /
  `Playbook` Prisma tables via `POST /api/use-cases`.
- `TechniquePicker` re-implemented as a tactic-grouped MUI dialog backed by
  `useAtomicIndex` (CSV fetched from redcanaryco/atomic-red-team), with a
  tactic-chip filter row and search.
- `RepoLoader` re-implemented as a two-stage dialog (browse techniques →
  pick a test from `T####.yaml`). Behavior matches upstream `RepoLoaderButton`.
- `UploadYaml` re-implemented to handle both wrapper YAMLs (with
  `atomic_tests:[]`) and bare single-test YAMLs; multi-test files open a
  test-selection dialog.
- `LoadSample` dropdown ships three curated samples (Hostname Discovery,
  Scheduled Task Startup, scp.exe push) — distinct from upstream's `samples/`
  folder but functionally equivalent.
- `AiAssistantBar` is a new component: fuse.js fuzzy search over the index
  (top-5 suggestions that pull the YAML directly), with a Generate button
  for the LLM path. Replaces upstream's modal-only AI flow.
- `YamlEmptyState` renders a "Get Started" panel when the form is pristine.
- Schema constants (`base`, `executor_names`, `supported_platforms`,
  `validationRules`) kept verbatim.
