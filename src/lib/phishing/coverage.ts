/**
 * Phishing attack-template COVERAGE catalogue — the breadth of domains/vectors
 * the simulation module can cover. Captured from PhishGrid's public attack-
 * templates library (phishgrid.com/attack-templates) to convey multi-domain,
 * multi-vector coverage on the Home overview.
 */

export interface CoverageGroup {
  group: string;
  icon: string;            // lucide icon name
  vector: string;          // delivery vector
  techniques: string[];    // representative ATT&CK ids
  templates: string[];
}

export const PHISHGRID_COVERAGE: CoverageGroup[] = [
  {
    group: "Email Phishing", icon: "Mail", vector: "Email",
    techniques: ["T1566.001", "T1566.002", "T1204.001"],
    templates: ["Amazon", "eBay Account", "Encrypted Mail", "Gmail", "Apple iCloud", "LinkedIn"],
  },
  {
    group: "Phone / Vishing Scams", icon: "Phone", vector: "Voice / SMS",
    techniques: ["T1566.004", "T1598"],
    templates: ["Fake Warranty Extension", "Utility Company Scam", "IRS / Tax Scam", "LIC India OTP Fraud", "Prize / Lottery Winnings"],
  },
  {
    group: "Healthcare & Finance", icon: "Landmark", vector: "Email / SMS",
    techniques: ["T1566.001", "T1566.002"],
    templates: ["Healthcare Scams", "Financial Institution Scams", "Credit Card", "Health Promotion"],
  },
  {
    group: "Social Engineering", icon: "Users", vector: "Email / Social",
    techniques: ["T1566.002", "T1598", "T1204.001"],
    templates: ["Job Offer Scams", "Fraud Protection Alert", "Greeting Cards", "Invites From Friends"],
  },
];

export const COVERAGE_SOURCE = "Coverage domains modeled on PhishGrid's attack-templates library (phishgrid.com/attack-templates).";

/**
 * Industry / sector coverage — vertical-specific phishing scenarios. Seeded from
 * PhishGrid's industries page (Education, Finance, Government, Healthcare,
 * Manufacturing, Retail) + extended verticals (Aerospace & Defense, Technology,
 * Energy, Telecom) to convey broad multi-industry coverage.
 */
export interface IndustryCoverage {
  name: string;
  emoji: string;
  blurb: string;
  examples: string[];
  techniques: string[];
  keywords: string[];      // match against template name/subject/category
}

export const INDUSTRY_COVERAGE: IndustryCoverage[] = [
  { name: "Finance & Banking", emoji: "🏦", blurb: "Wire-fraud, account-verification, and payment lures.", examples: ["Bank account verification", "Wire transfer (BEC)", "Credit-card fraud alert", "Crypto exchange login"], techniques: ["T1566.002", "T1566.003", "T1598"], keywords: ["bank", "paypal", "credit", "financ", "invoice", "payment", "payroll", "wire", "billing", "stripe", "quickbooks", "payoneer", "crypto", "coinbase", "binance", "bec"] },
  { name: "Education / EdTech", emoji: "🎓", blurb: "Student & staff portal, financial-aid, and payroll lures.", examples: ["LMS login (Canvas/Moodle)", "Financial-aid update", "Tuition payment", "Faculty payroll"], techniques: ["T1566.002", "T1204.001"], keywords: ["canvas", "moodle", "blackboard", "univers", "college", "student", "school", "edu", "classroom", "tuition", "academic"] },
  { name: "Government", emoji: "🏛️", blurb: "Tax, benefits, and credential-portal lures.", examples: ["IRS / tax refund", "Benefits portal", "Gov SSO login", "FOIA notice"], techniques: ["T1566.001", "T1566.002"], keywords: ["irs", "tax", "gov", "benefit", "social security", "dmv", "usps", "passport"] },
  { name: "Healthcare", emoji: "🏥", blurb: "Patient-portal, insurance, and EHR lures.", examples: ["Patient portal login", "Insurance claim", "EHR password reset", "Lab results"], techniques: ["T1566.002", "T1204.001"], keywords: ["health", "medical", "patient", "insurance", "pharma", "clinic", "hospital", "ehr"] },
  { name: "Manufacturing", emoji: "🏭", blurb: "Vendor-invoice, supplier-portal, and logistics lures.", examples: ["Vendor invoice", "PO confirmation", "Supplier portal", "Shipment tracking"], techniques: ["T1566.001", "T1566.002"], keywords: ["vendor", "invoice", "purchase order", "supplier", "shipment", "logistics", "fedex", "ups", "dhl", "freight"] },
  { name: "Retail / E-commerce", emoji: "🛒", blurb: "Order, refund, and loyalty lures.", examples: ["Order confirmation", "Refund / return", "Loyalty rewards", "Gift card"], techniques: ["T1566.002", "T1204.001"], keywords: ["amazon", "ebay", "shopify", "order", "refund", "walmart", "target", "gift card", "etsy", "delivery", "reward", "offer", "subscription"] },
  { name: "Aerospace & Defense", emoji: "✈️", blurb: "Cleared-personnel, supplier, and compliance lures.", examples: ["Security-clearance update", "Defense supplier portal", "Travel itinerary", "ITAR compliance notice"], techniques: ["T1566.001", "T1566.003", "T1598"], keywords: ["boeing", "lockheed", "defense", "clearance", "itar", "raytheon", "northrop", "aerospace", "aviation"] },
  { name: "Technology / SaaS", emoji: "☁️", blurb: "Cloud console, OAuth-consent, and dev-tool lures.", examples: ["Cloud console login (AWS/Azure/GCP)", "OAuth app consent", "GitHub security alert", "SaaS MFA re-enroll"], techniques: ["T1566.002", "T1528", "T1204.001"], keywords: ["aws", "amazon web services", "azure", "gcp", "google cloud", "oracle", "ibm cloud", "microsoft", "office 365", "office365", "m365", "teams", "slack", "zoom", "webex", "cisco", "bluejeans", "gotomeeting", "ringcentral", "skype", "google workspace", "github", "okta", "dropbox", "onedrive", "sharepoint", "saas", "cloud"] },
  { name: "Energy & Utilities", emoji: "⚡", blurb: "Billing, grid-vendor, and operational lures.", examples: ["Utility bill alert", "Grid vendor portal", "Outage notice", "Meter update"], techniques: ["T1566.001", "T1566.002"], keywords: ["utility", "electric", "gas", "power", "grid", "energy", "meter", "outage"] },
  { name: "Telecom", emoji: "📡", blurb: "Account, SIM-swap, and number-porting lures.", examples: ["Account suspension", "SIM-swap confirm", "Number porting", "Data overage"], techniques: ["T1566.002", "T1566.004"], keywords: ["telecom", "verizon", "at&t", "t-mobile", "sim", "mobile", "ringcentral", "vodafone", "porting", "carrier"] },
];

/** Does a template (by name/subject/category) belong to an industry? */
export function templateMatchesIndustry(t: { name?: string; subject?: string; category?: string }, keywords: string[]): boolean {
  const hay = `${t.name || ""} ${t.subject || ""} ${t.category || ""}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}
