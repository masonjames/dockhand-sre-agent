import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { InfraAgentClient } from "../infra-client.js";

/**
 * Submit a job and poll until completion. Shared helper for convenience tools.
 */
export async function submitAndWait(
	client: InfraAgentClient,
	kind: string,
	args: Record<string, unknown>,
	requestedBy: string,
	signal?: AbortSignal,
	onUpdate?: AgentToolUpdateCallback<unknown>,
	timeoutMs = 120_000,
): Promise<AgentToolResult<unknown>> {
	const submit = await client.submitJob(kind, args, requestedBy);

	if (submit.approval_required) {
		return {
			content: [
				{
					type: "text",
					text: `Job ${kind} requires approval (approval_id: ${submit.approval_id}). Cannot proceed automatically.`,
				},
			],
			details: submit,
		};
	}

	const deadline = Date.now() + timeoutMs;
	let job = await client.getJob(submit.job_id);

	while (!isTerminalOrBlocked(job.status)) {
		if (signal?.aborted) {
			return {
				content: [{ type: "text", text: `Aborted. Job ${submit.job_id} last status: ${job.status}` }],
				details: job,
			};
		}
		if (Date.now() > deadline) {
			return {
				content: [
					{ type: "text", text: `Timeout waiting for ${kind} job ${submit.job_id}. Status: ${job.status}` },
				],
				details: job,
			};
		}
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: `${kind} ${job.status}...` }],
				details: job,
			});
		}
		await sleep(3000);
		job = await client.getJob(submit.job_id);
	}

	if (job.status === "waiting_approval") {
		return {
			content: [
				{
					type: "text",
					text: `${kind}: waiting for approval (job ${submit.job_id}). Notify the operator and move on.`,
				},
			],
			details: job,
		};
	}

	let text = `${kind}: ${job.status}`;
	if (job.summary) text += `\n${job.summary}`;
	if (job.error) text += `\nError: ${job.error}`;
	if (job.result) text += `\n${JSON.stringify(job.result, null, 2)}`;

	return {
		content: [{ type: "text", text }],
		details: job,
	};
}

function isTerminalOrBlocked(status: string): boolean {
	return status === "succeeded" || status === "failed" || status === "canceled" || status === "waiting_approval";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
