import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { InfraAgentClient } from "../infra-client.js";
import { createHealthcheckTool } from "./healthcheck.js";
import { createListJobsTool, createSubmitJobTool, createWaitJobTool } from "./jobs.js";
import { createGetDocumentTool, createSearchKnowledgeTool } from "./knowledge.js";
import { createReadMemoryTool, createWriteMemoryTool } from "./memory.js";
import { createCheckAlertsTool, createMonitoringStatusTool, createPrometheusQueryTool } from "./monitoring.js";
import { createSendNotificationTool } from "./notify.js";

export function createSRETools(client: InfraAgentClient, dataDir: string): AgentTool<any>[] {
	return [
		createSubmitJobTool(client),
		createWaitJobTool(client),
		createListJobsTool(client),
		createHealthcheckTool(client),
		createMonitoringStatusTool(client),
		createPrometheusQueryTool(client),
		createCheckAlertsTool(client),
		createSearchKnowledgeTool(client),
		createGetDocumentTool(client),
		createSendNotificationTool(client),
		createWriteMemoryTool(dataDir),
		createReadMemoryTool(dataDir),
	];
}
