/**
 * Banking-sector phishing AWARENESS library (Mode A templates).
 *
 * Every template is a BENIGN training lure for AUTHORIZED simulation only —
 * placeholder-driven ({Bank}, {Name}, {link} …), with NO real bank branding,
 * NO real domains, and NO working credential/payload backend. Landing pages
 * carry a visible "authorized simulation — do not enter real credentials" notice.
 *
 * Each entry is MODELED ON a real, publicly-documented bank phishing campaign or
 * breach (attribution in `sourceRef`) so analysts can run realistic, educational
 * campaigns, and ships with teachable `redFlags` plus the ATT&CK techniques a
 * real lure of that class exercises (drives the detection simulation on launch).
 *
 * Scope: worldwide — employee-targeted breach vectors (Carbanak, Cobalt Group,
 * Lazarus/Bangladesh Bank, EvilProxy AiTM, Dridex) AND customer-facing fraud
 * (account-verification, OTP, KYC, UPI, smishing, mobile-banking trojans), with
 * both global and India-specific lures.
 */

import { prisma } from "@/lib/prisma";

interface SeedTemplate {
  name: string; category: string; kind: string; subject: string; body: string;
  placeholders: string[]; techniques: string[];
  description: string; redFlags: string[]; audience: string; region: string; difficulty: string;
  sourceRef: string; license: string;
}

// Visible training notice embedded in every simulated landing page.
const SIM_NOTICE = `<p style="font-size:11px;color:#8a94a6;margin-top:14px">⚠ Authorized phishing-awareness simulation — this is NOT a real {Bank} page. Do not enter real credentials.</p>`;

