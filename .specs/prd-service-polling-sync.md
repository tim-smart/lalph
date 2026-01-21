# PRD Service Polling Sync

## Summary

Add a fixed-interval polling loop inside the PRD service so that the local `.lalph/prd.yml` stays in sync with the PRD service issue data. The poll runs every 30 seconds, pulls full issue fields, and writes updates to `prd.yml`. If a local edit occurs during a sync, the in-flight sync is canceled to avoid overwriting local changes.

## Goals

- Keep local `prd.yml` aligned with PRD service issue updates.
- Poll on a fixed 30-second interval as part of the PRD service process.
- Sync full issue fields (title/description/priority/estimate/state/blockedBy/complete).
- Cancel in-flight sync if local edits are detected.

## Non-Goals

- No user-configurable poll interval (fixed 30s for now).
- No automatic push of local edits to the PRD service.
- No background daemon outside the PRD service process.

## Assumptions

- The PRD service already exposes an API to fetch issue data.
- `prd.yml` is the local source for the CLI and can be written atomically.
- There is a place in the PRD service lifecycle to start and stop a poll loop.

## Users

- CLI users who want `prd.yml` updated without manual refreshes.
- Internal tooling that relies on current task state in `prd.yml`.

## User Stories

- As a CLI user, I want `prd.yml` to reflect current issue fields without manual refresh.
- As a CLI user, I want my local edits preserved if I change `prd.yml` during a sync.

## Functional Requirements

- Polling runs inside the PRD service process and starts/stops with the service.
- Poll cadence is fixed to 30 seconds.
- Poll requests retrieve full issue fields from the PRD service.
- The sync updates local issue fields to match remote values for any matching IDs.
- Local-only issues remain unless the PRD service explicitly marks them deleted.
- Syncs are skipped if another sync is already running.
- If `prd.yml` changes during a sync, cancel the in-flight sync and retry next tick.
- Writes to `prd.yml` are atomic (write temp file then rename).

## Sync Flow

1. PRD service starts polling loop on initialization.
2. On each tick, if a sync is already running, skip.
3. Capture `prd.yml` mtime (and optional hash) at sync start.
4. Fetch issue updates from the PRD service (full fields).
5. If `prd.yml` mtime/hash changes before write, cancel the sync.
6. Map remote issues into the local model and apply field updates.
7. Persist `prd.yml` via atomic write and record last-sync timestamp.

## Data Mapping

- `id`: used as the primary key for matching issues.
- `title`, `description`, `priority`, `estimate`, `state`, `blockedBy`, `complete`: overwritten by remote values on sync.
- `githubPrNumber`: left unchanged unless the PRD service provides a value.

## Error Handling

- Network/API errors: retry on next tick.
- YAML parse errors: skip sync until the file parses.
- Unexpected data shape: skip applying that record.

## Acceptance Criteria

- PRD service polls every 30 seconds while running.
- `prd.yml` updates when remote issue fields change.
- Any local edit during a sync cancels the sync and preserves local content.
- Sync writes are atomic and do not leave partial files.
