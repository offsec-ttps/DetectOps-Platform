# labs/ — Detection Engineering Lab Deployments

This directory is the local hub for lab deployment management. It never modifies your existing SAR or GOAD installations.

## Structure

```
labs/
├── README.md
├── registry/
│   └── sources.json          # Known local installations (paths, configs)
├── .blueprints/              # Snapshotted configs from existing installs (auto-generated)
│   ├── sar-local/            # Copied SAR configs
│   ├── goad-local/           # Copied GOAD configs
│   └── sar-goad-standalone/  # Copied SAR+GOAD configs
└── deployments/              # Active deployments created from blueprints
    └── <deployment-id>/      # Each deployment gets its own directory
```

## How it works

1. **Registry** — `sources.json` points to your existing SAR/GOAD installations
2. **Scan** — The platform reads configs from those paths (read-only, never writes)
3. **Blueprint** — Configs are copied into `.blueprints/` as reusable snapshots
4. **Deploy** — When you deploy a template, configs are copied from blueprints to a user-chosen path under `deployments/` (or any path on any drive)

## Adding a new source

Edit `registry/sources.json` and add your installation path. The platform will pick it up on next scan.
