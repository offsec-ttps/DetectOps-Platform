import LandingClient from "@/components/marketing/LandingClient";
import { getSessionUser } from "@/lib/auth";

export const metadata = {
  title: "DetectOps · Detection Engineering, operationalized",
  description:
    "Simulate attacks, validate detections across every SIEM you run, and ship rules to GitHub — from one platform. Built for senior detection engineers.",
  openGraph: {
    title: "DetectOps · Detection Engineering, operationalized",
    description:
      "Detection-as-Code for modern Security Operations. 14,000+ rules unified. ATT&CK-mapped. SIEM-validated.",
    type: "website",
  },
};

export default async function RootPage() {
  // Never let a session/DB hiccup 500 the public landing page — fall back to
  // the anonymous view, matching every other getSessionUser() caller.
  const user = await getSessionUser().catch(() => null);
  return <LandingClient signedIn={!!user} userName={user?.name || ""} />;
}
