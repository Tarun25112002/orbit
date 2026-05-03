<p align="center">
  <img src="public/android-chrome-512x512.png" alt="Orbit Logo" width="80" height="80" />
</p>

<h1 align="center">Orbit</h1>

<p align="center">
  <strong>An autonomous, multi-agent AI platform that plans, generates, and validates production-grade frontend applications — end to end.</strong>
</p>

<p align="center">
  <a href="#architecture">Architecture</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#key-features">Features</a> •
  <a href="#ai-pipeline">AI Pipeline</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#deployment">Deployment</a>
</p>

---

## Overview

Orbit is a full-stack SaaS platform that transforms natural language prompts into complete, deployable frontend applications. It combines a multi-agent AI orchestration engine with a server-side Docker sandbox runtime, a real-time collaborative IDE, and a subscription-based billing system — all built on a modern, type-safe Next.js 16 stack.

This is not a wrapper around ChatGPT. Orbit features a **custom agentic pipeline** with supervisor/specialist/planner agents, autonomous build validation loops, intelligent model fallback chains, and a self-healing execution runtime that retries failed builds, swaps package managers, and fixes dependency conflicts automatically.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                         │
│  Next.js 16 App Router · React 19 · Monaco Editor · xterm.js   │
│  Allotment Panels · Framer Motion · Zustand State Management    │
└────────────────────────┬─────────────────────────────────────────┘
                         │ REST / WebSocket / Convex Realtime
┌────────────────────────▼─────────────────────────────────────────┐
│                     SERVER (Next.js 16)                          │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Clerk Auth  │  │ Stripe Billing│  │   Convex Backend DB    │  │
│  │  Middleware   │  │  Webhooks    │  │  (Projects/Files/Chat) │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              AI Orchestration Engine                      │   │
│  │  Supervisor → Specialist Agents → File Ops Planner       │   │
│  │  Groq (GPT-OSS-120B) ←→ Gemini Fallback Chain           │   │
│  │  Inngest Step Functions (Durable Execution)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Docker Sandbox Runtime                       │   │
│  │  Session Manager · File Sync · Port Detector              │   │
│  │  Resource Guard · Orphan Cleanup · Container Pooling      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Preview Proxy │  │ Terminal WS  │  │ Code Suggestions     │  │
│  │  (HTTP Proxy) │  │  Bridge      │  │ (OpenRouter/Gemini)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **Next.js 16** (App Router) | Framework with Turbopack, `proxy.ts` middleware |
| **React 19** | UI rendering with Suspense, Server Components |
| **TypeScript 5** | End-to-end type safety across client and server |
| **Monaco Editor** | VS Code-grade code editor with IntelliSense, Emmet |
| **xterm.js** | Full terminal emulator in the browser |
| **Allotment** | Resizable IDE panel layout (file tree / editor / preview) |
| **Framer Motion** | Page transitions and micro-animations |
| **Zustand** | Lightweight state management for editor/tab state |
| **Tailwind CSS 4** | Utility-first styling with custom design tokens |
| **Radix UI / Base UI** | Accessible, unstyled primitives (Dialog, Dropdown, etc.) |
| **Lucide React** | Icon system |
| **Recharts** | Data visualization |
| **Shiki** | Syntax-highlighted code blocks in chat |
| **React Flow** | Node-based execution graph visualization |
| **Rive** | GPU-accelerated animations (WebGL2) |

### Backend & Infrastructure
| Technology | Purpose |
|---|---|
| **Convex** | Realtime database (projects, files, conversations, subscriptions) |
| **Clerk** | Authentication (OAuth, email, session management) |
| **Stripe** | Payment processing, subscription billing (INR pricing) |
| **Inngest** | Durable step functions for AI task orchestration |
| **Docker (Dockerode)** | Server-side sandbox containers for code execution |
| **Sentry** | Error monitoring, performance tracing |

### AI & LLM Infrastructure
| Technology | Purpose |
|---|---|
| **Google Gemini** (2.5 Flash/Pro, 3.x) | Primary LLM with multi-model fallback chain |
| **Groq** (GPT-OSS-120B, 131K context) | High-throughput inference with TPM-aware routing |
| **Inngest Agent Kit** | Multi-agent orchestration framework |
| **OpenRouter** | Code suggestion engine (autocomplete + transform) |
| **Firecrawl** | Web scraping for URL context injection |

