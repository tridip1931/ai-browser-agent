/**
 * AI Browser Agent - Content Script (content.js)
 *
 * Responsibilities:
 * - DOM state capture (interactive elements only)
 * - Element annotation with data-ai-id attributes
 * - Action execution (click, type, scroll)
 * - Page mutation observation
 *
 * Runs in the context of every web page.
 */

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Content] Received message:', message.action);

  handleMessage(message)
    .then(sendResponse)
    .catch(error => {
      console.error('[Content] Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    });

  // CRITICAL: Must return true for async sendResponse
  return true;
});

/**
 * Route messages to appropriate handlers
 */
async function handleMessage(message) {
  switch (message.action) {
    case 'ping':
      return { success: true, status: 'ok', from: 'content' };

    case 'captureDOM':
      return await captureDOM();

    case 'executeAction':
      return await executeAction(message);

    case 'clearAnnotations':
      return clearAnnotations();

    default:
      console.warn('[Content] Unknown action:', message.action);
      return { success: false, error: `Unknown action: ${message.action}` };
  }
}

// ============================================================================
// DOM Capture
// ============================================================================

/**
 * Capture all interactive elements on the page
 * Assigns unique data-ai-id attributes for LLM targeting
 * Scrolls to bottom first to trigger lazy-loading of content
 */
async function captureDOM() {
  // First, scroll to bottom to trigger lazy-loading of all content
  await scrollToLoadAllContent();

  const elements = [];

  // Selectors for interactive elements
  const selectors = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  let index = 0;

  document.querySelectorAll(selectors).forEach((el) => {
    // Skip hidden elements
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Check if element is in viewport (for context, but don't skip off-screen)
    const inViewport = (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );

    // Skip invisible elements
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return;

    // Assign unique ID for AI targeting
    const elementId = `ai-target-${index}`;
    el.setAttribute('data-ai-id', elementId);

    // Extract element information WITH semantic context
    elements.push({
      id: elementId,
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      text: getElementText(el),
      placeholder: el.placeholder || '',
      href: el.href || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      role: el.getAttribute('role') || '',
      name: el.name || '',
      value: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : '',
      disabled: el.disabled || false,
      inViewport: inViewport,
      context: getSemanticContext(el),  // NEW: Add semantic context
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    });

    index++;
  });

  // Log capture summary
  const linksCount = elements.filter(e => e.tag === 'a').length;
  const buttonsCount = elements.filter(e => e.tag === 'button').length;
  const inputsCount = elements.filter(e => e.tag === 'input' || e.tag === 'textarea').length;
  const withContext = elements.filter(e => e.context !== null).length;

  console.log('[Content] === DOM Capture Complete ===');
  console.log('[Content] Total elements:', elements.length);
  console.log('[Content] Breakdown:', { links: linksCount, buttons: buttonsCount, inputs: inputsCount });
  console.log('[Content] With semantic context:', withContext, `(${Math.round(withContext/elements.length*100)}%)`);

  // Log first few article-like links for debugging
  const articleLinks = elements.filter(e =>
    e.tag === 'a' &&
    e.text &&
    e.text.length > 10 &&
    !['home', 'library', 'coaching', 'freebies'].includes(e.text.toLowerCase())
  );
  if (articleLinks.length > 0) {
    console.log('[Content] Article links found:', articleLinks.length);
    articleLinks.slice(0, 5).forEach(el => {
      console.log(`  - [${el.id}] "${el.text.substring(0, 40)}..." context:`, el.context ? 'yes' : 'no');
    });
  }

  return {
    success: true,
    elements: elements,
    pageInfo: {
      url: window.location.href,
      title: document.title,
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight
    }
  };
}

/**
 * Get semantic context for an element (parent headings, nearby text)
 * This helps the LLM understand what an element relates to semantically
 */
function getSemanticContext(el) {
  const context = {};

  // 1. Find closest heading (h1-h6)
  const closestHeading = findClosestHeading(el);
  if (closestHeading) {
    context.heading = closestHeading.textContent.trim().substring(0, 100);
  }

  // 2. Find parent section/article title
  const section = el.closest('article, section, [role="article"], .card, .post, .item, .entry, .blog-post, [class*="article"], [class*="post"], [class*="card"], [class*="item"]');
  if (section) {
    const sectionTitle = section.querySelector('h1, h2, h3, h4, .title, .heading, .post-title, .entry-title, [class*="title"]');
    if (sectionTitle && sectionTitle !== closestHeading) {
      context.sectionTitle = sectionTitle.textContent.trim().substring(0, 100);
    }
  }

  // 3. Get parent list item text for navigation
  const listItem = el.closest('li, [role="listitem"]');
  if (listItem) {
    const fullText = listItem.textContent.trim().substring(0, 150);
    if (fullText && fullText !== context.heading) {
      context.listItemText = fullText;
    }
  }

  // 4. Get nearby paragraph context (for "Read More" links)
  const nearbyP = el.closest('p') || el.previousElementSibling;
  if (nearbyP?.tagName === 'P') {
    const pText = nearbyP.textContent.trim();
    if (pText && pText.length > 10) {
      context.nearbyText = pText.substring(0, 150);
    }
  }

  // 5. Check parent figure/card for caption or description
  const figure = el.closest('figure, .card, .thumbnail, [class*="card"], [class*="thumb"]');
  if (figure) {
    const caption = figure.querySelector('figcaption, .caption, .description, [class*="caption"], [class*="desc"]');
    if (caption) {
      context.caption = caption.textContent.trim().substring(0, 100);
    }
  }

  // 6. If no context found, get text from parent container
  if (Object.keys(context).length === 0) {
    const parentContext = getParentContainerText(el);
    if (parentContext) {
      context.containerText = parentContext;
    }
  }

  return Object.keys(context).length > 0 ? context : null;
}

/**
 * Find the closest preceding heading for semantic context
 */
function findClosestHeading(el) {
  let current = el;
  let maxDepth = 10;

  while (current && maxDepth-- > 0) {
    let sibling = current.previousElementSibling;
    let siblingCheck = 5;

    while (sibling && siblingCheck-- > 0) {
      if (/^H[1-6]$/.test(sibling.tagName)) {
        return sibling;
      }
      const heading = sibling.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading) {
        return heading;
      }
      sibling = sibling.previousElementSibling;
    }

    current = current.parentElement;
    if (current && /^H[1-6]$/.test(current.tagName)) {
      return current;
    }

    if (current) {
      const parentHeading = current.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
      if (parentHeading) {
        return parentHeading;
      }
    }
  }

  return null;
}

/**
 * Get text from parent container as fallback context
 */
function getParentContainerText(el) {
  let current = el.parentElement;
  let depth = 0;
  const maxDepth = 5;

  while (current && depth < maxDepth) {
    if (current.tagName === 'BODY' || current.tagName === 'HTML') break;

    const textNodes = [];
    for (const node of current.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) textNodes.push(text);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (!['a', 'button', 'input', 'select', 'textarea'].includes(tag)) {
          const childText = node.textContent?.trim();
          if (childText && childText.length > 5 && childText.length < 200) {
            textNodes.push(childText);
          }
        }
      }
    }

    const combinedText = textNodes.join(' ').trim();
    if (combinedText.length > 20 && combinedText.length < 300) {
      return combinedText.substring(0, 150);
    }

    current = current.parentElement;
    depth++;
  }

  return null;
}

