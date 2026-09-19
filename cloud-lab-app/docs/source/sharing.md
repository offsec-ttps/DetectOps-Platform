# Sharing

You can give other people access to the same Attack Range by generating additional **WireGuard client** configs. Each person gets their own config; multiple users can be connected at the same time.

## How sharing works

- The Attack Range VPN (WireGuard) supports multiple **peers** (clients).
- The first client (`client1`) is created during the initial build. Its config is what you use to connect.
- **Sharing** adds a new peer (e.g. `alice`): the backend generates a new key pair and WireGuard config, runs the VPN playbooks to update the router, and stores the new config in the range’s config file under `general.sharing` (and returns it in the API response).

Recipients import their config into WireGuard and connect the same way you do; they then see the same private IPs (Splunk, Windows, etc.) and use the same credentials you have (from the config or the app).

## When you can share

- **wait_for_vpn** — VPN is up but lab might not be built yet. You can still share so someone else can use the same VPN (e.g. for phase 2 or future use).
- **running** — Lab is full up; sharing gives full access to the range.

You need the **attack_range_id** (and in the API, a config file in `config/<attack_range_id>.yml`).

## Using the app

1. Open the range (e.g. from the list) so you see its status.
2. Use the **Share** action (or equivalent).
3. Enter a **name** for the new user (e.g. `alice`).
4. The app shows or downloads the new WireGuard config. Send that file (or its contents) to the other person securely.
5. They import it into WireGuard and connect.

## Using the API

**Endpoint:** `POST /attack-range/share`

**Body:**

```json
{
  "attack_range_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "alice"
}
```

**Response (200):** Includes the new client config (e.g. in `config`) and a message. The config is also written to the range’s YAML under `general.sharing.<name>` so you can retrieve it later from `GET /configs/<attack_range_id>` or `GET /attack-range/status/<attack_range_id>` if the app exposes it.

**Errors:** 404 if the attack range/config doesn’t exist; 400/500 on validation or execution failure (e.g. invalid state, playbook error).

## Using the CLI

```bash
python attack_range.py share -n alice
```

If you have more than one config in `config/`, specify which range:

```bash
python attack_range.py share -n alice -c <attack_range_id_or_path>
```

The command prints the new WireGuard config and saves it to `general.sharing` in the config file.

## Passing the config to others

- Send the **contents** of the generated config (the `[Interface]` / `[Peer]` block) over a secure channel (e.g. encrypted chat or secure file share).
- Optionally, send the same **credentials** they’ll need (Splunk, RDP, SSH) — same as in your config or the “default credentials” in the app/API.
- They install [WireGuard](https://www.wireguard.com/install/), add a new tunnel from the config, and activate it. After that they use the same private IPs (e.g. Splunk at `10.0.2.10:8000`).

## Revocation

Attack Range does not currently automate revoking a single user. To revoke someone you would need to remove their peer from the WireGuard server (e.g. by editing the server config and re-running the VPN playbooks or by destroying and rebuilding the range). Until then, anyone with a valid client config can connect if the range is still up.

## Summary

- **Share** = new WireGuard client (name) for an existing range.
- **App:** Share action with a name; get/config is shown or downloaded.
- **API:** `POST /attack-range/share` with `attack_range_id` and `name`.
- **CLI:** `share -n <name>` (and `-c` if multiple configs).
- Config is stored in `general.sharing` and returned in the response; send it and the same credentials to the other user.