### DevOps
| Technology | Purpose |
|---|---|
| **PM2** | Process management (web + terminal bridge + preview proxy) |
| **Docker Compose** | Container orchestration for sandbox runtime |
| **Vercel** | Frontend deployment with edge middleware |

---

## Key Features

### 🤖 Multi-Agent AI Orchestration
- **Supervisor Agent** — Classifies user intent and delegates to specialist agents
- **Architecture Agent** — Analyzes component structure, state management, and data flow
- **Code Quality Agent** — Finds bugs, edge cases, regressions, and type-safety issues
- **Implementation Agent** — Generates production-grade Vite + React + TypeScript code
- **Web Context Agent** — Incorporates scraped URL content for doc-aware responses
- **File Operations Planner** — Produces executable JSON traces (create, update, delete, rename, run_command)
- **Synthesis Agent** — Composes the final user-facing response after execution

### 🐳 Docker Sandbox Runtime
- Isolated container execution per project session (Node, Python, Bash runtimes)
- Memory-limited (1.5 GB), CPU-throttled (50% quota), capability-dropped (`--cap-drop ALL`)
- Automatic `node_modules` caching per project key
- Idle session eviction (30-min timeout) with orphan container cleanup
- Port detection and host-port mapping for live previews
- File sync engine with tar-stream archiving for bulk container writes

### 💻 Browser-Based IDE
- **Monaco Editor** with TypeScript IntelliSense, Emmet abbreviations, and custom themes
- **Multi-tab editing** with preview tabs, pinning, close-others, and scroll overflow
- **File Explorer** with drag-and-drop, rename, create, delete, and context menus
- **Integrated Terminal** with xterm.js connected via WebSocket bridge to Docker containers
- **Live Preview** panel with auto-detected dev server URLs and iframe embedding
- **Building Animation** overlay that masks output until compilation completes
- **Auto-save** with 2-second debounce and retry logic
- **AI Selection Bar** — select code → get inline AI suggestions
- **Editor Status Bar** — language, line/column, encoding, word count

### 🔄 Self-Healing Build Pipeline
- Autonomous validation loop (`npm run build` / `tsc --noEmit` / `vite build`)
- Up to 5 fix-up iterations when builds fail — AI reads errors and patches code
- Automatic package manager detection and fallback (pnpm → yarn → npm)
- `npm ci` lockfile desync auto-recovery → `npm install`
- Peer dependency conflict resolution (auto-adds `--legacy-peer-deps` / `--force`)
- Network error retry with exponential backoff
- Build-gate: dev server only starts after successful build validation
- Dev server crash detection with failure-window tracking (max 3 failures in 2 min)

### 🧠 Intelligent Code Suggestions
- **Autocomplete mode** — inline completions as you type (synchronous, sub-200ms)
- **Transform mode** — select code + instruction → full-file rewrite (async via Inngest)
- Request deduplication with fingerprint-based caching
- Multi-model fallback chain (Gemini Flash → DeepSeek → Gemma)
- Per-provider rate-limit cooldown tracking
- Request lifecycle: queued → processing → retrying → completed
- SSE streaming and polling endpoints for async results

### 🔐 Authentication & Authorization
- Clerk-based authentication with GitHub OAuth support
- Middleware-level route protection (Next.js 16 `proxy.ts`)
- Encrypted GitHub token storage with AES-256-GCM
- Automatic stale cookie cleanup on sign-out
- Subscription-aware project limits (Free: 3, Basic: 10, Pro: 50, Advanced: ∞)

### 💳 Subscription & Billing
- Stripe Checkout integration with INR pricing (₹1,000 / ₹2,500 / ₹5,000 per month)
- Webhook-driven subscription activation with idempotent processing
- Real-time usage enforcement — blocks AI execution when limits exceeded
- Glassmorphic upgrade modal with tier comparison

