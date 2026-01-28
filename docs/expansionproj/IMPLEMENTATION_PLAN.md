# Implementation Plan — PACDeluxe Upstream Monitor

## Overview

A TypeScript + Playwright automation system that observes Pokemon Auto Chess login/lobby flows, captures artifacts to SQLite, computes diffs between runs, and triggers interactive Claude Code sessions when changes are detected.

**Location:** `../pacdeluxe-upstream-monitor/` (sibling to PACDeluxe)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    pacdeluxe-upstream-monitor                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐ │
│  │ Recorder │───▶│ Artifacts│───▶│   Diff   │───▶│  Claude   │ │
│  │(Playwright)   │ (SQLite) │    │  Engine  │    │ Notifier  │ │
│  └──────────┘    └──────────┘    └──────────┘    └───────────┘ │
│       │                                                │        │
│       ▼                                                ▼        │
│  ┌──────────┐                                   ┌───────────┐   │
│  │   Auth   │                                   │  Report   │   │
│  │  Manager │                                   │ Generator │   │
│  └──────────┘                                   └───────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
pacdeluxe-upstream-monitor/
├── package.json
├── tsconfig.json
├── .env.example              # Template for credentials
├── .env                      # Actual credentials (gitignored)
├── .gitignore
│
├── src/
│   ├── index.ts              # CLI entry point
│   ├── config.ts             # Configuration loader
│   │
│   ├── auth/
│   │   └── credentials.ts    # Credential injection for test account
│   │
│   ├── recorder/
│   │   ├── flows/
│   │   │   ├── login.flow.ts       # Login flow recording
│   │   │   └── lobby.flow.ts       # Lobby flow recording
│   │   ├── artifacts.ts            # Artifact capture (DOM, screenshots, events)
│   │   └── browser.ts              # Playwright browser management
│   │
│   ├── storage/
│   │   ├── db.ts             # SQLite connection and schema
│   │   ├── models.ts         # TypeScript types for artifacts
│   │   └── queries.ts        # CRUD operations
│   │
│   ├── diff/
│   │   ├── engine.ts         # Diff computation logic
│   │   ├── dom-diff.ts       # DOM structure comparison
│   │   ├── visual-diff.ts    # Screenshot pixel comparison
│   │   └── event-diff.ts     # Flow event sequence comparison
│   │
│   ├── report/
│   │   ├── generator.ts      # Markdown report generation
│   │   └── templates.ts      # Report templates
│   │
│   └── claude/
│       ├── notifier.ts       # Trigger Claude Code session
│       └── context.ts        # Prepare context for Claude
│
├── data/
│   └── artifacts.db          # SQLite database (gitignored)
│
├── reports/                  # Generated reports (gitignored)
│
└── tests/
    └── *.test.ts             # Unit tests
```

---

## Phase 1: Project Scaffolding

**Tasks:**
1. Create sibling directory structure
2. Initialize npm project with TypeScript
3. Install dependencies:
   - `playwright` - Browser automation
   - `better-sqlite3` - SQLite driver
   - `pixelmatch` - Visual diff
   - `diff` - Text/JSON diff
   - `commander` - CLI framework
   - `dotenv` - Credential loading
   - `chalk` - CLI output formatting
4. Create `.env.example` with required variables
5. Set up tsconfig.json for Node.js + ESM
6. Create .gitignore (node_modules, .env, data/, reports/)

**Deliverable:** Empty but runnable project skeleton

---

## Phase 2: Authentication Module

**Tasks:**
1. Create `auth/credentials.ts`:
   - Load email/password from `.env`
   - Export `getCredentials()` function
2. Validate credentials exist before run
3. No credential storage in SQLite (security)

**Environment Variables:**
```
PAC_TEST_EMAIL=your-test-account@example.com
PAC_TEST_PASSWORD=your-password
```

**Deliverable:** Secure credential loading

---

## Phase 3: Playwright Browser Management

**Tasks:**
1. Create `recorder/browser.ts`:
   - Launch Chromium in headed/headless mode
   - Configure viewport to match PACDeluxe (1280x900)
   - Set user agent to match standard Chrome
   - Handle browser lifecycle (launch, close, crash recovery)
2. Create browser context with:
   - Geolocation disabled
   - Notifications disabled
   - Standard timezone

**Deliverable:** Reusable browser launcher

---

## Phase 4: Login Flow Recording

**Tasks:**
1. Create `recorder/flows/login.flow.ts`:
   - Navigate to `https://pokemon-auto-chess.com`
   - Wait for login UI to load
   - Capture pre-login DOM snapshot
   - Capture pre-login screenshot
   - Fill email/password fields
   - Click login button
   - Wait for redirect/lobby load
   - Capture post-login DOM snapshot
   - Capture post-login screenshot
   - Record all network requests
   - Record console messages
   - Record timing metrics

