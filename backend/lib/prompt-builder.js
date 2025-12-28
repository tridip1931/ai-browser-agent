/**
 * AI Browser Agent - Prompt Builder
 *
 * Constructs prompts for the agent reasoning loop and
 * parses structured responses from the LLM.
 */

/**
 * Build the agent prompt from page state and task
 * @param {Object} params - Prompt parameters
 * @returns {string} Formatted prompt
 */
export function buildAgentPrompt(params) {
  const {
    task,
    currentUrl,
    elements,
    screenshot,
    actionHistory = [],
    taskType = 'multi-step',
    availableActions = ['click', 'type', 'scroll', 'wait', 'done']
  } = params;

  // Simplify elements for token efficiency
  // Note: Include ALL elements (not just viewport) since scroll-to-load captures everything
  const simplifiedElements = elements
    .slice(0, 100) // Limit to 100 elements for token budget
    .map(el => formatElement(el));

  const prompt = `You are an AI browser automation agent. Your task is to interact with web pages to accomplish user goals.

## Current Task
${task}

## Current Page
URL: ${currentUrl}

## Interactive Elements on Page
${simplifiedElements.length > 0 ? simplifiedElements.join('\n') : 'No interactive elements found.'}

## Action History
${actionHistory.length > 0 ? formatActionHistory(actionHistory) : 'No actions taken yet.'}

## Available Actions
${formatAvailableActions(availableActions)}

## Instructions
1. Analyze the current page state and task
2. Determine the single best next action to progress toward the goal
${taskType === 'one-shot' ? `
**ONE-SHOT TASK**: Just pick the best action. The system will handle completion.` : `
3. Use "done" when the task is complete

## Stop Conditions - Use "done" action when:
- The requested action has been performed successfully
- The goal has been achieved
- No further actions are needed`}

## Response Format
Respond with ONLY a JSON object in this exact format:
{
  "reasoning": "Brief explanation of why this action is needed",
  "action": "action_type",
  "targetId": "ai-target-X",
  "value": "text to type (if applicable)",
  "amount": 500
}

Important:
- Use the exact targetId from the elements list (e.g., "ai-target-0")
- For "done" action, omit targetId
- For "scroll" action, use positive amount to scroll down, negative to scroll up
- For "type" action, include the value to type
- Keep reasoning concise (1-2 sentences)

Respond with the JSON only, no markdown formatting.`;

  return prompt;
}

/**
 * Format a single element for the prompt
 * Includes semantic context to help LLM understand element relationships
 */
function formatElement(el) {
  const parts = [`[${el.id}]`];

  // Add tag and type
  if (el.type) {
    parts.push(`<${el.tag} type="${el.type}">`);
  } else {
    parts.push(`<${el.tag}>`);
  }

  // Add text content
  if (el.text) {
    parts.push(`"${el.text}"`);
  } else if (el.placeholder) {
    parts.push(`(placeholder: "${el.placeholder}")`);
  } else if (el.ariaLabel) {
    parts.push(`(aria-label: "${el.ariaLabel}")`);
  }

  // Add href for links
  if (el.href && el.tag === 'a') {
    // Truncate long URLs
    const href = el.href.length > 50 ? el.href.substring(0, 50) + '...' : el.href;
    parts.push(`-> ${href}`);
  }

  // Add semantic context - helps LLM understand what this element relates to
  if (el.context) {
    const contextParts = [];

    // Section/article title is most important for understanding content
    if (el.context.sectionTitle) {
      contextParts.push(`section: "${el.context.sectionTitle}"`);
    }

    // Heading provides hierarchical context
    if (el.context.heading && el.context.heading !== el.context.sectionTitle) {
      contextParts.push(`under: "${el.context.heading}"`);
    }

    // List item text for navigation menus
    if (el.context.listItemText && !el.context.heading) {
      contextParts.push(`in: "${el.context.listItemText}"`);
    }

    // Caption for figures/cards
    if (el.context.caption) {
      contextParts.push(`caption: "${el.context.caption}"`);
    }

    // Nearby text for "Read More" type links
    if (el.context.nearbyText && contextParts.length === 0) {
      const truncated = el.context.nearbyText.substring(0, 80);
      contextParts.push(`near: "${truncated}..."`);
    }

    // Container text as fallback context
    if (el.context.containerText && contextParts.length === 0) {
      const truncated = el.context.containerText.substring(0, 80);
      contextParts.push(`context: "${truncated}..."`);
    }

    if (contextParts.length > 0) {
      parts.push(`[${contextParts.join(', ')}]`);
    }
  }

  // Mark disabled elements
  if (el.disabled) {
    parts.push('[DISABLED]');
  }

  return parts.join(' ');
}

/**
 * Format action history for context
 */
function formatActionHistory(history) {
  return history
    .slice(-5) // Last 5 actions for context
    .map((h, i) => {
      const parts = [`${i + 1}. ${h.action}`];
      if (h.targetId) parts.push(`on ${h.targetId}`);
      if (h.value) parts.push(`with value "${h.value}"`);
      if (h.success === false) parts.push('[FAILED]');
      return parts.join(' ');
    })
    .join('\n');
}

