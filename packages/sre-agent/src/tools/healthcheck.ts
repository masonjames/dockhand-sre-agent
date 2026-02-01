import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { InfraAgentClient } from "../infra-client.js";
import { submitAndWait } from "./util.js";

const healthcheckSchema = Type.Object({});

export function createHealthcheckTool(client: InfraAgentClient): AgentTool<typeof healthcheckSchema> {
	return {
		name: "healthcheck",
		label: "healthcheck",
		description:
			"Run a platform healthcheck. Submits a healthcheck job to the infra-agent, waits for it to complete, " +
			"and returns the results. This checks SSH connectivity, Docker services, disk usage, and more.",
		parameters: healthcheckSchema,
		execute: async (_toolCallId, _params, signal, onUpdate) => {
			return submitAndWait(client, "healthcheck", {}, "dockhand: periodic healthcheck", signal, onUpdate);
		},
	};
}
