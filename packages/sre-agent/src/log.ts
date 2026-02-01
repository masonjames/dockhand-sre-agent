export interface LogContext {
	source: string;
}

function timestamp(): string {
	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `[${hh}:${mm}:${ss}]`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.substring(0, maxLen)}\n(truncated at ${maxLen} chars)`;
}

// Tool execution
export function logToolStart(toolName: string, label: string, args: Record<string, unknown>): void {
	console.log(`${timestamp()} [agent] -> ${toolName}: ${label}`);
	const formatted = formatToolArgs(args);
	if (formatted) {
		const indented = formatted
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.log(indented);
	}
}

export function logToolSuccess(toolName: string, durationMs: number, result: string): void {
	const duration = (durationMs / 1000).toFixed(1);
	console.log(`${timestamp()} [agent] ok ${toolName} (${duration}s)`);
	const truncated = truncate(result, 500);
	if (truncated) {
		const indented = truncated
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.log(indented);
	}
}

export function logToolError(toolName: string, durationMs: number, error: string): void {
	const duration = (durationMs / 1000).toFixed(1);
	console.log(`${timestamp()} [agent] ERR ${toolName} (${duration}s)`);
	const truncated = truncate(error, 500);
	const indented = truncated
		.split("\n")
		.map((line) => `           ${line}`)
		.join("\n");
	console.log(indented);
}

// Response streaming
export function logResponseStart(): void {
	console.log(`${timestamp()} [agent] Streaming response...`);
}

export function logThinking(thinking: string): void {
	console.log(`${timestamp()} [agent] Thinking`);
	const truncated = truncate(thinking, 500);
	const indented = truncated
		.split("\n")
		.map((line) => `           ${line}`)
		.join("\n");
	console.log(indented);
}

export function logResponse(text: string): void {
	console.log(`${timestamp()} [agent] Response`);
	const truncated = truncate(text, 1000);
	const indented = truncated
		.split("\n")
		.map((line) => `           ${line}`)
		.join("\n");
	console.log(indented);
}

// System
export function logInfo(message: string): void {
	console.log(`${timestamp()} [system] ${message}`);
}

export function logWarning(message: string, details?: string): void {
	console.log(`${timestamp()} [system] WARN ${message}`);
	if (details) {
		const indented = details
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.log(indented);
	}
}

export function logError(message: string, details?: string): void {
	console.error(`${timestamp()} [system] ERROR ${message}`);
	if (details) {
		const indented = details
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.error(indented);
	}
}

// Usage summary
export function logUsageSummary(usage: {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}): void {
	console.log(
		`${timestamp()} [agent] Usage: ${usage.input.toLocaleString()} in + ${usage.output.toLocaleString()} out` +
			(usage.cacheRead > 0 || usage.cacheWrite > 0
				? ` (${usage.cacheRead.toLocaleString()} cache read, ${usage.cacheWrite.toLocaleString()} cache write)`
				: "") +
			` = $${usage.cost.total.toFixed(4)}`,
	);
}

// Startup
export function logStartup(dataDir: string): void {
	console.log("Starting dockhand SRE agent...");
	console.log(`  Data directory: ${dataDir}`);
}

function formatToolArgs(args: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		if (key === "label") continue;
		if (typeof value === "string") {
			lines.push(value);
		} else {
			lines.push(JSON.stringify(value));
		}
	}
	return lines.join("\n");
}
