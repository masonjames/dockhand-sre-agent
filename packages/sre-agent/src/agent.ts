import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
	AgentSession,
	AuthStorage,
	convertToLlm,
	createExtensionRuntime,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SREConfig } from "./config.js";
import type { InfraAgentClient } from "./infra-client.js";
import * as log from "./log.js";
import { buildSystemPrompt } from "./prompt.js";
import { createSRETools } from "./tools/index.js";

// ============================================================================
// Settings Manager (minimal, compatible with AgentSession)
//
// WARNING: This class duck-types the full SettingsManager interface from
// pi-coding-agent. If new methods are added upstream, this will break at
// runtime with "is not a function" errors. When upgrading pi-coding-agent,
// check for new SettingsManager methods and add stubs here.
// ============================================================================

class SRESettingsManager {
	private settingsPath: string;
	private settings: { defaultThinkingLevel?: string } = {};

	constructor(dataDir: string) {
		this.settingsPath = join(dataDir, "settings.json");
		if (existsSync(this.settingsPath)) {
			try {
				this.settings = JSON.parse(readFileSync(this.settingsPath, "utf-8"));
			} catch {
				// ignore
			}
		}
	}

	getCompactionSettings() {
		return { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };
	}
	getCompactionEnabled() {
		return true;
	}
	setCompactionEnabled(_enabled: boolean) {}
	getRetrySettings() {
		return { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000 };
	}
	getRetryEnabled() {
		return true;
	}
	setRetryEnabled(_enabled: boolean) {}
	getDefaultModel() {
		return undefined;
	}
	getDefaultProvider() {
		return undefined;
	}
	setDefaultModelAndProvider(_provider: string, _modelId: string) {}
	getDefaultThinkingLevel() {
		return this.settings.defaultThinkingLevel || "medium";
	}
	setDefaultThinkingLevel(level: string) {
		this.settings.defaultThinkingLevel = level;
		try {
			writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
		} catch {
			// ignore
		}
	}
	getSteeringMode(): "all" | "one-at-a-time" {
		return "one-at-a-time";
	}
	setSteeringMode(_mode: "all" | "one-at-a-time") {}
	getFollowUpMode(): "all" | "one-at-a-time" {
		return "one-at-a-time";
	}
	setFollowUpMode(_mode: "all" | "one-at-a-time") {}
	getHookPaths(): string[] {
		return [];
	}
	getHookTimeout(): number {
		return 30000;
	}
	// Image and shell settings
	getImageAutoResize() {
		return false;
	}
	setImageAutoResize(_enabled: boolean) {}
	getBlockImages() {
		return false;
	}
	setBlockImages(_blocked: boolean) {}
	getShowImages() {
		return false;
	}
	setShowImages(_show: boolean) {}
	getShellCommandPrefix() {
		return undefined;
	}
	setShellCommandPrefix(_prefix: string | undefined) {}
	getShellPath() {
		return undefined;
	}
	setShellPath(_path: string | undefined) {}
	// Theme and UI settings (no-ops for headless)
	getTheme() {
		return undefined;
	}
	setTheme(_theme: string) {}
	getHideThinkingBlock() {
		return false;
	}
	setHideThinkingBlock(_hide: boolean) {}
	getQuietStartup() {
		return true;
	}
	setQuietStartup(_quiet: boolean) {}
	getCollapseChangelog() {
		return true;
	}
	setCollapseChangelog(_collapse: boolean) {}
	getLastChangelogVersion() {
		return undefined;
	}
	setLastChangelogVersion(_version: string) {}
	// Paths and packages (empty for headless)
	getPackages() {
		return [];
	}
	setPackages(_packages: unknown[]) {}
	setProjectPackages(_packages: unknown[]) {}
	getExtensionPaths() {
		return [];
	}
	setExtensionPaths(_paths: string[]) {}
	setProjectExtensionPaths(_paths: string[]) {}
	getSkillPaths() {
		return [];
	}
	setSkillPaths(_paths: string[]) {}
	setProjectSkillPaths(_paths: string[]) {}
	getPromptTemplatePaths() {
		return [];
	}
	setPromptTemplatePaths(_paths: string[]) {}
	setProjectPromptTemplatePaths(_paths: string[]) {}
	getThemePaths() {
		return [];
	}
	setThemePaths(_paths: string[]) {}
	setProjectThemePaths(_paths: string[]) {}
	getEnableSkillCommands() {
		return false;
	}
	setEnableSkillCommands(_enabled: boolean) {}
	getThinkingBudgets() {
		return undefined;
	}
	getEnabledModels() {
		return undefined;
	}
	setEnabledModels(_patterns: string[] | undefined) {}
	getDoubleEscapeAction(): "fork" | "tree" | "none" {
		return "none";
	}
	setDoubleEscapeAction(_action: "fork" | "tree" | "none") {}
	getShowHardwareCursor() {
		return false;
	}
	setShowHardwareCursor(_enabled: boolean) {}
	getEditorPaddingX() {
		return 0;
	}
	setEditorPaddingX(_padding: number) {}
	getAutocompleteMaxVisible() {
		return 10;
	}
	setAutocompleteMaxVisible(_maxVisible: number) {}
	getCodeBlockIndent() {
		return "  ";
	}
	setCodeBlockIndent(_indent: string) {}
	getBranchSummarySettings() {
		return { reserveTokens: 4096 };
	}
	getGlobalSettings() {
		return {};
	}
	getProjectSettings() {
		return {};
	}
	setDefaultProvider(_provider: string) {}
	setDefaultModel(_modelId: string) {}
}

