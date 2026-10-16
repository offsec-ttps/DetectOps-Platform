# Custom Attack-Simulation Modules

Analysts can create their own simulation modules without writing application code. A
module is **declarative content** — a JSON manifest that references existing Atomic
Red Team tests. The platform validates, signs, versions, and installs it, and it then
appears under **Attack Simulations** and the **Marketplace** alongside the built-in
libraries (Active Directory, Cloud, Container, Privilege Escalation, …).

This guide covers how to create, test, deploy, and manage a custom module, and the
limitations to know.

## The two kinds of module

A module's `contributes` block decides what it does. Pick one of two shapes:

1. **Scenario module** — an ordered chain of curated atomic tests. Use it to emulate a
   specific attack sequence. Each step references a real Atomic Red Team test by its
   `testGuid`. This runs through the existing runner and detection scoring.
2. **Catalog module** (`view: "attack-catalog"`) — a browsable library of ATT&CK
   techniques grouped by tactic/domain, exactly like the Active Directory library.
   Each technique resolves to its real atomic tests; the analyst ticks the ones to run
   and hands them to the **Campaign Designer**. This shape has no `scenarios` — the
   view drives execution — so a "module has no scenarios" validation warning is
   expected and can be ignored for catalog modules.

## Create a module

### Option A — the Builder UI (recommended)

Open **Marketplace → Build** (`/marketplace/build`). The builder gives you a starter
manifest and a live validation playground: as you edit, it validates the manifest and
compiles the atomic references, showing errors and warnings inline before you submit.

### Option B — submit a JSON package via the API

Fetch a starter template, edit it, dry-validate it, then submit:

```bash
# 1. Starter template
curl -s http://localhost:3000/api/modules/template > my-module.json

# 2. Dry-validate (no DB write) — returns { ok, errors, warnings, stepCount }
curl -s -X POST http://localhost:3000/api/modules/validate \
  -H 'Content-Type: application/json' -d @my-module.json

# 3. Submit — stores it as status=submitted and queues validation
curl -s -X POST http://localhost:3000/api/modules \
  -H 'Content-Type: application/json' -d @my-module.json
```

## Manifest reference

```jsonc
{
  "id": "yourteam.my-module",            // globally unique, lowercase, dot-separated
  "name": "My Module",
  "version": "1.0.0",                    // valid semver
  "category": "privilege-escalation",    // see allowed categories below
  "description": "What this module simulates and why.",
  "author": "Your Team",
  "icon": "ShieldAlert",                 // a lucide icon name
  "compatibleCoreVersion": "^1.0.0",     // semver range the platform must satisfy
  "permissions": {
    "frameworks": ["atomic"],            // declare what the module uses
    "integrations": ["siem"],
    "dataScopes": ["atomic-catalogue:read"]
  },
  "dependencies": [],
  "contributes": {
    "nav": [{ "label": "My Module", "icon": "ShieldAlert" }],

    // --- Scenario module ---
    "scenarios": [{
      "name": "Demo scenario",
      "description": "Single curated atomic.",
      "steps": [{
        "framework": "atomic",
        "refId": "f3132740-55bc-48c4-bcc0-758a459cd027",  // a real AtomicTest testGuid
        "techniqueId": "T1059.001",
        "displayName": "PowerShell demo step"
      }]
    }]

    // --- OR Catalog module ---
    // "view": "attack-catalog",
    // "scenarios": [],
    // "catalog": [{
    //   "name": "Discovery",            // tactic label (becomes a group)
    //   "domain": "Windows",            // optional facet
    //   "description": "Enumerate the host.",
    //   "techniques": [{ "id": "T1087.001", "name": "Local Account Discovery", "tactic": "discovery" }]
    // }]
  }
}
```

**Allowed `category` values:** `ransomware`, `phishing`, `lateral-movement`,
`exfiltration`, `persistence`, `credential-access`, `c2`, `discovery`, `impact`,
`apt`, `container`, `cloud`, `active-directory`, `hacktools`, `deceptive-delivery`,
`privilege-escalation`, `uac-bypass`, `user-to-admin`, `user-to-system`, `other`.

