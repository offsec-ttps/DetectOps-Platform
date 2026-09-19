# Ansible Roles

Attack Range uses **Ansible** to configure every server in your range: the VPN router and all lab hosts (Splunk, Windows, Linux, Kali, etc.). Which software and behavior each host gets is defined by **roles**. You choose those roles in a **template** (and thus in the generated config). Crucially, **you can use any Ansible Galaxy role** in a template to define a new configuration—not only the ones shipped with Attack Range.

## Using any Ansible Galaxy role in a template

Templates define the layout of your range. Under `attack_range`, each server has a **roles** list. Every role you list there is:

1. **Installed automatically** — Before any playbook runs, Attack Range extracts all role names from the config and runs `ansible-galaxy install <role_name>` for each. So any role that exists on [Ansible Galaxy](https://galaxy.ansible.com/) can be used.
2. **Applied at build time** — The main lab playbook is generated from your config. Each server gets a play that runs exactly the roles you attached to it, in order, with any variables you passed.

So if you want to add a custom stack (e.g. a different Splunk app, a monitoring role, or a security tool), add the Galaxy role name to the **roles** list of the right server in your template and build from that template. No need to modify Attack Range code.

### Role name format

Use the **Galaxy role name** as it appears on Ansible Galaxy. That is usually `namespace.role_name` (e.g. `geerlingguy.nginx`, `P4T12ICK.ludus_ar_splunk`). The same format is used when you run `ansible-galaxy install namespace.role_name`.

### Declaring roles in a template

In the template (and thus in the config), each server is a list entry under `attack_range`. The **roles** key is a list. You can use either of these forms:

**Role name only (string):**

```yaml
attack_range:
  - name: myserver
    instance_type: t3.medium
    ip_last_octet: 20
    linux: true
    user_name: ubuntu
    roles:
      - geerlingguy.docker
      - some_namespace.some_role
```

**Role with variables (dictionary):**

```yaml
attack_range:
  - name: splunk
    ...
    roles:
      - role: P4T12ICK.ludus_ar_splunk
        vars:
          ludus_ar_splunk_password: "MySecurePass"
      - role: geerlingguy.nginx
        vars:
          nginx_http_port: 8080
```

- **role** — The Galaxy role name (required in the dict form).
- **vars** — Optional variables passed to that role for this host. Follow the role’s documentation on variable names and values.
- **inventory_name** — Optional. If set, this role is applied to the host group with that name instead of the server’s `name`. Used when one role expects a specific group name in the inventory.

You can mix string and dict entries in the same **roles** list. Multiple roles on the same server run in the order listed.

### Example: defining a new configuration with Galaxy roles

1. Copy an existing template from `templates/<provider>/` (e.g. `splunk_minimal_aws.yml`).
2. Add or replace roles under the server(s) you want to change. Use any Galaxy role names.
3. For each role that needs options, use the dict form and set **vars** according to the role’s docs.
4. Save the template (e.g. as `templates/aws/my_custom_range.yml`) and build from it via the app or API (e.g. template `aws/my_custom_range`).

At build time, Attack Range will install every listed Galaxy role and run them on the matching hosts. No extra steps are required.

## How roles are installed and run

- **Source of truth:** The config file (created from your template) in `config/<attack_range_id>.yml`. Its `attack_range` section lists servers and their **roles**.
- **Installation:** Before the VPN and lab playbooks run, the controller scans `attack_range` for all role names (from both `role: name` and plain `name` in the list) and runs `ansible-galaxy install` for each. So only roles referenced in your config are installed.
- **Execution:** The lab playbook (`lab.yaml`) is generated from the same config: one play per host (or per `inventory_name` group), with that host’s roles and vars. So the exact roles and variables you put in the template are what run on each machine.

This is why **any** Galaxy role can define your configuration: if it’s in the template’s **roles** list, it gets installed and executed.

## Summary

- **Templates** define which Ansible roles run on which servers via the **roles** list under each server in `attack_range`.
- **Any Ansible Galaxy role** can be used: list it by name (e.g. `namespace.role_name`). Attack Range installs it and runs it at build time.
- Use **vars** (dict form) to pass variables to a role. Use **inventory_name** when the role expects a specific host group.
- To define a new configuration, create or edit a template, add the desired Galaxy roles (and vars), and build from that template. No code changes are required.
