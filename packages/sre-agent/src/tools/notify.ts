import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { InfraAgentClient } from "../infra-client.js";

const sendNotificationSchema = Type.Object({
	title: Type.String({ description: "Notification title" }),
	message: Type.String({ description: "Notification body text" }),
	priority: Type.Optional(
		Type.Union([Type.Literal("low"), Type.Literal("default"), Type.Literal("high"), Type.Literal("urgent")], {
			description: "Notification priority (default: 'default')",
		}),
	),
	tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for categorization" })),
});

export function createSendNotificationTool(client: InfraAgentClient): AgentTool<typeof sendNotificationSchema> {
	return {
		name: "send_notification",
		label: "send_notification",
		description:
			"Send a notification via ntfy. Use this to alert the operator about important events, " +
			"health issues, or completed tasks that need attention.",
		parameters: sendNotificationSchema,
		execute: async (_toolCallId, { title, message, priority, tags }) => {
			const result = await client.submitJob(
				"notify.ntfy",
				{
					title,
					message,
					priority: priority ?? "default",
					tags: tags ?? [],
				},
				"dockhand: notification",
			);
			return {
				content: [
					{
						type: "text",
						text: `Notification submitted (job_id: ${result.job_id}, status: ${result.status})`,
					},
				],
				details: result,
			};
		},
	};
}
