# MCP Browser Testing Setup

To enable automated browser testing for AI Browser Agent, configure a Playwright MCP server.

## Option 1: Playwright MCP Server

Add to your Claude Code MCP configuration (`~/.claude/mcp.json` or VS Code settings):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-playwright"]
    }
  }
}
```

## Option 2: Browserbase MCP

For cloud-hosted browsers:

```json
{
  "mcpServers": {
    "browserbase": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-browserbase"],
      "env": {
        "BROWSERBASE_API_KEY": "your-api-key",
        "BROWSERBASE_PROJECT_ID": "your-project-id"
      }
    }
  }
}
```

## Available Tools After Setup

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL |
| `browser_click` | Click element by selector |
| `browser_type` | Type text into element |
| `browser_snapshot` | Capture page state |
| `browser_evaluate` | Execute JavaScript |
| `browser_wait` | Wait for element |

## Test Commands

Once MCP is configured, run these tests:

```
# 1. Health check
curl http://localhost:3000/health

# 2. Navigate to test page
browser_navigate({ url: "https://example.com" })

# 3. Capture DOM (via extension)
browser_evaluate({
  expression: `new Promise(r => chrome.runtime.sendMessage({action:'captureState'}, r))`
})

# 4. Click first element
browser_click({ selector: "[data-ai-id='ai-target-0']" })

# 5. Verify
browser_snapshot()
```

## Manual Testing (No MCP)

If MCP browser tools aren't available:

1. Start backend: `cd backend && npm start`
2. Load extension in Chrome
3. Open DevTools Console
4. Run: `chrome.runtime.sendMessage({action: 'captureState'}, console.log)`
5. Verify elements are captured
