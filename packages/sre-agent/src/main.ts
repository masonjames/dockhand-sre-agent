#!/usr/bin/env node

import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { createSRERunner } from "./agent.js";
import { loadConfig } from "./config.js";
import { createEventsWatcher } from "./events.js";
import { InfraAgentClient } from "./infra-client.js";
import * as log from "./log.js";

// ============================================================================
// Config
// ============================================================================

const config = loadConfig();

// Allow overriding data dir via CLI arg
const cliDataDir = process.argv[2];
if (cliDataDir) {
	config.dataDir = resolve(cliDataDir);
}

// Ensure data directory exists
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, "events"), { recursive: true });

log.logStartup(config.dataDir);
log.logInfo(`Model: ${config.model}, thinking: ${config.thinkingLevel}`);
log.logInfo(`Infra-agent: ${config.infraAgentUrl}`);
log.logInfo(`Timezone: ${config.timezone}`);

// ============================================================================
// Create components
// ============================================================================

const infraClient = new InfraAgentClient(config);
const runner = createSRERunner(config, infraClient);

// Track if we're currently running to prevent overlapping runs
let running = false;

async function runSafely(text: string): Promise<void> {
	if (running) {
		log.logWarning("Skipping event - agent is already running", text.substring(0, 80));
		return;
	}
	running = true;
	try {
		await runner.run(text);
	} catch (err) {
		log.logError("Run failed", err instanceof Error ? err.message : String(err));
	} finally {
		running = false;
	}
}

// ============================================================================
// Events
// ============================================================================

const eventsDir = join(config.dataDir, "events");
const eventsWatcher = createEventsWatcher(eventsDir, runSafely, { maxQueueSize: config.eventQueueSize });
eventsWatcher.start();

// ============================================================================
// Initial healthcheck (with retry)
// ============================================================================

async function initialHealthcheck(maxRetries = 3, delayMs = 10_000): Promise<void> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			await infraClient.health();
			log.logInfo("Infra-agent reachable, running initial healthcheck...");
			await runSafely(
				"Run initial platform healthcheck and report status. If everything is healthy, respond [SILENT].",
			);
			return;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (attempt < maxRetries) {
				log.logWarning(`Infra-agent not reachable (attempt ${attempt}/${maxRetries}), retrying...`, msg);
				await new Promise((r) => setTimeout(r, delayMs));
			} else {
				log.logError(`Infra-agent not reachable after ${maxRetries} attempts, skipping initial healthcheck`, msg);
			}
		}
	}
}

initialHealthcheck().catch((err) => {
	log.logError("Initial healthcheck failed", err instanceof Error ? err.message : String(err));
});

// ============================================================================
// Shutdown
// ============================================================================

process.on("SIGINT", () => {
	log.logInfo("Shutting down (SIGINT)...");
	eventsWatcher.stop();
	process.exit(0);
});

process.on("SIGTERM", () => {
	log.logInfo("Shutting down (SIGTERM)...");
	eventsWatcher.stop();
	process.exit(0);
});

log.logInfo("Dockhand SRE agent running, waiting for events...");