### 🔗 GitHub Integration
- OAuth flow with encrypted token persistence
- Import repositories into Orbit workspace
- Export/push workspace files to GitHub repos
- Repository browser with connection status management

### 🌐 Preview Proxy System
- Standalone HTTP proxy server for iframe-based previews
- Cookie-based session routing to correct container port
- WebSocket upgrade support for HMR
- Cross-origin isolation handling for secure embedding

---

## AI Pipeline — Deep Dive

### Request Flow

```
User Message
     │
     ▼
┌─────────────┐     ┌──────────────────┐
│  Intent      │────▶│  Analysis Path   │─── Supervisor → Specialists → Synthesis
│  Detection   │     └──────────────────┘
│              │     ┌──────────────────┐
│              │────▶│  Execution Path  │─── File Ops Planner → Sandbox Execution
│              │     └──────────────────┘         │
└─────────────┘                                    ▼
                                          ┌────────────────┐
                                          │  Build Gate     │
                                          │  Validation     │
                                          │  Fix-up Loop    │
                                          └────────┬───────┘
                                                   ▼
                                          ┌────────────────┐
                                          │  Dev Server     │
                                          │  Live Preview   │
                                          └────────────────┘
```

### Model Routing Strategy

| Priority | Provider | Model | Use Case |
|---|---|---|---|
| 1 | Groq | GPT-OSS-120B (131K ctx) | Primary — fast inference, large context |
| 2 | Google | Gemini 2.5 Flash | Fallback — rate-limit or payload too large |
| 3 | Google | Gemini 2.5 Pro | Secondary fallback |
| 4 | Google | Gemini 3 Flash Preview | Tertiary fallback |
| 5 | Google | Gemini 3.1 Flash Live | Final fallback |

- **TPM-aware routing**: Estimates token count before sending; skips Groq if payload exceeds budget
- **Automatic compaction**: Truncates prompts while preserving head/tail context when tokens exceed limits
- **Per-model cooldown**: Rate-limited models are paused with retry-after tracking
- **Chained fallback**: On Groq failure (non-auth), automatically cascades through Gemini model chain

### Complex Build Chunking

For large project requests (e.g., "build a full e-commerce dashboard"), Orbit decomposes the work into deterministic chunks:

1. **Design Foundation & Config** — `package.json`, Vite config, Tailwind, TypeScript, `index.html`
2. **Core Layout & Navigation** — App shell, routing, navbar, footer, layout wrapper
3. **Feature Components & Content** — Pages, data, interactive elements, responsive grids
4. **Advanced Features & Polish** — Search/filter, modals, form validation, micro-animations

Each chunk is executed sequentially with up to 15 planner calls per request, 3 retries per call, and model rotation on failure.

---

## Project Structure

