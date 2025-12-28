/**
 * AI Browser Agent - Service Worker (background.js)
 *
 * Responsibilities:
 * - Agent orchestration (Observe → Reason → Act → Verify loop)
 * - API communication with backend proxy
 * - State management with checkpointing (30s timeout mitigation)
 * - Message routing between side panel and content scripts
 *
 * Now TAB-AWARE - each tab has its own agent session.
 */

import { runAgentLoop, stopAgentLoop, getAgentStatus as getLoopStatus, retryWithClarification } from './lib/agent-loop.js';
import { clearTabState } from './lib/state-manager.js';

// Track pending plan approvals by tabId
const pendingApprovals = new Map();

// ============================================================================
// Side Panel Registration
// ============================================================================

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] AI Browser Agent installed');

  // Disable automatic side panel opening - we'll control it manually per tab
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  // Disable side panel globally by default - we enable per-tab only
  chrome.sidePanel.setOptions({ enabled: false });
});

// Track which tabs have the side panel enabled
const enabledTabs = new Set();

// ============================================================================
// Tab-Specific Side Panel Control
// ============================================================================

// Handle extension icon click - enable side panel for THIS tab only
// CRITICAL: Both setOptions and open must be called SYNCHRONOUSLY - no .then() or await
chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] Extension icon clicked on tab:', tab.id);

  // Track this tab as enabled
  enabledTabs.add(tab.id);

  // Call setOptions synchronously (it's fast, no await needed)
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: 'sidepanel.html',
    enabled: true
  });

  // Call open synchronously right after - user gesture context is preserved
  chrome.sidePanel.open({ tabId: tab.id })
    .then(() => {
      console.log('[Background] Side panel opened for tab:', tab.id);
    })
    .catch(error => {
      console.error('[Background] Failed to open side panel:', error);
      enabledTabs.delete(tab.id);
    });
});

// When switching tabs, control side panel visibility
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  console.log('[Background] Tab activated:', tabId, 'enabled:', enabledTabs.has(tabId));

  // If this tab has side panel enabled, make sure it's visible
  // If not, disable the side panel for this tab
  try {
    if (enabledTabs.has(tabId)) {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: 'sidepanel.html',
        enabled: true
      });
    } else {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false
      });
    }
  } catch (error) {
    console.error('[Background] Failed to update side panel visibility:', error);
  }
});

// ============================================================================
// Tab Cleanup - Clear state when tab closes
// ============================================================================

chrome.tabs.onRemoved.addListener(async (tabId) => {
  console.log('[Background] Tab closed:', tabId);

  // Remove from enabled tabs tracking
  enabledTabs.delete(tabId);

  // Clear agent state
  await clearTabState(tabId);
});

// ============================================================================
// Tab Grouping - Group tabs with active AI agents
// ============================================================================

const AI_GROUP_NAME = 'AI Agent';
const AI_GROUP_COLOR = 'purple';

// Track the group ID for AI agent tabs
let aiAgentGroupId = null;

/**
 * Add a tab to the AI Agent group
 * @param {number} tabId - Tab ID to add to group
 */
async function addTabToAIGroup(tabId) {
  try {
    // Verify the tab exists
    await chrome.tabs.get(tabId);

    // Check if the group still exists
    if (aiAgentGroupId !== null) {
      try {
        await chrome.tabGroups.get(aiAgentGroupId);
      } catch {
        // Group no longer exists, reset
        aiAgentGroupId = null;
      }
    }

    // If we don't have a group, create one
    if (aiAgentGroupId === null) {
      aiAgentGroupId = await chrome.tabs.group({
        tabIds: [tabId]
      });

      // Style the group
      await chrome.tabGroups.update(aiAgentGroupId, {
        title: AI_GROUP_NAME,
        color: AI_GROUP_COLOR,
        collapsed: false
      });

      console.log('[Background] Created AI Agent group:', aiAgentGroupId);
    } else {
      // Add tab to existing group
      await chrome.tabs.group({
        tabIds: [tabId],
        groupId: aiAgentGroupId
      });

      console.log('[Background] Added tab', tabId, 'to AI Agent group');
    }
  } catch (error) {
    console.error('[Background] Failed to add tab to group:', error);
  }
}

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Get tabId from message (sent by sidepanel) or from sender (content script)
  const tabId = message.tabId || sender.tab?.id;

  console.log('[Background] Received message:', message.action, 'from tab:', tabId);

  handleMessage(message, sender, tabId)
    .then(sendResponse)
    .catch(error => {
      console.error('[Background] Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    });

  // CRITICAL: Must return true for async sendResponse
  return true;
});

/**
 * Route messages to appropriate handlers
 */
async function handleMessage(message, sender, tabId) {
  switch (message.action) {
    case 'ping':
      return { success: true, status: 'ok', from: 'background', tabId };

    case 'sidePanelOpened':
      // Side panel just opened for this tab - group it
      // Note: Tab is already in enabledTabs from action.onClicked
      addTabToAIGroup(tabId).catch(err => {
        console.error('[Background] Failed to group tab:', err);
      });
      return { success: true, tabId };

    case 'startTask':
      return await startAgentTask(message.task, tabId);

    case 'stopTask':
      return await stopAgentTask(tabId);

    case 'getStatus':
      return await getAgentStatus(tabId);

    case 'captureState':
      return await capturePageState(tabId);

    case 'approvePlan':
      return await handleApprovePlan(tabId);

    case 'rejectPlan':
      return await handleRejectPlan(tabId);

    case 'submitClarification':
      return await handleSubmitClarification(message.answer, tabId);

    default:
      console.warn('[Background] Unknown action:', message.action);
      return { success: false, error: `Unknown action: ${message.action}` };
  }
}

// ============================================================================
// Tab Utilities
// ============================================================================

/**
 * Send message to content script in a specific tab
 * Includes retry logic for when page navigates
 * @param {Object} message - Message to send
 * @param {number} tabId - Target tab ID
 * @param {number} retries - Number of retries
 */
async function sendToContentScript(message, tabId, retries = 3) {
  if (!tabId) {
    throw new Error('No tabId provided for content script message');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (error) {
      console.log(`[Background] Content script attempt ${attempt}/${retries} failed on tab ${tabId}:`, error.message);

      if (attempt < retries) {
        // Wait for page to load and content script to initialize
        await new Promise(r => setTimeout(r, 1000));

        // Try to inject content script if not loaded
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          });
          console.log('[Background] Injected content script into tab', tabId);
          await new Promise(r => setTimeout(r, 500));
        } catch (injectError) {
          console.log('[Background] Script injection skipped:', injectError.message);
        }
      } else {
        throw new Error('Content script not ready after retries. Please refresh the page.');
      }
    }
  }
}

