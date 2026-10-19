"""
Detection Engineering Lab Catalog - DOCX Generator
Generates a comprehensive Word document listing all red/blue team labs
for SOC/Detection Engineers.
"""

from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import datetime


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def set_cell_background(cell, color_hex):
    """Apply background color to a table cell."""
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), color_hex)
    cell._tc.get_or_add_tcPr().append(shading)


def add_heading_custom(doc, text, level=1, color=(0x1F, 0x3A, 0x5F)):
    """Add a heading with custom color."""
    heading = doc.add_heading(text, level=level)
    for run in heading.runs:
        run.font.color.rgb = RGBColor(*color)
    return heading


def add_table_from_data(doc, headers, rows, col_widths=None):
    """Add a styled table from headers and rows data."""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Light Grid Accent 1'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    # Header row
    hdr_cells = table.rows[0].cells
    for i, header in enumerate(headers):
        hdr_cells[i].text = header
        for paragraph in hdr_cells[i].paragraphs:
            for run in paragraph.runs:
                run.bold = True
                run.font.size = Pt(10)
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        set_cell_background(hdr_cells[i], '1F3A5F')

    # Data rows
    for row_idx, row_data in enumerate(rows):
        row_cells = table.rows[row_idx + 1].cells
        for col_idx, cell_text in enumerate(row_data):
            row_cells[col_idx].text = str(cell_text)
            for paragraph in row_cells[col_idx].paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(9)

    # Column widths
    if col_widths:
        for row in table.rows:
            for idx, width in enumerate(col_widths):
                row.cells[idx].width = width

    return table


def add_code_block(doc, code_text):
    """Add a monospaced code block."""
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Cm(0.5)
    run = paragraph.add_run(code_text)
    run.font.name = 'Consolas'
    run.font.size = Pt(8.5)
    # Shading
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), 'F4F4F4')
    paragraph._p.get_or_add_pPr().append(shading)
    return paragraph


def add_bullet(doc, text, level=0):
    """Add a bullet point."""
    paragraph = doc.add_paragraph(text, style='List Bullet')
    paragraph.paragraph_format.left_indent = Cm(1.0 + level * 0.5)
    return paragraph


def add_horizontal_line(doc):
    """Add a horizontal divider line."""
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '12')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '1F3A5F')
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p


# ─────────────────────────────────────────────────────────────────────
# Document Builder
# ─────────────────────────────────────────────────────────────────────

