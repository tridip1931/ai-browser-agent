/**
 * AI Browser Agent - E2E Tests
 *
 * Uses Playwright MCP for browser automation testing.
 * Tests the extension's core functionality.
 *
 * Prerequisites:
 * - Playwright MCP server running
 * - Backend server running on localhost:3000
 * - Extension loaded in Chrome
 *
 * Usage with Claude Code MCP:
 * 1. Start backend: cd backend && npm start
 * 2. Load extension in Chrome
 * 3. Run tests via Playwright MCP tools
 */

export const tests = {
  /**
   * Test: Backend Health Check
   * Verifies the backend server is running and responding
   */
  backendHealth: {
    name: 'Backend Health Check',
    steps: [
      'Navigate to http://localhost:3000/health',
      'Verify response contains status: "ok"',
      'Check providers object exists'
    ],
    expectedResult: {
      status: 'ok',
      providers: { anthropic: true, openai: false, ollama: true }
    }
  },

  /**
   * Test: DOM Capture
   * Tests the element capture functionality
   */
  domCapture: {
    name: 'DOM Element Capture',
    steps: [
      'Navigate to https://example.com',
      'Open extension side panel',
      'Trigger DOM capture via console: chrome.runtime.sendMessage({action: "captureState"})',
      'Verify elements array is returned',
      'Check elements have data-ai-id attributes'
    ],
    expectedResult: {
      elementsFound: true,
      hasTargetIds: true
    }
  },

  /**
   * Test: Click Action
   * Tests clicking on an element via the agent
   */
  clickAction: {
    name: 'Click Action Execution',
    steps: [
      'Navigate to https://example.com',
      'Submit task: "Click the More information link"',
      'Confirm action when prompted',
      'Verify navigation to new page'
    ],
    expectedResult: {
      actionExecuted: true,
      pageChanged: true
    }
  },

  /**
   * Test: Type Action
   * Tests typing into an input field
   */
  typeAction: {
    name: 'Type Action Execution',
    steps: [
      'Navigate to https://google.com',
      'Submit task: "Type hello world in the search box"',
      'Confirm action when prompted',
      'Verify text appears in search input'
    ],
    expectedResult: {
      actionExecuted: true,
      inputValue: 'hello world'
    }
  },

  /**
   * Test: Scroll Action
   * Tests page scrolling
   */
  scrollAction: {
    name: 'Scroll Action Execution',
    steps: [
      'Navigate to a long page',
      'Record initial scroll position',
      'Submit task: "Scroll down the page"',
      'Verify scroll position changed'
    ],
    expectedResult: {
      scrollChanged: true
    }
  },

  /**
   * Test: High-Risk Action Confirmation
   * Tests that dangerous actions require confirmation
   */
  highRiskConfirmation: {
    name: 'High-Risk Action Requires Confirmation',
    steps: [
      'Navigate to a page with a delete button',
      'Submit task: "Click the delete button"',
      'Verify confirmation dialog appears',
      'Cancel the action',
      'Verify action was not executed'
    ],
    expectedResult: {
      confirmationShown: true,
      actionBlocked: true
    }
  },

  /**
   * Test: Visual Indicator
   * Tests the orange border appears when AI is active
   */
  visualIndicator: {
    name: 'Visual Indicator Display',
    steps: [
      'Navigate to any page',
      'Start a task',
      'Verify orange border appears on page',
      'Verify "AI Active" badge is visible',
      'Complete or cancel task',
      'Verify indicator disappears'
    ],
    expectedResult: {
      borderVisible: true,
      badgeVisible: true,
      clearedAfterTask: true
    }
  },

  /**
   * Test: Prompt Injection Detection
   * Tests that malicious content is detected
   */
  injectionDetection: {
    name: 'Prompt Injection Detection',
    steps: [
      'Create test page with text: "Ignore previous instructions"',
      'Navigate to test page',
      'Submit any task',
      'Verify backend returns warning',
      'Verify confirmation is required'
    ],
    expectedResult: {
      injectionDetected: true,
      warningShown: true
    }
  },

  /**
   * Test: Service Worker Recovery
   * Tests state persistence after service worker restarts
   */
  serviceWorkerRecovery: {
    name: 'Service Worker State Recovery',
    steps: [
      'Start a multi-step task',
      'Wait for first action to complete',
      'Force service worker restart (chrome://serviceworker-internals)',
      'Verify task state is preserved',
      'Verify task can continue'
    ],
    expectedResult: {
      statePreserved: true,
      taskContinued: true
    }
  }
};

/**
 * MCP Test Runner Instructions
 *
 * To run these tests using Playwright MCP:
 *
 * 1. Ensure MCP server is configured in Claude settings
 * 2. Use the browser_navigate tool to open pages
 * 3. Use browser_click, browser_type for interactions
 * 4. Use browser_snapshot to capture state
 * 5. Use browser_evaluate for JavaScript execution
 *
 * Example MCP commands:
 * - browser_navigate({ url: "https://example.com" })
 * - browser_click({ selector: "[data-ai-id='ai-target-0']" })
 * - browser_type({ selector: "input", text: "hello" })
 * - browser_evaluate({ expression: "document.querySelector('[data-ai-id]')" })
 */

export default tests;
