# CLI — `detectops`

Manage the full lifecycle of every lab — **Local**, **Cloud**, and **Fleet** — from the command line. The CLI drives the same HTTP API the dashboard uses, so anything you can do in the UI you can script.

- **Entry points:** `./detectops <group> <action> [flags]` · `node cli/detectops.mjs …` · `npm run cli -- …`
- **Zero dependencies** — Node 18+ built-in `fetch` only.
- **Target:** `http://localhost:3000` by default (override with `--host` or `DETECTOPS_HOST`).
- **Auth:** none needed in dev mode. If the server runs with `AUTH_ENFORCE=1`, pass the `do_session` cookie via `--token` or `DETECTOPS_SESSION`.

## Groups & actions

| Group | Actions |
|-------|---------|
| `local` | `templates` · `list` · `create` · `start` · `stop` · `destroy` · `status` · `vm-start` · `vm-stop` |
| `cloud` | `health` · `templates` · `list` · `create` · `destroy` · `status` |
| `fleet` | `list` · `create` · `start` · `stop` · `destroy` · `lab-create` |
| `all`   | `status` |

## Global flags

| Flag | Meaning |
|------|---------|
| `--host <url>` | API base (default `http://localhost:3000`, or `DETECTOPS_HOST`) |
| `--token <tok>` | `do_session` cookie for `AUTH_ENFORCE=1` (or `DETECTOPS_SESSION`) |
| `--wait` | poll a `create` until the lab is up (streams the latest log line) |
| `--yes`, `-y` | skip the confirmation prompt on `destroy` |
| `--json` | machine-readable JSON output |
| `--no-color` | plain output |

Destructive actions (`destroy`) prompt for confirmation; non-interactively they **refuse** unless `--yes` is given.

## Local Lab

```bash
detectops local templates                       # available on-prem templates
detectops local list                            # deployed labs + status
detectops local create --template sar-minimal \
  --network-base 192.168.56 --splunk-ram 4096 --splunk-cpus 2 --wait
detectops local status --id <id>                # target by --id | --name <substr> | --path <deployPath>
detectops local start   --name "SAR Minimal"    # power VMs on  (engine "resume")
detectops local stop    --name "SAR Minimal"    # power VMs off (kept)
detectops local destroy --path <deployPath> --yes
detectops local vm-start --vm <vmName>          # per-VM control
```

**Create flags:** `--template` `--network-base` `--admin-pw` `--splunk-ram` `--splunk-cpus` `--win-ram` `--win-cpus` `--deploy-path`.

The fleet Splunk detection lab is a local VM deploy, so once created it's managed with the same `local start|stop|destroy` commands.

## Cloud Lab

Requires the Cloud Controller running (`./start-server.sh` launches it; see [Cloud Lab](../labs/cloud-lab.md)).

```bash
detectops cloud health                          # controller + provider CLI readiness
detectops cloud templates                       # templates the controller offers
detectops cloud list                            # your attack ranges + status
detectops cloud create --template aws_sar_minimal \
  --set-general key=value                        # or: --body '<json>' / --body @file.json
detectops cloud destroy --id <range_id> --yes   # add --abort for an in-progress build
```

## Fleet Lab

```bash
detectops fleet list                            # C2 servers + native fleets + Splunk detection labs
detectops fleet create --provider caldera --managed --advertise-host 192.168.1.20
detectops fleet create --provider caldera --connect --url http://10.0.0.20:8888 --api-key <key>
detectops fleet start   --id <c2-id>
detectops fleet stop    --id <c2-id>
detectops fleet destroy --id <c2-id> --yes      # managed = torn down; connected = forgotten
detectops fleet lab-create --wait               # deploy the Splunk detection lab the fleet forwards to
```

## Everything at a glance

```bash
detectops all status                            # local + cloud + fleet in one view
```
