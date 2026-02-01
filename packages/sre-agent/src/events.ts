import { Cron } from "croner";
import { existsSync, type FSWatcher, mkdirSync, readdirSync, statSync, unlinkSync, watch } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import * as log from "./log.js";

// ============================================================================
// Event Types (no channelId — single session)
// ============================================================================

export interface ImmediateEvent {
	type: "immediate";
	text: string;
}

export interface OneShotEvent {
	type: "one-shot";
	text: string;
	at: string; // ISO 8601 with timezone offset
}

export interface PeriodicEvent {
	type: "periodic";
	text: string;
	schedule: string; // cron syntax
	timezone: string; // IANA timezone
}

export type SREEvent = ImmediateEvent | OneShotEvent | PeriodicEvent;

// ============================================================================
// EventsWatcher
// ============================================================================

const DEBOUNCE_MS = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 100;

export type EventCallback = (text: string) => Promise<void>;

export interface EventsWatcherOptions {
	maxQueueSize?: number;
}

export class EventsWatcher {
	private timers: Map<string, NodeJS.Timeout> = new Map();
	private crons: Map<string, Cron> = new Map();
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private startTime: number;
	private watcher: FSWatcher | null = null;
	private knownFiles: Set<string> = new Set();
	private eventQueue: string[] = [];
	private processing = false;
	private maxQueueSize: number;

	constructor(
		private eventsDir: string,
		private onEvent: EventCallback,
		options?: EventsWatcherOptions,
	) {
		this.startTime = Date.now();
		this.maxQueueSize = options?.maxQueueSize ?? 10;
	}

	start(): void {
		if (!existsSync(this.eventsDir)) {
			mkdirSync(this.eventsDir, { recursive: true });
		}

		log.logInfo(`Events watcher starting, dir: ${this.eventsDir}`);

		// Scan existing files
		this.scanExisting();

		// Watch for changes
		this.watcher = watch(this.eventsDir, (_eventType, filename) => {
			if (!filename || !filename.endsWith(".json")) return;
			this.debounce(filename, () => this.handleFileChange(filename));
		});

		log.logInfo(`Events watcher started, tracking ${this.knownFiles.size} files`);
	}

	stop(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}

		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();

		for (const cron of this.crons.values()) {
			cron.stop();
		}
		this.crons.clear();

