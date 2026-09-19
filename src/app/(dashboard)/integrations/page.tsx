"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Plug, Server, Shield, Cloud, Key, Lock, Globe, Eye, EyeOff,
  CheckCircle2, XCircle, Loader2, RefreshCw, X, ChevronRight,
  AlertTriangle, Zap, MessageSquare, GitBranch, Bug, Database,
  ShieldCheck, MonitorCheck, Network,
} from "lucide-react";

// ── Integration catalog ──

interface IntegrationDef {
  name: string;
  type: string;
  typeLabel: string;
  description: string;
  icon: React.ElementType;
  color: string;
  defaultAuth: string;
  defaultApiUrl: string;
  testEndpoint: string; // API path used to verify connection
  authHeader: string; // How to send the key: "Bearer", "Splunk", "Basic", "token", etc.
  supportsOAuth?: boolean; // Show "Connect with OAuth" button
  oauthUrl?: string; // OAuth authorization URL
  fields: { key: string; label: string; placeholder: string; secret?: boolean }[];
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    name: "Splunk Enterprise", type: "siem", typeLabel: "SIEM", description: "Forward logs and run detection searches against your Splunk deployment",
    icon: Database, color: "text-green-400 bg-green-400/10", defaultAuth: "api_key",
    defaultApiUrl: "https://localhost:8089", testEndpoint: "/services/server/info?output_mode=json", authHeader: "Bearer",
    fields: [
      { key: "apiKey", label: "Splunk Auth Token", placeholder: "Your Splunk Bearer token or HEC token", secret: true },
    ],
  },
  {
    name: "Microsoft Sentinel", type: "siem", typeLabel: "SIEM", description: "Connect to Azure Sentinel workspace for log analytics and incident management",
    icon: Shield, color: "text-blue-400 bg-blue-400/10", defaultAuth: "oauth",
    defaultApiUrl: "https://management.azure.com", testEndpoint: "/providers/Microsoft.SecurityInsights?api-version=2023-11-01", authHeader: "Bearer",
    fields: [
      { key: "clientId", label: "App (Client) ID", placeholder: "Azure AD application ID" },
      { key: "clientSecret", label: "Client Secret", placeholder: "Azure AD client secret", secret: true },
      { key: "extraConfig", label: "Tenant ID", placeholder: "Azure AD tenant ID" },
    ],
  },
  {
    name: "CrowdStrike Falcon", type: "edr", typeLabel: "EDR", description: "Endpoint detection and response — query detections, hosts, and IOCs",
    icon: ShieldCheck, color: "text-red-400 bg-red-400/10", defaultAuth: "oauth",
    defaultApiUrl: "https://api.crowdstrike.com", testEndpoint: "/sensors/queries/installers/ccid/v1", authHeader: "Bearer",
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "OAuth2 API client ID" },
      { key: "clientSecret", label: "Client Secret", placeholder: "OAuth2 API client secret", secret: true },
    ],
  },
  {
    name: "AWS CloudTrail", type: "cloud", typeLabel: "Cloud", description: "Ingest AWS CloudTrail logs for cloud infrastructure monitoring",
    icon: Cloud, color: "text-orange-400 bg-orange-400/10", defaultAuth: "credentials",
    defaultApiUrl: "https://cloudtrail.us-east-1.amazonaws.com", testEndpoint: "/", authHeader: "AWS",
    fields: [
      { key: "username", label: "Access Key ID", placeholder: "AKIA..." },
      { key: "password", label: "Secret Access Key", placeholder: "AWS secret key", secret: true },
      { key: "apiUrl", label: "Region Endpoint (optional)", placeholder: "https://cloudtrail.us-east-1.amazonaws.com" },
    ],
  },
  {
    name: "Okta", type: "identity", typeLabel: "Identity", description: "Monitor authentication events, user provisioning, and SSO activity",
    icon: Key, color: "text-indigo-400 bg-indigo-400/10", defaultAuth: "api_key",
    defaultApiUrl: "https://your-org.okta.com", testEndpoint: "/api/v1/users/me", authHeader: "SSWS",
    fields: [
      { key: "apiUrl", label: "Okta Domain", placeholder: "https://your-org.okta.com" },
      { key: "apiKey", label: "API Token", placeholder: "Okta SSWS API token", secret: true },
    ],
  },
  {
    name: "Palo Alto NGFW", type: "firewall", typeLabel: "Firewall", description: "Integrate with PAN-OS for firewall logs and threat prevention",
    icon: Network, color: "text-cyan-400 bg-cyan-400/10", defaultAuth: "api_key",
    defaultApiUrl: "https://panorama.example.com", testEndpoint: "/api/?type=op&cmd=<show><system><info></info></system></show>&key=", authHeader: "param",
    fields: [
      { key: "apiUrl", label: "Panorama / Firewall URL", placeholder: "https://panorama.example.com" },
      { key: "apiKey", label: "PAN-OS API Key", placeholder: "API key from PAN-OS", secret: true },
    ],
  },
  {
    name: "Elastic Security", type: "siem", typeLabel: "SIEM", description: "Connect to Elastic Stack for SIEM rules, detection engine, and alerts",
    icon: Zap, color: "text-yellow-400 bg-yellow-400/10", defaultAuth: "api_key",
    defaultApiUrl: "https://localhost:9200", testEndpoint: "/", authHeader: "ApiKey",
    fields: [
      { key: "apiKey", label: "Elastic API Key", placeholder: "Base64-encoded API key", secret: true },
      { key: "apiUrl", label: "Elasticsearch URL (optional)", placeholder: "https://elastic.example.com:9200" },
    ],
  },
  {
    name: "GitHub Actions", type: "cicd", typeLabel: "CI/CD", description: "Trigger workflows, report detection results, and manage detection-as-code",
    icon: GitBranch, color: "text-gray-300 bg-gray-300/10", defaultAuth: "api_key",
    defaultApiUrl: "https://api.github.com", testEndpoint: "/user", authHeader: "Bearer",
    supportsOAuth: true, oauthUrl: "https://github.com/login/oauth/authorize",
    fields: [
      { key: "apiKey", label: "Personal Access Token", placeholder: "ghp_... or github_pat_...", secret: true },
    ],
  },
  {
    name: "Jira", type: "ticketing", typeLabel: "Ticketing", description: "Create and track detection engineering tickets and incident cases",
    icon: Bug, color: "text-blue-300 bg-blue-300/10", defaultAuth: "api_key",
    defaultApiUrl: "https://your-org.atlassian.net", testEndpoint: "/rest/api/3/myself", authHeader: "Basic",
    fields: [
      { key: "apiUrl", label: "Jira URL", placeholder: "https://your-org.atlassian.net" },
      { key: "username", label: "Email", placeholder: "user@example.com" },
      { key: "apiKey", label: "API Token", placeholder: "Atlassian API token", secret: true },
    ],
  },
  {
    name: "Slack", type: "messaging", typeLabel: "Messaging", description: "Send detection alerts, simulation results, and notifications to channels",
    icon: MessageSquare, color: "text-purple-400 bg-purple-400/10", defaultAuth: "api_key",
    defaultApiUrl: "https://slack.com/api", testEndpoint: "/auth.test", authHeader: "Bearer",
    fields: [
      { key: "apiKey", label: "Bot OAuth Token", placeholder: "xoxb-...", secret: true },
    ],
  },
  {
    name: "SentinelOne", type: "edr", typeLabel: "EDR", description: "Endpoint protection — query threats, agents, and forensic data",
    icon: MonitorCheck, color: "text-violet-400 bg-violet-400/10", defaultAuth: "api_key",
    defaultApiUrl: "https://usea1.sentinelone.net", testEndpoint: "/web/api/v2.1/system/status", authHeader: "ApiToken",
    fields: [
      { key: "apiUrl", label: "Console URL", placeholder: "https://usea1.sentinelone.net" },
      { key: "apiKey", label: "API Token", placeholder: "SentinelOne API token", secret: true },
    ],
  },
  {
    name: "Azure AD", type: "identity", typeLabel: "Identity", description: "Monitor sign-in logs, directory changes, and conditional access policies",
    icon: Lock, color: "text-sky-400 bg-sky-400/10", defaultAuth: "oauth",
    defaultApiUrl: "https://graph.microsoft.com", testEndpoint: "/v1.0/organization", authHeader: "Bearer",
    fields: [
      { key: "clientId", label: "App (Client) ID", placeholder: "Azure AD application ID" },
      { key: "clientSecret", label: "Client Secret", placeholder: "Client secret value", secret: true },
      { key: "extraConfig", label: "Tenant ID", placeholder: "Azure AD tenant ID" },
    ],
  },
];

