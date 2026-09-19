/**
 * Browser-side fetch helpers for the SAR proxy at /api/detection-lab/cloud/*.
 * Server-to-SAR communication lives in the proxy route; this module only calls
 * our Next.js proxy, never SAR directly.
 */

import type {
  SarAttackRangeListResponse,
  SarBuildRequest,
  SarBuildResponse,
  SarCloudFieldsResponse,
  SarDestroyRequest,
  SarDestroyResponse,
  SarHealthResponse,
  SarOperationStatus,
  SarProvider,
  SarProviderCheckResponse,
  SarShareRequest,
  SarShareResponse,
  SarSuggestedIpResponse,
  SarTemplateContentResponse,
  SarTemplateListResponse,
  SarUpdateNameRequest,
  SarUpdateNameResponse,
} from "@/types/sar";

const BASE = "/api/detection-lab/cloud";

class SarError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const msg = (parsed as any)?.message || (parsed as any)?.reason || res.statusText;
    throw new SarError(res.status, parsed, msg);
  }
  return parsed as T;
}

export async function sarHealth(): Promise<SarHealthResponse> {
  return req<SarHealthResponse>("health");
}

export async function sarProvidersCheck(): Promise<SarProviderCheckResponse> {
  return req<SarProviderCheckResponse>("providers/check");
}

/**
 * The IP to put in a range's `ip_whitelist`.
 *
 * This MUST be the controller HOST's outbound public IP (`/public-ip`), because
 * SSH to the range's router originates from this host. `/suggested-ip` returns
 * the *caller's* address as seen by the controller — and since we always reach
 * the controller through our own localhost proxy, that is `127.0.0.1`, which
 * builds a security group allowing nobody and makes the build fail with
 * "SSH is not available on router" after a 300s timeout.
 */
export async function sarSuggestedIp(): Promise<SarSuggestedIpResponse> {
  const usable = (ip?: string) => !!ip && !/^(127\.|0\.0\.0\.0$|::1$)/.test(ip);
  try {
    const pub = await req<SarSuggestedIpResponse>("public-ip");
    if (usable(pub?.ip)) return pub;
  } catch { /* fall back below */ }
  try {
    const sug = await req<SarSuggestedIpResponse>("suggested-ip");
    if (usable(sug?.ip)) return sug;
  } catch { /* ignore */ }
  // Never hand back a loopback/empty CIDR — the form warns instead.
  return { ip: "", cidr: "" } as SarSuggestedIpResponse;
}

export async function sarListTemplates(): Promise<SarTemplateListResponse> {
  return req<SarTemplateListResponse>("templates");
}

export async function sarGetTemplate(provider: SarProvider, name: string): Promise<SarTemplateContentResponse> {
  return req<SarTemplateContentResponse>(`templates/${provider}/${encodeURIComponent(name)}`);
}

export async function sarCloudFields(provider: SarProvider): Promise<SarCloudFieldsResponse> {
  return req<SarCloudFieldsResponse>(`templates/cloud-fields/${provider}`);
}

export async function sarBuildRange(body: SarBuildRequest): Promise<SarBuildResponse> {
  return req<SarBuildResponse>("attack-range/build", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sarRangeStatus(id: string): Promise<SarOperationStatus> {
  return req<SarOperationStatus>(`attack-range/status/${id}`);
}

export async function sarListRanges(): Promise<SarAttackRangeListResponse> {
  return req<SarAttackRangeListResponse>("attack-range/list");
}

export async function sarDestroyRange(body: SarDestroyRequest): Promise<SarDestroyResponse> {
  return req<SarDestroyResponse>("attack-range/destroy", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sarAbortRange(body: SarDestroyRequest): Promise<SarDestroyResponse> {
  return req<SarDestroyResponse>("attack-range/abort", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sarShareRange(body: SarShareRequest): Promise<SarShareResponse> {
  return req<SarShareResponse>("attack-range/share", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sarUpdateRangeName(body: SarUpdateNameRequest): Promise<SarUpdateNameResponse> {
  return req<SarUpdateNameResponse>("attack-range/update-name", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export { SarError };
