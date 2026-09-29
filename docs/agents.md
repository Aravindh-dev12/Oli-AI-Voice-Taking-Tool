# Oli agents, Brain and approvals

Oli now includes a Turnstone-inspired local workflow layer without adding a Turnstone dependency or cloud control plane.

## Shared Brain

The Brain is stored in the same local SQLite database as meetings. It supports durable memories grouped as:

- person
- project
- decision
- company
- topic
- meeting
- commitment
- fact

Every Brain write carries a source type/id, confidence and tags. Meeting completion automatically seeds a meeting summary, MEDDPICC facts and commitments. Agent-created memories use the same local store and can be searched by FTS5.

Delete a meeting also purges Brain entries derived from that meeting.

## Built-in agents

### Meeting Analyst

The Meeting Analyst is an always-allow local agent whose permitted side effects are limited to Brain memory writes and Inbox drafts. After a completed meeting, it is invoked automatically when an AI runtime is available.

### Follow-up Planner

The Follow-up Planner is configured for Ask First. It can prepare commitments, Brain updates, Obsidian synchronization and CRM synchronization, but approval is required before those side effects run.

### Local Researcher

The Local Researcher is Read Only. It can answer questions using local Brain, meeting and trusted knowledge context but cannot perform writes.

Agent permissions are persisted and can be changed in Dashboard → Agents.

## Approval model

Permission modes are deterministic:

- read_only: proposed write actions are blocked.
- ask_first: proposed write actions become approval records.
- always_allow: allowed write actions execute immediately.

The followup_draft action is always an internal Inbox write and does not send an email or message.

External CRM synchronization is approval-gated on meeting completion. Oli does not silently send the structured meeting payload to the configured CRM webhook anymore.

Every approval request, decision and execution is written to the local agent_audit table.

## Inbox

Agent results and follow-up drafts land in a local Inbox. Items can be marked unread, read or archived from the Dashboard or local API.

The Inbox is deliberately local. No notification service or Turnstone account is required.

## Schedules

Agents can run on a local fixed interval of 1 minute to 7 days. Scheduling is persisted in SQLite and executed by the desktop/server process.

Schedules are disabled by default. No network action occurs merely because a schedule exists; agent permission rules still apply.

## MCP

The local stdio MCP server exposes:

- oli_list_agents
- oli_run_agent
- oli_search_brain
- oli_list_inbox
- oli_list_approvals
- oli_resolve_approval
- oli_list_schedules
- existing meeting/transcript/commitment/MEDDPICC tools

Run MCP with the same local config as Oli:

    npm run mcp -- --db "/absolute/path/to/oli.db" --config "/absolute/path/to/config.json"

MCP does not gain credentials or remote access beyond the local configuration already used by Oli.

## Production boundary

Turnstone's public site also describes connected apps, browser work, recurring automations and reusable skills. Oli's current adaptation intentionally starts with the meeting domain: local knowledge, specialist agents, reviewable side effects and an auditable Inbox. Browser control and provider-specific app connectors remain separate integration surfaces so they can be added without weakening the sovereign audio path.

Research references:

- https://myturnstone.ai/
- https://myturnstone.ai/academy
