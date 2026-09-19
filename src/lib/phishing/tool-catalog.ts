/**
 * Catalogue of open-source phishing frameworks (Mode B reference data). This is
 * a curated directory for operators to choose + configure a framework; the
 * platform does NOT auto-spin live phishing servers (Evilginx/Gophish) here —
 * deployment is a gated, audited, operator-driven action documented per tool.
 * The detection-simulation value comes from running the chosen scenario's
 * ATT&CK techniques through the existing safe runner.
 */

export interface PhishingTool {
  id: string; name: string; type: string; language: string; maintained: boolean;
  containerReady: string; license: string; lastRelease: string; stars: string; forks: string;
  recommended: boolean; note: string; url: string;
}

export const PHISHING_TOOLS: PhishingTool[] = [
  { id: "gophish", name: "Gophish", type: "Campaign Server", language: "Go", maintained: true, containerReady: "Official Docker + community Helm", license: "MIT", lastRelease: "v0.12.1 (Sep 2022)", stars: "14k", forks: "2.9k", recommended: true, note: "Leading OSS email-campaign framework — admin UI, templating, click/credential tracking, REST API.", url: "https://github.com/gophish/gophish" },
  { id: "evilginx2", name: "Evilginx2", type: "AiTM Reverse Proxy", language: "Go", maintained: true, containerReady: "Docker (unofficial)", license: "BSD-3-Clause", lastRelease: "v3.3.0 (Apr 2024)", stars: "15.2k", forks: "2.7k", recommended: true, note: "Man-in-the-middle proxy for credential + session-cookie capture (2FA bypass). High-sensitivity — isolate strictly.", url: "https://github.com/kgretzky/evilginx2" },
  { id: "muraena", name: "Muraena", type: "AiTM Reverse Proxy", language: "Go", maintained: true, containerReady: "Manual Docker", license: "BSD-3-Clause", lastRelease: "v1.25 (Nov 2024)", stars: "1.1k", forks: "189", recommended: true, note: "Modern, scalable reverse-proxy kit (Redis logging, browser automation). Good Evilginx alternative.", url: "https://github.com/muraenateam/muraena" },
  { id: "set", name: "Social-Engineer Toolkit (SET)", type: "Template Toolkit", language: "Python", maintained: true, containerReady: "Dockerfile available", license: "BSD-3-Clause (restricted)", lastRelease: "v8.x", stars: "15k", forks: "3.4k", recommended: true, note: "Broad CLI toolkit; on-the-fly site/email cloning. Primarily CLI-driven.", url: "https://github.com/trustedsec/social-engineer-toolkit" },
  { id: "modlishka", name: "Modlishka", type: "Reverse Proxy", language: "Go", maintained: true, containerReady: "Custom deployment", license: "Proprietary (contact author)", lastRelease: "v1.1.1 (May 2025)", stars: "5.3k", forks: "945", recommended: false, note: "Pioneered session-cookie capture. Proprietary license — review terms before use.", url: "https://github.com/drk1wi/Modlishka" },
  { id: "kingphisher", name: "King Phisher", type: "Campaign Server", language: "Python", maintained: false, containerReady: "None official", license: "BSD-3-Clause", lastRelease: "v1.15.0 (Sep 2019)", stars: "2.6k", forks: "582", recommended: false, note: "Archived (2019). Use only for specific legacy needs; prefer Gophish.", url: "https://github.com/rsmusllp/king-phisher" },
  { id: "phishing-frenzy", name: "Phishing Frenzy", type: "Campaign Server", language: "Ruby/Rails", maintained: false, containerReady: "None", license: "GPL-3.0", lastRelease: "~2015", stars: "891", forks: "319", recommended: false, note: "Abandoned, unpatched vulnerabilities. Not recommended.", url: "https://github.com/pentestgeek/phishing-frenzy" },
];
