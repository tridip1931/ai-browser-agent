/**
 * AI Browser Agent - DOM Capture Module
 *
 * Captures interactive elements from the page and assigns
 * unique data-ai-id attributes for LLM targeting.
 */

// Selectors for interactive elements
const INTERACTIVE_SELECTORS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="combobox"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
  'summary',
  'details',
  'label[for]'
].join(', ');

/**
 * Capture all interactive elements on the page
 * @param {Object} options - Capture options
 * @param {boolean} options.includeOffscreen - Include elements outside viewport
 * @param {number} options.maxElements - Maximum number of elements to capture
 * @returns {Object} Capture result with elements array
 */
export function captureInteractiveElements(options = {}) {
  const {
    includeOffscreen = false,
    maxElements = 500
  } = options;

  const elements = [];
  let index = 0;

  // Clear previous annotations
  clearAnnotations();

  document.querySelectorAll(INTERACTIVE_SELECTORS).forEach((el) => {
    if (index >= maxElements) return;

    // Skip hidden elements
    if (!isVisible(el)) return;

    // Skip elements outside viewport unless requested
    const rect = el.getBoundingClientRect();
    const inViewport = isInViewport(rect);

    if (!includeOffscreen && !inViewport) return;

    // Assign unique ID for AI targeting
    const elementId = `ai-target-${index}`;
    el.setAttribute('data-ai-id', elementId);

    // Extract element information
    elements.push(extractElementInfo(el, elementId, rect, inViewport));
    index++;
  });

  return {
    success: true,
    elements: elements,
    count: elements.length,
    pageInfo: getPageInfo()
  };
}

/**
 * Check if an element is visible
 */
function isVisible(el) {
  // Check bounding rect
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  // Check computed style
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden') return false;
  if (style.display === 'none') return false;
  if (parseFloat(style.opacity) === 0) return false;

  return true;
}

/**
 * Check if element is in viewport
 */
function isInViewport(rect) {
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

/**
 * Extract relevant information from an element
 */
function extractElementInfo(el, elementId, rect, inViewport) {
  const tagName = el.tagName.toLowerCase();

  return {
    id: elementId,
    tag: tagName,
    type: el.type || '',
    text: getElementText(el),
    placeholder: el.placeholder || '',
    href: el.href || '',
    ariaLabel: el.getAttribute('aria-label') || '',
    role: el.getAttribute('role') || getImplicitRole(el),
    name: el.name || '',
    value: getElementValue(el),
    disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
    required: el.required || el.getAttribute('aria-required') === 'true',
    checked: el.checked,
    selected: el.selected,
    inViewport: inViewport,
    context: getSemanticContext(el),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}

/**
 * Get semantic context for an element (parent headings, nearby text)
 * This helps the LLM understand what an element relates to semantically
 */
function getSemanticContext(el) {
  const context = {};

  // 1. Find closest heading (h1-h6) - walk up and look for headings
  const closestHeading = findClosestHeading(el);
  if (closestHeading) {
    context.heading = closestHeading.textContent.trim().substring(0, 100);
  }

  // 2. Find parent section/article title - expanded selectors
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

  // 6. NEW: If no context found, get text from parent container
  // This is a fallback for pages without semantic HTML structure
  if (Object.keys(context).length === 0) {
    const parentContext = getParentContainerText(el);
    if (parentContext) {
      context.containerText = parentContext;
    }
  }

  return Object.keys(context).length > 0 ? context : null;
}

/**
 * Get text from parent container as fallback context
 * Walks up the DOM to find a container with meaningful text
 */
function getParentContainerText(el) {
  let current = el.parentElement;
  let depth = 0;
  const maxDepth = 5;

  while (current && depth < maxDepth) {
    // Skip body and html
    if (current.tagName === 'BODY' || current.tagName === 'HTML') break;

    // Get direct text content (not from children that are links/buttons)
    const textNodes = [];
    for (const node of current.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) textNodes.push(text);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Include text from non-interactive elements
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
 * Find the closest preceding heading for semantic context
 */
function findClosestHeading(el) {
  let current = el;
  let maxDepth = 10; // Prevent infinite loops

  while (current && maxDepth-- > 0) {
    // Check previous siblings for headings
    let sibling = current.previousElementSibling;
    let siblingCheck = 5; // Limit sibling traversal

    while (sibling && siblingCheck-- > 0) {
      if (/^H[1-6]$/.test(sibling.tagName)) {
        return sibling;
      }
      // Check inside sibling for headings (e.g., heading in a div)
      const heading = sibling.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading) {
        return heading;
      }
      sibling = sibling.previousElementSibling;
    }

    // Move up to parent
    current = current.parentElement;

    // Check if parent itself is a heading
    if (current && /^H[1-6]$/.test(current.tagName)) {
      return current;
    }

    // Check parent's children for headings (common pattern: heading + content in container)
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
 * Get implicit ARIA role for an element
 */
function getImplicitRole(el) {
  const tagName = el.tagName.toLowerCase();
  const type = el.type?.toLowerCase();

  const roleMap = {
    'a': el.href ? 'link' : '',
    'button': 'button',
    'input': {
      'button': 'button',
      'submit': 'button',
      'reset': 'button',
      'checkbox': 'checkbox',
      'radio': 'radio',
      'text': 'textbox',
      'email': 'textbox',
      'password': 'textbox',
      'search': 'searchbox',
      'tel': 'textbox',
      'url': 'textbox',
      'number': 'spinbutton',
      'range': 'slider'
    },
    'textarea': 'textbox',
    'select': 'combobox',
    'img': el.alt ? 'img' : 'presentation',
    'nav': 'navigation',
    'main': 'main',
    'header': 'banner',
    'footer': 'contentinfo',
    'aside': 'complementary'
  };

  if (tagName === 'input' && type) {
    return roleMap.input?.[type] || '';
  }

  return roleMap[tagName] || '';
}

/**
 * Extract readable text from an element (limited length)
 */
function getElementText(el) {
  // Priority order for text extraction
  const sources = [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.innerText?.trim(),
    el.value,
    el.placeholder,
    el.alt
  ];

  for (const source of sources) {
    if (source && source.trim()) {
      // Clean and truncate
      return source.trim().replace(/\s+/g, ' ').substring(0, 100);
    }
  }

  return '';
}

/**
 * Get the value of form elements
 */
function getElementValue(el) {
  const tagName = el.tagName.toLowerCase();

  if (tagName === 'select') {
    const selected = el.options[el.selectedIndex];
    return selected?.text || '';
  }

  if (tagName === 'input' || tagName === 'textarea') {
    // Don't expose password values
    if (el.type === 'password') return '***';
    return el.value || '';
  }

  return '';
}

/**
 * Get page-level information
 */
function getPageInfo() {
  return {
    url: window.location.href,
    title: document.title,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    language: document.documentElement.lang || 'en'
  };
}

/**
 * Clear all data-ai-id annotations from the page
 */
export function clearAnnotations() {
  document.querySelectorAll('[data-ai-id]').forEach(el => {
    el.removeAttribute('data-ai-id');
  });
}

/**
 * Find element by its AI target ID
 */
export function findElement(targetId) {
  return document.querySelector(`[data-ai-id="${targetId}"]`);
}

/**
 * Get element information by its AI target ID
 */
export function getElementById(targetId) {
  const el = findElement(targetId);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  return extractElementInfo(el, targetId, rect, isInViewport(rect));
}