const TEMPLATES: SeedTemplate[] = [
  // ───────────────────────── Employee-targeted (breach vectors) ─────────────────────────
  {
    name: "Bank Job Applicant — CV Download (Lazarus/Bangladesh Bank)",
    category: "link", kind: "email", audience: "employee", region: "global", difficulty: "hard",
    subject: "Application for the position — {Role} | CV & cover letter enclosed",
    body: `<p>Dear Sir/Madam,</p><p>I wish to apply for the <b>{Role}</b> role advertised by {Bank}. My CV and cover letter are available to download at the link below:</p><p><a href="{link}">Download CV & cover letter (PDF)</a></p><p>I look forward to your response.</p><p>Kind regards,<br>{Sender}</p>`,
    placeholders: ["Role", "Bank", "link", "Sender"], techniques: ["T1566.002", "T1204.001"],
    description: "Spear-phishing of bank staff via a fake job application linking to a 'CV' download — the exact initial vector of the 2016 Bangladesh Bank SWIFT heist (~US$81M), where Lazarus posed as applicant 'Rasel Ahlam' and employees downloaded a malicious CV.",
    redFlags: ["Unsolicited applicant linking to an external file host", "Generic 'Dear Sir/Madam' to a shared/role mailbox", "Download link rather than an attached PDF", "Creates no verifiable identity"],
    sourceRef: "Modeled on the 2016 Bangladesh Bank heist (Lazarus Group / APT38) — fake job-application CV lure.", license: "training-use",
  },
  {
    name: "Weaponized Invoice/Complaint Doc (Carbanak)",
    category: "attachment", kind: "email", audience: "employee", region: "global", difficulty: "hard",
    subject: "Re: outstanding settlement {InvoiceNo} — please review attached",
    body: `<p>Hello {Name},</p><p>Following our correspondence, please review the attached statement regarding settlement <b>{InvoiceNo}</b>. Enable content to view the secured document.</p><p>[statement_{InvoiceNo}.doc]</p><p>Regards,<br>{Sender} — Settlements</p>`,
    placeholders: ["Name", "InvoiceNo", "Sender"], techniques: ["T1566.001", "T1204.002", "T1203"],
    description: "A macro/exploit-laden Office document delivered to bank employees as an invoice or complaint — the delivery method the Carbanak (Anunak) gang used to steal US$1B+ from 100+ banks across dozens of countries, installing a backdoor after 'Enable Content'.",
    redFlags: ["'Enable content / macros' request", ".doc attachment from an unexpected sender", "Reply-style subject with no real prior thread", "Pressure framed as financial/settlement"],
    sourceRef: "Modeled on Carbanak/Anunak (2013–2018) — document-based spear-phishing of bank staff.", license: "training-use",
  },
  {
    name: "Central Bank / Regulator Bulletin (Cobalt Group)",
    category: "attachment", kind: "email", audience: "employee", region: "global", difficulty: "hard",
    subject: "{Regulator} security bulletin — mandatory review for member institutions",
    body: `<p>To the Information Security Officer,</p><p>Please find the latest {Regulator} advisory for member banks attached. Institutions are required to acknowledge receipt within 24 hours.</p><p>[{Regulator}_advisory.doc]</p><p>{Regulator} — Financial CERT</p>`,
    placeholders: ["Regulator"], techniques: ["T1566.001", "T1204.002"],
    description: "Spear-phishing bank staff with an attachment impersonating a central bank / financial regulator ('FinCERT'/SWIFT bulletin). The Cobalt Group used regulator-themed lures to breach banks across Europe and Asia and pivot to SWIFT/ATM systems.",
    redFlags: ["Authority + urgency ('mandatory', '24 hours')", "Regulator contacting you by generic email attachment", "Request to 'acknowledge' by opening the file"],
    sourceRef: "Modeled on Cobalt Group (2016–2018) — regulator/SWIFT-themed spear-phishing of banks.", license: "training-use",
  },
  {
    name: "SWIFT Payment Pending Authorization",
    category: "credential-harvest", kind: "email", audience: "employee", region: "global", difficulty: "hard",
    subject: "[SWIFT] Message {Ref} awaiting your authorization",
    body: `<p>Dear {Name},</p><p>A payment message (ref <b>{Ref}</b>) is pending authorization in the messaging terminal. Sign in to review and release before cut-off:</p><p><a href="{link}">Open messaging terminal</a></p><p>Payments Operations</p>`,
    placeholders: ["Name", "Ref", "link"], techniques: ["T1566.002", "T1204.001", "T1557"],
    description: "Credential-harvest lure aimed at payment-operations staff, impersonating the interbank messaging (SWIFT) terminal — the system abused in the Bangladesh Bank and Cobalt intrusions after initial phishing.",
    redFlags: ["Login link to the 'SWIFT terminal' by email", "Deadline/cut-off pressure", "Targets a specific operational role"],
    sourceRef: "Modeled on SWIFT-targeting intrusions (Lazarus/Cobalt) — payment-authorization lure.", license: "training-use",
  },
  {
    name: "IT Service Desk — Password Reset (Employee)",
    category: "credential-harvest", kind: "email", audience: "employee", region: "global", difficulty: "medium",
    subject: "[{Bank} IT] Password reset required — ticket {Ref}",
    body: `<p>Hi {Name},</p><p>A password reset has been requested for your {Bank} account (ticket {Ref}). If this was you, confirm your current credentials to complete it:</p><p><a href="{link}">Confirm & reset</a></p><p>{Bank} Service Desk</p>`,
    placeholders: ["Name", "Bank", "Ref", "link"], techniques: ["T1566.002", "T1204.001"],
    description: "Help-desk impersonation asking staff to 'confirm' credentials — the social-engineering pattern used by groups like Scattered Spider to breach financial and other enterprises.",
    redFlags: ["IT asking you to enter your current password", "Reset you did not request", "Link domain not the real intranet"],
    sourceRef: "Modeled on help-desk credential phishing (Scattered Spider-style) against enterprises.", license: "training-use",
  },
  {
    name: "ACH / Payroll Payment Rejected (Dridex)",
    category: "attachment", kind: "email", audience: "employee", region: "us", difficulty: "medium",
    subject: "ACH payment {Ref} rejected — remittance advice attached",
    body: `<p>Dear {Name},</p><p>Your recent ACH payment (<b>{Ref}</b>) was rejected by the receiving bank. The remittance advice is attached — open it to view the reason and resubmit.</p><p>[remittance_{Ref}.xls]</p>`,
    placeholders: ["Name", "Ref"], techniques: ["T1566.001", "T1204.002"],
    description: "A spreadsheet lure themed around a rejected ACH/payroll payment — the delivery theme of the Dridex banking trojan (Evil Corp), which harvested online-banking credentials from finance staff.",
    redFlags: ["Finance-themed .xls attachment", "'Enable editing/macros' to view", "Urgency around a rejected payment"],
    sourceRef: "Modeled on Dridex (Evil Corp) banking-trojan delivery lures.", license: "training-use",
  },

  // ───────────────────────── AiTM / MFA bypass (employee + customer) ─────────────────────────
  {
    name: "Microsoft 365 Re-authentication (EvilProxy AiTM)",
    category: "mfa-fatigue", kind: "email", audience: "employee", region: "global", difficulty: "hard",
    subject: "Your {Bank} Microsoft 365 session expired — re-authenticate",
    body: `<p>Hi {Name},</p><p>Your Microsoft 365 session for {Bank} has expired. To keep access to mail and files, re-authenticate now:</p><p><a href="{link}">Re-authenticate</a></p><p>This link expires in 30 minutes.</p>`,
    placeholders: ["Name", "Bank", "link"], techniques: ["T1566.002", "T1204.001", "T1557", "T1539"],
    description: "Adversary-in-the-middle (AiTM) lure driving staff to a reverse-proxy login that relays Microsoft 365 auth and steals the password, the live MFA code AND the session cookie. EvilProxy ran exactly this against banking/financial-services executives in 2023.",
    redFlags: ["'Session expired, re-authenticate' by email", "Short expiry to force haste", "Login page URL is not login.microsoftonline.com"],
    sourceRef: "Modeled on EvilProxy AiTM (2023, Menlo/Proofpoint) targeting financial-services M365 accounts.", license: "training-use",
  },
  {
    name: "Bank SSO Sign-in (AiTM Landing)",
    category: "credential-harvest", kind: "landing", audience: "both", region: "global", difficulty: "hard",
    subject: "",
    body: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:360px;margin:30px auto;padding:24px;border:1px solid #e3e6ea;border-radius:10px"><h2 style="font-size:18px;color:#1a2b4a">{Bank} Secure Sign-in</h2><p style="font-size:12px;color:#5f6b7a">Enter your credentials and one-time code to continue.</p><form data-sim="phishing"><input placeholder="Customer ID / email" style="width:100%;padding:9px;margin:6px 0;border:1px solid #ccc;border-radius:6px" /><input type="password" placeholder="Password" style="width:100%;padding:9px;margin:6px 0;border:1px solid #ccc;border-radius:6px" /><input placeholder="One-time passcode (OTP)" style="width:100%;padding:9px;margin:6px 0;border:1px solid #ccc;border-radius:6px" /><button style="width:100%;padding:10px;background:#1a2b4a;color:#fff;border:0;border-radius:6px;margin-top:8px">Sign in</button></form>${SIM_NOTICE}</div>`,
    placeholders: ["Bank"], techniques: ["T1566.002", "T1557", "T1111", "T1539"],
    description: "A benign training replica of a bank login that also asks for the OTP — mirroring AiTM/OTP-relay kits (EvilProxy, Tycoon 2FA) that capture the one-time code in real time to defeat MFA. No real backend; credentials go nowhere.",
    redFlags: ["Login page asking for your OTP as well as password", "URL/domain is not the bank's real one", "Arrived via an email/SMS link rather than you navigating there"],
    sourceRef: "Modeled on AiTM phishing kits (EvilProxy / Tycoon 2FA) — OTP-relay credential capture.", license: "training-use",
  },

  // ───────────────────────── Customer: account takeover / fraud ─────────────────────────
  {
    name: "Account Temporarily Suspended — Verify",
    category: "credential-harvest", kind: "email", audience: "customer", region: "global", difficulty: "easy",
    subject: "Your {Bank} account has been temporarily suspended",
    body: `<p>Dear Customer,</p><p>We detected irregular activity and have <b>temporarily suspended</b> your {Bank} account. To restore access, verify your identity within 24 hours:</p><p><a href="{link}">Verify my account</a></p><p>{Bank} Online Security</p>`,
    placeholders: ["Bank", "link"], techniques: ["T1566.002", "T1204.001"],
    description: "The classic bank-customer credential-harvest lure: a 'suspended account, verify now' email driving customers to a fake login. The most prolific bank phishing theme worldwide for two decades.",
    redFlags: ["'Dear Customer' — no real name", "Threat of suspension + short deadline", "Verify via a link instead of the official app/site"],
    sourceRef: "Modeled on long-running global bank 'account verification' credential phishing.", license: "training-use",
  },
  {
    name: "Suspicious Sign-in Detected",
    category: "credential-harvest", kind: "email", audience: "customer", region: "global", difficulty: "easy",
    subject: "New sign-in to your {Bank} account from {City}",
    body: `<p>Hi {Name},</p><p>We noticed a new sign-in to your {Bank} account from <b>{City}</b> on a new device. If this wasn't you, secure your account now:</p><p><a href="{link}">This wasn't me — secure account</a></p><p>{Bank} Security</p>`,
    placeholders: ["Name", "Bank", "City", "link"], techniques: ["T1566.002", "T1204.001"],
    description: "A 'suspicious login' alert that weaponizes the victim's own caution — the panic click on 'this wasn't me' leads to a credential-harvest page. Ubiquitous across retail-banking phishing.",
    redFlags: ["Alert pushes a link to 'secure' the account", "Generic location you can't confirm", "Hover shows a non-bank domain"],
    sourceRef: "Modeled on global retail-bank 'unusual sign-in' credential phishing.", license: "training-use",
  },
  {
    name: "Debit Card Blocked — Unusual Transaction",
    category: "credential-harvest", kind: "email", audience: "customer", region: "global", difficulty: "easy",
    subject: "{Bank}: card ending {CardLast4} blocked — action required",
    body: `<p>Dear Customer,</p><p>We blocked a transaction of <b>{Amount}</b> on your card ending <b>{CardLast4}</b> as a precaution. Confirm whether you authorized it to unblock your card:</p><p><a href="{link}">Review transaction</a></p><p>{Bank} Fraud Prevention</p>`,
    placeholders: ["Bank", "CardLast4", "Amount", "link"], techniques: ["T1566.002", "T1204.001"],
    description: "A card-fraud-alert lure that harvests full card/online-banking details under the guise of 'confirming' a blocked transaction. A dominant theme in card-not-present fraud worldwide.",
    redFlags: ["Asks you to confirm by entering card/CVV/PIN", "Partial card number used to build trust", "Link instead of calling the number on your card"],
    sourceRef: "Modeled on global card-fraud 'blocked transaction' phishing.", license: "training-use",
  },
  {
    name: "One-Time Passcode (OTP) Confirmation",
    category: "credential-harvest", kind: "email", audience: "customer", region: "global", difficulty: "medium",
    subject: "Confirm the one-time passcode to stop a {Amount} payment",
    body: `<p>Dear Customer,</p><p>A payment of <b>{Amount}</b> is being processed on your {Bank} account. If you did NOT authorize it, enter the one-time passcode we just sent to cancel:</p><p><a href="{link}">Cancel this payment</a></p><p>{Bank} Fraud Team</p>`,
    placeholders: ["Amount", "Bank", "link"], techniques: ["T1566.002", "T1598", "T1111"],
    description: "OTP-interception lure: tricks the customer into typing the live one-time code into a fake page so the fraudster can complete a real transfer. Industrialised by OTP-interception services (e.g. the UK 'OTP Agency').",
    redFlags: ["Anyone asking you to share/enter an OTP", "OTP framed as 'to cancel' a payment", "Pressure that a payment is 'in progress'"],
    sourceRef: "Modeled on OTP-interception phishing (e.g. UK 'OTP Agency', 2020–2024).", license: "training-use",
  },
  {
    name: "Fraud Department Callback (Vishing)",
    category: "vishing", kind: "email", audience: "customer", region: "global", difficulty: "medium",
    subject: "{Bank} fraud alert — call us immediately on {Phone}",
    body: `<p>Dear Customer,</p><p>Our systems flagged possible fraud on your {Bank} account. For your security, call our fraud desk immediately on <b>{Phone}</b> and quote reference <b>{Ref}</b>. Do not share this with anyone.</p><p>{Bank} Fraud Desk</p>`,
    placeholders: ["Bank", "Phone", "Ref"], techniques: ["T1566.004", "T1598"],
    description: "A hybrid email→phone (vishing) lure driving the victim to call a fraudster-controlled number, where they're social-engineered into moving money to a 'safe account' or revealing OTPs. A leading cause of authorised-push-payment (APP) fraud.",
    redFlags: ["Email directs you to a phone number (not the one on your card)", "'Move funds to a safe account' requests on the call", "Secrecy ('don't tell anyone')"],
    sourceRef: "Modeled on bank-impersonation vishing / 'safe account' APP fraud.", license: "training-use",
  },
  {
    name: "Crypto Exchange Withdrawal Alert",
    category: "credential-harvest", kind: "email", audience: "customer", region: "global", difficulty: "medium",
    subject: "Withdrawal request of {Amount} initiated on your {Bank} account",
    body: `<p>Hello {Name},</p><p>A withdrawal of <b>{Amount}</b> was requested from your {Bank} account. If you did not request this, cancel it within 15 minutes:</p><p><a href="{link}">Cancel withdrawal</a></p><p>{Bank} Security</p>`,
    placeholders: ["Name", "Amount", "Bank", "link"], techniques: ["T1566.002", "T1204.001", "T1557"],
    description: "A withdrawal-confirmation lure targeting crypto-exchange / neobank customers (e.g. Coinbase/Binance-style), harvesting login + 2FA to drain funds. Among the highest-value consumer phishing themes.",
    redFlags: ["15-minute countdown to force panic", "Login page is a look-alike domain", "Asks for 2FA/seed phrase"],
    sourceRef: "Modeled on crypto-exchange 'unauthorized withdrawal' phishing (Coinbase/Binance-style).", license: "training-use",
  },

  // ───────────────────────── KYC / regulatory (global + India) ─────────────────────────
  {
    name: "KYC Verification Overdue",
    category: "credential-harvest", kind: "email", audience: "customer", region: "global", difficulty: "easy",
    subject: "Action needed: complete {Bank} KYC to avoid account hold",
    body: `<p>Dear Customer,</p><p>Your {Bank} KYC verification is overdue. To avoid a hold on your account, complete verification today:</p><p><a href="{link}">Complete KYC now</a></p><p>{Bank} Compliance</p>`,
    placeholders: ["Bank", "link"], techniques: ["T1566.002", "T1204.001"],
    description: "A 'Know Your Customer' compliance lure that pressures customers to 're-verify' identity and card details on a fake portal. A dominant retail-banking phishing theme globally.",
    redFlags: ["Account-hold threat for 'overdue KYC'", "KYC 'completed' via an emailed link", "Requests card/PIN/Aadhaar/SSN online"],
    sourceRef: "Modeled on global bank KYC-verification phishing.", license: "training-use",
  },
  {
    name: "SBI/HDFC KYC Update (India)",
    category: "smishing", kind: "sms", audience: "customer", region: "india", difficulty: "easy",
    subject: "",
    body: `Dear Customer, your {Bank} account will be SUSPENDED today due to incomplete KYC. Update immediately: {link} — {Bank}`,
    placeholders: ["Bank", "link"], techniques: ["T1566.004", "T1204.001"],
    description: "India-specific KYC-update smishing — mass SMS claiming the account will be suspended unless KYC is updated via a link. One of the most reported bank-fraud vectors in India (SBI/HDFC/ICICI/PNB impersonation).",
    redFlags: ["SMS link to 'update KYC' (banks never do this)", "Today-only suspension threat", "Shortened/look-alike URL"],
    sourceRef: "Modeled on India retail-bank KYC-update smishing (SBI/HDFC/ICICI impersonation).", license: "training-use",
  },
  {
    name: "Income-Tax Refund Pending (India)",
    category: "smishing", kind: "sms", audience: "customer", region: "india", difficulty: "easy",
    subject: "",
    body: `Income Tax Dept: You have a refund of {Amount} approved. Verify your bank account to receive it: {link}`,
    placeholders: ["Amount", "link"], techniques: ["T1566.004", "T1204.001"],
    description: "Tax-refund smishing promising a refund if the victim 'verifies' their bank account on a fake portal — a recurring seasonal fraud impersonating the Indian Income-Tax Department.",
    redFlags: ["Unexpected refund 'approved'", "Verify bank details via SMS link", "Government body contacting via shortlink"],
    sourceRef: "Modeled on India Income-Tax-refund smishing.", license: "training-use",
  },
  {
    name: "UPI Collect-Request 'Credit' Scam (India)",
    category: "smishing", kind: "sms", audience: "customer", region: "india", difficulty: "medium",
    subject: "",
    body: `You have received {Amount} via UPI from {Sender}. APPROVE the request in your app to credit your account: {link}`,
    placeholders: ["Amount", "Sender", "link"], techniques: ["T1566.004", "T1598"],
    description: "UPI 'collect request' reversal scam: the victim is told money is incoming and to 'approve to receive', but approving a UPI collect request actually SENDS money. A top UPI fraud pattern in India.",
    redFlags: ["Approving/entering UPI PIN to RECEIVE money (never needed)", "Pressure to approve a 'credit' request", "Unknown requester"],
    sourceRef: "Modeled on India UPI collect-request ('approve to receive') fraud.", license: "training-use",
  },
  {
    name: "Reward Points Expiring — Redeem Now",
    category: "smishing", kind: "sms", audience: "customer", region: "global", difficulty: "easy",
    subject: "",
    body: `{Bank}: Your {Amount} reward points expire TODAY. Redeem now before they lapse: {link}`,
    placeholders: ["Bank", "Amount", "link"], techniques: ["T1566.004", "T1204.001"],
    description: "Reward/cashback-expiry smishing driving customers to a fake redemption portal that harvests card and online-banking details. Extremely common across India and globally.",
    redFlags: ["'Points expire today' urgency", "Redeem via SMS link", "Asks for card number/CVV/OTP to 'redeem'"],
    sourceRef: "Modeled on bank reward-points/cashback redemption smishing.", license: "training-use",
  },
  {
    name: "Account Locked — Reactivate (Smishing)",
    category: "smishing", kind: "sms", audience: "customer", region: "global", difficulty: "easy",
    subject: "",
    body: `{Bank} Alert: Your account has been LOCKED for security. Reactivate within 2 hours to avoid permanent closure: {link}`,
    placeholders: ["Bank", "link"], techniques: ["T1566.004", "T1204.001"],
    description: "Account-locked smishing — short, high-urgency SMS driving a tap-through to a credential-harvest page. The highest-volume consumer bank phishing channel today.",
    redFlags: ["SMS claiming the account is locked", "Two-hour / permanent-closure threat", "Link to 'reactivate' instead of the official app"],
    sourceRef: "Modeled on global retail-bank account-locked smishing.", license: "training-use",
  },
  {
    name: "Mobile Banking App Update (SOVA/BRATA)",
    category: "malware", kind: "sms", audience: "customer", region: "global", difficulty: "hard",
    subject: "",
    body: `{Bank}: A critical security update is required for your mobile banking app. Install now to keep access: {link} [{Bank}-secure.apk]`,
    placeholders: ["Bank", "link"], techniques: ["T1566.004", "T1204.001"],
    description: "Smishing that pushes a malicious Android banking app ('security update') — the delivery method of mobile banking trojans such as SOVA, BRATA, Cerberus and Hydra, which overlay real bank apps and steal credentials/OTPs on the device.",
    redFlags: ["App 'update' delivered via SMS link / sideloaded APK", "Install from outside the official app store", "Requests Accessibility / SMS permissions after install"],
    sourceRef: "Modeled on Android banking-trojan smishing (SOVA / BRATA / Cerberus / Hydra).", license: "training-use",
  },

  // ───────────────────────── Banking-trojan delivery (corporate) ─────────────────────────
  {
    name: "Reply-Chain Invoice (Emotet/QakBot)",
    category: "attachment", kind: "email", audience: "employee", region: "global", difficulty: "hard",
    subject: "RE: {Vendor} invoice {InvoiceNo} — updated copy",
    body: `<p>Hi {Name},</p><p>Please see the updated invoice from {Vendor} as discussed. Open the attached document and enable content to view it.</p><p>[{Vendor}_invoice_{InvoiceNo}.doc]</p><p>Thanks,<br>{Sender}</p><hr><p style="color:#888;font-size:11px">&gt; On {Date}, {Name} wrote: … (quoted prior thread)</p>`,
    placeholders: ["Vendor", "InvoiceNo", "Name", "Sender", "Date"], techniques: ["T1566.001", "T1204.002", "T1203"],
    description: "Thread-hijacked reply-chain email carrying a malicious invoice document — the signature delivery of Emotet and QakBot (QBot), loaders that led to banking-credential theft and ransomware across the financial sector.",
    redFlags: ["Reply-chain that quotes a real prior email but adds an attachment", "'Enable content' to view an invoice", "Slightly-off sender address on a known thread"],
    sourceRef: "Modeled on Emotet / QakBot reply-chain invoice delivery.", license: "training-use",
  },
  {
    name: "E-Banking Certificate Update (Retefe)",
    category: "attachment", kind: "email", audience: "customer", region: "eu", difficulty: "hard",
    subject: "{Bank} e-banking: install the updated security certificate",
    body: `<p>Dear Customer,</p><p>To continue using {Bank} e-banking you must install an updated security certificate. Open the attached file and follow the steps.</p><p>[{Bank}_ebanking_cert.zip]</p><p>{Bank} e-Banking</p>`,
    placeholders: ["Bank"], techniques: ["T1566.001", "T1204.002"],
    description: "A 'security certificate update' attachment that installs malware reconfiguring the device to silently reroute online-banking traffic — the Retefe banking trojan's method against banks in Switzerland, Austria, the UK and Japan.",
    redFlags: ["Asked to install a 'certificate' from an email attachment", "ZIP/installer for e-banking", "Steps to change proxy/root-certificate settings"],
    sourceRef: "Modeled on the Retefe banking trojan (Switzerland/Austria/UK/Japan).", license: "training-use",
  },

  // ───────────────────────── BEC / corporate banking ─────────────────────────
  {
    name: "Vendor Bank-Account Change (BEC)",
    category: "bec", kind: "email", audience: "employee", region: "global", difficulty: "hard",
    subject: "Updated remittance details for invoice {InvoiceNo}",
    body: `<p>Hello {Name},</p><p>Please note our banking details have changed. Kindly update your records and remit the balance for invoice <b>{InvoiceNo}</b> to the new account. Reply and I'll confirm the details.</p><p>Regards,<br>{Sender} — {Vendor} Accounts</p>`,
    placeholders: ["Name", "InvoiceNo", "Sender", "Vendor"], techniques: ["T1566.003", "T1598"],
    description: "Vendor-impersonation BEC asking accounts-payable to redirect a payment to a fraudster-controlled account — the single costliest email-fraud category (billions in losses, per the FBI IC3).",
    redFlags: ["Supplier 'changed bank details' by email", "No out-of-band (phone) verification", "Look-alike sender domain", "Pressure to remit before verifying"],
    sourceRef: "Modeled on Business Email Compromise (BEC) vendor-payment-redirect fraud (FBI IC3).", license: "training-use",
  },
  {
    name: "CEO Urgent Wire Request (BEC)",
    category: "bec", kind: "email", audience: "employee", region: "global", difficulty: "medium",
    subject: "Are you at your desk?",
    body: `<p>{Name}, I need you to process an urgent wire before our board call — it's time-sensitive and confidential. Reply and I'll send the beneficiary details.</p><p>Sent from my iPhone — {ExecName}, CEO</p>`,
    placeholders: ["Name", "ExecName"], techniques: ["T1566.003", "T1598"],
    description: "Executive-impersonation BEC pressuring a finance employee into an urgent, confidential wire transfer. A long-running, high-loss corporate-banking fraud.",
    redFlags: ["Urgency + secrecy from a 'C-level' sender", "'Sent from my iPhone' to excuse the odd tone", "Reply-to address differs from the exec's real one"],
    sourceRef: "Modeled on CEO-fraud / Business Email Compromise wire-transfer scams.", license: "training-use",
  },
  {
    name: "Relationship Manager Transfer Confirmation",
    category: "bec", kind: "email", audience: "customer", region: "global", difficulty: "medium",
    subject: "{Bank}: your relationship manager needs you to confirm a transfer",
    body: `<p>Dear {Name},</p><p>This is {Sender}, your {Bank} relationship manager. A transfer on your account needs confirmation. Please review and confirm here before 5 PM:</p><p><a href="{link}">Review & confirm transfer</a></p><p>{Sender} — {Bank} Private Banking</p>`,
    placeholders: ["Name", "Bank", "Sender", "link"], techniques: ["T1566.002", "T1598", "T1204.001"],
    description: "Private-banking relationship-manager impersonation targeting high-net-worth customers to authorize or 'confirm' a transfer on a fake portal. Targets the trust customers place in a named banker.",
    redFlags: ["Named 'RM' you can't verify is really them", "Link to confirm a transfer by deadline", "Bypasses the official app's approval flow"],
    sourceRef: "Modeled on private-banking relationship-manager impersonation fraud.", license: "training-use",
  },
];

