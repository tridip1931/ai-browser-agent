# AI Browser Agent — Chrome Extension

## Project Overview

A Manifest V3 Chrome extension that enables AI-powered browser automation using a ReAct-style agent loop. Observes page state (DOM + screenshots), sends to LLM for reasoning, executes actions, and verifies results.

## Tech Stack

- **Chrome Extension Manifest V3** — Service workers, side panel, content scripts
- **Vanilla JavaScript** — No build step, ES modules
- **Backend** — Node.js/Express proxy server
- **LLM Providers** — Anthropic Claude, OpenAI, Ollama (local)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Side Panel UI ◄──────────► Service Worker (background.js)     │
│  • Chat interface           • Agent orchestration               │
│  • Action confirmations     • API communication                 │
│                             • State management                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  Content Scripts (content.js)                                   │
│  • DOM capture (interactive elements only)                     │
│  • Element annotation (data-ai-id)                             │
│  • Action execution (click, type, scroll)                      │
│  • Mutation observer (state change detection)                  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend Proxy (server.js)                                      │
│  • API key storage (env vars only)                             │
│  • LLM provider abstraction                                    │
│  • Rate limiting + cost tracking                               │
│  • Prompt injection filtering                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Folder Structure

```
ai-browser-agent/
├── extension/
│   ├── manifest.json
│   ├── background.js       ← Service worker (agent loop)
│   ├── content.js          ← DOM capture + action execution
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── lib/
│       ├── dom-capture.js
│       ├── element-annotator.js
│       └── action-executor.js
├── backend/
│   ├── server.js
│   ├── providers/
│   │   ├── index.js
│   │   ├── anthropic.js
│   │   ├── openai.js
│   │   └── ollama.js
│   └── middleware/
│       ├── auth.js
│       ├── rate-limit.js
│       └── injection-filter.js
├── ONE-PAGER.md            ← Technical specification
├── CLAUDE.md               ← This file
└── README.md
```

## Critical Constraints

### Service Worker Limitations
- **Terminates after ~30s of inactivity** — No persistent state in memory
- **Must checkpoint to `chrome.storage.session`** — Resume after timeout
- **Async message handlers must `return true`**

```javascript
// CORRECT
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncWork().then(sendResponse);
  return true; // Required!
});
```

### Security: API Keys NEVER Touch Client
- All LLM API keys stored server-side only
- Extension authenticates with backend via JWT
- Never expose keys in extension code or storage

### Prompt Injection Risk
- Anthropic research: mitigations reduced attack success 23.6% → 11.2%
- Still non-zero — default to "ask before acting"
- High-risk actions ALWAYS require user confirmation

## Agent Loop Pattern

```
1. OBSERVE  → Capture DOM elements + optional screenshot
2. REASON   → Send to LLM via backend proxy
3. ACT      → Execute chosen action (click, type, scroll)
4. VERIFY   → Confirm success before next iteration
5. REPEAT   → Until task complete or error
```

## Element Annotation

Content script assigns unique IDs to interactive elements:

```javascript
el.setAttribute('data-ai-id', `ai-target-${index}`);
```

LLM returns action with `targetId`, content script queries by `[data-ai-id="..."]`.

## Coding Standards

### Logging Convention
```javascript
console.log('[Background] Agent loop started:', task);
console.log('[Content] Elements captured:', elements.length);
console.log('[SidePanel] User confirmed action');
console.log('[Backend] Provider response:', response);
```

### Message Protocol
```javascript
// Extension internal messages
{ action: 'captureState' }
{ action: 'executeAction', targetId: 'ai-target-5', type: 'click' }
{ action: 'agentProgress', step: 3, total: 7, status: 'Clicking login...' }

// Backend API
POST /api/reason   → { task, elements, screenshot?, actionHistory }
POST /api/confirm  → { action, domain, riskLevel }
```

### Error Handling
```javascript
try {
  const result = await executeAction(action);
  await checkpointState({ ...state, lastAction: action });
} catch (error) {
  console.error('[Background] Action failed:', error);
  await notifyUser({ type: 'error', message: error.message });
}
```

## High-Risk Actions (Always Confirm)

- `purchase` — Any payment-related action
- `publish` — Posting content publicly
- `delete` — Permanent deletion
- `share` — Sharing personal data
- `password` — Password changes
- `payment` — Payment method changes

## Testing with MCP

**Full SOP:** See [tests/TESTING-SOP.md](tests/TESTING-SOP.md)

### Quick MCP Test Sequence

```
1. WebFetch → http://localhost:3000/health (verify backend)
2. browser_navigate → https://example.com
3. browser_evaluate → chrome.runtime.sendMessage({action: 'captureState'})
4. Verify elements array with data-ai-id attributes
5. browser_click → [data-ai-id="ai-target-0"]
6. browser_snapshot → verify page changed
```

### Manual Testing Checklist

1. Load unpacked extension in `chrome://extensions/`
2. Open side panel on any website
3. Submit simple task: "Click the first link on the page"
4. Verify confirmation dialog appears
5. Confirm and verify action executes
6. Check console for proper logging

### Debug via MCP

```javascript
// Check extension state
browser_evaluate({
  expression: `chrome.storage.session.get(null).then(console.log)`
})

// Force action execution
browser_evaluate({
  expression: `chrome.runtime.sendMessage({
    action: 'executeAction',
    type: 'click',
    targetId: 'ai-target-0'
  })`
})
```

## Development Workflow

### Extension
1. Make changes to source files
2. Go to `chrome://extensions/`
3. Click refresh icon on extension card
4. Test on target website

### Backend
1. Install dependencies: `npm install`
2. Set env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
3. Run: `npm start`
4. Test: `curl http://localhost:3000/health`

## Reference

- [ONE-PAGER.md](ONE-PAGER.md) — Technical specification
- [tests/TESTING-SOP.md](tests/TESTING-SOP.md) — Testing procedures with MCP
- [Chrome MV3 Docs](https://developer.chrome.com/docs/extensions/mv3/)
- [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [browser-use](https://github.com/browser-use/browser-use) — Reference implementation
