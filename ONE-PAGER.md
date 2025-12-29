# AI-Powered Browser Automation Chrome Extension — Technical Scope

**Building a browser automation extension requires orchestrating three tiers: a Chrome extension for browser control, a backend proxy server for secure LLM access, and model-agnostic AI integration.** The core pattern is a **ReAct-style agent loop** where the AI observes the page state, reasons about the next action, executes it, and verifies the result.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      CHROME EXTENSION (Manifest V3)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐         ┌─────────────────────────────────┐   │
│  │  Service Worker     │◄───────►│  Side Panel UI                  │   │
│  │  (background.js)    │         │  • Chat interface               │   │
│  │  • Agent orchestration        │  • Task status/progress         │   │
│  │  • API communication│         │  • Action confirmation dialogs  │   │
│  │  • State management │         │  • Visual AI activity indicator │   │
│  └─────────┬───────────┘         └─────────────────────────────────┘   │
│            │                                                            │
│            │  chrome.tabs.sendMessage / chrome.scripting                │
│            ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Content Scripts                              │   │
│  │  • DOM state capture (simplified tree, interactive elements)    │   │
│  │  • Action execution (click, type, scroll, form fill)            │   │
│  │  • Element annotation for AI targeting                          │   │
│  │  • Page observer (mutation detection for state changes)         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  chrome.tabs.captureVisibleTab  │  chrome.debugger (CDP)        │   │
│  │  • Screenshot capture           │  • Synthetic input events     │   │
│  │  • Base64 image for vision LLM  │  • Network interception       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ Authenticated requests (JWT/OAuth)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      BACKEND PROXY SERVER                               │
│  • API key storage (environment variables only)                        │
│  • LLM provider abstraction layer (Claude, OpenAI, Ollama)             │
│  • Rate limiting and cost tracking per user/token                      │
│  • Request validation and prompt injection filtering                   │
│  • Action audit logging                                                │
└────────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      LLM PROVIDERS                                      │
│  Anthropic Claude API  │  OpenAI API  │  Local (Ollama)                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Agent Loop: Observation → Reasoning → Action → Verification

The extension implements a **ReAct-style agent loop** that iterates until task completion.

### 1. Observation Phase (Hybrid DOM + Screenshot)

**DOM capture** extracts a simplified tree containing only interactive elements:

```javascript
// content.js - Simplified DOM extraction
function captureInteractiveElements() {
  const elements = [];
  const selectors = 'button, a, input, textarea, select, [role="button"], [onclick]';

  document.querySelectorAll(selectors).forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // Skip hidden

    // Assign unique ID for targeting
    const elementId = `ai-target-${index}`;
    el.setAttribute('data-ai-id', elementId);

    elements.push({
      id: elementId,
      tag: el.tagName.toLowerCase(),
      text: el.innerText?.substring(0, 100) || '',
      placeholder: el.placeholder || '',
      type: el.type || '',
      href: el.href || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    });
  });

  return elements;
}
```

**Screenshot capture** for visual context:

```javascript
// background.js - Screenshot capture
async function captureScreenshot(tabId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  return dataUrl; // Base64 PNG for vision LLM
}
```

### 2. Reasoning Phase (LLM Request)

```javascript
// background.js - Agent reasoning
async function getNextAction(task, pageState, history) {
  const response = await fetch(`${BACKEND_URL}/api/reason`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      task: task,
      currentUrl: pageState.url,
      elements: pageState.elements,
      screenshot: pageState.screenshot, // Optional, increases tokens 10-100x
      actionHistory: history,
      availableActions: ['click', 'type', 'scroll', 'wait', 'done']
    })
  });

  return response.json();
  // Returns: { action: 'click', targetId: 'ai-target-5', reasoning: '...' }
}
```

### 3. Action Execution

```javascript
// content.js - Action executor
function executeAction(action) {
  const element = document.querySelector(`[data-ai-id="${action.targetId}"]`);
  if (!element) throw new Error(`Element ${action.targetId} not found`);

  switch (action.type) {
    case 'click':
      element.click();
      break;
    case 'type':
      element.focus();
      element.value = action.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      break;
    case 'scroll':
      window.scrollBy(0, action.amount || 500);
      break;
    case 'wait':
      // Handled by orchestrator
      break;
  }
}
```

### 4. Verification Phase

```javascript
// background.js - Verify action success
async function verifyAction(tabId, expectedChange) {
  await new Promise(r => setTimeout(r, 1000)); // Wait for page update

  const newState = await capturePageState(tabId);

  // Compare with expected outcome
  const success = evaluateChange(newState, expectedChange);

  if (!success) {
    return { success: false, newState, error: 'Expected change not observed' };
  }

  return { success: true, newState };
}
```

---

## Chrome Extension Manifest (V3)