Finding a `testGuid`: the **Atomic Test Library** page lists every test; the GUID is on
each test's detail panel. Catalog modules reference ATT&CK technique IDs instead, and
the platform resolves them to the matching atomics automatically.

## Lifecycle: validate → submit → approve → install

| Stage | Status | How |
|---|---|---|
| Dry-validate | — | `POST /api/modules/validate` (stateless, no write) |
| Submit | `submitted` | `POST /api/modules`; queues an async validation run (schema + atomic-ref compile + AI review) |
| Decide | `live` or `needs-human` | auto-approved on a clean validation, else an admin decides |
| Approve | `live` | `POST /api/modules/{id}/approve {"decision":"approve"}` (admin) |
| Install | `enabled` | `POST /api/modules/{id}/install`; verifies dependencies and enables it |

Once installed, the module shows under **Attack Simulations** and is runnable like any
built-in library. A scenario module runs from its module page; a catalog module opens
the attack-catalog table and hands selections to the Campaign Designer.

End-to-end, by API:

```bash
MID=yourteam.my-module
curl -s -X POST http://localhost:3000/api/modules -H 'Content-Type: application/json' -d @my-module.json
curl -s -X POST http://localhost:3000/api/modules/$MID/approve -H 'Content-Type: application/json' -d '{"decision":"approve"}'
curl -s -X POST http://localhost:3000/api/modules/$MID/install  -H 'Content-Type: application/json' -d '{}'
```

## Test a module

- **Before submitting:** use `POST /api/modules/validate` (or the builder playground).
  It validates the manifest schema and compiles every atomic `refId` against the local
  Atomic Red Team catalogue, so a typo'd GUID or an undeclared permission fails fast.
- **After installing:** open the module and run it. A scenario module runs its steps
  through the runner; a catalog module runs selected use cases through the Campaign
  Designer, which handles the target environment and detection scoring.
- **Real detonation:** running against a live endpoint needs a **fleet node** (the
  agent prepare script installs Atomic Red Team and PurpleSharp) or the **SAR** lab.
  Without one, runs execute in simulate-only / stub mode.

## Manage, version, remove

- **New version:** resubmit the same `id` with a higher `version`; history is kept
  under `ModuleVersion`.
- **Edit metadata:** `PATCH /api/modules/{id}`.
- **Remove:** `DELETE /api/modules/{id}`.
- **List yours:** `GET /api/modules?mine=1` (filter by `category`, `status`, `q`).

## Limitations & requirements

- **Atomics only.** Steps reference existing Atomic Red Team tests by `testGuid`; a
  module cannot carry raw shell commands. This keeps execution inside the signed,
  hash-verified bundle model. (Catalog modules reference ATT&CK technique IDs, which
  resolve to those same atomics.)
- **The referenced atomic must exist locally.** Sync the Atomic Test Library first; an
  unknown `testGuid` fails validation.
- **Valid manifest.** `id` must be unique and you must own it to resubmit; `version`
  must be valid semver; `category` must be one of the allowed values; permissions used
  must be declared.
- **Signing & ownership.** Submitting content-hashes and signs the package and records
  you as owner. A module id owned by another publisher cannot be overwritten.
- **Marketplace flag.** The module APIs require the marketplace feature to be enabled.
- **Windows scope.** Catalog modules in the `active-directory`, `uac-bypass`,
  `user-to-admin`, and `user-to-system` categories are scoped to Windows atomic tests
  so cross-platform tests of a shared technique don't appear.
- **PurpleSharp** (alternative engine for catalog modules) runs only on a Windows fleet
  node that has it installed; otherwise the Atomic Red Team engine is used.

## Worked example

The five tactic-lens libraries shipped with the platform (Privilege Escalation,
Lateral Movement, UAC Bypass, User to Admin, User to SYSTEM) are catalog modules built
exactly this way. Copy one of their manifests from `src/lib/modules/seed-simulations.ts`
as a reference for a well-formed catalog module.