/**
 * Format available actions
 */
function formatAvailableActions(actions) {
  const descriptions = {
    'click': 'click(targetId) - Click on an element',
    'type': 'type(targetId, value) - Type text into an input field',
    'scroll': 'scroll(amount) - Scroll the page (positive=down, negative=up)',
    'wait': 'wait(ms) - Wait for page to update',
    'done': 'done() - Task is complete',
    'select': 'select(targetId, value) - Select an option from dropdown'
  };

  return actions
    .map(a => `- ${descriptions[a] || a}`)
    .join('\n');
}

/**
 * Parse the LLM response into a structured action
 * @param {string} response - Raw LLM response
 * @returns {Object} Parsed action object
 */
export function parseAgentResponse(response) {
  try {
    // Try to extract JSON from the response
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    // Parse the JSON
    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.action) {
      throw new Error('Missing action field');
    }

    // Normalize the response
    return {
      action: parsed.action,
      targetId: parsed.targetId || null,
      value: parsed.value || null,
      amount: parsed.amount || null,
      reasoning: parsed.reasoning || '',
      raw: response
    };

  } catch (error) {
    console.error('[PromptBuilder] Failed to parse response:', error);
    console.error('[PromptBuilder] Raw response:', response);

    // Return error action
    return {
      action: 'error',
      error: `Failed to parse LLM response: ${error.message}`,
      reasoning: 'The AI response was not in the expected format',
      raw: response
    };
  }
}

/**
 * Build a planning prompt for task breakdown
 * @param {Object} params - Planning parameters
 * @returns {string} Formatted prompt
 */
export function buildPlanningPrompt(params) {
  const {
    task,
    currentUrl,
    elements,
    screenshot,
    conversationHistory = []
  } = params;

  // Simplify elements for token efficiency
  // Note: Include ALL elements (not just viewport) since scroll-to-load captures everything
  const simplifiedElements = elements
    .slice(0, 100) // Limit to 100 elements for token budget
    .map(el => formatElement(el));

  const conversationContext = conversationHistory.length > 0
    ? `\n## Previous Conversation\n${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}\n`
    : '';

  return `You are a browser automation planner. Analyze the user's request and create a step-by-step execution plan.

## User Request
${task}

## Current Page
URL: ${currentUrl}
${conversationContext}
## Interactive Elements on Page
${simplifiedElements.length > 0 ? simplifiedElements.join('\n') : 'No interactive elements found.'}

## Available Actions
- click(targetId) - Click on an element
- type(targetId, value) - Type text into an input field
- scroll(amount) - Scroll the page (positive=down, negative=up)
- select(targetId, value) - Select an option from dropdown
- wait(ms) - Wait for page to update

## Instructions
1. Find the element that BEST matches the user's request
2. For "find article on X" - search for elements with "X" in text or context
3. Create 1-3 steps MAXIMUM (usually just 1 click is enough)
4. Use ONLY targetIds from the elements list above (e.g., "ai-target-39")

## CRITICAL RULES
- Maximum 3 steps per plan
- If you find a matching element, just click it (1 step)
- If no match found, set understood=false and ask which article they want

## Response Format
Respond with ONLY a JSON object:

{
  "understood": true,
  "clarifyingQuestions": [],
  "summary": "Brief description of what will happen",
  "steps": [
    {
      "step": 1,
      "action": "click",
      "targetId": "ai-target-X",
      "value": null,
      "targetDescription": "What this element is",
      "expectedResult": "What should happen after this action",
      "verification": "How to verify success"
    }
  ],
  "risks": [],
  "estimatedActions": 1
}

If you need clarification, respond with:
{
  "understood": false,
  "clarifyingQuestions": ["Question 1?", "Question 2?"],
  "summary": null,
  "steps": [],
  "risks": [],
  "estimatedActions": 0
}

Respond with JSON only, no markdown formatting.`;
}

/**
 * Robust JSON parsing using regex extraction
 * Extracts key fields from potentially malformed JSON
 * This is more reliable than full JSON parsing for local LLMs
 */
function extractJsonField(jsonStr, fieldName, type = 'string') {
  // Try to extract a field value using regex
  const patterns = {
    'boolean': new RegExp(`"${fieldName}"\\s*:\\s*(true|false)`, 'i'),
    'string': new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)"`, 'i'),
    'number': new RegExp(`"${fieldName}"\\s*:\\s*(\\d+)`, 'i'),
    'array': new RegExp(`"${fieldName}"\\s*:\\s*\\[([^\\]]*?)\\]`, 's'),
  };

  const match = jsonStr.match(patterns[type]);
  if (!match) return null;

  if (type === 'boolean') return match[1].toLowerCase() === 'true';
  if (type === 'number') return parseInt(match[1], 10);
  if (type === 'array') {
    // Extract array items - handle strings
    const arrayContent = match[1];
    const items = [];
    const stringMatches = arrayContent.matchAll(/"([^"]*)"/g);
    for (const m of stringMatches) {
      items.push(m[1]);
    }
    return items;
  }
  return match[1];
}