```
orbit/
├── convex/                    # Convex backend (schema, queries, mutations)
│   ├── schema.ts              # Database schema (projects, files, conversations, subscriptions)
│   ├── projects.ts            # Project CRUD + AI access checks
│   ├── files.ts               # File tree operations (create, update, delete, rename)
│   ├── conversations.ts       # Chat history management
│   ├── subscriptions.ts       # Subscription tier queries
│   └── system.ts              # System-level queries (file loading, project context)
│
├── docker/
│   └── templates/             # Dockerfile templates (Node.js, Python)
│
├── src/
│   ├── app/                   # Next.js App Router pages & API routes
│   │   ├── page.tsx           # Landing page
│   │   ├── dashboard/         # User dashboard
│   │   ├── pricing/           # Subscription pricing page
│   │   ├── projects/[id]/     # Project workspace (IDE)
│   │   ├── sign-in/           # Clerk sign-in
│   │   ├── sign-up/           # Clerk sign-up
│   │   └── api/
│   │       ├── inngest/       # Inngest webhook + 2300-line orchestration functions
│   │       ├── messages/      # Chat message API (send, cancel, complete)
│   │       ├── sandbox/       # Docker sandbox API (create, exec, files, kill, port, stats)
│   │       ├── suggestion/    # Code suggestion API (submit, poll, stream, metrics)
│   │       ├── github/        # GitHub integration (repos, import, export, push, connection)
│   │       ├── stripe/        # Stripe checkout + webhooks
│   │       └── auth/          # GitHub OAuth (connect, callback, disconnect)
│   │
│   ├── components/
│   │   ├── ui/                # 30 reusable UI primitives (Button, Dialog, Tabs, etc.)
│   │   └── ai-elements/       # 48 AI chat components (message, code-block, terminal, etc.)
│   │
│   ├── features/
│   │   ├── editor/            # Monaco editor, status bar, selection AI bar, welcome tab
│   │   ├── projects/          # File explorer, project layout, GitHub dialog, sandbox hooks
│   │   ├── conversations/     # Chat sidebar, conversation hooks
│   │   └── auth/              # Auth guard, unauthenticated view
│   │
│   ├── lib/
│   │   ├── conversation-agents.ts  # 5600-line multi-agent orchestration engine
│   │   ├── gemini.ts               # Groq + Gemini dual-provider with fallback chain
│   │   ├── errors.ts               # Structured error classification (rate_limit, auth, etc.)
│   │   ├── ai-execution.ts         # AI execution trace parser + validator
│   │   ├── suggestion-engine.ts    # Code suggestion generation with retry logic
│   │   ├── completion-runtime.ts   # Request lifecycle + caching + rate limiting
│   │   ├── docker/                 # Session manager, file sync, port detector, resource guard
│   │   ├── github-*.ts             # GitHub client, OAuth state, crypto, helpers
│   │   └── clerk-auth.ts           # Server-side auth with cookie fallback
│   │
│   ├── server/
│   │   ├── proxy.ts           # Standalone preview proxy server (HTTP + WebSocket)
│   │   └── terminal-bridge.ts # WebSocket terminal bridge to Docker containers
│   │
│   ├── inngest/
│   │   └── client.ts          # Inngest client initialization
│   │
│   └── proxy.ts               # Next.js 16 middleware (auth + route protection)
│
├── ecosystem.config.js        # PM2 process configuration (web, terminal, proxy)
├── docker-compose.yml         # Docker Compose for sandbox networking
└── package.json               # Dependencies & scripts
```

---

## Database Schema

```typescript
// Convex Schema (convex/schema.ts)
projects:    { name, ownerId, updatedAt, importStatus?, exportStatus?, importRepoUrl?, exportRepoUrl? }
files:       { projectId, parentId?, name, type, content?, storageId?, updatedAt }
conversations: { projectId, title, updatedAt }
messages:    { conversationId, projectId, role, content, reasoning_details?, thinking_logs?, status? }
subscriptions: { ownerId, tier, stripeSessionId?, stripePaymentIntentId?, status, createdAt, updatedAt }
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **Docker** (for sandbox runtime)
- **Convex** account
- **Clerk** account
- **Stripe** account
- API keys: Gemini, Groq (optional), OpenRouter (optional), Firecrawl (optional)

### Installation

```bash
# Clone the repository
git clone https://github.com/Tarun25112002/orbit.git
cd orbit

# Install dependencies
npm install

# Set up Docker sandbox images
npm run sandbox:setup

# Configure environment variables
cp .env.local.example .env.local
# Fill in your API keys and service credentials

# Start Convex backend
npx convex dev

# Start the development server
npm run dev

# In a separate terminal — start Inngest dev server
npm run dev:inngest
```

### Environment Variables

```env
# Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Database
NEXT_PUBLIC_CONVEX_URL=
CONVEX_DEPLOY_KEY=

# AI Models
GEMINI_API_KEY=
GROQ_API_KEY=                    # Optional — enables Groq primary routing
GROQ_MODEL=openai/gpt-oss-120b  # Optional — default model for Groq
OPENROUTER_API_KEY=              # Optional — code suggestions

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# GitHub Integration
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=
GITHUB_TOKEN_ENCRYPTION_KEY=    # 32-byte hex key for AES-256-GCM

# Monitoring
SENTRY_DSN=
SENTRY_AUTH_TOKEN=

# Web Scraping
FIRECRAWL_API_KEY=               # Optional
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js development server (Turbopack) |
| `npm run dev:inngest` | Start Inngest dev server |
| `npm run dev:full` | Start both Next.js and Inngest concurrently |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type-checking |
| `npm run sandbox:setup` | Build Docker images and create network |

