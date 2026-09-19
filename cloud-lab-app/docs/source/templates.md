# Templates

Templates are YAML files that define an Attack Range layout: cloud provider, general settings, and the list of servers (Splunk, Windows, Linux, Kali, Zeek, etc.) with their roles. Each **build** starts from a template; a copy is saved as `config/<attack_range_id>.yml` and used for that range’s lifecycle.

## Where templates live

Templates are under **provider-specific** directories:

```
templates/
├── aws/
│   ├── splunk_minimal_aws.yml
│   ├── splunk_windows_aws.yml
│   ├── splunk_windows_kali_aws.yml
│   └── ...
├── azure/
│   ├── splunk_minimal_azure.yml
│   ├── splunk_windows_azure.yml
│   └── ...
└── gcp/
    ├── splunk_minimal_gcp.yml
    ├── splunk_windows_gcp.yml
    └── ...
```

The **template identifier** you use in the API or CLI can be:

- **Provider + name:** `aws/splunk_minimal_aws` (recommended)
- **Name only:** `splunk_minimal_aws` (searched across all provider dirs)
- **With extension:** `splunk_minimal_aws.yml`

## Built-in templates (by provider)

### AWS (`templates/aws/`)

| Template | Description |
|----------|-------------|
| `splunk_minimal_aws.yml` | Single Splunk server (minimal). |
| `splunk_linux_aws.yml` | Splunk + Linux servers. |
| `splunk_windows_aws.yml` | Splunk + Windows. |
| `splunk_windows_kali_aws.yml` | Splunk + Windows + Kali. |
| `splunk_ad_aws.yml` | Splunk + Active Directory style layout. |
| `splunk_es_aws.yml` | Splunk + Enterprise Security. |
| `splunk_soar_aws.yml` | Splunk + SOAR. |
| `splunk_zeek_windows_aws.yml` | Splunk + Zeek + Windows. |

### Azure (`templates/azure/`)

| Template | Description |
|----------|-------------|
| `splunk_minimal_azure.yml` | Single Splunk server. |
| `splunk_linux_azure.yml` | Splunk + Linux. |
| `splunk_windows_azure.yml` | Splunk + Windows. |
| `splunk_full_azure.yml` | Full stack. |
| `splunk_ad_azure.yml` | Splunk + AD. |
| `splunk_es_azure.yml` | Splunk + Enterprise Security. |

### GCP (`templates/gcp/`)

| Template | Description |
|----------|-------------|
| `splunk_minimal_gcp.yml` | Single Splunk server. |
| `splunk_linux_gcp.yml` | Splunk + Linux. |
| `splunk_windows_gcp.yml` | Splunk + Windows. |
| `splunk_ad_gcp.yml` | Splunk + AD. |
| `splunk_es_gcp.yml` | Splunk + Enterprise Security. |
| `splunk_zeek_windows_gcp.yml` | Splunk + Zeek + Windows. |

Exact contents (instance types, images, roles) may vary; use the file or the API `GET /templates/<provider>/<name>` to inspect.

## Template structure

A template has the same layout as a [configuration](configuration.md) file:

1. **general** — `attack_range_password`, `cloud_provider`, `attack_range_name`, `ip_whitelist`, `description`. No `attack_range_id` or `status` (those are set when creating a range from the template).

2. **Provider block** — Either `aws`, `azure`, or `gcp` with region, tags, and (for AWS) optional key/image defaults.

3. **attack_range** — List of servers. Each server has:
   - `name`, `instance_type`, `ip_last_octet`, `linux` or `windows`, `user_name`
   - Provider-specific image/AMI fields (e.g. `ami_name_filter`/`ami_owner` for AWS, `image_publisher`/`image_offer`/`image_sku` for Azure)
   - **roles** — Ansible roles (and `vars`) applied to that host (e.g. `P4T12ICK.ludus_ar_splunk`, `P4T12ICK.ar_guacamole`, `P4T12ICK.ludus_ar_windows`, `P4T12ICK.ar_kali`)

## Listing and fetching templates

- **API**
  - `GET /templates` — List all templates (optionally with provider availability).
  - `GET /templates/<provider>/<name>` — Full content of one template (YAML as JSON).
- **CLI** — No direct “list templates” command; use the templates dir or the API. Build references a template by name: `build -t aws/splunk_minimal_aws`.

## Creating a custom template

1. Copy an existing template from `templates/<provider>/` (e.g. `splunk_windows_aws.yml`).
2. Put it in the same provider directory (or a custom location and reference by path if your workflow supports it).
3. Edit:
   - **general** — description, password, whitelist.
   - **attack_range** — add/remove servers, change instance types, adjust roles and vars.
4. Do **not** set `attack_range_id` or `status`; those are set when a range is created from the template.
5. Use the new file as the template in the app or API (e.g. `build -t aws/my_custom_template`).

Templates are read at build start; the saved config in `config/<attack_range_id>.yml` is the one updated with status, WireGuard, and sharing. See [Configuration](configuration.md) and [Ansible Roles](ansible-roles.md) for role names and variables.
