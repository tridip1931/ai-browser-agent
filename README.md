# AI Browser Agent

AI-powered browser automation Chrome extension using a ReAct-style agent loop.

## Quick Start

### 1. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and add your API key(s)
npm start
```

The backend runs on `http://localhost:3000`. At least one API key is required:
- `ANTHROPIC_API_KEY` — Claude (recommended)
- `OPENAI_API_KEY` — GPT-4
- Ollama runs locally without an API key

### 2. Extension Setup

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Click the extension icon to open the side panel

### 3. Test It

1. Navigate to any website (e.g., google.com)
2. Open the AI Browser Agent side panel
3. Type a task: "Click the first link on this page"
4. Confirm the action when prompted
5. Watch it work!

## How It Works

The agent follows a **ReAct loop** (Reasoning + Acting):

```
1. OBSERVE  → Capture interactive DOM elements
2. REASON   → Send to LLM, get next action
3. ACT      → Execute action (click, type, scroll)
4. VERIFY   → Confirm success, repeat until done
```

## Project Structure

```
extension/
├── manifest.json       # Chrome MV3 manifest
├── background.js       # Service worker (orchestration)
├── content.js          # DOM interaction
├── sidepanel.html/js   # Chat UI
└── lib/
    ├── dom-capture.js      # Element extraction
    ├── action-executor.js  # Action handlers
    ├── agent-loop.js       # Main loop
    ├── state-manager.js    # Persistence
    ├── api-client.js       # Backend communication
    ├── permissions.js      # Risk detection
    ├── site-permissions.js # Per-site settings
    └── visual-indicator.js # Orange border

backend/
├── server.js           # Express API server
├── providers/
│   ├── anthropic.js    # Claude integration
│   ├── openai.js       # GPT-4 integration
│   └── ollama.js       # Local models
├── lib/
│   ├── prompt-builder.js   # LLM prompts
│   └── cost-tracker.js     # Usage tracking
└── middleware/
    └── injection-filter.js # Security
```

## Security

- **API keys server-side only** — Never stored in extension
- **High-risk actions require confirmation** — Purchase, delete, publish, etc.
- **Prompt injection filtering** — Pattern detection on backend
- **Visual indicator** — Orange border when AI is active
- **Per-site permissions** — Control automation per domain

## Providers

| Provider | Model | Vision | Cost |
|----------|-------|--------|------|
| Anthropic | Claude Sonnet | Yes | $3/$15 per 1M tokens |
| OpenAI | GPT-4o | Yes | $2.50/$10 per 1M tokens |
| Ollama | Llama 3.2 | Partial | Free (local) |

## Docs

- [ONE-PAGER.md](ONE-PAGER.md) — Technical specification
- [CLAUDE.md](CLAUDE.md) — Development guidelines