---

## Deployment

### Production (PM2)

```bash
npm run build
npm run sandbox:setup

# Start all services
pm2 start ecosystem.config.js

# Services:
# - orbit-web      → Next.js on port 3000
# - orbit-terminal → WebSocket terminal bridge on port 3001
# - orbit-proxy    → Preview proxy on port 3002
```

### Vercel

The project is configured for Vercel deployment with:
- Sentry integration (`withSentryConfig` in `next.config.ts`)
- Monitoring tunnel route (`/monitoring`)
- Edge middleware for auth (`src/proxy.ts`)

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/messages` | POST | Send a chat message (triggers AI pipeline) |
| `/api/messages/cancel` | POST | Cancel an in-progress AI task |
| `/api/messages/complete` | POST | Mark a message as completed |
| `/api/sandbox/create` | POST | Create a Docker sandbox session |
| `/api/sandbox/exec` | POST | Execute a command in a sandbox |
| `/api/sandbox/files/read` | POST | Read a file from sandbox container |
| `/api/sandbox/files/write` | POST | Write a file to sandbox container |
| `/api/sandbox/kill` | POST | Terminate a sandbox session |
| `/api/sandbox/port` | GET | Get mapped port for preview URL |
| `/api/sandbox/stats` | GET | Get sandbox resource stats |
| `/api/suggestion` | POST | Submit a code suggestion request |
| `/api/suggestion/poll` | GET | Poll for async suggestion result |
| `/api/suggestion/stream` | GET | SSE stream for suggestion progress |
| `/api/suggestion/metrics` | GET | Suggestion engine metrics |
| `/api/github/repos` | GET | List user's GitHub repositories |
| `/api/github/import` | POST | Import a GitHub repo into workspace |
| `/api/github/export` | POST | Export workspace to new GitHub repo |
| `/api/github/push` | POST | Push workspace changes to GitHub |
| `/api/github/connection` | GET/DELETE | Check or remove GitHub connection |
| `/api/stripe/create-checkout` | POST | Create Stripe checkout session |
| `/api/stripe/sync-session` | POST | Sync Stripe session status |
| `/api/stripe/webhooks` | POST | Handle Stripe webhook events |
| `/api/inngest` | POST | Inngest webhook handler |

---

## Security

- **Container isolation**: Docker containers run with `--cap-drop ALL`, only `CHOWN`, `SETUID`, `SETGID` capabilities added
- **No new privileges**: `--security-opt no-new-privileges` on all containers
- **Resource limits**: 1.5 GB memory, 50% CPU quota per container
- **Path traversal prevention**: AI execution trace validator rejects `../` paths
- **Encrypted tokens**: GitHub OAuth tokens encrypted with AES-256-GCM
- **Rate limiting**: Per-session request throttling on suggestion engine
- **Middleware auth**: All non-public routes protected via Clerk middleware
- **Dangerous command blocking**: Regex-based filter for `rm -rf`, `git reset --hard`, `format`, etc.
- **Operation cap**: Maximum 200 file operations per AI execution trace

---

## Performance

- **Turbopack** — Sub-second HMR in development
- **Streaming responses** — AI responses streamed via SSE for real-time feedback
- **Request deduplication** — Identical code suggestions served from in-memory cache
- **Lazy editor loading** — Monaco Editor loaded dynamically on first file open
- **Node_modules caching** — Per-project `node_modules` volume mount avoids reinstalls
- **Concurrent file sync** — 12-worker parallel read, 6-worker parallel mutations
- **Dependency fingerprinting** — FNV-1a hash of lock files; skip install if unchanged

---

## Author

**Tarun Kumar Jha**

- GitHub: [@Tarun25112002](https://github.com/Tarun25112002)
- LinkedIn: [Tarun Kumar Jha](https://www.linkedin.com/in/tarun-kumar-jha-721761248/)
- X: [@TarunJha2002](https://x.com/TarunJha2002)

---

## License

This project is proprietary. All rights reserved.
