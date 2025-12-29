# AI Browser Agent

AI-powered browser automation Chrome extension with conversational AI and confidence-based decision making.

## V2 Features

- **Conversational AI** — Multi-turn dialogue with clarifying questions
- **Confidence Routing** — 3-zone system (ask/assume-announce/proceed)
- **CDP Integration** — Real mouse/keyboard events via Chrome DevTools Protocol
- **Mid-Execution Dialogue** — Retry, skip, replan, or abort on failures
- **Self-Refine Loop** — Iteratively improve plans before execution
- **Monochrome UI** — Clean design with orange accent

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
4. Review the plan and approve
5. Watch it work!

## How It Works

The agent follows a **confidence-based dialogue loop**:

```
1. PLAN      → Generate action plan with confidence score
2. ROUTE     → Based on confidence:
               < 0.5  → Ask clarifying questions
               0.5-0.9 → Assume + Announce (3s countdown)
               >= 0.9 → Proceed to approval
3. REFINE    → Self-improve plan if needed (max 3 iterations)
4. APPROVE   → User confirms the plan
5. EXECUTE   → Run actions via CDP (real input events)
6. RECOVER   → On failure: retry/skip/replan/abort
```

## Project Structure

```
extension/
├── manifest.json           # Chrome MV3 manifest
├── background.js           # Service worker (orchestration)
├── content.js              # DOM interaction
├── sidepanel.html/js       # Chat UI with V2 components
└── lib/
    ├── agent-loop.js       # V2 dialogue loop
    ├── state-manager.js    # State machine + confidence routing
    ├── cdp-executor.js     # Chrome DevTools Protocol actions
    ├── api-client.js       # Backend communication
    ├── dom-capture.js      # Element extraction
    └── action-executor.js  # Fallback action handlers

backend/
├── server.js               # Express API server
├── providers/
│   ├── anthropic.js        # Claude integration
│   ├── openai.js           # GPT-4 integration
│   └── ollama.js           # Local models
└── lib/
    └── prompt-builder.js   # V2 confidence prompts

tests/
├── golden/                 # Golden dataset (39 test cases)
└── ...
```

## Security

- **API keys server-side only** — Never stored in extension
- **High-risk actions require confirmation** — Purchase, delete, publish, etc.
- **CDP real events** — Uses Chrome's native debugging protocol
- **Visual indicator** — Chrome's "Started debugging" banner when active
- **User cancel** — Click Chrome's cancel button to stop anytime

## Confidence Zones

| Zone | Confidence | Behavior |
|------|------------|----------|
| **Ask** | < 0.5 | Show clarifying questions |
| **Assume + Announce** | 0.5 - 0.9 | Show assumptions, 3s countdown to execute |
| **Proceed** | >= 0.9 | Go directly to plan approval |

## Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:backend      # Backend unit tests
npm run test:extension    # Extension unit tests
npm run test:golden       # Golden dataset tests

# Coverage
npm run test:coverage
```

**Test Coverage**: 327 tests (78 backend + 210 extension + 39 golden)

## Providers

| Provider | Model | Vision | Cost |
|----------|-------|--------|------|
| Anthropic | Claude Sonnet | Yes | $3/$15 per 1M tokens |
| OpenAI | GPT-4o | Yes | $2.50/$10 per 1M tokens |
| Ollama | Llama 3.2 | Partial | Free (local) |

## Docs

- [ONE-PAGER.md](ONE-PAGER.md) — Technical specification
- [CLAUDE.md](CLAUDE.md) — Development guidelines
- [docs/](docs/) — V2 feature specifications
- [tests/TESTING-SOP.md](tests/TESTING-SOP.md) — Manual testing procedures

## License

MIT
