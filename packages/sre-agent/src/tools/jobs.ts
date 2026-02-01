import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { InfraAgentClient } from "../infra-client.js";

// ============================================================================
// submit_job
// ============================================================================

const submitJobSchema = Type.Object({
	kind: Type.String({
		description: "The job kind to submit (e.g. 'healthcheck', 'monitoring.status', 'docker.cleanup')",
	}),
	args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Job-specific arguments" })),
	reason: Type.Optional(Type.String({ description: "Why this job is being submitted" })),
});

export function createSubmitJobTool(client: InfraAgentClient): AgentTool<typeof submitJobSchema> {
	return {
		name: "submit_job",
		label: "submit_job",
		description:
			"Submit a job to the infra-agent for execution. Returns the job ID and status. " +
			"Some jobs may require approval before execution.",
		parameters: submitJobSchema,
		execute: async (_toolCallId, { kind, args, reason }) => {
			const result = await client.submitJob(kind, args ?? {}, reason ? `dockhand: ${reason}` : "dockhand");
			let text = `Job submitted: ${result.job_id} (status: ${result.status})`;
			if (result.approval_required) {
				text += `\nApproval required (approval_id: ${result.approval_id})`;
			}
			if (result.message) {
				text += `\n${result.message}`;
			}
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
	};
}

// ============================================================================
// wait_job
// ============================================================================

const waitJobSchema = Type.Object({
	job_id: Type.String({ description: "The job ID to wait for" }),
	timeout_seconds: Type.Optional(Type.Number({ description: "Maximum wait time in seconds (default: 120)" })),
});

export function createWaitJobTool(client: InfraAgentClient): AgentTool<typeof waitJobSchema> {
	return {
		name: "wait_job",
		label: "wait_job",
		description:
			"Poll a job until it reaches a terminal state (succeeded, failed, canceled). " +
			"Returns the full job result.",
		parameters: waitJobSchema,
		execute: async (_toolCallId, { job_id, timeout_seconds }, signal, onUpdate) => {
			const timeoutMs = (timeout_seconds ?? 120) * 1000;
			const pollIntervalMs = 3000;
			const deadline = Date.now() + timeoutMs;

			let job = await client.getJob(job_id);

			while (!isTerminalOrBlocked(job.status) && Date.now() < deadline) {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: `Wait aborted. Last status: ${job.status}` }],
						details: job,
					};
				}
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: `Job ${job_id}: ${job.status}...` }],
						details: job,
					});
				}
				await sleep(pollIntervalMs);
				job = await client.getJob(job_id);
			}

			if (job.status === "waiting_approval") {
				return {
					content: [
						{
							type: "text",
							text: `Job ${job_id} requires approval before it can run. Send a notification to the operator and move on.`,
						},
					],
					details: job,
				};
			}

			if (!isTerminalOrBlocked(job.status)) {
				return {
					content: [{ type: "text", text: `Timeout waiting for job ${job_id}. Last status: ${job.status}` }],
					details: job,
				};
			}

			let text = `Job ${job_id} ${job.status}`;
			if (job.summary) text += `\nSummary: ${job.summary}`;
			if (job.error) text += `\nError: ${job.error}`;
			if (job.result) text += `\nResult: ${JSON.stringify(job.result, null, 2)}`;
			return {
				content: [{ type: "text", text }],
				details: job,
			};
		},
	};
}

// ============================================================================
// list_jobs
// ============================================================================

const listJobsSchema = Type.Object({
	status: Type.Optional(
		Type.String({ description: "Filter by status: queued, running, waiting_approval, succeeded, failed, canceled" }),
	),
	source: Type.Optional(
		Type.String({ description: "Filter by source: admin, portal, webhook, loopback, scheduler, sre_agent" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of jobs to return (default: 20, max: 100)" })),
});

export function createListJobsTool(client: InfraAgentClient): AgentTool<typeof listJobsSchema> {
	return {
		name: "list_jobs",
		label: "list_jobs",
		description: "List recent jobs with optional filters for status and source.",
		parameters: listJobsSchema,
		execute: async (_toolCallId, { status, source, limit }) => {
			const result = await client.listJobs({ status, source, limit });
			const lines = result.jobs.map(
				(j) => `${j.job_id} | ${j.kind} | ${j.status} | ${j.created_at} | ${j.summary ?? ""}`,
			);
			const text = `${result.count} jobs:\n${lines.join("\n") || "(none)"}`;
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
	};
}

// ============================================================================
// Helpers
// ============================================================================

function isTerminalOrBlocked(status: string): boolean {
	return status === "succeeded" || status === "failed" || status === "canceled" || status === "waiting_approval";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
