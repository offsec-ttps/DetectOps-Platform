/**
 * Library routing targets for the Threat-Intelligence → Simulation-Library
 * watcher.
 *
 * Each `LibraryTarget` declares how to recognise techniques that belong to one
 * Attack-Simulation library (by ATT&CK id, id prefix, tactic, and keyword) and
 * which in-library category a matched technique lands in.
 *
 * To make a new library auto-updatable: add a LibraryTarget here. The classifier,
 * scan, dedup, review UI, library-merge and Campaign-Designer handoff are all
 * reused. (v1 ships only the ClickFix / "Deceptive Delivery & Execution"
 * target — the one attack-sim library that exists today.)
 */

// These category strings MUST match the `category` values used in the backing
// library config (src/config/attack-libraries/clickfix.ts).
const CLICKFIX_CATEGORY = "ClickFix (copy-paste execution)";
const DELIVERY_CATEGORY = "Delivery & Obfuscation";

export interface LibraryTargetRouting {
  attackIds?: string[];        // exact ATT&CK ids that strongly imply this library
  attackPrefixes?: string[];   // id prefixes (e.g. "T1204") — weaker signal
  tactics?: string[];          // ATT&CK tactic slugs — weak signal
  keywords?: string[];         // lower-cased substrings in name/title/summary/tags
}

export interface LibraryTarget {
  libraryKey: string;          // matches LibraryDef.key
  moduleId: string;            // matches LibraryDef.moduleId
  backing: "attack-sim";       // v1 only auto-merges attack-sim libraries
  displayName: string;
  description: string;         // shown to the AI classifier
  routing: LibraryTargetRouting;
  /** Which in-library category a matched technique belongs to. */
  categoryFor: (techniqueId: string, name: string) => string;
}

const DELIVERY_MARKERS = ["smuggl", "clickonce", "appref", ".application", "motw", "mark-of-the-web", "mark of the web", "iso", "img container", "pixel", "steganograph"];

export const LIBRARY_TARGETS: LibraryTarget[] = [
  {
    libraryKey: "clickfix",
    moduleId: "detectops.clickfix-sim",
    backing: "attack-sim",
    displayName: "Deceptive Delivery & Execution (ClickFix)",
    description:
      "Social-engineering-to-execution tradecraft: ClickFix / fake-CAPTCHA copy-paste execution (victim pastes a command into Run / Terminal / File Explorer), FileFix, ConsentFix, mshta/finger/WebDAV/DNS variants, plus delivery & obfuscation (HTML smuggling, ClickOnce abuse, Mark-of-the-Web bypass, pixel/stego payloads).",
    routing: {
      attackIds: ["T1204.004", "T1218.005", "T1027.006", "T1574.014", "T1553.005"],
      attackPrefixes: ["T1204", "T1566"],
      tactics: ["initial-access", "execution"],
      keywords: [
        "clickfix", "click fix", "fakecaptcha", "fake captcha", "fake-captcha",
        "filefix", "file fix", "consentfix", "consent fix", "pastejack", "paste",
        "copy-paste", "copy and paste", "mshta", "html smuggling", "html-smuggling",
        "clickonce", "appref-ms", "motw", "mark-of-the-web", "finger.exe", "webdav",
        "verify you are human", "i am not a robot", "captcha",
      ],
    },
    categoryFor: (techniqueId, name) => {
      const hay = `${techniqueId} ${name}`.toLowerCase();
      return DELIVERY_MARKERS.some((m) => hay.includes(m)) ? DELIVERY_CATEGORY : CLICKFIX_CATEGORY;
    },
  },
];

export function getTarget(libraryKey: string): LibraryTarget | null {
  return LIBRARY_TARGETS.find((t) => t.libraryKey === libraryKey) || null;
}