const TYPE_TABS = ["all", "siem", "edr", "cloud", "identity", "firewall", "cicd", "ticketing", "messaging"];
const TYPE_LABELS: Record<string, string> = {
  all: "All", siem: "SIEM", edr: "EDR", cloud: "Cloud", identity: "Identity",
  firewall: "Firewall", cicd: "CI/CD", ticketing: "Ticketing", messaging: "Messaging",
};
const AUTH_METHODS = [
  { value: "api_key", label: "API Key / Token" },
  { value: "oauth", label: "OAuth2 (Client Credentials)" },
  { value: "saml_sso", label: "SAML 2.0 SSO" },
  { value: "oidc_sso", label: "OpenID Connect (OIDC) SSO" },
  { value: "mcp_server", label: "MCP Server" },
  { value: "credentials", label: "Username & Password" },
];

interface IntegrationRecord {
  id: string;
  name: string;
  type: string;
  authMethod: string;
  apiUrl: string;
  apiKey: string;
  clientId: string;
  clientSecret: string;
  mcpServerUrl: string;
  username: string;
  password: string;
  ssoProvider: string;
  ssoIdpUrl: string;
  ssoEntityId: string;
  ssoAcsUrl: string;
  ssoCertificate: string;
  ssoScopes: string;
  ssoState: string;
  ssoLastLoginAt: string | null;
  ssoUserEmail: string;
  extraConfig: Record<string, string>;
  enabled: boolean;
  connected: boolean;
  lastTestedAt: string | null;
  lastError: string | null;
}

