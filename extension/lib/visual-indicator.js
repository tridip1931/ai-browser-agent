/**
 * AI Browser Agent - Visual Indicator Module
 *
 * Provides visual feedback when the AI agent is actively controlling
 * the browser. Following Claude's orange border pattern for clear
 * user awareness of AI activity.
 */

// CSS for the AI active indicator
const AI_ACTIVE_CSS = `
  /* Orange border overlay when AI is controlling */
  body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border: 3px solid #f97316;
    pointer-events: none;
    z-index: 2147483647;
    box-sizing: border-box;
  }

  /* AI status badge in corner */
  body::after {
    content: '🤖 AI Active';
    position: fixed;
    top: 8px;
    right: 8px;
    background: #f97316;
    color: white;
    padding: 6px 12px;
    border-radius: 16px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 12px;
    font-weight: 600;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(249, 115, 22, 0.4);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }
`;

// CSS ID for the injected style
const INDICATOR_STYLE_ID = 'ai-browser-agent-indicator';

/**
 * Show the AI active indicator on a tab
 * @param {number} tabId - The tab ID to show indicator on
 */
export async function showActiveIndicator(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: AI_ACTIVE_CSS
    });
    console.log('[VisualIndicator] Shown on tab:', tabId);
  } catch (error) {
    console.error('[VisualIndicator] Failed to show:', error);
    // Non-critical, don't throw
  }
}

/**
 * Hide the AI active indicator from a tab
 * @param {number} tabId - The tab ID to hide indicator from
 */
export async function hideActiveIndicator(tabId) {
  try {
    await chrome.scripting.removeCSS({
      target: { tabId },
      css: AI_ACTIVE_CSS
    });
    console.log('[VisualIndicator] Hidden on tab:', tabId);
  } catch (error) {
    console.error('[VisualIndicator] Failed to hide:', error);
    // Non-critical, don't throw
  }
}

/**
 * Highlight a specific element during action execution
 * @param {number} tabId - The tab ID
 * @param {string} targetId - The data-ai-id of the element
 */
export async function highlightElement(tabId, targetId) {
  const highlightCSS = `
    [data-ai-id="${targetId}"] {
      outline: 3px solid #f97316 !important;
      outline-offset: 2px !important;
      animation: ai-highlight 0.5s ease-in-out !important;
    }

    @keyframes ai-highlight {
      0% { outline-color: transparent; }
      50% { outline-color: #f97316; }
      100% { outline-color: #f97316; }
    }
  `;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: highlightCSS
    });

    // Remove highlight after animation
    setTimeout(async () => {
      try {
        await chrome.scripting.removeCSS({
          target: { tabId },
          css: highlightCSS
        });
      } catch {
        // Tab may have navigated
      }
    }, 1000);

    console.log('[VisualIndicator] Highlighted element:', targetId);
  } catch (error) {
    console.error('[VisualIndicator] Failed to highlight:', error);
  }
}

/**
 * Show a status message on the page
 * @param {number} tabId - The tab ID
 * @param {string} message - Message to display
 * @param {string} type - Message type: 'info' | 'success' | 'error'
 */
export async function showStatusMessage(tabId, message, type = 'info') {
  const colors = {
    info: '#3b82f6',
    success: '#22c55e',
    error: '#ef4444'
  };

  const color = colors[type] || colors.info;

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, bgColor) => {
      // Remove existing message
      const existing = document.getElementById('ai-agent-status');
      if (existing) existing.remove();

      // Create new message
      const div = document.createElement('div');
      div.id = 'ai-agent-status';
      div.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${bgColor};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        font-weight: 500;
        z-index: 2147483647;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        animation: slideUp 0.3s ease-out;
      `;
      div.textContent = msg;

      // Add animation style
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(div);

      // Auto-remove after 3 seconds
      setTimeout(() => {
        div.style.animation = 'slideUp 0.3s ease-out reverse';
        setTimeout(() => div.remove(), 300);
      }, 3000);
    },
    args: [message, color]
  });
}

/**
 * Flash the border briefly to indicate an action
 * @param {number} tabId - The tab ID
 */
export async function flashBorder(tabId) {
  const flashCSS = `
    body::before {
      animation: borderFlash 0.3s ease-in-out !important;
    }

    @keyframes borderFlash {
      0% { border-color: #f97316; }
      50% { border-color: #fbbf24; }
      100% { border-color: #f97316; }
    }
  `;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: flashCSS
    });

    setTimeout(async () => {
      try {
        await chrome.scripting.removeCSS({
          target: { tabId },
          css: flashCSS
        });
      } catch {
        // Tab may have navigated
      }
    }, 300);
  } catch (error) {
    console.error('[VisualIndicator] Failed to flash:', error);
  }
}
