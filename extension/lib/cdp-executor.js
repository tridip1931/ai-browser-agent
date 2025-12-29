/**
 * CDP (Chrome DevTools Protocol) action executor
 * Uses chrome.debugger API for real input events
 *
 * Benefits over content script synthetic events:
 * - Real pixel-coordinate mouse clicks
 * - Real keyboard events
 * - Shadow DOM access
 * - Cross-origin iframe support
 * - Native Chrome "debugging" banner
 */

// Track which tabs have debugger attached
const attachedTabs = new Map(); // tabId -> { attached: boolean, timestamp: number }

/**
 * Attach debugger to tab (triggers native Chrome banner)
 * @param {number} tabId - Tab ID to attach to
 * @returns {Promise<void>}
 */
export async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId) && attachedTabs.get(tabId).attached) {
    console.log('[CDP] Debugger already attached to tab', tabId);
    return;
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        console.error('[CDP] Failed to attach:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        attachedTabs.set(tabId, { attached: true, timestamp: Date.now() });
        console.log('[CDP] Debugger attached to tab', tabId);
        resolve();
      }
    });
  });
}

/**
 * Detach debugger from tab (removes Chrome banner)
 * @param {number} tabId - Tab ID to detach from
 * @returns {Promise<void>}
 */
export async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId) || !attachedTabs.get(tabId).attached) {
    console.log('[CDP] Debugger not attached to tab', tabId);
    return;
  }

  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[CDP] Detach warning:', chrome.runtime.lastError.message);
      }
      attachedTabs.delete(tabId);
      console.log('[CDP] Debugger detached from tab', tabId);
      resolve();
    });
  });
}

/**
 * Check if debugger is attached to tab
 * @param {number} tabId - Tab ID to check
 * @returns {boolean}
 */
export function isDebuggerAttached(tabId) {
  return attachedTabs.has(tabId) && attachedTabs.get(tabId).attached;
}

/**
 * Execute real mouse click at coordinates
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<void>}
 */
export async function cdpClick(tabId, x, y) {
  // Move mouse to position first
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y
  });

  // Small delay for natural feel
  await sleep(50);

  // Mouse down
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  });

  // Small delay between press and release
  await sleep(50);

  // Mouse up
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  });

  console.log('[CDP] Click at', x, y);
}

/**
 * Execute double click at coordinates
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<void>}
 */
export async function cdpDoubleClick(tabId, x, y) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 2
  });

  await sleep(50);

  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 2
  });

  console.log('[CDP] Double click at', x, y);
}

/**
 * Type text using real keyboard events
 * @param {number} tabId - Tab ID
 * @param {string} text - Text to type
 * @returns {Promise<void>}
 */
export async function cdpType(tabId, text) {
  for (const char of text) {
    // For regular characters, use insertText which handles unicode properly
    await sendCommand(tabId, 'Input.insertText', {
      text: char
    });

    // Small delay between characters for natural typing
    await sleep(15);
  }

  console.log('[CDP] Typed', text.length, 'characters');
}

/**
 * Clear input field and type new text
 * @param {number} tabId - Tab ID
 * @param {string} text - Text to type
 * @returns {Promise<void>}
 */
export async function cdpClearAndType(tabId, text) {
  // Select all
  await cdpPressKey(tabId, 'a', ['Control']);
  await sleep(50);

  // Delete selected
  await cdpPressKey(tabId, 'Backspace');
  await sleep(50);

  // Type new text
  await cdpType(tabId, text);
}

/**
 * Press special key (Enter, Tab, Escape, etc.)
 * @param {number} tabId - Tab ID
 * @param {string} key - Key name (Enter, Tab, Escape, Backspace, ArrowDown, etc.)
 * @param {string[]} modifiers - Optional modifier keys (Control, Shift, Alt, Meta)
 * @returns {Promise<void>}
 */
export async function cdpPressKey(tabId, key, modifiers = []) {
  const keyMap = {
    'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
    'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
    'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
    'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    'Home': { key: 'Home', code: 'Home', keyCode: 36 },
    'End': { key: 'End', code: 'End', keyCode: 35 },
    'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    'Space': { key: ' ', code: 'Space', keyCode: 32 },
    'a': { key: 'a', code: 'KeyA', keyCode: 65 },
    'c': { key: 'c', code: 'KeyC', keyCode: 67 },
    'v': { key: 'v', code: 'KeyV', keyCode: 86 },
    'x': { key: 'x', code: 'KeyX', keyCode: 88 },
    'z': { key: 'z', code: 'KeyZ', keyCode: 90 },
  };

  const keyInfo = keyMap[key] || { key, code: key, keyCode: 0 };

  // Build modifier flags
  let modifierFlags = 0;
  if (modifiers.includes('Alt')) modifierFlags |= 1;
  if (modifiers.includes('Control')) modifierFlags |= 2;
  if (modifiers.includes('Meta')) modifierFlags |= 4;
  if (modifiers.includes('Shift')) modifierFlags |= 8;

  // Key down
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode,
    modifiers: modifierFlags
  });

  // Key up
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode,
    modifiers: modifierFlags
  });

  console.log('[CDP] Pressed key:', key, modifiers.length ? `with ${modifiers.join('+')}` : '');
}

