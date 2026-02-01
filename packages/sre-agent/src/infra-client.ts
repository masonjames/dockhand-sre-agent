import type { SREConfig } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export interface JobSubmitResponse {
	job_id: string;
	status: string;
	approval_required: boolean;
	approval_id?: string;
	message?: string;
}

/** Response from GET /portal/jobs/{id} — status polling endpoint. */
export interface PortalJobStatus {
	job_id: string;
	status: string;
	summary?: string;
	error?: string;
	result?: unknown;
	artifact_paths?: string[];
}

/** Item returned by GET /portal/jobs — list endpoint with richer metadata. */
export interface PortalJobListItem {
	job_id: string;
	kind: string;
	status: string;
	source: string;
	summary?: string;
	error?: string;
	created_at: string;
	requested_by?: string;
}

export interface JobListResponse {
	jobs: PortalJobListItem[];
	count: number;
}

export interface KnowledgeSearchResult {
	path: string;
	kind: string;
	title: string;
	size_bytes: number;
}

export interface KnowledgeSearchResponse {
	results: KnowledgeSearchResult[];
	count: number;
}

export interface KnowledgeListResponse {
	docs: KnowledgeSearchResult[];
	count: number;
}

export interface KnowledgeDocResponse {
	path: string;
	content: string;
}

export interface TemplateInfo {
	id: string;
	name: string;
	description: string;
	logo: string;
	tags: string[];
	has_policy: boolean;
	blocked?: boolean;
	requires_approval?: boolean;
}

export interface TemplateListResponse {
	templates: TemplateInfo[];
	count: number;
	catalog_total: number;
}

export interface TemplatePolicyResponse {
	policy: Record<string, unknown>;
}

export class InfraClientError extends Error {
	constructor(
		message: string,
		public status: number,
		public body?: unknown,
	) {
		super(message);
		this.name = "InfraClientError";
	}
}

// ============================================================================
// Client
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30_000;

export class InfraAgentClient {
	private baseUrl: string;
	private secret: string;

	constructor(config: SREConfig) {
		// Strip trailing slash
		this.baseUrl = config.infraAgentUrl.replace(/\/+$/, "");
		this.secret = config.portalSecret;
	}

	// -- Jobs ------------------------------------------------------------------

	async submitJob(kind: string, args: Record<string, unknown> = {}, requestedBy?: string): Promise<JobSubmitResponse> {
		return this.post<JobSubmitResponse>("/portal/jobs", {
			kind,
			args,
			requested_by: requestedBy ?? "dockhand",
		});
	}

	async getJob(jobId: string): Promise<PortalJobStatus> {
		return this.get<PortalJobStatus>(`/portal/jobs/${encodeURIComponent(jobId)}`);
	}

	async listJobs(opts?: { status?: string; source?: string; limit?: number }): Promise<JobListResponse> {
		const params = new URLSearchParams();
		if (opts?.status) params.set("status", opts.status);
		if (opts?.source) params.set("source", opts.source);
		if (opts?.limit) params.set("limit", String(opts.limit));
		const qs = params.toString();
		return this.get<JobListResponse>(`/portal/jobs${qs ? `?${qs}` : ""}`);
	}

	// -- Knowledge -------------------------------------------------------------

	async searchKnowledge(query: string, limit?: number): Promise<KnowledgeSearchResponse> {
		const params = new URLSearchParams({ q: query });
		if (limit) params.set("limit", String(limit));
		return this.get<KnowledgeSearchResponse>(`/portal/knowledge/search?${params}`);
	}

	async listKnowledge(kind?: string): Promise<KnowledgeListResponse> {
		const params = new URLSearchParams();
		if (kind) params.set("kind", kind);
		const qs = params.toString();
		return this.get<KnowledgeListResponse>(`/portal/knowledge/list${qs ? `?${qs}` : ""}`);
	}

	async getDocument(path: string): Promise<KnowledgeDocResponse> {
		const params = new URLSearchParams({ path });
		return this.get<KnowledgeDocResponse>(`/portal/knowledge/get?${params}`);
	}

	// -- Templates -------------------------------------------------------------

	async listTemplates(opts?: { tag?: string; query?: string; limit?: number }): Promise<TemplateListResponse> {
		const params = new URLSearchParams();
		if (opts?.tag) params.set("tag", opts.tag);
		if (opts?.query) params.set("query", opts.query);
		if (opts?.limit) params.set("limit", String(opts.limit));
		const qs = params.toString();
		return this.get<TemplateListResponse>(`/portal/templates${qs ? `?${qs}` : ""}`);
	}

	async getTemplatePolicy(templateId: string): Promise<TemplatePolicyResponse> {
		return this.get<TemplatePolicyResponse>(`/portal/templates/${encodeURIComponent(templateId)}/policy`);
	}

	// -- Health ----------------------------------------------------------------

	async health(): Promise<{ ok: boolean; service: string; version: string }> {
		return this.get("/health", false);
	}

	// -- HTTP primitives -------------------------------------------------------

	private async get<T>(path: string, usePortalAuth = true, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = { Accept: "application/json" };
		if (usePortalAuth) headers["X-Portal-Secret"] = this.secret;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
			if (!res.ok) {
				const body = await res.text().catch(() => "");
				throw new InfraClientError(`GET ${path} failed: ${res.status} ${res.statusText}`, res.status, body);
			}
			return (await res.json()) as T;
		} finally {
			clearTimeout(timer);
		}
	}

	private async post<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
			"X-Portal-Secret": this.secret,
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!res.ok) {
				const respBody = await res.text().catch(() => "");
				throw new InfraClientError(`POST ${path} failed: ${res.status} ${res.statusText}`, res.status, respBody);
			}
			return (await res.json()) as T;
		} finally {
			clearTimeout(timer);
		}
	}
}
