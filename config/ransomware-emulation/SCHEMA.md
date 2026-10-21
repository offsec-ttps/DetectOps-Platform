# Ransomware emulation plan — file format

One JSON file per ransomware group: `config/ransomware-emulation/plans/<slug>.json`.
A plan maps a group's **publicly reported** TTPs (MITRE ATT&CK, CISA #StopRansomware
advisories, vendor research) to an ordered attack chain, and each chain step to
**existing** Atomic Red Team tests from the local catalogue (`atomic_tests`). Plans
never introduce new commands or payloads — a step with no suitable local atomic is
recorded as a coverage gap (`noAtomicReason`).

```jsonc
{
  "gang": "LockBit",                 // EXACT ransomware_gangs.name in the DB
  "displayName": "LockBit 3.0",
  "aliases": ["LockBit Black"],
  "status": "active",                // active | disrupted | defunct | rebranded
  "activeSince": "2019",
  "lineage": "",                     // e.g. "Successor of Conti", "Rebrand of Royal"
  "summary": "2–4 sentence profile of the operation and how it intrudes.",
  "uniqueTraits": ["What distinguishes this group's tradecraft from generic ransomware"],
  "insufficientReporting": false,    // true when public TTP reporting is too thin for a full chain
  "sources": [
    { "id": "S1", "title": "...", "publisher": "CISA", "date": "2023-03-16", "url": "https://..." }
  ],
  "chain": [
    {
      "order": 1,
      "tactic": "initial-access",    // ATT&CK tactic slug
      "techniqueId": "T1190",
      "techniqueName": "Exploit Public-Facing Application",
      "procedure": "Observed group-specific behaviour, e.g. exploits Citrix Bleed (CVE-2023-4966).",
      "tools": ["..."],
      "signature": true,             // true = specialised/distinctive for this group; false = common ransomware tradecraft
      "observed": "current",         // historical | current | both
      "sourceRefs": ["S1"],
      "atomics": [
        { "testGuid": "<from local catalogue>", "testNumber": 1, "testName": "...",
          "fidelity": "exact",         // exact = reproduces the procedure; close = same technique+tooling class; proxy = same technique, different implementation
          "note": "why this test represents the procedure" }
      ],
      "noAtomicReason": ""           // filled when atomics is empty
    }
  ]
}
```

Rules
- Every chain step cites at least one source in `sourceRefs`. No unsourced TTPs.
- `testGuid` values must exist in the local catalogue (validated by
  `scripts/validate-ransomware-plans.py`). Prefer Windows tests.
- Order the chain by kill-chain phase (initial access → … → impact). 8–18 steps.
- Impact / recovery-inhibition / credential-dumping steps are still mapped; the
  sweep engine excludes them automatically and the report shows them as
  "mapped — not detonated (destructive / session-poisoning)".
