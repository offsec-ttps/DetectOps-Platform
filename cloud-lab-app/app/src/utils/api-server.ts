// Server-side API utilities for Astro SSR
// Uses process.env which is available in Node.js server context

function getApiBaseUrl(): string {
	// In server-side (Node.js), use process.env
	if (typeof process !== 'undefined' && process.env) {
		// If API_URL or PUBLIC_API_URL is explicitly set, use it
		if (process.env.API_URL) {
			return process.env.API_URL.trim();
		}
		if (process.env.PUBLIC_API_URL) {
			return process.env.PUBLIC_API_URL.trim();
		}
		// Otherwise, check if we're in Docker
		const isDocker = process.env.DOCKER === 'true';
		return isDocker ? 'http://api:4000' : 'http://localhost:4000';
	}
	// Fallback for local dev
	return 'http://localhost:4000';
}

const API_BASE_URL = getApiBaseUrl();

export interface Template {
	name: string;
	provider: string;
	path: string;
	description?: string;
	provider_available?: boolean;
	architecture?: any[];
}

export interface ProviderAvailability {
	provider: string;
	available: boolean;
	cli_command: string;
	error_message?: string;
}

export interface AttackRange {
	type: string;
	status: string;
	created_time: string;
	start_time?: string;
	end_time?: string;
	attack_range_id?: string;
	attack_range_name?: string;
	template_name?: string;
	router_public_ip?: string;
	wireguard_config?: string;
	wireguard_config_path?: string;
	sharing?: Record<string, string>;
	result?: any;
	error?: string;
	error_phase?: string;
	traceback?: string;
}

export async function fetchTemplates(): Promise<{ templates: Template[]; providerAvailability: Record<string, ProviderAvailability> }> {
	console.log('[Server] Fetching templates from:', API_BASE_URL);
	const response = await fetch(`${API_BASE_URL}/templates`);
	if (!response.ok) {
		const errorText = await response.text();
		console.error('[Server] Failed to fetch templates:', response.status, errorText);
		throw new Error(`Failed to fetch templates: ${response.status} ${errorText}`);
	}
	const data = await response.json();
	console.log('[Server] Fetched templates:', data.templates?.length || 0);
	return {
		templates: data.templates || [],
		providerAvailability: data.provider_availability || {}
	};
}

export async function fetchAttackRanges(): Promise<AttackRange[]> {
	console.log('[Server] Fetching attack ranges from:', API_BASE_URL);
	const response = await fetch(`${API_BASE_URL}/attack-range/list`);
	if (!response.ok) {
		const errorText = await response.text();
		console.error('[Server] Failed to fetch attack ranges:', response.status, errorText);
		throw new Error(`Failed to fetch attack ranges: ${response.status} ${errorText}`);
	}
	const data = await response.json();
	console.log('[Server] Fetched attack ranges:', data.attack_ranges?.length || 0);
	return data.attack_ranges || [];
}

export async function fetchAttackRangeStatus(attackRangeId: string): Promise<AttackRange> {
	console.log('[Server] Fetching attack range status from:', API_BASE_URL);
	const response = await fetch(`${API_BASE_URL}/attack-range/status/${attackRangeId}`);
	if (!response.ok) {
		const errorText = await response.text();
		console.error('[Server] Failed to fetch attack range status:', response.status, errorText);
		throw new Error(`Failed to fetch attack range status: ${response.status} ${errorText}`);
	}
	return await response.json();
}
