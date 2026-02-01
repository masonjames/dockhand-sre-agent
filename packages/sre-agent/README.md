# @mariozechner/pi-sre-agent (dockhand)

Headless SRE agent daemon ("dockhand") that monitors platform infrastructure and takes autonomous remediation actions. Communicates with the dockhand infra-agent via HTTP through the portal API. Other pi agents can reference this agent by the keyword "dockhand".

## Architecture

- **Modeled on pi-mom** — uses the same Agent/AgentSession/SessionManager lifecycle
- **No Slack** — logs to structured console output instead
- **No Docker sandbox** — tools are HTTP calls to infra-agent, not shell commands
- **Single persistent session** — one conversation context persisted in `context.jsonl`
- **Event-driven** — watches a directory for event files (periodic cron, one-shot, immediate)
- **Working memory** — reads/writes MEMORY.md to persist context across sessions (like mom)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for LLM calls |
| `INFRA_AGENT_URL` | Yes | — | Infra-agent base URL (e.g. `http://infra-agent:18789`) |
| `INFRA_AGENT_PORTAL_SECRET` | Yes | — | Portal API shared secret |
| `SRE_AGENT_DATA_DIR` | No | `/var/lib/sre-agent` | Workspace for session data, memory, events |
| `SRE_AGENT_MODEL` | No | `claude-sonnet-4-5` | Model ID |
| `SRE_AGENT_THINKING` | No | `medium` | Thinking level (low/medium/high) |
| `SRE_AGENT_TIMEZONE` | No | `UTC` | Default timezone for events |
| `SRE_AGENT_EVENT_QUEUE_SIZE` | No | `10` | Max queued events before discarding |

## Tools

| Tool | Description |
|------|-------------|
| `submit_job` | Submit any job to infra-agent |
| `wait_job` | Poll a job until terminal state |
| `list_jobs` | List recent jobs with filters |
| `healthcheck` | Run platform healthcheck (convenience) |
| `monitoring_status` | Get monitoring dashboard overview |
| `prometheus_query` | Execute PromQL query |
| `check_alerts` | Check active Prometheus alerts |
| `search_knowledge` | Search platform knowledge base |
| `get_document` | Retrieve a knowledge document |
| `send_notification` | Send notification via ntfy |
| `write_memory` | Persist observations to MEMORY.md |
| `read_memory` | Read current MEMORY.md contents |

## Events

Place JSON event files in `$SRE_AGENT_DATA_DIR/events/`:

```json
// Periodic (cron)
{"type": "periodic", "text": "Run healthcheck...", "schedule": "*/15 * * * *", "timezone": "UTC"}

// One-shot (runs once at scheduled time, then deletes itself)
{"type": "one-shot", "text": "Run migration check", "at": "2025-01-15T10:00:00-05:00"}

// Immediate (runs once on detection, then deletes itself)
{"type": "immediate", "text": "Investigate alert spike"}
```

Default events are provided in `events/` in the source tree.

## Build

```bash
npm run build
```

## Run

```bash
# Direct (via "dockhand" binary)
ANTHROPIC_API_KEY=... INFRA_AGENT_URL=http://infra-agent:18789 INFRA_AGENT_PORTAL_SECRET=... dockhand

# With custom data dir (also accepted as CLI arg)
dockhand /path/to/data-dir

# Or via node directly
node dist/main.js /path/to/data-dir
```

## Data Directory Structure

```
$SRE_AGENT_DATA_DIR/
├── context.jsonl      # Persisted conversation history
├── settings.json      # Agent settings
├── auth.json          # Auth storage
├── MEMORY.md          # Working memory (read/written by agent)
└── events/            # Event files (periodic, one-shot, immediate)
```
