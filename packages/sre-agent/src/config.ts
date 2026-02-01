import type { ThinkingLevel } from "@mariozechner/pi-ai";

export interface SREConfig {
	infraAgentUrl: string;
	portalSecret: string;
	anthropicApiKey: string;
	dataDir: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	timezone: string;
	eventQueueSize: number;
}

export function loadConfig(): SREConfig {
	const missing: string[] = [];

	const infraAgentUrl = process.env.INFRA_AGENT_URL;
	if (!infraAgentUrl) missing.push("INFRA_AGENT_URL");

	const portalSecret = process.env.INFRA_AGENT_PORTAL_SHARED_SECRET ?? process.env.INFRA_AGENT_PORTAL_SECRET;
	if (!portalSecret) missing.push("INFRA_AGENT_PORTAL_SHARED_SECRET");

	const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
	if (!anthropicApiKey) missing.push("ANTHROPIC_API_KEY");

	if (missing.length > 0) {
		console.error(`Missing required environment variables: ${missing.join(", ")}`);
		process.exit(1);
	}

	const dataDir = process.env.SRE_AGENT_DATA_DIR || "/var/lib/sre-agent";
	const model = process.env.SRE_AGENT_MODEL || "claude-sonnet-4-5";
	const thinkingLevel = (process.env.SRE_AGENT_THINKING || "medium") as ThinkingLevel;
	const timezone = process.env.SRE_AGENT_TIMEZONE || "UTC";
	const eventQueueSize = parseInt(process.env.SRE_AGENT_EVENT_QUEUE_SIZE || "10", 10);

	return {
		infraAgentUrl: infraAgentUrl!,
		portalSecret: portalSecret!,
		anthropicApiKey: anthropicApiKey!,
		dataDir,
		model,
		thinkingLevel,
		timezone,
		eventQueueSize,
	};
}