```json
{
  "manifest_version": 3,
  "name": "AI Browser Agent",
  "version": "1.0",
  "description": "AI-powered browser automation",

  "permissions": [
    "activeTab",
    "scripting",
    "sidePanel",
    "storage"
  ],

  "optional_permissions": [
    "tabs",
    "debugger"
  ],

  "host_permissions": [
    "https://*/*",
    "http://*/*"
  ],

  "background": {
    "service_worker": "background.js",
    "type": "module"
  },

  "side_panel": {
    "default_path": "sidepanel.html"
  },

  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],

  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### Permission Strategy

| Permission | When Needed | Why Deferred |
|------------|-------------|--------------|
| `activeTab` | Always | Minimum for current tab access |
| `scripting` | Always | Inject content scripts |
| `sidePanel` | Always | Persistent chat UI |
| `storage` | Always | State persistence |
| `tabs` | URL/title access | Scary warning, request at runtime |
| `debugger` | Synthetic input | Very scary warning, CDP access |

---

## Backend Proxy Server

### Express Server with Provider Abstraction

```javascript
// server.js
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getProvider } from './providers/index.js';

const app = express();

// Rate limiting per user
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyGenerator: (req) => req.user.id,
  handler: (req, res) => res.status(429).json({ error: 'Rate limit exceeded' })
});

app.use('/api', authenticate, limiter);

app.post('/api/reason', async (req, res) => {
  const { task, currentUrl, elements, screenshot, actionHistory, availableActions } = req.body;

  // Prompt injection detection
  if (detectInjection(elements)) {
    return res.status(400).json({
      error: 'Suspicious content detected',
      requiresConfirmation: true
    });
  }

  const provider = getProvider(req.user.preferredProvider || 'anthropic');

  const prompt = buildAgentPrompt({
    task,
    currentUrl,
    elements,
    screenshot,
    actionHistory,
    availableActions
  });

  const response = await provider.complete(prompt, {
    maxTokens: 1000,
    temperature: 0.1 // Low temp for reliable actions
  });

  // Log for audit
  await logAction(req.user.id, { task, response });

  res.json(parseAgentResponse(response));
});
```

### LLM Provider Abstraction

```javascript
// providers/index.js
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';

const providers = {
  anthropic: new AnthropicProvider(process.env.ANTHROPIC_API_KEY),
  openai: new OpenAIProvider(process.env.OPENAI_API_KEY),
  ollama: new OllamaProvider(process.env.OLLAMA_URL || 'http://localhost:11434')
};

export function getProvider(name) {
  return providers[name] || providers.anthropic;
}
```

```javascript
// providers/anthropic.js
import Anthropic from '@anthropic-ai/sdk';

export class AnthropicProvider {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(prompt, options) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: options.maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });
    return response.content[0].text;
  }
}
```

---

## Permission Model

### Multi-Layer Permission System

```javascript
// permissions.js
const sitePermissions = {
  // Stored in chrome.storage.local
  // Format: { domain: { mode: 'ask' | 'autonomous', allowedActions: [...] } }
};

const HIGH_RISK_ACTIONS = [
  'purchase',      // Any payment-related action
  'publish',       // Posting content publicly
  'delete',        // Permanent deletion
  'share',         // Sharing personal data
  'password',      // Password changes
  'payment'        // Payment method changes
];

async function requiresConfirmation(action, domain) {
  // High-risk actions ALWAYS require confirmation
  if (HIGH_RISK_ACTIONS.some(risk => action.type.includes(risk))) {
    return { required: true, reason: 'high-risk-action' };
  }

  const sitePerm = await getSitePermission(domain);

  // No permission for this site
  if (!sitePerm) {
    return { required: true, reason: 'no-site-permission' };
  }

  // Ask mode
  if (sitePerm.mode === 'ask') {
    return { required: true, reason: 'user-preference' };
  }

  // Autonomous mode - proceed
  return { required: false };
}
```

### Visual Indicator (Claude Pattern)

```javascript
// sidepanel.js - Orange border when AI is controlling
function setAIActiveIndicator(tabId, active) {
  if (active) {
    chrome.scripting.insertCSS({
      target: { tabId },
      css: `
        body::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border: 3px solid #f97316;
          pointer-events: none;
          z-index: 999999;
        }
      `
    });
  } else {
    chrome.scripting.removeCSS({ target: { tabId } });
  }
}
```

---

## Security: Prompt Injection Defense

### Content Classifier

```javascript
// middleware/injection-filter.js
const SUSPICIOUS_PATTERNS = [
  /ignore previous instructions/i,
  /disregard the above/i,
  /new system prompt/i,
  /you are now/i,
  /forget everything/i,
  /execute the following/i,
  /\[system\]/i,
  /\[assistant\]/i
];

function detectInjection(elements) {
  const allText = elements.map(e => e.text + e.ariaLabel).join(' ');

  // Check visible text
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(allText)) {
      return { detected: true, source: 'visible-text', pattern: pattern.source };
    }
  }

  // Check hidden elements (comments, hidden divs)
  // These are captured separately in DOM extraction

  return { detected: false };
}
```

**Anthropic's research shows mitigations reduced attack success from 23.6% to 11.2%** — still non-zero, justifying conservative defaults.

---

## State Management

### Service Worker State Persistence

The 30-second idle timeout requires explicit state checkpointing:

```javascript
// background.js - State management
const STATE_KEY = 'agent-state';

