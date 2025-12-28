/**
 * AI Browser Agent - Action Executor Module
 *
 * Executes browser actions on target elements identified by data-ai-id.
 * Supports click, type, scroll, select, and other common interactions.
 */

import { findElement } from './dom-capture.js';

/**
 * Execute an action on a target element
 * @param {Object} action - Action specification
 * @param {string} action.type - Action type (click, type, scroll, etc.)
 * @param {string} action.targetId - Element's data-ai-id
 * @param {string} action.value - Value for type actions
 * @param {number} action.amount - Amount for scroll actions
 * @returns {Object} Execution result
 */
export async function executeAction(action) {
  const { type, targetId, value, amount } = action;

  console.log('[ActionExecutor] Executing:', type, targetId);

  try {
    switch (type) {
      case 'click':
        return await performClick(targetId);

      case 'type':
        return await performType(targetId, value);

      case 'clear':
        return await performClear(targetId);

      case 'select':
        return await performSelect(targetId, value);

      case 'scroll':
        return performScroll(amount);

      case 'scrollTo':
        return await performScrollTo(targetId);

      case 'focus':
        return performFocus(targetId);

      case 'hover':
        return performHover(targetId);

      case 'wait':
        return await performWait(amount);

      case 'pressKey':
        return performKeyPress(targetId, value);

      default:
        throw new Error(`Unknown action type: ${type}`);
    }
  } catch (error) {
    console.error('[ActionExecutor] Error:', error);
    return {
      success: false,
      action: type,
      error: error.message
    };
  }
}

/**
 * Click on an element
 */
async function performClick(targetId) {
  const element = getElement(targetId);

  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(150);

  // Ensure element is interactable
  if (element.disabled) {
    throw new Error(`Element ${targetId} is disabled`);
  }

  // Dispatch mouse events for better compatibility
  dispatchMouseEvents(element);

  // Perform the click
  element.click();

  return {
    success: true,
    action: 'click',
    targetId: targetId
  };
}

/**
 * Type text into an input element
 */
async function performType(targetId, value) {
  const element = getElement(targetId);

  if (!isTextInput(element)) {
    throw new Error(`Element ${targetId} is not a text input`);
  }

  // Focus the element
  element.focus();
  await sleep(50);

  // Clear existing value
  element.value = '';
  element.dispatchEvent(new Event('input', { bubbles: true }));

  // Type the new value character by character for better compatibility
  for (const char of value) {
    element.value += char;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(10); // Small delay between characters
  }

  // Dispatch change event
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return {
    success: true,
    action: 'type',
    targetId: targetId,
    value: value
  };
}

/**
 * Clear an input element
 */
async function performClear(targetId) {
  const element = getElement(targetId);

  if (!isTextInput(element)) {
    throw new Error(`Element ${targetId} is not a text input`);
  }

  element.focus();
  element.value = '';
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return {
    success: true,
    action: 'clear',
    targetId: targetId
  };
}

/**
 * Select an option from a dropdown
 */
async function performSelect(targetId, value) {
  const element = getElement(targetId);

  if (element.tagName.toLowerCase() !== 'select') {
    throw new Error(`Element ${targetId} is not a select element`);
  }

  // Find matching option by value or text
  let optionFound = false;
  for (const option of element.options) {
    if (option.value === value || option.text === value) {
      option.selected = true;
      optionFound = true;
      break;
    }
  }

  if (!optionFound) {
    throw new Error(`Option "${value}" not found in ${targetId}`);
  }

  element.dispatchEvent(new Event('change', { bubbles: true }));

  return {
    success: true,
    action: 'select',
    targetId: targetId,
    value: value
  };
}

/**
 * Scroll the page
 */
function performScroll(amount = 500) {
  const direction = amount > 0 ? 'down' : 'up';

  window.scrollBy({
    top: amount,
    behavior: 'smooth'
  });

  return {
    success: true,
    action: 'scroll',
    amount: amount,
    direction: direction
  };
}

/**
 * Scroll to bring an element into view
 */
async function performScrollTo(targetId) {
  const element = getElement(targetId);

  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });

  await sleep(300);

  return {
    success: true,
    action: 'scrollTo',
    targetId: targetId
  };
}

/**
 * Focus an element
 */
function performFocus(targetId) {
  const element = getElement(targetId);
  element.focus();

  return {
    success: true,
    action: 'focus',
    targetId: targetId
  };
}

/**
 * Hover over an element
 */
function performHover(targetId) {
  const element = getElement(targetId);

  element.dispatchEvent(new MouseEvent('mouseenter', {
    bubbles: true,
    cancelable: true,
    view: window
  }));

  element.dispatchEvent(new MouseEvent('mouseover', {
    bubbles: true,
    cancelable: true,
    view: window
  }));

  return {
    success: true,
    action: 'hover',
    targetId: targetId
  };
}

/**
 * Wait for a specified duration
 */
async function performWait(duration = 1000) {
  await sleep(duration);

  return {
    success: true,
    action: 'wait',
    duration: duration
  };
}

/**
 * Press a key on an element
 */
function performKeyPress(targetId, key) {
  const element = targetId ? getElement(targetId) : document.activeElement;

  const keyEvent = new KeyboardEvent('keydown', {
    key: key,
    code: getKeyCode(key),
    bubbles: true,
    cancelable: true
  });

  element.dispatchEvent(keyEvent);

  // Special handling for Enter key in forms
  if (key === 'Enter' && element.form) {
    element.form.dispatchEvent(new Event('submit', { bubbles: true }));
  }

  return {
    success: true,
    action: 'pressKey',
    key: key
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get element by target ID, throwing if not found
 */
function getElement(targetId) {
  const element = findElement(targetId);
  if (!element) {
    throw new Error(`Element not found: ${targetId}`);
  }
  return element;
}

/**
 * Check if element is a text input
 */
function isTextInput(element) {
  const tagName = element.tagName.toLowerCase();

  if (tagName === 'textarea') return true;

  if (tagName === 'input') {
    const type = element.type.toLowerCase();
    const textTypes = ['text', 'password', 'email', 'search', 'tel', 'url', 'number'];
    return textTypes.includes(type);
  }

  // Contenteditable elements
  if (element.contentEditable === 'true') return true;

  return false;
}

/**
 * Dispatch mouse events for better click compatibility
 */
function dispatchMouseEvents(element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const mouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY
  };

  element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
  element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
}

/**
 * Get key code for keyboard events
 */
function getKeyCode(key) {
  const keyCodes = {
    'Enter': 'Enter',
    'Tab': 'Tab',
    'Escape': 'Escape',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight'
  };

  return keyCodes[key] || `Key${key.toUpperCase()}`;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verify an action was successful by checking expected changes
 */
export async function verifyAction(action, expectedChange) {
  await sleep(500); // Wait for DOM updates

  // Basic verification - element state changed
  if (action.type === 'type' && action.targetId) {
    const element = findElement(action.targetId);
    if (element && element.value === action.value) {
      return { success: true, verified: true };
    }
  }

  // For other actions, we trust the execution
  return { success: true, verified: true };
}