/**
 * Capture screenshot of a specific tab
 */
async function captureScreenshot() {
  try {
    // Note: captureVisibleTab captures whatever is visible
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return dataUrl;
  } catch (error) {
    console.error('[Background] Screenshot capture failed:', error);
    return null;
  }
}

// ============================================================================
// Page State Capture
// ============================================================================

/**
 * Capture full page state (DOM elements + optional screenshot) for a specific tab
 * @param {number} tabId - Tab ID to capture
 * @param {boolean} includeScreenshot - Whether to include screenshot
 */
async function capturePageState(tabId, includeScreenshot = false) {
  // Get tab info
  const tab = await chrome.tabs.get(tabId);

  // Get DOM elements from content script
  const domResponse = await sendToContentScript({ action: 'captureDOM' }, tabId);

  const state = {
    url: tab.url,
    title: tab.title,
    elements: domResponse.elements || [],
    timestamp: Date.now(),
    tabId
  };

  // Optionally capture screenshot (expensive - 10-100x more tokens)
  if (includeScreenshot) {
    state.screenshot = await captureScreenshot(tabId);
  }

  return state;
}

// ============================================================================
// Agent Task Management - Tab-Specific
// ============================================================================

/**
 * Start a new agent task for a specific tab
 * @param {string} task - Task description
 * @param {number} tabId - Tab ID to run task on
 */
async function startAgentTask(task, tabId) {
  console.log('[Background] Starting task on tab', tabId, ':', task);

  if (!tabId) {
    return { success: false, error: 'No tab ID provided' };
  }

  const taskId = Date.now().toString();

  // Notify side panel that task is starting
  notifySidePanel({
    type: 'taskStarted',
    task: task,
    status: 'running',
    tabId
  });

  // Run agent loop with callbacks - now with tabId
  runAgentLoop(task, tabId, {
    // Progress updates
    onProgress: (progress) => {
      console.log('[Background] Progress on tab', tabId, ':', JSON.stringify(progress));
      notifySidePanel({
        type: 'progress',
        ...progress,
        tabId
      });
    },

    // Action starting (for UI to show "in progress")
    onActionStarted: (action) => {
      console.log('[Background] Action starting on tab', tabId, ':', JSON.stringify(action));
      notifySidePanel({
        type: 'actionStarted',
        action: action,
        tabId
      });
    },

    // Action executed
    onAction: (action, result) => {
      console.log('[Background] Action executed on tab', tabId, ':', JSON.stringify({ action, result }));
      notifySidePanel({
        type: 'actionExecuted',
        action: action,
        result: result,
        tabId
      });
    },

    // Task completed
    onComplete: (reasoning) => {
      console.log('[Background] Task completed on tab', tabId, ':', reasoning);
      notifySidePanel({
        type: 'taskCompleted',
        reasoning: reasoning,
        status: 'completed',
        tabId
      });
    },

    // Error occurred
    onError: (error) => {
      console.error('[Background] Task error on tab', tabId, ':', error);
      notifySidePanel({
        type: 'taskError',
        error: error,
        status: 'error',
        tabId
      });
    },

    // Plan ready for approval
    onPlanReady: async (plan) => {
      console.log('[Background] Plan ready for approval on tab', tabId, ':', JSON.stringify(plan));

      // Store resolver for when user approves/rejects
      return new Promise((resolve) => {
        pendingApprovals.set(tabId, { resolve, plan });

        notifySidePanel({
          type: 'planReady',
          plan: plan,
          tabId
        });
      });
    },

    // Clarification needed
    onClarifyNeeded: (clarifyInfo) => {
      console.log('[Background] Clarification needed on tab', tabId, ':', JSON.stringify(clarifyInfo));
      notifySidePanel({
        type: 'clarifyNeeded',
        questions: clarifyInfo.questions,
        tabId
      });
    },

    // Capture page state for this specific tab
    capturePageState: async () => {
      const state = await capturePageState(tabId);
      console.log('[Background] Captured page state for tab', tabId, ':', state.url, 'elements:', state.elements?.length);
      return state;
    },

    // Execute action on this specific tab
    executeAction: async (action) => {
      console.log('[Background] Executing action on tab', tabId, ':', JSON.stringify(action));
      const result = await sendToContentScript({
        action: 'executeAction',
        type: action.action,
        targetId: action.targetId,
        value: action.value,
        amount: action.amount
      }, tabId);
      console.log('[Background] Action result from tab', tabId, ':', JSON.stringify(result));
      return result;
    }
  });

  return {
    success: true,
    message: 'Task started',
    taskId: taskId,
    tabId
  };
}

