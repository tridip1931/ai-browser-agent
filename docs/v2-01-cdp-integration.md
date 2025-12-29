# V2 Part 1: Chrome DevTools Protocol Integration

## Overview

Upgrade from content script synthetic events to Chrome DevTools Protocol (CDP) for real input events. This triggers Chrome's native "Started debugging this browser" banner automatically.

## Why CDP?

| Benefit | Description |
|---------|-------------|
| **Native banner** | Chrome shows "Started debugging" banner automatically |
| **Real input events** | Indistinguishable from user input |
| **Shadow DOM access** | Can interact with web components |
| **Cross-origin iframes** | Full access to nested content |
| **More reliable** | No synthetic event detection by websites |

## Files to Modify

| File | Change |
|------|--------|
| `extension/manifest.json` | Move `debugger` from optional to required permissions |
| `extension/lib/cdp-executor.js` | **NEW** — CDP action executor |
| `extension/background.js` | Add debugger attach/detach lifecycle |
| `extension/content.js` | Add `getElementRect` message handler |

---

## Implementation

### 1. Manifest Changes

```json
{
  "permissions": [
    "activeTab",
    "scripting",
    "sidePanel",
    "storage",
    "tabs",
    "tabGroups",
    "debugger"  // Move from optional_permissions
  ]
}
```

### 2. New File: `extension/lib/cdp-executor.js`

```javascript
/**
 * CDP (Chrome DevTools Protocol) action executor
 * Uses chrome.debugger API for real input events
 */

let attachedTabs = new Map(); // tabId -> attached state

/**
 * Attach debugger to tab (triggers native Chrome banner)
 */
export async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;

  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        attachedTabs.set(tabId, true);
        console.log('[CDP] Debugger attached to tab', tabId);
        resolve();
      }
    });
  });
}

/**
 * Detach debugger from tab (removes Chrome banner)
 */
export async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;

  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
      console.log('[CDP] Debugger detached from tab', tabId);
      resolve();
    });
  });
}

/**
 * Execute real mouse click at coordinates
 */
export async function cdpClick(tabId, x, y) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x, y,
    button: 'left',
    clickCount: 1
  });

  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x, y,
    button: 'left',
    clickCount: 1
  });

  console.log('[CDP] Click at', x, y);
}

/**
 * Type text using real keyboard events
 */
export async function cdpType(tabId, text) {
  for (const char of text) {
    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char
    });

    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      text: char
    });

    await sleep(10);
  }

  console.log('[CDP] Typed', text.length, 'characters');
}

/**
 * Press special key (Enter, Tab, Escape, etc.)
 */
export async function cdpPressKey(tabId, key) {
  const keyMap = {
    'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
    'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
    'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
    'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  };

  const keyInfo = keyMap[key] || { key, code: key, keyCode: 0 };

  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode
  });

  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode
  });

  console.log('[CDP] Pressed key:', key);
}

/**
 * Scroll page using mouse wheel
 */
export async function cdpScroll(tabId, deltaX, deltaY) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 400,
    y: 300,
    deltaX,
    deltaY
  });

  console.log('[CDP] Scrolled by', deltaX, deltaY);
}

/**
 * Take screenshot via CDP
 */
export async function cdpScreenshot(tabId) {
  const result = await sendCommand(tabId, 'Page.captureScreenshot', {
    format: 'png'
  });

  return result.data; // Base64 PNG
}

/**
 * Helper: Send CDP command
 */
function sendCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 3. Background.js Changes

```javascript
import { attachDebugger, detachDebugger } from './lib/cdp-executor.js';

// When task starts
async function startAgentTask(task, tabId) {
  // Attach debugger (triggers Chrome's native banner)
  await attachDebugger(tabId);
  // ... existing task logic
}

// When task ends (complete, error, or cancelled)
async function endAgentTask(tabId) {
  // Detach debugger (removes Chrome banner)
  await detachDebugger(tabId);
  // ... existing cleanup
}

// Listen for user canceling via Chrome's banner
chrome.debugger.onDetach.addListener((source, reason) => {
  if (reason === 'canceled_by_user') {
    console.log('[Background] User cancelled via Chrome banner');
    stopTask(source.tabId);
  }
});
```

### 4. Content.js: Add getElementRect Handler

```javascript
// Add to message listener
case 'getElementRect':
  const element = document.querySelector(`[data-ai-id="${message.targetId}"]`);
  if (element) {
    const rect = element.getBoundingClientRect();
    sendResponse({
      success: true,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    });
  } else {
    sendResponse({ success: false, error: 'Element not found' });
  }
  return true;
```

---

## Comparison: Before vs After

| Capability | Content Script (V1) | CDP (V2) |
|------------|---------------------|----------|
| Mouse clicks | Synthetic `dispatchEvent()` | Real pixel-coordinate clicks |
| Keyboard input | Synthetic `KeyboardEvent` | Real key presses |
| Shadow DOM | No access | Full access |
| Iframes | Same-origin only | Cross-origin supported |
| Detection | Sites can detect synthetic | Indistinguishable from user |
| Debugging banner | Custom injection | Native Chrome banner |

---

## Implementation Status: ✅ COMPLETE

All CDP integration features have been implemented:

- `extension/lib/cdp-executor.js` - Full CDP action executor
- `extension/background.js` - Debugger attach/detach lifecycle
- `extension/manifest.json` - `debugger` permission included

## Testing Checklist

- [x] Debugger attaches when task starts
- [x] Chrome shows native "Started debugging" banner
- [x] Click actions work via CDP
- [x] Type actions work via CDP
- [x] User can cancel via Chrome's Cancel button
- [x] Debugger detaches when task completes
- [x] Debugger detaches on error