def build_document():
    doc = Document()

    # ── Page setup ──
    section = doc.sections[0]
    section.top_margin = Cm(2)
    section.bottom_margin = Cm(2)
    section.left_margin = Cm(2)
    section.right_margin = Cm(2)

    # ── Default font ──
    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(11)

    # ═══════════════════════════════════════════════════════════════════
    # TITLE PAGE
    # ═══════════════════════════════════════════════════════════════════

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_run = title.add_run('Detection Engineering\nLab Catalog')
    title_run.font.size = Pt(36)
    title_run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
    title_run.bold = True

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub_run = subtitle.add_run(
        'A Comprehensive Master List of Red Team & Blue Team Labs\n'
        'for SOC Analysts and Detection Engineers'
    )
    sub_run.font.size = Pt(14)
    sub_run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

    doc.add_paragraph()
    doc.add_paragraph()

    # Document info
    info = doc.add_paragraph()
    info.alignment = WD_ALIGN_PARAGRAPH.CENTER
    info_run = info.add_run(
        f'Version: 1.0\n'
        f'Date: {datetime.date.today().strftime("%B %d, %Y")}\n'
        f'Total Labs Listed: 150+\n'
        f'Domains Covered: 12\n'
        f'SIEM Integrations: 8'
    )
    info_run.font.size = Pt(11)
    info_run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)

    doc.add_page_break()

    # ═══════════════════════════════════════════════════════════════════
    # TABLE OF CONTENTS
    # ═══════════════════════════════════════════════════════════════════

    add_heading_custom(doc, 'Table of Contents', level=1)

    toc_entries = [
        '1.  Architecture Blueprint (Single Network, Multi-Tenant)',
        '2.  Cloud Security Labs',
        '3.  Kubernetes / Container Labs',
        '4.  Web Application / API Labs (OWASP Top 10 + API Top 10)',
        '5.  LLM / GenAI / OWASP LLM Top 10 Labs',
        '6.  Active Directory / Windows Endpoint Labs',
        '7.  Linux / Endpoint / Privilege Escalation Labs',
        '8.  CI/CD & Supply Chain Labs',
        '9.  IaC / Terraform / Policy as Code Labs',
        '10. Mobile Application Security Labs',
        '11. Network / PCAP / Detection Labs',
        '12. Identity / IAM / Authentication Labs',
        '13. IoT / OT / ICS Labs',
        '14. Red-Team Emulation / Simulation Frameworks',
        '15. SIEM / Detection Reference Stacks',
        '16. Sample End-to-End Deployment Playbook',
        '17. MITRE ATT&CK ↔ Sigma Coverage Mapping',
        '18. Suggested Folder Structure',
        '19. Gap Areas & Roadmap',
        '20. Final CLI Prompt Template',
        '21. Appendix: Deployment Commands Reference',
    ]

    for entry in toc_entries:
        p = doc.add_paragraph(entry)
        p.paragraph_format.left_indent = Cm(1)

    doc.add_page_break()

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 1: Architecture Blueprint
    # ═══════════════════════════════════════════════════════════════════

    add_heading_custom(doc, '1. Architecture Blueprint (Single Network, Multi-Tenant)', level=1)

    doc.add_paragraph(
        'The platform follows a single-network, multi-tenant architecture where each lab '
        'instance runs in isolation but ships logs to a shared or dedicated SIEM tenant. '
        'The CLI orchestrator handles provisioning, simulation, detection, and teardown.'
    )

    add_heading_custom(doc, 'Architecture Diagram', level=2)
    add_code_block(doc, """┌────────────────────────────────────────────────────────────────────┐
│                     Detection Engineering Platform                 │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Lab CLI │→ │ Selector  │→ │ Builder  │→ │ Deployer │            │
│  └─────────┘  └──────────┘  └──────────┘  └─────┬────┘            │
│        │             │              │           │                  │
│      (1) Ask: env?  (2) Ask: lab? (3) Ask: SIEM? (4) Deploy         │
└────────────────────────────────────────────────────────────────────┘
       │                                                       │
       ▼                                                       ▼
┌────────────────────┐                            ┌────────────────────────┐
│  Lab Tenant Network│                            │  SIEM Tenant (Splunk/ │
│  (Docker/K8s/VM)   │ ─── log shippers ───────►  │  Elastic/Sentinel/QR/ │
│  + Atomic Red Team │                            │  Loki/Sumo/Wazuh)      │
│  + Stratus Red Team │                            │  + Sigma Repo          │
└────────────────────┘                            └────────────────────────┘""")

    add_heading_custom(doc, 'CLI Workflow Prompt', level=2)
    add_code_block(doc, """> ./detection-lab run
[1] Select Environment:
    [a] Local      (Docker / Vagrant / Minikube / Kind / Lima)
    [b] Cloud      (AWS / Azure / GCP / OCI / Alibaba)
    [c] Remote     (existing VM / SSH host / K8s cluster)
    [d] Hybrid     (local compute + cloud APIs)

[2] Select Lab Category:
    1. Cloud Security          2. Kubernetes / Container
    3. Web / API               4. LLM / GenAI / MCP
    5. Active Directory        6. Linux / Endpoint
    7. CI/CD / Supply Chain    8. IaC / Terraform
    9. Mobile                  10. Network / PCAP
   11. Identity / IAM          12. IoT / OT

[3] Select Lab: (searchable fuzzy list)

[4] Select SIEM Target:
    [1] Splunk  [2] Elastic  [3] Sentinel  [4] Loki/Grafana
    [5] Wazuh   [6] Sumo     [7] Chronicle [8] QRadar

[5] Select Attack Simulator (runs after lab is up):
    [1] Atomic Red Team  [2] Stratus Red Team  [3] Caldera
    [4] Purple Knight    [5] Mythic agents     [6] Custom sigma-cli

[6] Deploying... ✓ Ready at https://lab-<id>.detection.local""")

    add_horizontal_line(doc)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 2: Cloud Security Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '2. Cloud Security Labs', level=1)

    doc.add_paragraph(
        'These labs deploy intentionally vulnerable cloud infrastructure across AWS, Azure, '
        'GCP, and multi-cloud environments. They are designed to teach cloud attack techniques '
        'and generate telemetry for detection rule development.'
    )

    cloud_labs = [
        ['1', 'AWSGoat', 'https://github.com/ine-labs/AWSGoat', 'Cloud (AWS)', 'Tiered AWS vulnerabilities'],
        ['2', 'AzureGoat', 'https://github.com/ine-labs/AzureGoat', 'Cloud (Azure)', 'Tiered Azure vulnerabilities'],
        ['3', 'GCPGoat', 'https://github.com/ine-labs/GCPGoat', 'Cloud (GCP)', 'Tiered GCP vulnerabilities'],
        ['4', 'CloudGoat', 'https://github.com/RhinoSecurityLabs/cloudgoat', 'Cloud (AWS)', 'Scenario-based pentest'],
        ['5', 'CloudFoxable', 'https://github.com/BishopFox/cloudfoxable', 'Cloud (AWS)', 'Intentionally vulnerable env for CloudFox'],
        ['6', 'EntraGoat', 'https://github.com/Semperis/EntraGoat', 'Cloud (Entra ID)', 'Microsoft 365/Entra ID vulns'],
        ['7', 'Sadcloud', 'https://github.com/naggie/sadcloud', 'Cloud (AWS)', 'Terraform-based insecure AWS'],
        ['8', 'TerraGoat', 'https://github.com/bridgecrewio/terragoat', 'Cloud (AWS/Azure/GCP)', 'Misconfigured IaC'],
        ['9', 'CI/CD Goat', 'https://github.com/cider-security-research/cicd-goat', 'Local/Docker', 'Jenkins + GitLab + Argo'],
        ['10', 'GitHub Actions Goat', 'https://github.com/step-security/github-actions-goat', 'Cloud (GitHub)', 'GitHub Actions security'],
        ['11', 'EKS Goat (OWASP)', 'https://github.com/OWASP/www-project-eks-goat', 'Cloud (AWS EKS)', 'Vulnerable EKS clusters'],
        ['12', 'DVCA', 'https://github.com/haerinia/DVCA', 'Cloud (AWS)', 'Damn Vulnerable Cloud App'],
        ['13', 'SANS Cloud Security Workshop', 'https://github.com/sans/cloud-security-workshop', 'Cloud (AWS)', 'Workshops with detection scenarios'],
        ['14', 'Hacking The Cloud', 'https://hackingthe.cloud/', 'Cloud', 'Attack encyclopedia + labs'],
        ['15', 'CloudSecList Labs', 'https://github.com/cloudseclabs', 'Cloud', 'Misc. cloud misconfigurations'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment', 'Notes'], cloud_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 3: Kubernetes / Container Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '3. Kubernetes / Container Labs', level=1)

    doc.add_paragraph(
        'Container and Kubernetes security labs that simulate misconfigurations, '
        'container escapes, RBAC issues, and runtime threats. Pair with Falco, '
        'Tetragon, or Tracee for runtime detection.'
    )

    k8s_labs = [
        ['1', 'Kubernetes Goat', 'https://github.com/madhuakula/kubernetes-goat', 'Local/Docker'],
        ['2', 'KubeSecurity Lab', 'https://github.com/walidshaari/Kubernetes-Security', 'Local'],
        ['3', 'CKS Challenge', 'https://github.com/walidshaari/cks-challenge', 'Local'],
        ['4', 'Kyverno Policy Lab', 'https://github.com/kyverno/kyverno', 'Local'],
        ['5', 'Misconfig-Kubernetes', 'https://github.com/aquasecurity/misconfig-kubernetes', 'Local'],
        ['6', 'CKA-CKS Mastery', 'https://github.com/r0hi5/CKA-CKS-Mastery', 'Local'],
        ['7', 'Tracee Sample Lab', 'https://github.com/aquasecurity/tracee', 'Local'],
        ['8', 'Tetragon Lab', 'https://github.com/cilium/tetragon', 'Local'],
        ['9', 'Falco CTF', 'https://github.com/falcosecurity/falco', 'Local'],
        ['10', 'Kubescape Hippo', 'https://github.com/kubescape/kubescape', 'Local'],
        ['11', 'DVCC', 'https://github.com/haerinia/dvcc', 'Local'],
        ['12', 'Docker Attack Platform', 'https://github.com/lvcccb/docker-attack-platform', 'Local'],
        ['13', 'Container Attack Demo', 'https://github.com/wiz-sec/container-attack-demo', 'Local'],
        ['14', 'Kubestriker Lab', 'https://github.com/ridgebucket/kubestriker-lab', 'Local'],
        ['15', 'Container Security Lab', 'https://github.com/raesene/container_security_lab', 'Local'],
        ['16', 'K8s Security Lab', 'https://github.com/mrtc0/k8s-security-lab', 'Local'],
        ['17', 'Polaris Playground', 'https://github.com/FairwindsOps/polaris', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], k8s_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 4: Web Application / API Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '4. Web Application / API Labs (OWASP Top 10 + API Top 10)', level=1)

    doc.add_paragraph(
        'These labs cover OWASP Top 10 web vulnerabilities, OWASP API Security Top 10, '
        'GraphQL attacks, and modern web application security. They generate HTTP logs, '
        'WAF events, and application-layer telemetry for detection engineering.'
    )

    web_labs = [
        ['1', 'OWASP Juice Shop', 'https://github.com/bkimminich/juice-shop', 'Local/Docker'],
        ['2', 'OWASP WebGoat', 'https://github.com/WebGoat/WebGoat', 'Local/Docker'],
        ['3', 'DVWA', 'https://github.com/digininja/DVWA', 'Local/Docker'],
        ['4', 'Mutillidae', 'https://github.com/webpwnized/mutillidae', 'Local'],
        ['5', 'OWASP NodeGoat', 'https://github.com/OWASP/NodeGoat', 'Local/Docker'],
        ['6', 'OWASP PyGoat', 'https://github.com/adeyosemanaj/PyGoat', 'Local'],
        ['7', 'OWASP RailsGoat', 'https://github.com/OWASP/railsgoat', 'Local'],
        ['8', 'OWASP crAPI', 'https://github.com/OWASP/crAPI', 'Local/Docker'],
        ['9', 'VAmPI', 'https://github.com/erev0s/VAmPI', 'Local/Docker'],
        ['10', 'DVNA', 'https://github.com/appsecco/dvna', 'Local'],
        ['11', 'DVTA', 'https://github.com/srini0x00/dvta', 'Local'],
        ['12', 'OWASP Security Shepherd', 'https://github.com/OWASP/SecurityShepherd', 'Local'],
        ['13', 'DVWS-node', 'https://github.com/snoopysecurity/dvws-node', 'Local'],
        ['14', 'XVWA', 'https://github.com/s4n7h0/xvwa', 'Local'],
        ['15', 'API Sec Lab (Checkmarx)', 'https://github.com/Checkmarx/api-sec-lab', 'Local'],
        ['16', 'BuggyBank', 'https://github.com/jemnight/BuggyBank', 'Local'],
        ['17', 'PortSwigger Web Security Academy', 'https://portswigger.net/web-security', 'Online'],
        ['18', 'TCM WebAppSec Labs', 'https://github.com/TCM-Course/Lab', 'Local'],
        ['19', 'DVGA (GraphQL)', 'https://github.com/daniel-rudakov/DVGA', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], web_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 5: LLM / GenAI / MCP Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '5. LLM / GenAI / OWASP LLM Top 10 Labs', level=1)

    doc.add_paragraph(
        'Emerging labs covering OWASP LLM Top 10, prompt injection, model poisoning, '
        'agent security, and Model Context Protocol (MCP) vulnerabilities. These are '
        'critical for building next-gen AI security detections.'
    )

    llm_labs = [
        ['1', 'OWASP LLM Top10 Demo', 'https://github.com/OWASP/www-project-top-10-for-large-language-model-applications', 'Local'],
        ['2', 'LLMGoat', 'https://github.com/danielmiessler/LLM-Goat', 'Local'],
        ['3', 'Garak', 'https://github.com/leondz/garak', 'Local'],
        ['4', 'PyRIT (Microsoft)', 'https://github.com/Azure/PyRIT', 'Local'],
        ['5', 'Lakera Gandalf', 'https://gandalf.lakera.ai/', 'Online'],
        ['6', 'Promptfoo', 'https://github.com/promptfoo/promptfoo', 'Local'],
        ['7', 'Nagini', 'https://github.com/sleeyax/nagini', 'Local'],
        ['8', 'Pacu-LLM', 'https://github.com/RhinoSecurityLabs/pacu', 'Local'],
        ['9', 'AI Village CTF', 'https://www.aivillage.ai/', 'Online'],
        ['10', 'LLMCTF', 'https://github.com/LLM-CTF/llmctf', 'Local'],
        ['11', 'Damn Vulnerable LLM Agent', 'https://github.com/WithSecureLabs/damn-vulnerable-llm-agent', 'Local'],
        ['12', 'Anthropic Red Team Suite', 'https://github.com/anthropics/anthropic-red-team', 'Local'],
        ['13', 'Tensor Trust', 'https://tensortrust.ai/', 'Online'],
        ['14', 'AgenticSecurity', 'https://github.com/maior/agentic-security', 'Local'],
        ['15', 'MCP-Goat', 'https://github.com/obra/mcp-security-lab', 'Local'],
        ['16', 'Damn Vulnerable MCP', 'https://github.com/modelcontextprotocol/dvmcp', 'Local'],
        ['17', 'Inspector MCP', 'https://github.com/step-security/inspector-mcp', 'Local'],
        ['18', 'MCPScan Playground', 'https://github.com/protectai/mcp-scan', 'Local'],
        ['19', 'Invariant Labs MCP Tests', 'https://github.com/invariantlabs-ai/mcp-safety', 'Local'],
        ['20', 'OWASP Agentic LLM Top 10', 'https://github.com/OWASP-agentic/OWASP-Agentic-LLM-Top-10', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository / URL', 'Environment'], llm_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 6: Active Directory / Windows Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '6. Active Directory / Windows Endpoint Labs', level=1)

    doc.add_paragraph(
        'Windows and Active Directory labs that simulate domain misconfigurations, '
        'Kerberoasting, AS-REP roasting, lateral movement, privilege escalation, '
        'and credential dumping. Pair with Sysmon + Windows Event Logs for detection.'
    )

    ad_labs = [
        ['1', 'GOAD', 'https://github.com/Orange-Cyberdefense/GOAD', 'Local (Vagrant/Proxmox/Azure)'],
        ['2', 'GOAD-Light', 'https://github.com/Orange-Cyberdefense/GOAD/tree/main/goad-light', 'Local'],
        ['3', 'Vulnerable AD', 'https://github.com/sonySMB/vulnerable-AD', 'Local (PowerShell)'],
        ['4', 'VulnAD', 'https://github.com/MyStuffExplore/VulnAD', 'Local'],
        ['5', 'King of the Hill', 'https://github.com/KingOfTheHillLab/KotH', 'Local/Cloud'],
        ['6', 'DAFT', 'https://github.com/SecurityRiskAdvisors/DAFT', 'Local'],
        ['7', 'WinPilot', 'https://github.com/OTRF/WinPilot', 'Local'],
        ['8', 'Invoke-ADLabDeployer', 'https://github.com/ChrisPineapple/Invoke-ADLabDeployer', 'Local'],
        ['9', 'LabBuilder', 'https://github.com/PlagueHO/LabBuilder', 'Local'],
        ['10', 'AutomatedLab', 'https://github.com/AutomatedLab/AutomatedLab', 'Local/Hyper-V/Azure'],
        ['11', 'Azure Sentinel Lab', 'https://github.com/Azure/Azure-Sentinel', 'Cloud (Azure)'],
        ['12', 'BlackHills AD Lab', 'https://github.com/blackhillsinfosec/BlackHills-AD-Lab', 'Local'],
        ['13', 'Purple Knight (Semperis)', 'https://www.purpleknight.com/', 'Local/Cloud'],
        ['14', 'TCM PEH Lab', 'https://github.com/TCM-Course/Lab', 'Local'],
        ['15', 'HackTheBox Pro Labs', 'https://www.hackthebox.com/hacker/pro-labs', 'Cloud'],
        ['16', 'SOC Fortress', 'https://github.com/CyberDefenders/soc-fortress', 'Local/Cloud'],
        ['17', 'DetectionLab', 'https://github.com/clong/DetectionLab', 'Local (Vagrant) + AWS'],
        ['18', 'Splunk Attack Range', 'https://github.com/splunk/attack_range', 'Local/AWS/Azure'],
        ['19', 'Elastic Detection Lab', 'https://github.com/elastic/detection-rules-testing', 'Local/Cloud'],
        ['20', 'Malware Lab', 'https://github.com/cmdlab/malware-lab', 'Local'],
        ['21', 'PoshC2 Lab', 'https://github.com/PoshC2/PoshC2', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], ad_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 7: Linux / Endpoint Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '7. Linux / Endpoint / Privilege Escalation Labs', level=1)

    doc.add_paragraph(
        'Linux endpoint labs covering privilege escalation, auditd telemetry, '
        'Falco runtime detection, and Sysmon for Linux. Generate auth logs, '
        'syslog, and auditd events for detection rule development.'
    )

    linux_labs = [
        ['1', 'Linux PrivEsc Arena', 'https://github.com/sajadsarvari/linux-privesc-arena', 'Local/Docker'],
        ['2', 'VulnHub Images', 'https://www.vulnhub.com/', 'Local (ISO)'],
        ['3', 'OverTheWire', 'https://overthewire.org/wargames/', 'Online'],
        ['4', 'TryHackMe Linux PrivEsc', 'https://tryhackme.com', 'Online'],
        ['5', 'Damn Vulnerable Linux', 'https://github.com/JonathanGiles/DVL', 'Local'],
        ['6', 'TCM Linux Priv-Esc', 'https://github.com/TCM-Course/Linux-Priv-Esc', 'Local'],
        ['7', 'SELinux Playground', 'https://github.com/SELinuxProject/selinux-playground', 'Local'],
        ['8', 'LinuxFortress', 'https://github.com/0xrawg/linux-fortress', 'Local'],
        ['9', 'Auditd Lab', 'https://github.com/Neo23x0/auditd-lab', 'Local'],
        ['10', 'Falco Playground', 'https://github.com/falcosecurity/playground', 'Local'],
        ['11', 'Sysmon for Linux', 'https://github.com/microsoft/SysmonForLinux', 'Local'],
        ['12', 'Wazuh Agent Lab', 'https://github.com/wazuh/wazuh', 'Local/Cloud'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], linux_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 8: CI/CD & Supply Chain Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '8. CI/CD & Supply Chain Labs', level=1)

    doc.add_paragraph(
        'CI/CD pipeline and software supply chain security labs covering Jenkins, '
        'GitLab, ArgoCD, Helm, Tekton, and GitHub Actions misconfigurations. '
        'These generate pipeline logs, webhook events, and SBOM telemetry.'
    )

    cicd_labs = [
        ['1', 'CI/CD Goat (Cider Security)', 'https://github.com/cider-security-research/cicd-goat', 'Local'],
        ['2', 'GitHub Actions Goat', 'https://github.com/step-security/github-actions-goat', 'Cloud'],
        ['3', 'TerraGoat', 'https://github.com/bridgecrewio/terragoat', 'Cloud'],
        ['4', 'Jenkins Goat', 'https://github.com/step-security/jenkins-goat', 'Local'],
        ['5', 'Argo Goat', 'https://github.com/step-security/argo-goat', 'Local'],
        ['6', 'HelmGoat', 'https://github.com/bridgecrewio/helm-goat', 'Local'],
        ['7', 'GitLab CICD Goat', 'https://github.com/step-security/gitlab-goat', 'Cloud'],
        ['8', 'Tekton Goat', 'https://github.com/step-security/tekton-goat', 'Local'],
        ['9', 'CNCF Supply Chain Lab', 'https://github.com/cncf/tag-security', 'Local'],
        ['10', 'SLSA Playground', 'https://slsa.dev/', 'Cloud'],
        ['11', 'Sigstore Playground', 'https://github.com/sigstore/community-playground', 'Local'],
        ['12', 'SBOM Lab (Anchore)', 'https://github.com/anchore/sbom-lab', 'Local'],
        ['13', 'Trivy Vuln Lab', 'https://github.com/aquasecurity/trivy', 'Local'],
        ['14', 'Grype Lab', 'https://github.com/anchore/grype', 'Local'],
        ['15', 'Syft Lab', 'https://github.com/anchore/syft', 'Local'],
        ['16', 'OSV-Scanner Tests', 'https://github.com/google/osv-scanner', 'Local'],
        ['17', 'Dependency-Track Demo', 'https://github.com/DependencyTrack/dependency-track', 'Local'],
        ['18', 'Secure Workflows', 'https://github.com/step-security/secure-workflows', 'Local'],
        ['19', 'CI Tests (Chainguard)', 'https://github.com/chainguard-dev/ci-tests', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], cicd_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 9: IaC / Terraform Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '9. IaC / Terraform / Policy as Code Labs', level=1)

    doc.add_paragraph(
        'Infrastructure as Code security labs covering Terraform, CloudFormation, '
        'Kubernetes manifests, and policy-as-code tools (OPA, Kyverno, Checkov, KICS).'
    )

    iac_labs = [
        ['1', 'TerraGoat', 'https://github.com/bridgecrewio/terragoat', 'Cloud'],
        ['2', 'CFNgoat', 'https://github.com/bridgecrewio/cfngoat', 'Cloud (AWS)'],
        ['3', 'K8sGoat (IaC)', 'https://github.com/bridgecrewio/k8sgoat', 'Local'],
        ['4', 'AzureGoat IaC', 'https://github.com/ine-labs/AzureGoat', 'Cloud'],
        ['5', 'OPA Playground', 'https://github.com/open-policy-agent/opa', 'Local'],
        ['6', 'Rego Lab', 'https://github.com/open-policy-agent/opa/tree/main/rego', 'Local'],
        ['7', 'Kyverno Policy Lab', 'https://github.com/kyverno/kyverno-website', 'Local'],
        ['8', 'Conftest Playground', 'https://github.com/open-policy-agent/conftest', 'Local'],
        ['9', 'Checkov Playground', 'https://github.com/bridgecrewio/checkov', 'Local'],
        ['10', 'Regula Lab', 'https://github.com/aquasecurity/regula', 'Local'],
        ['11', 'Terrascan Playground', 'https://github.com/tenable/terrascan', 'Local'],
        ['12', 'KICS Playground', 'https://github.com/Checkmarx/kics', 'Local'],
        ['13', 'Audit Kubernetes', 'https://github.com/DevSecOpsPlayground/Audit-Kubernetes', 'Local'],
        ['14', 'PACPro Play', 'https://github.com/Accenture/pacpro', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], iac_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 10: Mobile Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '10. Mobile Application Security Labs', level=1)

    doc.add_paragraph(
        'Android and iOS application security labs covering OWASP MASVS/MSTG, '
        'runtime manipulation, insecure storage, and certificate pinning bypass.'
    )

    mobile_labs = [
        ['1', 'DVHMA', 'https://github.com/0xroot/DVHMA', 'Local (Android Studio)'],
        ['2', 'DIVA Android', 'https://github.com/appsectrainings/diva-android', 'Local'],
        ['3', 'OWASP iGoat', 'https://github.com/OWASP/iGoat', 'Local'],
        ['4', 'OWASP MASTG', 'https://github.com/OWASP/owasp-mastg', 'Local'],
        ['5', 'MobSF Lab', 'https://github.com/MobSF/Mobile-Security-Framework-MobSF', 'Local'],
        ['6', 'MSTG Hacking Playground', 'https://github.com/OWASP/owasp-mastg/tree/master/Android', 'Local'],
        ['7', 'Damn Vulnerable iOS App', 'https://github.com/prateek147/DVIA', 'Local'],
        ['8', 'AndroGoat', 'https://github.com/satishpatnayak/AndroGoat', 'Local'],
        ['9', 'InjuredAndroid', 'https://github.com/AnonJax/InjuredAndroid', 'Local'],
        ['10', 'OWASP MSTG Vulnerable Apps', 'https://github.com/OWASP/owasp-mstg', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], mobile_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 11: Network / PCAP Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '11. Network / PCAP / Detection Labs', level=1)

    doc.add_paragraph(
        'Network traffic analysis labs with PCAP datasets, Zeek/Suricata IDS, '
        'Arkime (Moloch) full-packet capture, and Splunk BOTS datasets.'
    )

    network_labs = [
        ['1', 'Malware Traffic Analysis', 'https://www.malware-traffic-analysis.net/', 'Online PCAP'],
        ['2', 'NetRESec Samples', 'https://www.netresec.com/?page=PcapFiles', 'Online'],
        ['3', 'PCAP Labs', 'https://github.com/markleehunt/pcap-labs', 'Local'],
        ['4', 'PCAP Files Collection', 'https://github.com/joeylane/pcapfiles', 'Local'],
        ['5', 'Zeek Security Repo', 'https://github.com/zeek/zeek', 'Local'],
        ['6', 'Suricata Playground', 'https://github.com/OISF/suricata', 'Local'],
        ['7', 'Wireshark Sample Captures', 'https://wiki.wireshark.org/SampleCaptures', 'Local'],
        ['8', 'TryHackMe SOC', 'https://tryhackme.com', 'Online'],
        ['9', 'LetsDefend.io', 'https://letsdefend.io', 'Online'],
        ['10', 'CyberDefenders CTFs', 'https://cyberdefenders.org', 'Online'],
        ['11', 'Splunk BOTS v3', 'https://github.com/splunk/botsv3', 'Local'],
        ['12', 'Splunk BOTS v2', 'https://github.com/splunk/botsv2', 'Local'],
        ['13', 'SigmaHQ Ruleset', 'https://github.com/SigmaHQ/sigma', 'Local'],
        ['14', 'ThreatHunter Playbook', 'https://github.com/OTRF/ThreatHunter-Playbook', 'Local'],
        ['15', 'Mordor Datasets', 'https://github.com/OTRF/mordor', 'Local'],
        ['16', 'Mordor (Forge)', 'https://github.com/hunters-forge/mordor', 'Local'],
        ['17', 'BLUESPAWN', 'https://github.com/BlueTeam-IR/BLUESPAWN', 'Local'],
        ['18', 'Stenographer Lab', 'https://github.com/google/stenographer', 'Local'],
        ['19', 'Arkime (Moloch) Lab', 'https://github.com/arkime/arkime', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository / URL', 'Environment'], network_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 12: Identity / IAM Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '12. Identity / IAM / Authentication Labs', level=1)

    doc.add_paragraph(
        'Identity and access management labs covering Entra ID, Active Directory, '
        'OAuth/OIDC, SAML, Keycloak, and Okta misconfigurations.'
    )

    identity_labs = [
        ['1', 'EntraGoat', 'https://github.com/Semperis/EntraGoat', 'Cloud'],
        ['2', 'Purple Knight', 'https://www.purpleknight.com', 'Local/Cloud'],
        ['3', 'BARK Lab', 'https://github.com/Rohnny/BARK-Lab', 'Local'],
        ['4', 'BloodHound CE', 'https://github.com/SpecterOps/BloodHound', 'Local'],
        ['5', 'PingCastle Lab', 'https://github.com/vletoux/pingcastle', 'Local'],
        ['6', 'Munchhausen (CS Lab)', 'https://github.com/microsoft/CSLab-Munchhausen', 'Cloud'],
        ['7', 'LabForge AD Playground', 'https://github.com/fixthebug/LabForge', 'Local'],
        ['8', 'StormSpotter', 'https://github.com/Azure/Stormspotter', 'Cloud (Azure)'],
        ['9', 'ROADtools Lab', 'https://github.com/dirkjanm/ROADtools', 'Cloud/Local'],
        ['10', 'AADInternals', 'https://github.com/Gerenios/AADInternals', 'Cloud'],
        ['11', 'EntraAttack', 'https://github.com/manwhoami/EntraAttack', 'Local'],
        ['12', 'Keycloak Goat', 'https://github.com/jboss/keycloak-goat', 'Local'],
        ['13', 'Okta Auth Lab', 'https://github.com/oktadev/auth-lab', 'Local'],
        ['14', 'OIDC Lab', 'https://github.com/ossf-critial/oidc-lab', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], identity_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 13: IoT / OT Labs
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '13. IoT / OT / ICS Labs', level=1)

    doc.add_paragraph(
        'Operational technology and IoT security labs covering PLCs, SCADA, '
        'router firmware, and ICS honeypots.'
    )

    iot_labs = [
        ['1', 'Damn Vulnerable PLC', 'https://github.com/dhondta/damn-vulnerable-plc', 'Local'],
        ['2', 'Conpot Honeypot', 'https://github.com/mushorg/conpot', 'Local'],
        ['3', 'Redpoint (DigitalBond)', 'https://github.com/digitalbond/Redpoint', 'Local'],
        ['4', 'IoT Lab', 'https://github.com/HighTable/IoT-Lab', 'Local'],
        ['5', 'DVRF (Router Firmware)', 'https://github.com/praetorian-inc/DVRF', 'Local'],
        ['6', 'Firmware Slap', 'https://github.com/ChrisTheCoolHut/FirmwareSlap', 'Local'],
        ['7', 'ICS Security Testbeds', 'https://github.com/ITI/ICS-Security-Testbeds', 'Local'],
        ['8', 'Damn Vulnerable Chemical Process', 'https://github.com/ukncsc/DVC', 'Local'],
        ['9', 'CymiLab', 'https://github.com/0xc0z/CymiLab', 'Local'],
        ['10', 'MiniCPS3', 'https://github.com/scadastrangelove/MiniCPS3', 'Local'],
        ['11', 'IoTGoat (OWASP)', 'https://github.com/OWASP/IoTGoat', 'Local'],
        ['12', 'T-Pot Honeypot', 'https://github.com/telekom-security/tpotce', 'Local'],
    ]

    add_table_from_data(doc, ['#', 'Lab Name', 'Repository', 'Environment'], iot_labs)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 14: Red-Team Emulation Frameworks
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '14. Red-Team Emulation / Simulation Frameworks', level=1)

    doc.add_paragraph(
        'These tools are used to simulate adversary techniques against the deployed '
        'labs, generating telemetry that SOC analysts use to build and validate '
        'detection rules. They map directly to MITRE ATT&CK techniques.'
    )

    redteam_tools = [
        ['1', 'Atomic Red Team', 'https://github.com/redcanaryco/atomic-red-team', 'Run T1059.x etc. on host'],
        ['2', 'Stratus Red Team', 'https://github.com/DataDog/stratus-red-team', 'Cloud attack detonations'],
        ['3', 'CALDERA', 'https://github.com/mitre/caldera', 'Adversary emulation'],
        ['4', 'Infection Monkey', 'https://github.com/guardicore/monkey', 'Lateral movement simulation'],
        ['5', 'Purple Knight', 'https://www.purpleknight.com', 'AD misconfiguration assessment'],
        ['6', 'Mythic (Apollo/Athena)', 'https://github.com/its-a-feature/Mythic', 'C2 framework'],
        ['7', 'Sliver', 'https://github.com/BishopFox/sliver', 'C2 framework'],
        ['8', 'Empire', 'https://github.com/BC-SECURITY/Empire', 'C2 framework'],
        ['9', 'Covenant', 'https://github.com/cobbr/Covenant', 'C2 framework'],
        ['10', 'Merlin', 'https://github.com/Ne0nd0g/merlin', 'C2 framework'],
        ['11', 'PoshC2', 'https://github.com/PoshC2/PoshC2', 'C2 framework'],
        ['12', 'Havoc', 'https://github.com/HavocResearch/Havoc', 'C2 framework'],
        ['13', 'APTSimulator', 'https://github.com/Whackatre/APTSimulator', 'Local Windows APT simulation'],
        ['14', 'Prelude Operator', 'https://github.com/preludeorg/operator', 'Adversary emulation'],
        ['15', 'Mordor Datasets', 'https://github.com/hunters-forge/mordor', 'Replayable datasets'],
        ['16', 'ATT&CK Evaluations', 'https://github.com/center-for-threat-informed-defense/attack-evaluations', 'Vendor evaluations'],
        ['17', 'Sigma Validation', 'https://github.com/SigmaHQ/sigma', 'sigma-cli rule testing'],
        ['18', 'ChainReact CTF', 'https://github.com/chainreact-ctf/chainreact', 'Local'],
        ['19', 'CrackingReality Lab', 'https://github.com/HackingLab/CrackingReality', 'Local'],
        ['20', 'T-Pot (Honeypots)', 'https://github.com/telekom-security/tpotce', 'All-in-one honeypot'],
    ]

    add_table_from_data(doc, ['#', 'Tool', 'Repository', 'Trigger / Use Case'], redteam_tools)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 15: SIEM / Detection Stacks
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '15. SIEM / Detection Reference Stacks', level=1)

    doc.add_paragraph(
        'Reference SIEM deployments and detection rule repositories that pair with '
        'the labs above. These provide the ingestion, correlation, and alerting layer.'
    )

    siem_stacks = [
        ['1', 'Splunk Attack Range', 'https://github.com/splunk/attack_range'],
        ['2', 'Elastic Detection Lab', 'https://github.com/elastic/detection-rules'],
        ['3', 'DetectionLab (Clint Odom)', 'https://github.com/clong/DetectionLab'],
        ['4', 'Blue Team Notes', 'https://github.com/Purp1eW0LVARLab/Blue-Team-Notes'],
        ['5', 'SOCFortress CoPilot', 'https://github.com/socfortress/socfortress'],
        ['6', 'Wazuh All-in-One', 'https://github.com/wazuh/wazuh-all-in-one'],
        ['7', 'Raspberry Pi Home Security', 'https://github.com/peerdavid/raspberry-pi-home-security'],
        ['8', 'SigmaHQ Ruleset', 'https://github.com/SigmaHQ/sigma'],
        ['9', 'Sigma-cli', 'https://github.com/SigmaHQ/sigma-cli'],
        ['10', 'ES Assistant', 'https://github.com/SecurityRiskAdvisors/esassistant'],
        ['11', 'Blue Team Labs Online', 'https://blueteamlabs.online/'],
        ['12', 'Splunk Cloud Security Labs', 'https://github.com/splunk/cloud-security-labs'],
        ['13', 'Elastic Detection Rules Testing', 'https://github.com/elastic/detection-rules-testing'],
        ['14', 'ATT&CK Navigator', 'https://github.com/mitre-attack/attack-navigator'],
        ['15', 'CAR (Cyber Analytics Repository)', 'https://car.mitre.org/'],
        ['16', 'Azure Sentinel Detections', 'https://github.com/Azure/Azure-Sentinel'],
        ['17', 'LOKI IOC Scanner', 'https://github.com/Neo23x0/Loki'],
        ['18', 'YARA Rules', 'https://github.com/Yara-Rules/rules'],
    ]

    add_table_from_data(doc, ['#', 'Stack', 'Repository'], siem_stacks)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 16: Sample Deployment Playbook
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '16. Sample End-to-End Deployment Playbook', level=1)

    doc.add_paragraph(
        'Example workflow: Deploy Kubernetes Goat + Atomic Red Team + Sigma in front of Splunk.'
    )

    add_code_block(doc, """# User prompt sequence
 $ ./detection-lab run
Env: local
Lab: kubernetes-goat
SIEM: splunk
Simulator: atomic-red-team + stratus-red-team

# 1. Provisioning
[+] docker compose -f labs/kubernetes-goat/docker-compose.yml up -d
[+] kubectl apply -f labs/kubernetes-goat/scenarios/
[+] Deploying Splunk Universal Forwarder + Falco DaemonSet...

# 2. Wire telemetry
[+] HEC token created for k8s namespace "goat"
[+] Index `k8s_security` created
[+] Falco → Splunk HEC streaming enabled
[+] Sigma rules from /sigma/cloud/k8s applied

# 3. Run simulation (player role)
[+] atomic-red-team T1611 "Kubernetes Cluster Info Reveal"
[+] atomic-red-team T1613 "Container and Resource Discovery"
[+] stratus-red-team detonate aws.iam.backdoor-aws-creds

# 4. Build detections
[+] Open Sigma Editor at https://sigma.detection.local
[+] Test rules against replayed events from this lab
[+] Push to https://github.com/<org>/detection-rules
[+] CI runs sigma-cli test -> Splunk ES import

# 5. Teardown
 $ ./detection-lab teardown kubernetes-goat""")

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 17: ATT&CK Mapping
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '17. MITRE ATT&CK ↔ Sigma Coverage Mapping', level=1)

    doc.add_paragraph(
        'Recommended mapping of each lab to MITRE ATT&CK tactics and the corresponding '
        'Sigma rule namespace for detection coverage.'
    )

    mapping_data = [
        ['AWSGoat', 'TA0006 (Credential Access), TA0009 (Collection), TA0001 (Initial Access)', 'cloud/aws/'],
        ['AzureGoat', 'TA0004 (Persistence via Service Principals)', 'cloud/azure/'],
        ['GCPGoat', 'TA0008 (Lateral Movement), TA0010 (Exfiltration)', 'cloud/gcp/'],
        ['EntraGoat', 'TA0004 (Consent Phishing), T1098 (Account Manipulation)', 'cloud/azure/identity'],
        ['Kubernetes Goat', 'T1611, T1613, T1525, T1610, T1609', 'cloud/k8s/'],
        ['OWASP crAPI', 'T1190 (Exploit Public App), T1059', 'web/api/'],
        ['OWASP Juice Shop', 'T1190, T1071, T1505', 'web/'],
        ['DVGA (GraphQL)', 'T1592, T1190', 'web/graphql/'],
        ['CI/CD Goat', 'T1195 (Supply Chain), T1059.004', 'devops/'],
        ['TerraGoat', 'T1578 (Modify Cloud Compute Infra)', 'cloud/terraform/'],
        ['GOAD', 'T1003, T1068, T1071, T1486, T1485, T1055, T1136', 'windows/, ad/'],
        ['DVWA', 'T1190, T1059, T1078', 'web/'],
        ['MCP-Goat / DV-MCP', 'T1059 (Prompt Injection), T1190', 'llm/, mcp/'],
        ['OWASP LLM Goat', 'T1530, T1190, T1602', 'llm/'],
        ['Mobile DVIA', 'T1190, T1437', 'mobile/'],
    ]

    add_table_from_data(doc, ['Lab', 'ATT&CK Tactics', 'Sigma Coverage Path'], mapping_data)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 18: Folder Structure
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '18. Suggested Folder Structure', level=1)

    doc.add_paragraph(
        'Recommended repository layout for the Detection Engineering Lab Platform.'
    )

    add_code_block(doc, """detection-lab-platform/
├── cli/
├── labs/
│   ├── cloud/      aws-goat, azure-goat, gcp-goat, cloudgoat, cloudfoxable...
│   ├── k8s/        kubernetes-goat, dvcc, tetragon-lab...
│   ├── web/        juice-shop, dvwa, crapi, vampi, dvga...
│   ├── llm/        llmgoat, dv-mcp, mcpscan, pyrit...
│   ├── ad/         goad, vulnad, purple-knight...
│   ├── linux/      auditd-lab, lpe-arena, falco-playground...
│   ├── cicd/       cicd-goat, github-actions-goat, helmgoat...
│   ├── iac/        terragoat, cfngoat, kics-playground...
│   ├── mobile/     dvia, androgoat, mstg...
│   ├── network/    zeek-lab, suricata-lab, arkime...
│   ├── identity/   entragoat, keycloak-goat, okta-authlab...
│   └── ot/         dv-plc, conpot, minicps3...
├── siem-connectors/  splunk/ elastic/ sentinel/ loki/ wazuh/...
├── simulators/      atomic-red-team, stratus-red-team, caldera, mythic...
├── detections/      sigma rules, splunk searches, kql, eql...
├── playbooks/       end-to-end workflow YAMLs
└── orchestrator/    terraform, ansible, docker-compose, kind, helm charts""")

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 19: Gap Areas & Roadmap
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '19. Gap Areas & Suggested Roadmap', level=1)

    doc.add_paragraph(
        'Emerging and underrepresented lab areas to expand the platform:'
    )

    gap_areas = [
        'MCP (Model Context Protocol) Security Labs — DV-MCP, Inspector-MCP, MCPScan',
        'Agent & Agentic LLM Top 10 — OWASP working group publishing v1',
        'Post-Quantum Crypto test labs — for telemetry/detection',
        'RAG / Vector DB Poisoning labs — few exist; build one internally',
        'Browser Extension / Browser-in-Browser C2 labs — EvilSelenium, Meterpeter C2',
        'IoT Device Fingerprint labs — Zhyphyr, IoTGoat by OWASP',
        'Bluetooth/BLE Red labs — BlueZ lab, Ubertooth samples',
        'ICS/SCADA honeypot labs — Conpot, Cowrie, T-Pot',
        'Serverless attack labs — LambdaGoat, Cloudflare Workers Goat',
        'Data Engineering Detection labs — Snowflake Security, Databricks vuln',
    ]

    for item in gap_areas:
        add_bullet(doc, item)

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 20: CLI Prompt Template
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '20. Final CLI Prompt Template', level=1)

    doc.add_paragraph(
        'Embed this interactive prompt in the CLI orchestrator to guide users through '
        'lab selection, SIEM configuration, and attack simulation.'
    )

    add_code_block(doc, """DETECTION LAB ORCHESTRATOR
==========================

STEP 1 -> Environment
  [L] Local        [C] Cloud       [R] Remote      [H] Hybrid

STEP 2 -> Provider (if C/H)
  [1] AWS          [2] Azure       [3] GCP         [4] OCI         [5] Alibaba

STEP 3 -> Lab Domain
  1=Cloud 2=K8s 3=Web/API 4=LLM/MCP 5=AD 6=Linux 7=CI/CD
  8=IaC  9=Mobile 10=Network 11=Identity 12=IoT/OT

STEP 4 -> Lab (fuzzy search by name)

STEP 5 -> SIEM Sink
  [S] Splunk  [E] Elastic  [M] Sentinel  [G] Grafana/Loki
  [W] Wazuh   [U] Sumo     [C] Chronicle  [Q] QRadar

STEP 6 -> Attacker Emulation
  [1] Atomic Red Team
  [2] Stratus Red Team
  [3] CALDERA
  [4] Infection Monkey
  [5] Mythic / Sliver / Havoc
  [6] Replay Mordor datasets

STEP 7 -> Mode
  [1] Build & Test (with detection rules already in Sigma repo)
  [2] Pure Red (only deploy target + simulator)
  [3] Pure Blue (only deploy SIEM + ingest; no simulator)

STEP 8 -> Auto-teardown timer
  [1] 1 hour   [2] 4 hours   [3] 24 hours   [4] Manual

Provisioning lab... -> Lab URL: https://lab-7f4a.detection.local
SIEM URL: https://siem.detection.local/splunk
Sigma repo branch: lab-7f4a""")

    # ═══════════════════════════════════════════════════════════════════
    # SECTION 21: Appendix
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, '21. Appendix: Deployment Commands Reference', level=1)

    add_heading_custom(doc, 'Local Docker Deployment', level=2)
    add_code_block(doc, """# Clone and run any Docker-based lab
git clone https://github.com/<org>/<lab>.git
cd <lab>
docker-compose up -d

# Example: Kubernetes Goat
git clone https://github.com/madhuakula/kubernetes-goat.git
cd kubernetes-goat
bash setup-kubernetes-goat.sh

# Example: OWASP Juice Shop
docker run -d -p 3000:3000 bkimminich/juice-shop

# Example: DVWA
docker run -d -p 80:80 vulnerables/web-dvwa""")

    add_heading_custom(doc, 'Cloud Deployment (Terraform)', level=2)
    add_code_block(doc, """# Example: AWSGoat
git clone https://github.com/ine-labs/AWSGoat.git
cd AWSGoat/terraform
terraform init
terraform plan
terraform apply -auto-approve

# Example: CloudGoat
pip install cloudgoat
cloudgoat config profile add <aws-profile>
cloudgoat scenario <scenario-name> --profile <aws-profile>

# Example: AzureGoat
git clone https://github.com/ine-labs/AzureGoat.git
cd AzureGoat/terraform
az login
terraform init && terraform apply""")

    add_heading_custom(doc, 'SIEM Integration', level=2)
    add_code_block(doc, """# Splunk HEC token setup (for any lab)
curl -k https://<splunk>:8088/services/collector \
  -H "Authorization: Splunk <token>" \
  -d '{"event": "lab test event", "index": "lab_test"}'

# Elastic ingest pipeline
docker run -d -p 9200:9200 -p 9300:9300 \
  -e "discovery.type=single-node" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0

# Wazuh all-in-one
git clone https://github.com/wazuh/wazuh-all-in-one.git
cd wazuh-all-in-one
./wazuh-certs-tool.sh
docker-compose up -d""")

    add_heading_custom(doc, 'Attack Simulation', level=2)
    add_code_block(doc, """# Atomic Red Team - run a single technique
Invoke-AtomicTest T1059.001

# Stratus Red Team - detonate cloud attack
stratus detonate aws.iam.backdoor-aws-creds

# CALDERA - start adversary emulation
python caldera.py --start

# Sigma rule testing
sigma-cli test rule.yml --target splunk --config config.yml""")

    # ═══════════════════════════════════════════════════════════════════
    # FOOTER
    # ═══════════════════════════════════════════════════════════════════

    doc.add_page_break()
    add_heading_custom(doc, 'Summary Statistics', level=1)

    stats = [
        ['Total Labs Listed', '150+'],
        ['Cloud Security Labs', '15'],
        ['Kubernetes / Container Labs', '17'],
        ['Web Application / API Labs', '19'],
        ['LLM / GenAI / MCP Labs', '20'],
        ['Active Directory / Windows Labs', '21'],
        ['Linux / Endpoint Labs', '12'],
        ['CI/CD & Supply Chain Labs', '19'],
        ['IaC / Terraform Labs', '14'],
        ['Mobile Application Labs', '10'],
        ['Network / PCAP Labs', '19'],
        ['Identity / IAM Labs', '14'],
        ['IoT / OT Labs', '12'],
        ['Red-Team Emulation Tools', '20'],
        ['SIEM / Detection Stacks', '18'],
        ['Domains Covered', '12'],
        ['SIEM Integrations', '8'],
        ['Attack Simulators', '6+'],
    ]

    add_table_from_data(doc, ['Category', 'Count'], stats)

    doc.add_paragraph()
    doc.add_paragraph()

    footer = doc.add_paragraph()
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer_run = footer.add_run(
        'Generated by Detection Engineering Lab Platform\n'
        f'Date: {datetime.date.today().strftime("%B %d, %Y")}\n'
        'Version 1.0'
    )
    footer_run.font.size = Pt(10)
    footer_run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)

    # ── Save ──
    output_file = 'Detection_Engineering_Lab_Catalog.docx'
    doc.save(output_file)
    print(f'\n✅ Document saved: {output_file}')
    print(f'   Total sections: 21')
    print(f'   Total labs listed: 150+')
    return output_file


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    build_document()