/**
 * Stop the current agent task for a specific tab
 * @param {number} tabId - Tab ID to stop
 */
async function stopAgentTask(tabId) {
  console.log('[Background] Stopping task on tab', tabId);

  await stopAgentLoop(tabId);

  notifySidePanel({
    type: 'taskStopped',
    status: 'stopped',
    tabId
  });

  return { success: true, message: 'Task stopped', tabId };
}

/**
 * Get current agent status for a specific tab
 * @param {number} tabId - Tab ID
 */
async function getAgentStatus(tabId) {
  const status = await getLoopStatus(tabId);
  return {
    success: true,
    ...status
  };
}

/**
 * Handle plan approval from side panel
 * @param {number} tabId - Tab ID
 */
async function handleApprovePlan(tabId) {
  console.log('[Background] Plan approved for tab', tabId);

  const pending = pendingApprovals.get(tabId);
  if (pending && pending.resolve) {
    pending.resolve(true);
    pendingApprovals.delete(tabId);
    return { success: true, message: 'Plan approved' };
  }

  return { success: false, error: 'No pending plan approval' };
}

/**
 * Handle plan rejection from side panel
 * @param {number} tabId - Tab ID
 */
async function handleRejectPlan(tabId) {
  console.log('[Background] Plan rejected for tab', tabId);

  const pending = pendingApprovals.get(tabId);
  if (pending && pending.resolve) {
    pending.resolve(false);
    pendingApprovals.delete(tabId);
    return { success: true, message: 'Plan rejected' };
  }

  return { success: false, error: 'No pending plan rejection' };
}

/**
 * Handle clarification submission from side panel
 * @param {string} answer - User's answer
 * @param {number} tabId - Tab ID
 */
async function handleSubmitClarification(answer, tabId) {
  console.log('[Background] Clarification submitted for tab', tabId, ':', answer);

  // Retry the agent loop with clarification
  await retryWithClarification(tabId, answer, {
    // Reuse the same callbacks
    onProgress: (progress) => {
      notifySidePanel({
        type: 'progress',
        ...progress,
        tabId
      });
    },

    onActionStarted: (action) => {
      notifySidePanel({
        type: 'actionStarted',
        action: action,
        tabId
      });
    },

    onAction: (action, result) => {
      notifySidePanel({
        type: 'actionExecuted',
        action: action,
        result: result,
        tabId
      });
    },

    onComplete: (reasoning) => {
      notifySidePanel({
        type: 'taskCompleted',
        reasoning: reasoning,
        status: 'completed',
        tabId
      });
    },

    onError: (error) => {
      notifySidePanel({
        type: 'taskError',
        error: error,
        status: 'error',
        tabId
      });
    },

    onPlanReady: async (plan) => {
      return new Promise((resolve) => {
        pendingApprovals.set(tabId, { resolve, plan });
        notifySidePanel({
          type: 'planReady',
          plan: plan,
          tabId
        });
      });
    },

    onClarifyNeeded: (clarifyInfo) => {
      notifySidePanel({
        type: 'clarifyNeeded',
        questions: clarifyInfo.questions,
        tabId
      });
    },

    capturePageState: async () => {
      return await capturePageState(tabId);
    },

    executeAction: async (action) => {
      return await sendToContentScript({
        action: 'executeAction',
        type: action.action,
        targetId: action.targetId,
        value: action.value,
        amount: action.amount
      }, tabId);
    }
  });

  return { success: true, message: 'Clarification submitted' };
}

// ============================================================================
// Side Panel Communication
// ============================================================================

/**
 * Send notification to side panel
 */
function notifySidePanel(message) {
  chrome.runtime.sendMessage({
    ...message,
    source: 'background'
  }).catch(() => {
    // Side panel might not be open
    console.log('[Background] Side panel not available for tab', message.tabId);
  });
}

// ============================================================================
// Service Worker Keep-Alive (for long-running tasks)
// ============================================================================

// Note: Service worker terminates after ~30s of inactivity
// State checkpointing is handled by state-manager.js

console.log('[Background] Service worker started');
