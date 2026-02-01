import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { InfraAgentClient } from "../infra-client.js";
import { submitAndWait } from "./util.js";

// ============================================================================
// monitoring_status
// ============================================================================

const monitoringStatusSchema = Type.Object({});

export function createMonitoringStatusTool(client: InfraAgentClient): AgentTool<typeof monitoringStatusSchema> {
	return {
		name: "monitoring_status",
		label: "monitoring_status",
		description:
			"Get the current monitoring dashboard overview including Prometheus targets, active alerts, and system health.",
		parameters: monitoringStatusSchema,
		execute: async (_toolCallId, _params, signal, onUpdate) => {
			return submitAndWait(client, "monitoring.status", {}, "dockhand: monitoring status check", signal, onUpdate);
		},
	};
}

// ============================================================================
// prometheus_query
// ============================================================================

const prometheusQuerySchema = Type.Object({
	expr: Type.String({ description: "PromQL expression to execute (e.g. 'up', 'node_cpu_seconds_total')" }),
});

export function createPrometheusQueryTool(client: InfraAgentClient): AgentTool<typeof prometheusQuerySchema> {
	return {
		name: "prometheus_query",
		label: "prometheus_query",
		description: "Execute a PromQL query against Prometheus and return the results.",
		parameters: prometheusQuerySchema,
		execute: async (_toolCallId, { expr }, signal, onUpdate) => {
			return submitAndWait(client, "prometheus.query", { expr }, "dockhand: prometheus query", signal, onUpdate);
		},
	};
}

// ============================================================================
// check_alerts
// ============================================================================

const checkAlertsSchema = Type.Object({});

export function createCheckAlertsTool(client: InfraAgentClient): AgentTool<typeof checkAlertsSchema> {
	return {
		name: "check_alerts",
		label: "check_alerts",
		description: "Check for active Prometheus alerts. Returns all currently firing or pending alerts.",
		parameters: checkAlertsSchema,
		execute: async (_toolCallId, _params, signal, onUpdate) => {
			return submitAndWait(client, "prometheus.alerts", {}, "dockhand: check alerts", signal, onUpdate);
		},
	};
}
