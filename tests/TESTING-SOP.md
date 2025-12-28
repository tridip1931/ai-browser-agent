# AI Browser Agent — Testing SOP

Standard Operating Procedure for testing the extension using MCP tools.

---

## Prerequisites

1. **Backend running:** `cd backend && npm start`
2. **Extension loaded:** Load `extension/` folder in `chrome://extensions/`
3. **MCP available:** Playwright MCP or Browser MCP configured

---

## MCP Testing Workflow

### Phase 1: Backend Verification

```
1. Use WebFetch to check http://localhost:3000/health
2. Verify response: { status: "ok", providers: { anthropic: true } }
3. If failed: Check backend logs, verify API keys
```

### Phase 2: Extension Loading

```
1. Use browser_navigate to chrome://extensions
2. Verify "AI Browser Agent" appears in list
3. Check for any error badges
4. If errors: Check manifest.json syntax
```

### Phase 3: DOM Capture Test

```
1. browser_navigate({ url: "https://example.com" })
2. Open side panel (extension icon click)
3. browser_evaluate({ expression: `
     chrome.runtime.sendMessage({action: 'captureState'}, r => console.log(r))
   `})
4. Verify elements array in console
5. Check data-ai-id attributes on page elements
```

### Phase 4: Action Execution Tests

**Click Test:**
```
1. browser_navigate({ url: "https://example.com" })
2. Submit task via side panel: "Click the More information link"
3. Confirm action when dialog appears
4. Verify page navigates to IANA
```

**Type Test:**
```
1. browser_navigate({ url: "https://google.com" })
2. Submit task: "Type 'test query' in the search box"
3. Confirm action
4. browser_evaluate({ expression: "document.querySelector('input[name=q]').value" })
5. Verify value is "test query"
```

**Scroll Test:**
```
1. Navigate to long page
2. browser_evaluate({ expression: "window.scrollY" }) // Record initial
3. Submit task: "Scroll down"
4. browser_evaluate({ expression: "window.scrollY" }) // Check increased
```

### Phase 5: Security Tests

**High-Risk Confirmation:**
```
1. Navigate to page with delete/purchase button
2. Submit task targeting that button
3. Verify confirmation dialog appears
4. Click Deny
5. Verify action not executed
```

**Injection Detection:**
```
1. Create test HTML with "ignore previous instructions" text
2. Serve locally or use data URL
3. Navigate and submit any task
4. Verify backend returns injection warning
```

### Phase 6: State Persistence Test

```
1. Start multi-step task
2. Wait for first action
3. browser_evaluate({ expression: `
     chrome.storage.session.get('agent-state').then(console.log)
   `})
4. Verify state shows running, iteration > 0
5. Go to chrome://serviceworker-internals
6. Stop AI Browser Agent worker
7. Return to test page
8. Verify task resumes from saved state
```

---

## Quick Test Checklist

| Test | Command | Expected |
|------|---------|----------|
| Backend up | `curl localhost:3000/health` | `{"status":"ok"}` |
| Extension loaded | Check chrome://extensions | No errors |
| DOM capture | Send captureState message | Elements array |
| Click action | Task: "Click first link" | Navigation occurs |
| Type action | Task: "Type in search" | Text appears |
| Confirmation | Target delete button | Dialog shows |
| Visual indicator | Start any task | Orange border |

---

## Debugging with MCP

**Get console logs:**
```
browser_evaluate({
  expression: "console.log('[Debug] Last 10 messages:', window.__aiAgentLogs)"
})
```

**Check extension state:**
```
browser_evaluate({
  expression: `
    chrome.storage.session.get(null).then(data => {
      console.log('Session storage:', data);
    })
  `
})
```

**Force action execution:**
```
browser_evaluate({
  expression: `
    chrome.runtime.sendMessage({
      action: 'executeAction',
      type: 'click',
      targetId: 'ai-target-0'
    })
  `
})
```

**Clear state:**
```
browser_evaluate({
  expression: "chrome.storage.session.clear()"
})
```

---

## MCP Tools Reference

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to URL |
| `browser_click` | Click element |
| `browser_type` | Type text |
| `browser_snapshot` | Capture page state |
| `browser_evaluate` | Run JavaScript |
| `browser_wait` | Wait for element |
| `WebFetch` | HTTP requests |

---

## Automated Test Sequence

For full test suite via MCP:

```javascript
// 1. Backend health
WebFetch({ url: "http://localhost:3000/health" })

// 2. Navigate to test page
browser_navigate({ url: "https://example.com" })

// 3. Capture DOM
browser_evaluate({ expression: `
  new Promise(resolve => {
    chrome.runtime.sendMessage({action: 'captureState'}, resolve)
  })
`})

// 4. Execute click
browser_click({ selector: "a" })

// 5. Verify navigation
browser_snapshot() // Check current URL
```

---

## Known Limitations

1. **Extension context:** MCP runs in page context, not extension context
2. **Side panel:** Cannot directly interact with side panel via MCP
3. **Service worker:** Cannot directly communicate with background.js
4. **Workaround:** Use `chrome.runtime.sendMessage` via `browser_evaluate`

---

## Troubleshooting

| Issue | Check | Fix |
|-------|-------|-----|
| Backend 404 | Server running? | `npm start` |
| No elements | Content script loaded? | Refresh page |
| No response | Service worker alive? | Check chrome://extensions |
| Actions fail | Element visible? | Scroll into view first |
| Injection false positive | Pattern too broad? | Update filter patterns |