// ============================================================================
// Runner
// ============================================================================

export interface SRERunner {
	run(text: string): Promise<{ stopReason: string; errorMessage?: string }>;
	abort(): void;
}

function getMemory(dataDir: string): string {
	const memoryPath = join(dataDir, "MEMORY.md");
	if (existsSync(memoryPath)) {
		try {
			const content = readFileSync(memoryPath, "utf-8").trim();
			if (content) return content;
		} catch {
			// ignore
		}
	}
	return "(no working memory yet)";
}

function extractToolResultText(result: unknown): string {
	if (typeof result === "string") return result;

	if (
		result &&
		typeof result === "object" &&
		"content" in result &&
		Array.isArray((result as { content: unknown }).content)
	) {
		const content = (result as { content: Array<{ type: string; text?: string }> }).content;
		const textParts: string[] = [];
		for (const part of content) {
			if (part.type === "text" && part.text) {
				textParts.push(part.text);
			}
		}
		if (textParts.length > 0) return textParts.join("\n");
	}

	return JSON.stringify(result);
}

export function createSRERunner(config: SREConfig, infraClient: InfraAgentClient): SRERunner {
	const model = getModel("anthropic", config.model as any);

	// Create tools
	const tools = createSRETools(infraClient, config.dataDir);

	// Session management
	mkdirSync(config.dataDir, { recursive: true });
	const contextFile = join(config.dataDir, "context.jsonl");
	const sessionManager = SessionManager.open(contextFile, config.dataDir);
	const settingsManager = new SRESettingsManager(config.dataDir);

	// Auth and model registry
	const authStorage = new AuthStorage(join(config.dataDir, "auth.json"));
	const modelRegistry = new ModelRegistry(authStorage);

	// Build system prompt
	const memory = getMemory(config.dataDir);
	const systemPrompt = buildSystemPrompt(config, memory);

	// Create agent
	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel: config.thinkingLevel,
			tools,
		},
		convertToLlm,
		getApiKey: async () => config.anthropicApiKey,
	});

	// Load existing messages
	const loadedSession = sessionManager.buildSessionContext();
	if (loadedSession.messages.length > 0) {
		agent.replaceMessages(loadedSession.messages);
		log.logInfo(`Loaded ${loadedSession.messages.length} messages from context.jsonl`);
	}

	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};

	const baseToolsOverride = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

	// Create AgentSession
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager: settingsManager as any,
		cwd: config.dataDir,
		modelRegistry,
		resourceLoader,
		baseToolsOverride,
	});

	// Per-run state
	const runState = {
		pendingTools: new Map<string, { toolName: string; args: unknown; startTime: number }>(),
		totalUsage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		errorMessage: undefined as string | undefined,
	};

	// Subscribe to events for structured logging
	session.subscribe(async (event) => {
		if (event.type === "tool_execution_start") {
			const agentEvent = event as AgentEvent & { type: "tool_execution_start" };
			const args = agentEvent.args as { label?: string };
			const label = args.label || agentEvent.toolName;

			runState.pendingTools.set(agentEvent.toolCallId, {
				toolName: agentEvent.toolName,
				args: agentEvent.args,
				startTime: Date.now(),
			});

			log.logToolStart(agentEvent.toolName, label, agentEvent.args as Record<string, unknown>);
		} else if (event.type === "tool_execution_end") {
			const agentEvent = event as AgentEvent & { type: "tool_execution_end" };
			const resultStr = extractToolResultText(agentEvent.result);
			const pending = runState.pendingTools.get(agentEvent.toolCallId);
			runState.pendingTools.delete(agentEvent.toolCallId);

			const durationMs = pending ? Date.now() - pending.startTime : 0;

			if (agentEvent.isError) {
				log.logToolError(agentEvent.toolName, durationMs, resultStr);
			} else {
				log.logToolSuccess(agentEvent.toolName, durationMs, resultStr);
			}
		} else if (event.type === "message_start") {
			const agentEvent = event as AgentEvent & { type: "message_start" };
			if (agentEvent.message.role === "assistant") {
				log.logResponseStart();
			}
		} else if (event.type === "message_end") {
			const agentEvent = event as AgentEvent & { type: "message_end" };
			if (agentEvent.message.role === "assistant") {
				const assistantMsg = agentEvent.message as any;

				if (assistantMsg.stopReason) {
					runState.stopReason = assistantMsg.stopReason;
				}
				if (assistantMsg.errorMessage) {
					runState.errorMessage = assistantMsg.errorMessage;
				}

				if (assistantMsg.usage) {
					runState.totalUsage.input += assistantMsg.usage.input;
					runState.totalUsage.output += assistantMsg.usage.output;
					runState.totalUsage.cacheRead += assistantMsg.usage.cacheRead;
					runState.totalUsage.cacheWrite += assistantMsg.usage.cacheWrite;
					runState.totalUsage.cost.input += assistantMsg.usage.cost.input;
					runState.totalUsage.cost.output += assistantMsg.usage.cost.output;
					runState.totalUsage.cost.cacheRead += assistantMsg.usage.cost.cacheRead;
					runState.totalUsage.cost.cacheWrite += assistantMsg.usage.cost.cacheWrite;
					runState.totalUsage.cost.total += assistantMsg.usage.cost.total;
				}

				const content = agentEvent.message.content;
				const thinkingParts: string[] = [];
				const textParts: string[] = [];
				for (const part of content) {
					if (part.type === "thinking") {
						thinkingParts.push((part as any).thinking);
					} else if (part.type === "text") {
						textParts.push((part as any).text);
					}
				}

				for (const thinking of thinkingParts) {
					log.logThinking(thinking);
				}

				const text = textParts.join("\n");
				if (text.trim() && text.trim() !== "[SILENT]" && !text.trim().startsWith("[SILENT]")) {
					log.logResponse(text);
				}
			}
		} else if (event.type === "auto_compaction_start") {
			log.logInfo(`Auto-compaction started (reason: ${(event as any).reason})`);
		} else if (event.type === "auto_compaction_end") {
			const compEvent = event as any;
			if (compEvent.result) {
				log.logInfo(`Auto-compaction complete: ${compEvent.result.tokensBefore} tokens compacted`);
			} else if (compEvent.aborted) {
				log.logInfo("Auto-compaction aborted");
			}
		} else if (event.type === "auto_retry_start") {
			const retryEvent = event as any;
			log.logWarning(`Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})`, retryEvent.errorMessage);
		}
	});

	return {
		async run(text: string): Promise<{ stopReason: string; errorMessage?: string }> {
			// Refresh memory and system prompt
			const memory = getMemory(config.dataDir);
			const freshPrompt = buildSystemPrompt(config, memory);
			session.agent.setSystemPrompt(freshPrompt);

			// Reset per-run state
			runState.pendingTools.clear();
			runState.totalUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			runState.stopReason = "stop";
			runState.errorMessage = undefined;

			log.logInfo(`Processing: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);

			// Add timestamp to user message
			const now = new Date();
			const pad = (n: number) => n.toString().padStart(2, "0");
			const offset = -now.getTimezoneOffset();
			const offsetSign = offset >= 0 ? "+" : "-";
			const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
			const offsetMins = pad(Math.abs(offset) % 60);
			const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;
			const userMessage = `[${timestamp}] [dockhand]: ${text}`;

			await session.prompt(userMessage);

			// Log usage
			if (runState.totalUsage.cost.total > 0) {
				log.logUsageSummary(runState.totalUsage);
			}

			// Check for silent response
			const messages = session.messages;
			const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
			if (lastAssistant) {
				const finalText = lastAssistant.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				if (finalText.trim() === "[SILENT]" || finalText.trim().startsWith("[SILENT]")) {
					log.logInfo("Silent response - nothing to report");
				}
			}

			return { stopReason: runState.stopReason, errorMessage: runState.errorMessage };
		},

		abort(): void {
			session.abort();
		},
	};
}
