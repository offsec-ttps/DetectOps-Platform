# Build Forge

**Route:** `/build-forge` · **Sidebar:** Simulation → Build Forge

Build Forge is the tooling supply chain for simulations: discover attacker tooling from GitHub, fetch or build binaries, and organize them into **binary collections** you can pull into scenarios.

## What it does

- **Discover** repos and releases via GitHub search (`/api/build-forge/github-search`, `/repos`, `/releases/[owner]/[repo]`).
- **Fetch** prebuilt release binaries (`/releases/download`, `/meta-binaries/[owner]/[repo]`).
- **Build / compile** tooling and track builds (`/builds`, `/builds/[id]`, `/builds/[id]/download`).
- **Organize** results into reusable binary collections (`/binary-collection`, `/binary-collection/[id]`, `/builds/[id]/save-to-collection`).

## Typical workflow

```mermaid
graph LR
    S[Search GitHub] --> F[Fetch release / build from source]
    F --> C[Save to binary collection]
    C --> U[Use in simulations]
```

Binary collections give simulations and fleet campaigns a consistent, version-pinned set of tooling to deploy.

!!! warning "Authorized use only"
    Build Forge fetches and compiles offensive tooling. Use it only for authorized, defensive testing on systems you are permitted to test.