**Selectors to identify (will need research):**
- Email input field
- Password input field
- Login button
- Login success indicator

**Deliverable:** Login flow that captures artifacts

---

## Phase 5: Lobby Flow Recording

**Tasks:**
1. Create `recorder/flows/lobby.flow.ts`:
   - Assert logged in state
   - Capture lobby DOM snapshot
   - Capture lobby screenshot
   - Navigate through lobby sections:
     - Main lobby
     - Player profile
     - Settings menu
     - Game mode selection
   - Capture each section's DOM and screenshot
   - Record all UI element positions/sizes
   - Record any dynamic content (player counts, etc.)

**Deliverable:** Lobby exploration flow

---

## Phase 6: SQLite Storage Layer

**Tasks:**
1. Create `storage/db.ts`:
   - Initialize SQLite with better-sqlite3
   - Create schema on first run
2. Create `storage/models.ts` - TypeScript interfaces:
   ```typescript
   interface Run {
     id: number;
     timestamp: string;
     upstream_version: string | null;
     duration_ms: number;
     status: 'success' | 'failure';
   }

   interface DomSnapshot {
     id: number;
     run_id: number;
     flow: string;
     step: string;
     html: string;
     selector_map: string; // JSON
   }

   interface Screenshot {
     id: number;
     run_id: number;
     flow: string;
     step: string;
     png_blob: Buffer;
     width: number;
     height: number;
   }

   interface FlowEvent {
     id: number;
     run_id: number;
     flow: string;
     event_type: string;
     timestamp_ms: number;
     data: string; // JSON
   }

   interface NetworkRequest {
     id: number;
     run_id: number;
     url: string;
     method: string;
     status: number;
     duration_ms: number;
   }
   ```
3. Create `storage/queries.ts` - CRUD operations

**Schema:**
```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  upstream_version TEXT,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE dom_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  html TEXT NOT NULL,
  selector_map TEXT
);

CREATE TABLE screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  png_blob BLOB NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);

CREATE TABLE flow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  flow TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  data TEXT
);

CREATE TABLE network_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  url TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER,
  duration_ms INTEGER
);

CREATE INDEX idx_dom_run ON dom_snapshots(run_id);
CREATE INDEX idx_screenshots_run ON screenshots(run_id);
CREATE INDEX idx_events_run ON flow_events(run_id);
CREATE INDEX idx_network_run ON network_requests(run_id);
```

**Deliverable:** Working SQLite storage

---

## Phase 7: Diff Engine

**Tasks:**
1. Create `diff/dom-diff.ts`:
   - Parse HTML into comparable structure
   - Identify added/removed/changed elements
   - Track selector changes (class names, IDs)
   - Detect structural changes vs content changes

2. Create `diff/visual-diff.ts`:
   - Use pixelmatch for pixel-level comparison
   - Generate diff image highlighting changes
   - Calculate change percentage
   - Identify regions of change

3. Create `diff/event-diff.ts`:
   - Compare flow event sequences
   - Detect timing changes
   - Detect new/removed events

4. Create `diff/engine.ts`:
   - Orchestrate all diff types
   - Compare run N vs run N-1
   - Produce unified diff report

