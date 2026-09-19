/**
 * Curated, benign security-awareness phishing TEMPLATES (Mode A). These are
 * training lures for AUTHORIZED simulation — placeholder-driven, no real
 * credentials/payloads. Each maps to the ATT&CK techniques a real lure of that
 * class would exercise (drives the detection simulation on launch).
 */

import { prisma } from "@/lib/prisma";

interface SeedTemplate {
  name: string; category: string; kind: string; subject: string; body: string;
  placeholders: string[]; techniques: string[]; license: string;
}

const TEMPLATES: SeedTemplate[] = [
  {
    name: "Password Expiry Notice", category: "credential-harvest", kind: "email",
    subject: "[Action Required] Your {Company} password expires today",
    body: `<p>Hi {Name},</p><p>Your {Company} account password expires in <b>2 hours</b>. To avoid losing access, please verify your account:</p><p><a href="{link}">Reset your password</a></p><p>— {Company} IT Service Desk</p>`,
    placeholders: ["Name", "Company", "link"], techniques: ["T1566.002", "T1204.001"], license: "training-use",
  },
  {
    name: "Shared Document (OneDrive)", category: "link", kind: "email",
    subject: "{Sender} shared \"{DocName}\" with you",
    body: `<p>{Sender} has shared a document with you on {Company} OneDrive.</p><p><a href="{link}">Open \"{DocName}\"</a></p><p>This link will expire in 7 days.</p>`,
    placeholders: ["Sender", "DocName", "Company", "link"], techniques: ["T1566.002", "T1204.001"], license: "training-use",
  },
  {
    name: "Invoice Attachment", category: "attachment", kind: "email",
    subject: "Invoice {InvoiceNo} from {Vendor} — payment overdue",
    body: `<p>Dear {Name},</p><p>Please find attached invoice <b>{InvoiceNo}</b> from {Vendor}. Payment is overdue; review the attached document.</p><p>[invoice_{InvoiceNo}.html]</p>`,
    placeholders: ["Name", "InvoiceNo", "Vendor"], techniques: ["T1566.001", "T1204.002"], license: "training-use",
  },
  {
    name: "MFA Re-enrollment", category: "mfa-fatigue", kind: "email",
    subject: "Re-enroll your authenticator — {Company} security update",
    body: `<p>Hi {Name},</p><p>As part of a security upgrade, all staff must re-enroll their authenticator app. Complete this within 24 hours:</p><p><a href="{link}">Re-enroll MFA</a></p>`,
    placeholders: ["Name", "Company", "link"], techniques: ["T1566.002", "T1204.001"], license: "training-use",
  },
  {
    name: "CEO Wire Request (BEC)", category: "bec", kind: "email",
    subject: "Quick favor — are you at your desk?",
    body: `<p>{Name}, I need you to process an urgent vendor payment before our call. Reply and I'll send the details. Keep this confidential for now.</p><p>Sent from my iPhone — {ExecName}, CEO</p>`,
    placeholders: ["Name", "ExecName"], techniques: ["T1566.003", "T1598"], license: "training-use",
  },
  {
    name: "Microsoft 365 Sign-in (Landing)", category: "credential-harvest", kind: "landing",
    subject: "",
    body: `<!-- benign training landing page (no real auth backend) --><form data-sim="phishing"><h2>Sign in to {Company}</h2><input placeholder="email" /><input type="password" placeholder="password" /><button>Sign in</button><p style="font-size:11px;color:#888">Authorized phishing simulation — do not enter real credentials.</p></form>`,
    placeholders: ["Company"], techniques: ["T1566.002"], license: "training-use",
  },
];

export async function ensurePhishingTemplates(): Promise<void> {
  for (const t of TEMPLATES) {
    const exists = await prisma.phishingTemplate.findUnique({ where: { name: t.name } });
    if (exists) continue;
    await prisma.phishingTemplate.create({
      data: { name: t.name, category: t.category, kind: t.kind, subject: t.subject, body: t.body, placeholders: JSON.stringify(t.placeholders), techniques: JSON.stringify(t.techniques), license: t.license, sourceRef: "DetectOps curated (training)" },
    });
  }
}