/**
 * Extract steps array from JSON response using regex
 * More robust than full JSON parsing
 */
function extractSteps(jsonStr) {
  const steps = [];

  // Find all step objects - look for patterns like "step": N
  const stepPattern = /\{\s*"step"\s*:\s*(\d+)[^}]*?"action"\s*:\s*"([^"]+)"[^}]*?"targetId"\s*:\s*"?([^",}\s]+)"?[^}]*?"targetDescription"\s*:\s*"([^"]*)"[^}]*?\}/gs;

  let match;
  while ((match = stepPattern.exec(jsonStr)) !== null) {
    const step = {
      step: parseInt(match[1], 10),
      action: match[2],
      targetId: match[3] === 'null' ? null : match[3],
      targetDescription: match[4],
      value: null,
      expectedResult: '',
      verification: ''
    };

    // Try to extract value if present
    const valueMatch = match[0].match(/"value"\s*:\s*"([^"]*)"/);
    if (valueMatch) step.value = valueMatch[1];

    // Try to extract expectedResult
    const expectedMatch = match[0].match(/"expectedResult"\s*:\s*"([^"]*)"/);
    if (expectedMatch) step.expectedResult = expectedMatch[1];

    steps.push(step);
  }

  // If no steps found with complex pattern, try simpler extraction
  if (steps.length === 0) {
    // Alternative: find individual step blocks
    const simplePattern = /"action"\s*:\s*"(click|type|scroll|select|wait)"[^}]*?"targetId"\s*:\s*"(ai-target-\d+)"/g;
    let stepNum = 1;
    while ((match = simplePattern.exec(jsonStr)) !== null) {
      steps.push({
        step: stepNum++,
        action: match[1],
        targetId: match[2],
        targetDescription: '',
        value: null,
        expectedResult: '',
        verification: ''
      });
    }
  }

  // Limit to first 5 steps to prevent runaway plans
  return steps.slice(0, 5);
}

/**
 * Parse the planning response from LLM
 * Uses robust regex extraction instead of full JSON parsing
 * @param {string} response - Raw LLM response
 * @returns {Object} Parsed plan object
 */
export function parsePlanResponse(response) {
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  // First try standard JSON parsing
  try {
    const parsed = JSON.parse(jsonStr);

    // Validate and limit steps
    const steps = (parsed.steps || []).slice(0, 5);

    return {
      understood: parsed.understood === true,
      clarifyingQuestions: parsed.clarifyingQuestions || [],
      summary: parsed.summary || null,
      steps: steps,
      risks: parsed.risks || [],
      estimatedActions: steps.length,
      raw: response
    };
  } catch (jsonError) {
    console.log('[PromptBuilder] JSON parse failed, using regex extraction...');
  }

  // Fallback: Extract fields using regex
  try {
    const understood = extractJsonField(jsonStr, 'understood', 'boolean');
    const summary = extractJsonField(jsonStr, 'summary', 'string');
    const clarifyingQuestions = extractJsonField(jsonStr, 'clarifyingQuestions', 'array') || [];
    const steps = extractSteps(jsonStr);

    // If we found at least understood field and some content
    if (understood !== null || steps.length > 0 || summary) {
      console.log('[PromptBuilder] Regex extraction successful:', {
        understood,
        stepsFound: steps.length,
        summary: summary?.substring(0, 50)
      });

      return {
        understood: understood === true,
        clarifyingQuestions: clarifyingQuestions,
        summary: summary || 'Executing plan...',
        steps: steps,
        risks: [],
        estimatedActions: steps.length,
        raw: response
      };
    }

    throw new Error('Could not extract required fields');
  } catch (error) {
    console.error('[PromptBuilder] Failed to parse plan response:', error);
    console.error('[PromptBuilder] Raw response (first 500 chars):', response.substring(0, 500));

    return {
      error: `Failed to parse plan: ${error.message}`,
      understood: false,
      clarifyingQuestions: ['I had trouble understanding the page. Could you be more specific about what you want to do?'],
      summary: null,
      steps: [],
      risks: [],
      estimatedActions: 0,
      raw: response
    };
  }
}

/**
 * Build a verification prompt
 */
export function buildVerificationPrompt(action, beforeState, afterState) {
  return `You are verifying if a browser action was successful.

## Action Taken
${JSON.stringify(action, null, 2)}

## State Before Action
URL: ${beforeState.url}
Elements: ${beforeState.elements?.length || 0}

## State After Action
URL: ${afterState.url}
Elements: ${afterState.elements?.length || 0}

## Question
Was the action successful? Consider:
- Did the page change as expected?
- Did the target element respond?
- Are there any error messages visible?

Respond with JSON:
{
  "success": true/false,
  "confidence": 0.0-1.0,
  "explanation": "brief explanation"
}`;
}
