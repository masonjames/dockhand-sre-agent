import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { InfraAgentClient } from "../infra-client.js";

// ============================================================================
// search_knowledge
// ============================================================================

const searchKnowledgeSchema = Type.Object({
	query: Type.String({ description: "Search query for the knowledge base" }),
	limit: Type.Optional(Type.Number({ description: "Maximum results to return (default: 20, max: 100)" })),
});

export function createSearchKnowledgeTool(client: InfraAgentClient): AgentTool<typeof searchKnowledgeSchema> {
	return {
		name: "search_knowledge",
		label: "search_knowledge",
		description:
			"Search the platform knowledge base for documentation, runbooks, scripts, and configuration files. " +
			"Returns matching documents with paths and metadata.",
		parameters: searchKnowledgeSchema,
		execute: async (_toolCallId, { query, limit }) => {
			const result = await client.searchKnowledge(query, limit);
			const lines = result.results.map((r) => `${r.path} (${r.kind}) - ${r.title} [${r.size_bytes} bytes]`);
			const text = `Found ${result.count} documents:\n${lines.join("\n") || "(no results)"}`;
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
	};
}

// ============================================================================
// get_document
// ============================================================================

const getDocumentSchema = Type.Object({
	path: Type.String({ description: "Relative path to the document in the knowledge base" }),
});

export function createGetDocumentTool(client: InfraAgentClient): AgentTool<typeof getDocumentSchema> {
	return {
		name: "get_document",
		label: "get_document",
		description: "Retrieve the full content of a document from the platform knowledge base.",
		parameters: getDocumentSchema,
		execute: async (_toolCallId, { path }) => {
			const result = await client.getDocument(path);
			return {
				content: [{ type: "text", text: result.content }],
				details: { path: result.path },
			};
		},
	};
}
