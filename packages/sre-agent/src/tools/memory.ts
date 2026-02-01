import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================================
// write_memory
// ============================================================================

const writeMemorySchema = Type.Object({
	content: Type.String({
		description:
			"The full content to write to MEMORY.md. This replaces the entire file. " +
			"Include all existing content you want to keep plus any new observations.",
	}),
});

export function createWriteMemoryTool(dataDir: string): AgentTool<typeof writeMemorySchema> {
	const memoryPath = join(dataDir, "MEMORY.md");

	return {
		name: "write_memory",
		label: "write_memory",
		description:
			"Write to your working memory (MEMORY.md). Use this to persist observations, known issues, " +
			"recent actions, and operational context across sessions. The content is included in your system " +
			"prompt on each wake-up. To update memory, first read the current content from your system prompt's " +
			"Memory section, then write the updated version.",
		parameters: writeMemorySchema,
		execute: async (_toolCallId, { content }) => {
			try {
				writeFileSync(memoryPath, content, "utf-8");
				return {
					content: [{ type: "text", text: `Memory updated (${content.length} bytes written to MEMORY.md)` }],
					details: { path: memoryPath, bytes: content.length },
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Failed to write memory: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	};
}

// ============================================================================
// read_memory
// ============================================================================

const readMemorySchema = Type.Object({});

export function createReadMemoryTool(dataDir: string): AgentTool<typeof readMemorySchema> {
	const memoryPath = join(dataDir, "MEMORY.md");

	return {
		name: "read_memory",
		label: "read_memory",
		description:
			"Read the current contents of your working memory (MEMORY.md). " +
			"Use this before write_memory to avoid losing existing observations.",
		parameters: readMemorySchema,
		execute: async () => {
			try {
				if (!existsSync(memoryPath)) {
					return {
						content: [{ type: "text", text: "(no working memory yet — MEMORY.md does not exist)" }],
						details: { exists: false },
					};
				}
				const content = readFileSync(memoryPath, "utf-8");
				return {
					content: [{ type: "text", text: content || "(empty)" }],
					details: { path: memoryPath, bytes: content.length },
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Failed to read memory: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	};
}