		this.knownFiles.clear();
		this.eventQueue.length = 0;
		log.logInfo("Events watcher stopped");
	}

	private debounce(filename: string, fn: () => void): void {
		const existing = this.debounceTimers.get(filename);
		if (existing) clearTimeout(existing);
		this.debounceTimers.set(
			filename,
			setTimeout(() => {
				this.debounceTimers.delete(filename);
				fn();
			}, DEBOUNCE_MS),
		);
	}

	private scanExisting(): void {
		let files: string[];
		try {
			files = readdirSync(this.eventsDir).filter((f) => f.endsWith(".json"));
		} catch (err) {
			log.logWarning("Failed to read events directory", String(err));
			return;
		}
		for (const filename of files) {
			this.handleFile(filename);
		}
	}

	private handleFileChange(filename: string): void {
		const filePath = join(this.eventsDir, filename);

		if (!existsSync(filePath)) {
			this.handleDelete(filename);
		} else if (this.knownFiles.has(filename)) {
			this.cancelScheduled(filename);
			this.handleFile(filename);
		} else {
			this.handleFile(filename);
		}
	}

	private handleDelete(filename: string): void {
		if (!this.knownFiles.has(filename)) return;
		log.logInfo(`Event file deleted: ${filename}`);
		this.cancelScheduled(filename);
		this.knownFiles.delete(filename);
	}

	private cancelScheduled(filename: string): void {
		const timer = this.timers.get(filename);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(filename);
		}
		const cron = this.crons.get(filename);
		if (cron) {
			cron.stop();
			this.crons.delete(filename);
		}
	}

	private async handleFile(filename: string): Promise<void> {
		const filePath = join(this.eventsDir, filename);

		let event: SREEvent | null = null;
		let lastError: Error | null = null;

		for (let i = 0; i < MAX_RETRIES; i++) {
			try {
				const content = await readFile(filePath, "utf-8");
				event = this.parseEvent(content, filename);
				break;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (i < MAX_RETRIES - 1) {
					await this.sleep(RETRY_BASE_MS * 2 ** i);
				}
			}
		}

		if (!event) {
			log.logWarning(`Failed to parse event file after ${MAX_RETRIES} retries: ${filename}`, lastError?.message);
			this.deleteFile(filename);
			return;
		}

		this.knownFiles.add(filename);

		switch (event.type) {
			case "immediate":
				this.handleImmediate(filename, event);
				break;
			case "one-shot":
				this.handleOneShot(filename, event);
				break;
			case "periodic":
				this.handlePeriodic(filename, event);
				break;
		}
	}

	private parseEvent(content: string, filename: string): SREEvent | null {
		const data = JSON.parse(content);

		if (!data.type || !data.text) {
			throw new Error(`Missing required fields (type, text) in ${filename}`);
		}

		switch (data.type) {
			case "immediate":
				return { type: "immediate", text: data.text };

			case "one-shot":
				if (!data.at) {
					throw new Error(`Missing 'at' field for one-shot event in ${filename}`);
				}
				return { type: "one-shot", text: data.text, at: data.at };

			case "periodic":
				if (!data.schedule) {
					throw new Error(`Missing 'schedule' field for periodic event in ${filename}`);
				}
				if (!data.timezone) {
					throw new Error(`Missing 'timezone' field for periodic event in ${filename}`);
				}
				return {
					type: "periodic",
					text: data.text,
					schedule: data.schedule,
					timezone: data.timezone,
				};

			default:
				throw new Error(`Unknown event type '${data.type}' in ${filename}`);
		}
	}

	private handleImmediate(filename: string, event: ImmediateEvent): void {
		const filePath = join(this.eventsDir, filename);

		try {
			const stat = statSync(filePath);
			if (stat.mtimeMs < this.startTime) {
				log.logInfo(`Stale immediate event, deleting: ${filename}`);
				this.deleteFile(filename);
				return;
			}
		} catch {
			return;
		}

		log.logInfo(`Executing immediate event: ${filename}`);
		this.enqueue(filename, event);
	}

	private handleOneShot(filename: string, event: OneShotEvent): void {
		const atTime = new Date(event.at).getTime();
		const now = Date.now();

		if (atTime <= now) {
			log.logInfo(`One-shot event in the past, deleting: ${filename}`);
			this.deleteFile(filename);
			return;
		}

		const delay = atTime - now;
		log.logInfo(`Scheduling one-shot event: ${filename} in ${Math.round(delay / 1000)}s`);

		const timer = setTimeout(() => {
			this.timers.delete(filename);
			log.logInfo(`Executing one-shot event: ${filename}`);
			this.enqueue(filename, event);
		}, delay);

		this.timers.set(filename, timer);
	}

	private handlePeriodic(filename: string, event: PeriodicEvent): void {
		try {
			const cron = new Cron(event.schedule, { timezone: event.timezone }, () => {
				log.logInfo(`Executing periodic event: ${filename}`);
				this.enqueue(filename, event, false);
			});

			this.crons.set(filename, cron);

			const next = cron.nextRun();
			log.logInfo(`Scheduled periodic event: ${filename}, next run: ${next?.toISOString() ?? "unknown"}`);
		} catch (err) {
			log.logWarning(`Invalid cron schedule for ${filename}: ${event.schedule}`, String(err));
			this.deleteFile(filename);
		}
	}

	private enqueue(filename: string, event: SREEvent, deleteAfter = true): void {
		let scheduleInfo: string;
		switch (event.type) {
			case "immediate":
				scheduleInfo = "immediate";
				break;
			case "one-shot":
				scheduleInfo = event.at;
				break;
			case "periodic":
				scheduleInfo = event.schedule;
				break;
		}

		const message = `[EVENT:${filename}:${event.type}:${scheduleInfo}] ${event.text}`;

		if (this.eventQueue.length >= this.maxQueueSize) {
			log.logWarning(`Event queue full, discarded: ${filename}`);
			if (deleteAfter) this.deleteFile(filename);
			return;
		}

		this.eventQueue.push(message);
		if (deleteAfter) this.deleteFile(filename);
		this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this.processing) return;
		this.processing = true;

		while (this.eventQueue.length > 0) {
			const message = this.eventQueue.shift()!;
			try {
				await this.onEvent(message);
			} catch (err) {
				log.logWarning("Event handler error", err instanceof Error ? err.message : String(err));
			}
		}

		this.processing = false;
	}

	private deleteFile(filename: string): void {
		const filePath = join(this.eventsDir, filename);
		try {
			unlinkSync(filePath);
		} catch (err) {
			if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
				log.logWarning(`Failed to delete event file: ${filename}`, String(err));
			}
		}
		this.knownFiles.delete(filename);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

export function createEventsWatcher(
	eventsDir: string,
	onEvent: EventCallback,
	options?: EventsWatcherOptions,
): EventsWatcher {
	return new EventsWatcher(eventsDir, onEvent, options);
}