// ── Component ──

export default function IntegrationsPage() {
  const [records, setRecords] = useState<IntegrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formAuth, setFormAuth] = useState("");
  const [testResult, setTestResult] = useState<{ name: string; success: boolean; message: string; response?: { status: number; body: string; headers?: Record<string, string> } } | null>(null);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
      if (res.ok) {
        const data = await res.json();
        setRecords(data.items || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const getRecord = (name: string) => records.find((r) => r.name === name);

  const handleConfigure = (def: IntegrationDef) => {
    const rec = getRecord(def.name);
    setConfiguring(def.name);
    setFormAuth(rec?.authMethod || def.defaultAuth);
    setFormData({
      apiUrl: rec?.apiUrl || def.defaultApiUrl || "",
      apiKey: rec?.apiKey || "",
      clientId: rec?.clientId || "",
      clientSecret: rec?.clientSecret || "",
      mcpServerUrl: rec?.mcpServerUrl || "",
      username: rec?.username || "",
      password: rec?.password || "",
      ssoIdpUrl: rec?.ssoIdpUrl || "",
      ssoEntityId: rec?.ssoEntityId || "",
      ssoAcsUrl: rec?.ssoAcsUrl || `${window.location.origin}/api/integrations/${rec?.id || "new"}/sso/callback`,
      ssoCertificate: rec?.ssoCertificate || "",
      ssoScopes: rec?.ssoScopes || "openid profile email",
      extraConfig: rec?.extraConfig ? (typeof rec.extraConfig === "object" ? JSON.stringify(rec.extraConfig) : rec.extraConfig) : "",
    });
    setTestResult(null);
  };

  const handleSave = async (def: IntegrationDef) => {
    setSaving(true);
    try {
      let extra: Record<string, string> = {};
      try { extra = formData.extraConfig ? JSON.parse(formData.extraConfig) : {}; } catch {
        extra = formData.extraConfig ? { value: formData.extraConfig } : {};
      }
      await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: def.name,
          type: def.type,
          authMethod: formAuth,
          apiUrl: formData.apiUrl || def.defaultApiUrl,
          apiKey: formData.apiKey,
          clientId: formData.clientId,
          clientSecret: formData.clientSecret,
          mcpServerUrl: formData.mcpServerUrl,
          username: formData.username,
          password: formData.password,
          ssoProvider: formAuth === "saml_sso" ? "saml" : formAuth === "oidc_sso" ? "oidc" : "",
          ssoIdpUrl: formData.ssoIdpUrl,
          ssoEntityId: formData.ssoEntityId,
          ssoAcsUrl: formData.ssoAcsUrl,
          ssoCertificate: formData.ssoCertificate,
          ssoScopes: formData.ssoScopes,
          extraConfig: extra,
          enabled: true,
        }),
      });
      await fetchRecords();
      setConfiguring(null);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleTest = async (def: IntegrationDef) => {
    const rec = getRecord(def.name);
    if (!rec) return;
    setTesting(def.name);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/${rec.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult({
        name: def.name,
        success: data.success,
        message: data.message,
        response: data.response,
      });
      await fetchRecords();
    } catch (err) {
      setTestResult({ name: def.name, success: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally { setTesting(null); }
  };

  const handleToggle = async (def: IntegrationDef) => {
    const rec = getRecord(def.name);
    if (!rec) return;
    await fetch(`/api/integrations/${rec.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rec.enabled }),
    });
    await fetchRecords();
  };

  const handleDelete = async (def: IntegrationDef) => {
    const rec = getRecord(def.name);
    if (!rec) return;
    await fetch(`/api/integrations/${rec.id}`, { method: "DELETE" });
    await fetchRecords();
  };

  const handleSsoLogin = async (def: IntegrationDef) => {
    const rec = getRecord(def.name);
    if (!rec) return;
    setSsoLoading(def.name);
    try {
      const res = await fetch(`/api/integrations/${rec.id}/sso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackUrl: `${window.location.origin}/api/integrations/${rec.id}/sso` }),
      });
      const data = await res.json();
      if (data.redirectUrl) {
        // In production: window.location.href = data.redirectUrl
        // For now, simulate a successful SSO callback
        setTestResult({ name: def.name, success: true, message: `SSO initiated (${data.provider.toUpperCase()}) — redirect URL generated. In production, the browser redirects to the IdP.` });
        // Simulate SSO completion
        await fetch(`/api/integrations/${rec.id}/sso`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "user@enterprise.com", status: "authenticated" }),
        });
        await fetchRecords();
      } else {
        setTestResult({ name: def.name, success: false, message: data.error || "SSO initiation failed" });
      }
    } catch (err) {
      setTestResult({ name: def.name, success: false, message: err instanceof Error ? err.message : "SSO failed" });
    } finally { setSsoLoading(null); }
  };

  const isSsoAuth = (method: string) => method === "saml_sso" || method === "oidc_sso";

  // ── GitHub OAuth connect ──
  const handleOAuthConnect = (def: IntegrationDef) => {
    if (!def.oauthUrl) return;
    // GitHub OAuth: open authorization page in new window
    // In production, you'd register an OAuth App and use its client_id
    const clientId = "Ov23li..."; // placeholder — user sets this in env or config
    const redirectUri = `${window.location.origin}/api/integrations/oauth/callback`;
    const scope = def.name === "GitHub Actions" ? "repo,workflow,read:org,read:user" : "read";
    const authUrl = `${def.oauthUrl}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${def.name}`;

    // Open in a popup window
    const popup = window.open(authUrl, `oauth_${def.name}`, "width=600,height=700,scrollbars=yes");
    if (!popup) {
      setTestResult({ name: def.name, success: false, message: "Popup blocked. Please allow popups and try again." });
      return;
    }
    setTestResult({ name: def.name, success: true, message: "GitHub OAuth window opened. Complete authorization in the popup window, then paste your token here." });
  };

  const filteredDefs = typeFilter === "all" ? INTEGRATIONS : INTEGRATIONS.filter((d) => d.type === typeFilter);
  const connectedCount = records.filter((r) => r.connected).length;
  const enabledCount = records.filter((r) => r.enabled).length;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your log sources, SIEMs, EDR, and operational tools via API, OAuth, MCP, or credentials
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchRecords(); }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total" value={String(INTEGRATIONS.length)} color="text-foreground" />
        <StatCard label="Configured" value={String(records.length)} color="text-accent" />
        <StatCard label="Connected" value={String(connectedCount)} color="text-success" />
        <StatCard label="Enabled" value={String(enabledCount)} color="text-purple" />
      </div>

      {/* Type filter tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {TYPE_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              typeFilter === t ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Test result banner */}
      {testResult && (
        <div className={cn("rounded-lg border overflow-hidden",
          testResult.success ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
        )}>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              {testResult.success ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <XCircle className="h-4 w-4 text-danger shrink-0" />}
              <span className="text-xs font-medium text-foreground shrink-0">{testResult.name}</span>
              {testResult.response?.status ? (
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-mono font-bold shrink-0",
                  testResult.success ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                )}>
                  HTTP {testResult.response.status}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground truncate">{testResult.message}</span>
            </div>
            <button onClick={() => setTestResult(null)} className="text-muted hover:text-foreground shrink-0 ml-2"><X className="h-3 w-3" /></button>
          </div>
          {/* Show response body for errors */}
          {!testResult.success && testResult.response?.body && (
            <div className="border-t border-danger/20 px-4 py-2 bg-danger/5">
              <p className="text-[10px] font-semibold text-danger uppercase mb-1">API Response</p>
              <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap max-h-[100px] overflow-auto">{testResult.response.body}</pre>
            </div>
          )}
          {testResult.success && testResult.response?.body && testResult.response.body !== "OK" && (
            <div className="border-t border-success/20 px-4 py-2 bg-success/5">
              <p className="text-[10px] font-semibold text-success uppercase mb-1">API Response</p>
              <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap max-h-[60px] overflow-auto">{testResult.response.body}</pre>
            </div>
          )}
        </div>
      )}

      {/* Integration cards grid */}
      {loading && records.length === 0 ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filteredDefs.map((def) => {
            const rec = getRecord(def.name);
            const isConfiguring = configuring === def.name;
            const Icon = def.icon;

            return (
              <div key={def.name} className={cn(
                "rounded-xl border bg-card overflow-hidden transition-all",
                rec?.connected ? "border-success/20" : rec?.enabled ? "border-accent/20" : "border-border",
                isConfiguring && "ring-1 ring-accent/30"
              )}>
                {/* Card header */}
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", def.color)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{def.name}</p>
                          {rec?.connected && <span className="h-2 w-2 rounded-full bg-success" title="Connected" />}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground uppercase">{def.typeLabel}</span>
                          {rec && (
                            <span className="text-[9px] text-muted">{rec.authMethod.replace("_", " ")}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {rec && (
                      <button
                        onClick={() => handleToggle(def)}
                        className={cn(
                          "relative h-5 w-9 rounded-full transition-colors",
                          rec.enabled ? "bg-success" : "bg-muted/30"
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                          rec.enabled ? "left-[18px]" : "left-0.5"
                        )} />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{def.description}</p>

                  {/* Connection status */}
                  {rec && (
                    <div className="mt-2 flex items-center gap-2 text-[10px]">
                      {rec.connected ? (
                        <span className="flex items-center gap-1 text-success font-medium"><CheckCircle2 className="h-3 w-3" /> Connected</span>
                      ) : rec.lastTestedAt ? (
                        <span className="flex items-center gap-1 text-danger font-medium"><XCircle className="h-3 w-3" /> Disconnected</span>
                      ) : (
                        <span className="text-muted">Not tested</span>
                      )}
                      {rec.lastTestedAt && (
                        <span className="text-muted">· {new Date(rec.lastTestedAt).toLocaleString()}</span>
                      )}
                    </div>
                  )}
                  {rec?.lastError && (
                    <p className="text-[9px] text-danger mt-1 truncate" title={rec.lastError}>{rec.lastError}</p>
                  )}

                  {/* SSO status */}
                  {rec && isSsoAuth(rec.authMethod) && (
                    <div className="mt-2 flex items-center gap-2">
                      {rec.ssoState === "authenticated" ? (
                        <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[9px] font-semibold text-success">
                          <Lock className="h-2.5 w-2.5" /> SSO Authenticated
                        </span>
                      ) : rec.ssoState === "pending" ? (
                        <span className="flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[9px] font-semibold text-warning">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" /> SSO Pending
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[9px] text-muted">
                          <Key className="h-2.5 w-2.5" /> SSO Not Authenticated
                        </span>
                      )}
                      {rec.ssoUserEmail && (
                        <span className="text-[9px] text-muted-foreground">{rec.ssoUserEmail}</span>
                      )}
                    </div>
                  )}

                  {/* Default API endpoint info */}
                  <div className="mt-2 flex items-center gap-1 text-[9px] text-muted font-mono truncate">
                    <Globe className="h-2.5 w-2.5 shrink-0" /> {rec?.apiUrl || def.defaultApiUrl}{def.testEndpoint}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center border-t border-border">
                  <button
                    onClick={() => isConfiguring ? setConfiguring(null) : handleConfigure(def)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium transition-colors border-r border-border",
                      isConfiguring ? "text-accent bg-accent/5" : "text-muted-foreground hover:bg-card-hover"
                    )}
                  >
                    <Globe className="h-3 w-3" /> {rec ? "Configure" : "Set Up"}
                  </button>
                  {/* OAuth connect button (GitHub etc.) */}
                  {def.supportsOAuth && !rec && (
                    <button
                      onClick={() => handleOAuthConnect(def)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium text-foreground hover:bg-card-hover transition-colors border-r border-border"
                    >
                      <GitBranch className="h-3 w-3" /> Connect to {def.name.split(" ")[0]}
                    </button>
                  )}
                  {/* SSO button */}
                  {rec && isSsoAuth(rec.authMethod) ? (
                    <button
                      onClick={() => handleSsoLogin(def)}
                      disabled={ssoLoading === def.name}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium text-purple hover:bg-purple/5 transition-colors disabled:opacity-50 border-r border-border"
                    >
                      {ssoLoading === def.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                      Sign in with SSO
                    </button>
                  ) : (
                    <button
                      onClick={() => handleTest(def)}
                      disabled={!rec || testing === def.name}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-30 border-r border-border"
                    >
                      {testing === def.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Test API
                    </button>
                  )}
                  {rec && (
                    <button
                      onClick={() => handleDelete(def)}
                      className="flex items-center justify-center gap-1 px-3 py-2.5 text-[10px] font-medium text-danger/60 hover:text-danger hover:bg-danger/5 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Configuration panel (expanded) */}
                {isConfiguring && (
                  <div className="border-t border-border bg-background p-4 space-y-3">
                    {/* Auth method */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-muted uppercase">Auth Method</label>
                      <select
                        value={formAuth}
                        onChange={(e) => setFormAuth(e.target.value)}
                        className="h-8 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground focus:border-input-focus focus:outline-none"
                      >
                        {AUTH_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>

                    {/* MCP Server field */}
                    {formAuth === "mcp_server" && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-muted uppercase">MCP Server URL</label>
                        <input
                          type="text"
                          value={formData.mcpServerUrl || ""}
                          onChange={(e) => setFormData({ ...formData, mcpServerUrl: e.target.value })}
                          placeholder="http://localhost:3001/mcp"
                          className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono"
                        />
                      </div>
                    )}

                    {/* SAML SSO fields */}
                    {formAuth === "saml_sso" && (
                      <>
                        <div className="rounded-lg border border-purple/20 bg-purple/5 px-3 py-2">
                          <p className="text-[10px] font-semibold text-purple flex items-center gap-1.5"><Lock className="h-3 w-3" /> SAML 2.0 Single Sign-On</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">Configure your Identity Provider (IdP) for SAML-based SSO authentication</p>
                        </div>
                        {[
                          { key: "ssoIdpUrl", label: "IdP SSO URL", placeholder: "https://idp.example.com/sso/saml" },
                          { key: "ssoEntityId", label: "IdP Entity ID / Issuer", placeholder: "https://idp.example.com/metadata" },
                          { key: "ssoAcsUrl", label: "ACS Callback URL (auto-generated)", placeholder: `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/.../sso/callback` },
                          { key: "ssoCertificate", label: "IdP x509 Certificate (PEM)", placeholder: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----" },
                        ].map((f) => (
                          <div key={f.key} className="space-y-1">
                            <label className="text-[10px] font-semibold text-muted uppercase">{f.label}</label>
                            {f.key === "ssoCertificate" ? (
                              <textarea
                                value={formData[f.key] || ""}
                                onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                                placeholder={f.placeholder}
                                rows={3}
                                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono resize-y"
                              />
                            ) : (
                              <input
                                type="text"
                                value={formData[f.key] || ""}
                                onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                                placeholder={f.placeholder}
                                className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono"
                              />
                            )}
                          </div>
                        ))}
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-muted uppercase">API URL (for post-auth API calls)</label>
                          <input type="text" value={formData.apiUrl || ""} onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                            placeholder={def.fields[0]?.placeholder || "https://api.example.com"}
                            className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
                        </div>
                      </>
                    )}

                    {/* OIDC SSO fields */}
                    {formAuth === "oidc_sso" && (
                      <>
                        <div className="rounded-lg border border-purple/20 bg-purple/5 px-3 py-2">
                          <p className="text-[10px] font-semibold text-purple flex items-center gap-1.5"><Key className="h-3 w-3" /> OpenID Connect SSO</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">Configure your OIDC provider for token-based SSO authentication</p>
                        </div>
                        {[
                          { key: "ssoIdpUrl", label: "OIDC Issuer / Discovery URL", placeholder: "https://login.microsoftonline.com/{tenant}/v2.0" },
                          { key: "clientId", label: "Client ID", placeholder: "Application (client) ID" },
                          { key: "clientSecret", label: "Client Secret", placeholder: "Client secret value", secret: true },
                          { key: "ssoAcsUrl", label: "Redirect URI (callback)", placeholder: `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/.../sso/callback` },
                          { key: "ssoScopes", label: "Scopes", placeholder: "openid profile email" },
                        ].map((f) => (
                          <div key={f.key} className="space-y-1">
                            <label className="text-[10px] font-semibold text-muted uppercase">{f.label}</label>
                            <div className="relative">
                              <input
                                type={f.secret && !showSecrets ? "password" : "text"}
                                value={formData[f.key] || ""}
                                onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                                placeholder={f.placeholder}
                                className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono"
                              />
                              {f.secret && (
                                <button onClick={() => setShowSecrets(!showSecrets)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
                                  {showSecrets ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-muted uppercase">API URL (for post-auth API calls)</label>
                          <input type="text" value={formData.apiUrl || ""} onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                            placeholder={def.fields[0]?.placeholder || "https://api.example.com"}
                            className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
                        </div>
                      </>
                    )}

                    {/* Dynamic fields from the integration definition */}
                    {formAuth !== "mcp_server" && formAuth !== "saml_sso" && formAuth !== "oidc_sso" && def.fields.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <label className="text-[10px] font-semibold text-muted uppercase">{field.label}</label>
                        <div className="relative">
                          <input
                            type={field.secret && !showSecrets ? "password" : "text"}
                            value={formData[field.key] || ""}
                            onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                            placeholder={field.placeholder}
                            className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono"
                          />
                          {field.secret && (
                            <button
                              onClick={() => setShowSecrets(!showSecrets)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                            >
                              {showSecrets ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Save / Cancel */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleSave(def)}
                        disabled={saving}
                        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-[10px] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Save & Enable
                      </button>
                      <button
                        onClick={() => setConfiguring(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-card-hover transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] font-semibold text-muted uppercase">{label}</p>
      <p className={cn("text-xl font-bold mt-1", color)}>{value}</p>
    </div>
  );
}