/**
 * Extract readable text from an element (limited to 100 chars)
 */
function getElementText(el) {
  // Priority: aria-label > innerText > value > title
  const text = el.getAttribute('aria-label') ||
    el.innerText ||
    el.value ||
    el.title ||
    '';

  // Clean and truncate
  return text.trim().replace(/\s+/g, ' ').substring(0, 100);
}

/**
 * Clear all data-ai-id annotations
 */
function clearAnnotations() {
  document.querySelectorAll('[data-ai-id]').forEach(el => {
    el.removeAttribute('data-ai-id');
  });

  console.log('[Content] Cleared all AI annotations');
  return { success: true };
}

// ============================================================================
// Action Execution
// ============================================================================

/**
 * Execute an action on a target element
 */
async function executeAction(message) {
  const { type, targetId, value, amount } = message;

  console.log('[Content] Executing action:', type, 'on', targetId);

  // Find element by data-ai-id
  const element = document.querySelector(`[data-ai-id="${targetId}"]`);

  if (!element) {
    throw new Error(`Element not found: ${targetId}`);
  }

  switch (type) {
    case 'click':
      return await performClick(element);

    case 'type':
      return await performType(element, value);

    case 'scroll':
      return performScroll(amount);

    case 'focus':
      element.focus();
      return { success: true, action: 'focus' };

    case 'hover':
      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return { success: true, action: 'hover' };

    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

/**
 * Perform a click action
 */
async function performClick(element) {
  // Scroll element into view if needed
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Small delay to allow scroll to complete
  await sleep(100);

  // Dispatch click event
  element.click();

  return { success: true, action: 'click' };
}

/**
 * Perform a type action (fill input field)
 */
async function performType(element, value) {
  // Focus the element
  element.focus();

  // Clear existing value
  element.value = '';

  // Type the new value
  element.value = value;

  // Dispatch input events for React/Vue compatibility
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return { success: true, action: 'type', value };
}

/**
 * Perform a scroll action
 */
function performScroll(amount = 500) {
  window.scrollBy({
    top: amount,
    behavior: 'smooth'
  });

  return { success: true, action: 'scroll', amount };
}

// ============================================================================
// Scroll to Load All Content - Step by Step with Timeouts
// ============================================================================

/**
 * Methodically scroll through the entire page to:
 * 1. Trigger lazy-loading of all content
 * 2. Capture elements at each scroll position
 * 3. Maintain context across scroll iterations
 *
 * Each atomic action has a proper timeout for reliability.
 */
async function scrollToLoadAllContent() {
  const originalScrollY = window.scrollY;
  const scrollStep = Math.floor(window.innerHeight * 0.8); // 80% viewport for overlap
  const maxScrolls = 30; // Safety limit
  const scrollTimeout = 300; // Time to wait after each scroll
  const loadTimeout = 500; // Time to wait for lazy content to load

  let scrollCount = 0;
  let lastDocHeight = document.documentElement.scrollHeight;
  let lastElementCount = document.querySelectorAll('a, button, input').length;
  let stableCount = 0; // Track how many times element count hasn't changed

  console.log('[Content] === Starting methodical scroll-to-load ===');
  console.log('[Content] Initial state:', {
    documentHeight: lastDocHeight,
    elementCount: lastElementCount,
    viewportHeight: window.innerHeight
  });

  // Step 1: Scroll to top first to ensure consistent starting point
  window.scrollTo({ top: 0, behavior: 'instant' });
  await sleep(scrollTimeout);
  console.log('[Content] Step 1: Scrolled to top');

  // Step 2: Scroll down incrementally
  while (scrollCount < maxScrolls) {
    scrollCount++;

    // Action: Scroll down one step
    const targetScrollY = Math.min(
      window.scrollY + scrollStep,
      document.documentElement.scrollHeight - window.innerHeight
    );

    window.scrollTo({ top: targetScrollY, behavior: 'instant' });

    // Timeout: Wait for scroll to complete
    await sleep(scrollTimeout);

    // Action: Check for new content loaded
    const currentDocHeight = document.documentElement.scrollHeight;
    const currentElementCount = document.querySelectorAll('a, button, input').length;

    console.log(`[Content] Scroll ${scrollCount}: position=${Math.round(window.scrollY)}, ` +
      `height=${currentDocHeight}, elements=${currentElementCount}`);

    // Check if document height increased (new lazy content loaded)
    if (currentDocHeight > lastDocHeight) {
      console.log('[Content] New content detected! Height increased by', currentDocHeight - lastDocHeight);
      lastDocHeight = currentDocHeight;
      stableCount = 0;

      // Extra timeout for lazy content to fully render
      await sleep(loadTimeout);
    }

    // Check if element count increased
    if (currentElementCount > lastElementCount) {
      console.log('[Content] New elements detected!', currentElementCount - lastElementCount, 'new elements');
      lastElementCount = currentElementCount;
      stableCount = 0;
    } else {
      stableCount++;
    }

    // Check if we've reached the bottom
    const atBottom = window.scrollY >= (document.documentElement.scrollHeight - window.innerHeight - 10);

    if (atBottom) {
      console.log('[Content] Reached bottom of page');

      // Wait longer at bottom for any final lazy content
      await sleep(loadTimeout);

      // Check one more time for new content
      const finalHeight = document.documentElement.scrollHeight;
      const finalElements = document.querySelectorAll('a, button, input').length;

      if (finalHeight === lastDocHeight && finalElements === lastElementCount) {
        console.log('[Content] No new content at bottom, scroll complete');
        break;
      } else {
        console.log('[Content] More content loaded at bottom, continuing...');
        lastDocHeight = finalHeight;
        lastElementCount = finalElements;
      }
    }

    // Safety: If content hasn't changed for 3 scrolls, assume we're done
    if (stableCount >= 3 && atBottom) {
      console.log('[Content] Content stable for 3 scrolls, finishing');
      break;
    }
  }

  // Step 3: Final stats
  console.log('[Content] === Scroll complete ===');
  console.log('[Content] Final state:', {
    scrollCount,
    finalHeight: document.documentElement.scrollHeight,
    finalElements: document.querySelectorAll('a, button, input').length
  });

  // Step 4: Scroll back to original position
  window.scrollTo({ top: originalScrollY, behavior: 'instant' });
  await sleep(scrollTimeout);
  console.log('[Content] Returned to original scroll position:', originalScrollY);
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Initialization
// ============================================================================

console.log('[Content] AI Browser Agent content script loaded on:', window.location.href);