**Deliverable:** Multi-modal diff engine

---

## Phase 8: Report Generator

**Tasks:**
1. Create `report/generator.ts`:
   - Generate Markdown report from diff results
   - Include:
     - Run metadata (timestamp, duration, version)
     - Summary of changes (high/medium/low severity)
     - DOM changes with context
     - Screenshot diffs (as base64 images or file refs)
     - Flow timing changes
     - Network request changes
2. Save report to `reports/YYYY-MM-DD-HHmmss.md`

**Deliverable:** Human-readable change reports

---

## Phase 9: Claude Notifier

**Tasks:**
1. Create `claude/context.ts`:
   - Prepare context document for Claude
   - Include relevant PACDeluxe code snippets
   - Include diff summary
   - Include specific questions/areas of concern

2. Create `claude/notifier.ts`:
   - Output instructions to terminal
   - Generate a `.claude-context.md` file in PACDeluxe repo
   - Suggest command: `cd ../pokemonautochessdeluxe && claude`
   - Context file includes:
     - What changed upstream
     - Relevant PACDeluxe files to review
     - Suggested investigation areas

**Deliverable:** Claude Code session launcher

---

## Phase 10: CLI Interface

**Tasks:**
1. Create `src/index.ts` with commander:
   ```
   upstream-monitor record    # Run recording flows
   upstream-monitor diff      # Compare latest vs previous
   upstream-monitor report    # Generate report from diff
   upstream-monitor run       # record + diff + report + notify
   upstream-monitor list      # List all runs
   upstream-monitor show <id> # Show details of a run
   ```

2. Add flags:
   - `--headed` - Show browser window
   - `--flow <name>` - Run specific flow only
   - `--compare <id1> <id2>` - Compare specific runs
   - `--verbose` - Detailed logging

**Deliverable:** Usable CLI tool

---

## Phase 11: Testing & Documentation

**Tasks:**
1. Write unit tests for:
   - Credential loading
   - SQLite operations
   - Diff algorithms
2. Create README.md with:
   - Setup instructions
   - Usage examples
   - Architecture overview
3. Update PACDeluxe CLAUDE.md to reference this tool

**Deliverable:** Tested and documented system

---

## Execution Order

```
Phase 1  ─────────────────────────────────────────▶  Scaffolding
    │
Phase 2  ─────────────────────────────────────────▶  Auth
    │
Phase 3  ─────────────────────────────────────────▶  Browser
    │
    ├──────────┬──────────┐
    ▼          ▼          ▼
Phase 4    Phase 5    Phase 6   (can parallelize)
Login      Lobby      Storage
    │          │          │
    └──────────┴──────────┘
               │
Phase 7  ─────────────────────────────────────────▶  Diff Engine
    │
Phase 8  ─────────────────────────────────────────▶  Report
    │
Phase 9  ─────────────────────────────────────────▶  Claude Notifier
    │
Phase 10 ─────────────────────────────────────────▶  CLI
    │
Phase 11 ─────────────────────────────────────────▶  Testing & Docs
```

---

## Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "diff": "^5.2.0",
    "dotenv": "^16.4.0",
    "pixelmatch": "^5.3.0",
    "playwright": "^1.42.0",
    "pngjs": "^7.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/diff": "^5.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

---

## Ethical Constraints

This system is **read-only observation** of the upstream game:
- No game state modification
- No automated gameplay
- No competitive advantage
- Only captures what a human would see in a browser
- Credentials used only for legitimate test account access

---

## Questions Resolved

| Question | Answer |
|----------|--------|
| Location | Sibling folder `../pacdeluxe-upstream-monitor/` |
| Flows | Login + Lobby only |
| Trigger | Manual CLI |
| Claude Action | Interactive session with context file |
| Auth | Test account credentials from `.env` |
| Storage | SQLite database |
| Language | TypeScript + Playwright |

---

## Next Steps

1. Confirm this plan
2. You provide test account credentials (or create one)
3. I begin Phase 1 implementation