// Old generic placeholders (pre-banking library). They are NOT deleted on seed:
// PhishingCampaign rows reference templates by id (config.templateId), so
// removing them would break viewing/relaunching any campaign built from one.
// They simply stay alongside the banking library.
export const LEGACY_TEMPLATE_NAMES = [
  "Password Expiry Notice", "Shared Document (OneDrive)", "Invoice Attachment",
  "MFA Re-enrollment", "CEO Wire Request (BEC)", "Microsoft 365 Sign-in (Landing)",
];

export async function ensurePhishingTemplates(): Promise<void> {
  // Idempotent: only (re)seed when the banking library isn't fully present, so a
  // GET on the templates endpoint stays cheap.
  const names = TEMPLATES.map((t) => t.name);
  const have = await prisma.phishingTemplate.count({ where: { name: { in: names } } });
  if (have >= names.length) return;

  // Create ONLY the templates that are missing. Never overwrite an existing row:
  // an operator may have tuned a seeded template's body/red-flags, and one
  // missing name must not clobber every other seeded template's edits.
  const existing = new Set(
    (await prisma.phishingTemplate.findMany({ where: { name: { in: names } }, select: { name: true } })).map((r) => r.name),
  );
  for (const t of TEMPLATES) {
    if (existing.has(t.name)) continue;
    await prisma.phishingTemplate.create({
      data: {
        name: t.name,
        category: t.category, kind: t.kind, subject: t.subject, body: t.body,
        placeholders: JSON.stringify(t.placeholders), techniques: JSON.stringify(t.techniques),
        description: t.description, redFlags: JSON.stringify(t.redFlags),
        audience: t.audience, region: t.region, difficulty: t.difficulty,
        sourceRef: t.sourceRef, license: t.license,
      },
    }).catch((e: any) => { if (e?.code !== "P2002") throw e; }); // lost a race to a concurrent seed — fine
  }
}