async function saveState(state) {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

async function loadState() {
  const result = await chrome.storage.session.get(STATE_KEY);
  return result[STATE_KEY] || {
    currentTask: null,
    actionHistory: [],
    status: 'idle'
  };
}

// Checkpoint after every action
async function executeWithCheckpoint(action) {
  const state = await loadState();

  // Execute action
  const result = await executeAction(action);

  // Update state
  state.actionHistory.push({ action, result, timestamp: Date.now() });
  await saveState(state);

  return result;
}
```

---

## Key Tradeoffs

| Decision | Tradeoff | Recommendation |
|----------|----------|----------------|
| **Screenshot vs DOM** | Screenshots: 10-100x more tokens, better visual understanding | Use hybrid: screenshots for initial understanding, DOM for actions |
| **Autonomous vs Supervised** | Autonomy: powerful but risky (11.2% injection success) | Default to "ask before acting", opt-in autonomous for trusted sites |
| **Single vs Multi-agent** | Multi-agent: better decomposition, more latency/cost | Single agent with checkpointing for most tasks |
| **Content script vs CDP** | CDP: pixel-precise but scary permissions | Content scripts for standard ops, CDP for edge cases |

---

## Implementation Phases

### Phase 1: Extension Skeleton ✅ COMPLETE
- [x] manifest.json with required permissions
- [x] Basic content.js with DOM capture
- [x] background.js service worker skeleton
- [x] Side panel HTML/JS skeleton

### Phase 2: DOM Capture & Action Execution ✅ COMPLETE
- [x] Element annotation system (unique IDs with `data-ai-id`)
- [x] Interactive element extraction with semantic context
- [x] Click, type, scroll action executors
- [x] Mutation observer for state changes
- [x] Full page element capture (not just viewport)

### Phase 3: Backend Proxy ✅ COMPLETE
- [x] Express server with CORS
- [x] Anthropic provider integration
- [x] Rate limiting middleware (60 req/min)
- [x] Basic prompt injection filter

### Phase 4: Agent Loop ✅ COMPLETE
- [x] Planning-first approach: Plan → Approve → Execute → Verify
- [x] Action history management
- [x] State persistence across service worker restarts
- [x] Error handling and retry logic
- [x] Clarification flow for ambiguous requests
- [x] Tab-specific sessions (multiple tabs supported)

### Phase 5: Permission System ✅ COMPLETE
- [x] Plan approval dialogs in chat UI
- [x] Action confirmation with visual feedback
- [x] High-risk action detection
- [x] Tab grouping for AI-controlled tabs ("AI Agent" group)

### Phase 6: Multi-Provider & Polish ✅ COMPLETE
- [x] OpenAI provider
- [x] Ollama (local) provider
- [x] **Groq provider** (FREE, 14,400 req/day, ultra-fast llama-3.3-70b)
- [x] DeepSeek provider
- [x] Semantic context extraction for better element selection
- [x] JSON sanitization for malformed LLM responses
- [ ] Cost tracking (planned)
- [ ] Screenshot support (planned)

---

## V2 Plans (Next Version)

| Part | Description | Status |
|------|-------------|--------|
| [CDP Integration](docs/v2-01-cdp-integration.md) | Upgrade to Chrome DevTools Protocol for real input events | Planned |
| [Monochrome UI](docs/v2-02-monochrome-ui.md) | Clean design with orange accent, CSS variables | Planned |
| [Activity Feed](docs/v2-03-activity-feed.md) | Terminal-like action display format | Planned |
| [Plan Display](docs/v2-04-plan-display.md) | Simplified execution plan cards | Planned |
| [Conversational AI](docs/v2-05-conversational-ai.md) | Multi-turn dialogue with confidence-based decisions | Planned |

### V2 Summary

| Feature | V1 (Current) | V2 (Planned) |
|---------|--------------|--------------|
| Input method | Content script (synthetic) | CDP (real events) |
| Page indicator | Custom orange border | Native Chrome debugger banner |
| UI style | Colorful chat interface | Monochromatic activity feed |
| Action display | Cards with emojis | Simple text feed |
| Color scheme | Multiple colors | Grayscale + orange accent |
| Clarification | Single round, open-ended | Multi-round, option-based |
| Confidence | None | 3-zone system (ask/assume/proceed) |
| Plan iteration | None | Self-refine loop (3 iterations) |
| Failure recovery | Log and continue | Analyze + retry/skip/replan |

---

## Open Source References

| Repository | Stars | Approach |
|------------|-------|----------|
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | 72k | Python browser automation agent |
| [nichdame/nanobrowser](https://github.com/nichdame/nanobrowser) | 11k | Chrome extension with multi-agent architecture |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | — | TypeScript browser automation |
| [anthropics/computer-use-demo](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo) | — | Anthropic's reference implementation |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | — | Unified LLM API (100+ models) |