/**
 * Scroll page using mouse wheel
 * @param {number} tabId - Tab ID
 * @param {number} deltaX - Horizontal scroll amount (positive = right)
 * @param {number} deltaY - Vertical scroll amount (positive = down)
 * @param {number} x - X coordinate for scroll (default: center)
 * @param {number} y - Y coordinate for scroll (default: center)
 * @returns {Promise<void>}
 */
export async function cdpScroll(tabId, deltaX, deltaY, x = 400, y = 300) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY
  });

  console.log('[CDP] Scrolled by', deltaX, deltaY);
}

/**
 * Scroll down by pixels
 * @param {number} tabId - Tab ID
 * @param {number} amount - Pixels to scroll (default: 500)
 * @returns {Promise<void>}
 */
export async function cdpScrollDown(tabId, amount = 500) {
  await cdpScroll(tabId, 0, amount);
}

/**
 * Scroll up by pixels
 * @param {number} tabId - Tab ID
 * @param {number} amount - Pixels to scroll (default: 500)
 * @returns {Promise<void>}
 */
export async function cdpScrollUp(tabId, amount = 500) {
  await cdpScroll(tabId, 0, -amount);
}

/**
 * Take screenshot of the page
 * @param {number} tabId - Tab ID
 * @param {Object} options - Screenshot options
 * @returns {Promise<string>} Base64 encoded PNG
 */
export async function cdpScreenshot(tabId, options = {}) {
  const result = await sendCommand(tabId, 'Page.captureScreenshot', {
    format: options.format || 'png',
    quality: options.quality || 80,
    fromSurface: true,
    ...options
  });

  console.log('[CDP] Screenshot captured');
  return result.data; // Base64 PNG
}

/**
 * Hover over coordinates
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<void>}
 */
export async function cdpHover(tabId, x, y) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y
  });

  console.log('[CDP] Hover at', x, y);
}

/**
 * Focus an element (requires coordinates)
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<void>}
 */
export async function cdpFocus(tabId, x, y) {
  // Click to focus
  await cdpClick(tabId, x, y);
}

/**
 * Navigate to URL
 * @param {number} tabId - Tab ID
 * @param {string} url - URL to navigate to
 * @returns {Promise<void>}
 */
export async function cdpNavigate(tabId, url) {
  await sendCommand(tabId, 'Page.navigate', { url });
  console.log('[CDP] Navigating to', url);
}

/**
 * Wait for navigation to complete
 * @param {number} tabId - Tab ID
 * @param {number} timeout - Timeout in ms (default: 30000)
 * @returns {Promise<void>}
 */
export async function cdpWaitForNavigation(tabId, timeout = 30000) {
  // Enable page events if not already
  await sendCommand(tabId, 'Page.enable');

  // This is a simplified wait - in production you'd listen for loadEventFired
  await sleep(1000);
  console.log('[CDP] Waited for navigation');
}

/**
 * Send a CDP command
 * @param {number} tabId - Tab ID
 * @param {string} method - CDP method name
 * @param {Object} params - Method parameters
 * @returns {Promise<any>}
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

/**
 * Sleep helper
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Setup debugger detach listener (call once in background.js)
 * @param {Function} onUserCancel - Callback when user cancels via Chrome banner
 */
export function setupDebuggerDetachListener(onUserCancel) {
  chrome.debugger.onDetach.addListener((source, reason) => {
    const { tabId } = source;

    // Clean up our tracking
    if (attachedTabs.has(tabId)) {
      attachedTabs.delete(tabId);
    }

    console.log('[CDP] Debugger detached from tab', tabId, 'reason:', reason);

    if (reason === 'canceled_by_user') {
      console.log('[CDP] User cancelled via Chrome banner');
      if (onUserCancel) {
        onUserCancel(tabId);
      }
    }
  });
}

// Export for use in background.js
export default {
  attachDebugger,
  detachDebugger,
  isDebuggerAttached,
  cdpClick,
  cdpDoubleClick,
  cdpType,
  cdpClearAndType,
  cdpPressKey,
  cdpScroll,
  cdpScrollDown,
  cdpScrollUp,
  cdpScreenshot,
  cdpHover,
  cdpFocus,
  cdpNavigate,
  cdpWaitForNavigation,
  setupDebuggerDetachListener
};
