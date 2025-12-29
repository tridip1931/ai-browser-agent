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

import {
  runAgentLoop,
  stopAgentLoop,
  getAgentStatus as getLoopStatus,
  retryWithClarification,
  // V2 exports
  runAgentLoopV2,
  retryWithClarificationV2
} from './lib/agent-loop.js';
import { clearTabState, recordMidExecDecision } from './lib/state-manager.js';
import {
  attachDebugger,
  detachDebugger,
  isDebuggerAttached,
  setupDebuggerDetachListener,
  cdpClick,
  cdpType,
  cdpClearAndType,
  cdpPressKey,
  cdpScrollDown,
  cdpScrollUp
} from './lib/cdp-executor.js';

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

  // Detach debugger if attached
  if (isDebuggerAttached(tabId)) {
    try {
      await detachDebugger(tabId);
    } catch (err) {
      // Tab already closed, debugger auto-detached
      console.log('[Background] Debugger cleanup on tab close:', err.message);
    }
  }

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

    // ========================================
    // V2: Confidence-Based Agent Loop
    // ========================================

    case 'startTaskV2':
      return await startAgentTaskV2(message.task, tabId);

    case 'submitClarificationV2':
      return await handleSubmitClarificationV2(message.answer, message.selectedOptionId, tabId);

    case 'correctAssumption':
      return await handleCorrectAssumption(message.field, message.newValue, tabId);

    case 'midExecDecision':
      return await handleMidExecDecision(message.decision, tabId);

    case 'cancelAssumeAnnounce':
      return await handleCancelAssumeAnnounce(tabId);

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

  // Attach debugger to tab (triggers Chrome's native "Started debugging" banner)
  try {
    await attachDebugger(tabId);
    console.log('[Background] Debugger attached for CDP actions on tab', tabId);
  } catch (error) {
    console.error('[Background] Failed to attach debugger:', error);
    return { success: false, error: `Failed to attach debugger: ${error.message}` };
  }

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
    onComplete: async (reasoning) => {
      console.log('[Background] Task completed on tab', tabId, ':', reasoning);

      // Detach debugger on completion
      if (isDebuggerAttached(tabId)) {
        try {
          await detachDebugger(tabId);
          console.log('[Background] Debugger detached after completion on tab', tabId);
        } catch (err) {
          console.warn('[Background] Failed to detach debugger on completion:', err);
        }
      }

      notifySidePanel({
        type: 'taskCompleted',
        reasoning: reasoning,
        status: 'completed',
        tabId
      });
    },

    // Error occurred
    onError: async (error) => {
      console.error('[Background] Task error on tab', tabId, ':', error);

      // Detach debugger on error
      if (isDebuggerAttached(tabId)) {
        try {
          await detachDebugger(tabId);
          console.log('[Background] Debugger detached after error on tab', tabId);
        } catch (err) {
          console.warn('[Background] Failed to detach debugger on error:', err);
        }
      }

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

    // Execute action on this specific tab using CDP for real input events
    executeAction: async (action) => {
      console.log('[Background] Executing CDP action on tab', tabId, ':', JSON.stringify(action));

      try {
        // For actions that need element coordinates, get them from content script
        if (action.targetId && ['click', 'type'].includes(action.action)) {
          // First scroll element into view and get coordinates
          const scrollResult = await sendToContentScript({
            action: 'scrollElementIntoView',
            targetId: action.targetId
          }, tabId);

          if (!scrollResult.success) {
            return scrollResult; // Element not found
          }

          const { center } = scrollResult;

          // Execute CDP action based on type
          switch (action.action) {
            case 'click':
              await cdpClick(tabId, center.x, center.y);
              return { success: true, action: 'click', method: 'cdp' };

            case 'type':
              // Click to focus first
              await cdpClick(tabId, center.x, center.y);
              await sleep(100);
              // Clear and type using CDP
              await cdpClearAndType(tabId, action.value);
              return { success: true, action: 'type', value: action.value, method: 'cdp' };
          }
        }

        // Handle scroll actions via CDP
        if (action.action === 'scroll') {
          const amount = action.amount || 500;
          if (amount > 0) {
            await cdpScrollDown(tabId, amount);
          } else {
            await cdpScrollUp(tabId, Math.abs(amount));
          }
          return { success: true, action: 'scroll', amount, method: 'cdp' };
        }

        // Handle keypress actions via CDP
        if (action.action === 'keypress' || action.action === 'pressKey') {
          await cdpPressKey(tabId, action.key || action.value);
          return { success: true, action: 'keypress', key: action.key || action.value, method: 'cdp' };
        }

        // Fallback to content script for other actions (hover, focus, etc.)
        console.log('[Background] Falling back to content script for action:', action.action);
        const result = await sendToContentScript({
          action: 'executeAction',
          type: action.action,
          targetId: action.targetId,
          value: action.value,
          amount: action.amount
        }, tabId);

        return result;

      } catch (error) {
        console.error('[Background] CDP action failed:', error);
        return { success: false, error: error.message };
      }
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

  // Detach debugger (removes Chrome's "Started debugging" banner)
  if (isDebuggerAttached(tabId)) {
    try {
      await detachDebugger(tabId);
      console.log('[Background] Debugger detached from tab', tabId);
    } catch (error) {
      console.warn('[Background] Failed to detach debugger:', error);
    }
  }

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

    onComplete: async (reasoning) => {
      // Detach debugger on completion
      if (isDebuggerAttached(tabId)) {
        try {
          await detachDebugger(tabId);
        } catch (err) {
          console.warn('[Background] Failed to detach debugger:', err);
        }
      }

      notifySidePanel({
        type: 'taskCompleted',
        reasoning: reasoning,
        status: 'completed',
        tabId
      });
    },

    onError: async (error) => {
      // Detach debugger on error
      if (isDebuggerAttached(tabId)) {
        try {
          await detachDebugger(tabId);
        } catch (err) {
          console.warn('[Background] Failed to detach debugger:', err);
        }
      }

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

    // Execute action using CDP (same as main startAgentTask)
    executeAction: async (action) => {
      try {
        if (action.targetId && ['click', 'type'].includes(action.action)) {
          const scrollResult = await sendToContentScript({
            action: 'scrollElementIntoView',
            targetId: action.targetId
          }, tabId);

          if (!scrollResult.success) {
            return scrollResult;
          }

          const { center } = scrollResult;

          switch (action.action) {
            case 'click':
              await cdpClick(tabId, center.x, center.y);
              return { success: true, action: 'click', method: 'cdp' };

            case 'type':
              await cdpClick(tabId, center.x, center.y);
              await sleep(100);
              await cdpClearAndType(tabId, action.value);
              return { success: true, action: 'type', value: action.value, method: 'cdp' };
          }
        }

        if (action.action === 'scroll') {
          const amount = action.amount || 500;
          if (amount > 0) {
            await cdpScrollDown(tabId, amount);
          } else {
            await cdpScrollUp(tabId, Math.abs(amount));
          }
          return { success: true, action: 'scroll', amount, method: 'cdp' };
        }

        if (action.action === 'keypress' || action.action === 'pressKey') {
          await cdpPressKey(tabId, action.key || action.value);
          return { success: true, action: 'keypress', key: action.key || action.value, method: 'cdp' };
        }

        // Fallback to content script
        return await sendToContentScript({
          action: 'executeAction',
          type: action.action,
          targetId: action.targetId,
          value: action.value,
          amount: action.amount
        }, tabId);

      } catch (error) {
        console.error('[Background] CDP action failed:', error);
        return { success: false, error: error.message };
      }
    }
  });

  return { success: true, message: 'Clarification submitted' };
}

// ============================================================================
// V2: Confidence-Based Agent Task Handlers
// ============================================================================

// Track V2-specific pending state
const pendingAssumeAnnounce = new Map(); // tabId -> { onCorrect, onCancel }
const pendingMidExecDecisions = new Map(); // tabId -> { onDecision }

/**
 * Start V2 agent task with confidence-based dialogue
 * @param {string} task - Task description
 * @param {number} tabId - Tab ID
 */
async function startAgentTaskV2(task, tabId) {
  console.log('[Background] Starting V2 task on tab', tabId, ':', task);

  if (!tabId) {
    return { success: false, error: 'No tab ID provided' };
  }

  // Attach debugger
  try {
    await attachDebugger(tabId);
    console.log('[Background] Debugger attached for V2 task on tab', tabId);
  } catch (error) {
    console.error('[Background] Failed to attach debugger:', error);
    return { success: false, error: `Failed to attach debugger: ${error.message}` };
  }

  // Notify side panel
  notifySidePanel({
    type: 'taskStarted',
    task: task,
    status: 'running',
    version: 'v2',
    tabId
  });

  // Run V2 agent loop with confidence-based callbacks
  runAgentLoopV2(task, tabId, {
    // Standard callbacks
    onProgress: (progress) => {
      notifySidePanel({ type: 'progress', ...progress, tabId });
    },

    onActionStarted: (action) => {
      notifySidePanel({ type: 'actionStarted', action, tabId });
    },

    onAction: (action, result) => {
      notifySidePanel({ type: 'actionExecuted', action, result, tabId });
    },

    onComplete: async (reasoning) => {
      if (isDebuggerAttached(tabId)) {
        try { await detachDebugger(tabId); } catch (e) { /* ignore */ }
      }
      notifySidePanel({ type: 'taskCompleted', reasoning, status: 'completed', tabId });
    },

    onError: async (error) => {
      if (isDebuggerAttached(tabId)) {
        try { await detachDebugger(tabId); } catch (e) { /* ignore */ }
      }
      notifySidePanel({ type: 'taskError', error, status: 'error', tabId });
    },

    onPlanReady: async (plan) => {
      return new Promise((resolve) => {
        pendingApprovals.set(tabId, { resolve, plan });
        notifySidePanel({ type: 'planReady', plan, tabId });
      });
    },

    onClarifyNeeded: (clarifyInfo) => {
      notifySidePanel({
        type: 'clarifyNeeded',
        questions: clarifyInfo.questions,
        isOptionBased: clarifyInfo.isOptionBased,
        tabId
      });
    },

    // V2 specific callbacks
    onConfidenceReport: (confidence) => {
      notifySidePanel({
        type: 'confidenceReport',
        overall: confidence.overall,
        breakdown: confidence.breakdown,
        recommendation: confidence.recommendation,
        tabId
      });
    },

    onAssumeAnnounce: (info) => {
      // Store callbacks for user response
      pendingAssumeAnnounce.set(tabId, {
        onCorrect: info.onCorrect,
        onCancel: info.onCancel
      });

      notifySidePanel({
        type: 'assumeAnnounce',
        assumptions: info.assumptions,
        plan: info.plan,
        autoExecuteDelay: info.autoExecuteDelay,
        tabId
      });
    },

    onSelfRefineProgress: (progress) => {
      notifySidePanel({
        type: 'selfRefineUpdate',
        iteration: progress.iteration,
        maxIterations: progress.maxIterations,
        previousScore: progress.previousScore,
        newScore: progress.newScore,
        improvements: progress.improvements,
        tabId
      });
    },

    onMidExecDialog: (info) => {
      // Store decision callback
      pendingMidExecDecisions.set(tabId, {
        onDecision: info.onDecision
      });

      notifySidePanel({
        type: 'midExecDialog',
        failedStep: info.failedStep,
        error: info.error,
        analysis: info.analysis,
        options: info.options,
        suggestedAction: info.suggestedAction,
        tabId
      });
    },

    // Page state capture
    capturePageState: async () => {
      return await capturePageState(tabId);
    },

    // Execute action via CDP (same as V1)
    executeAction: async (action) => {
      try {
        if (action.targetId && ['click', 'type'].includes(action.action)) {
          const scrollResult = await sendToContentScript({
            action: 'scrollElementIntoView',
            targetId: action.targetId
          }, tabId);

          if (!scrollResult.success) return scrollResult;

          const { center } = scrollResult;

          switch (action.action) {
            case 'click':
              await cdpClick(tabId, center.x, center.y);
              return { success: true, action: 'click', method: 'cdp' };

            case 'type':
              await cdpClick(tabId, center.x, center.y);
              await sleep(100);
              await cdpClearAndType(tabId, action.value);
              return { success: true, action: 'type', value: action.value, method: 'cdp' };
          }
        }

        if (action.action === 'scroll') {
          const amount = action.amount || 500;
          if (amount > 0) {
            await cdpScrollDown(tabId, amount);
          } else {
            await cdpScrollUp(tabId, Math.abs(amount));
          }
          return { success: true, action: 'scroll', amount, method: 'cdp' };
        }

        if (action.action === 'keypress' || action.action === 'pressKey') {
          await cdpPressKey(tabId, action.key || action.value);
          return { success: true, action: 'keypress', key: action.key || action.value, method: 'cdp' };
        }

        // Fallback to content script
        return await sendToContentScript({
          action: 'executeAction',
          type: action.action,
          targetId: action.targetId,
          value: action.value,
          amount: action.amount
        }, tabId);

      } catch (error) {
        console.error('[Background] V2 CDP action failed:', error);
        return { success: false, error: error.message };
      }
    }
  });

  return { success: true, message: 'V2 task started', tabId };
}

/**
 * Handle V2 clarification submission with option selection
 */
async function handleSubmitClarificationV2(answer, selectedOptionId, tabId) {
  console.log('[Background] V2 Clarification submitted for tab', tabId);

  await retryWithClarificationV2(tabId, answer, selectedOptionId, {
    onProgress: (progress) => notifySidePanel({ type: 'progress', ...progress, tabId }),
    onActionStarted: (action) => notifySidePanel({ type: 'actionStarted', action, tabId }),
    onAction: (action, result) => notifySidePanel({ type: 'actionExecuted', action, result, tabId }),

    onComplete: async (reasoning) => {
      if (isDebuggerAttached(tabId)) {
        try { await detachDebugger(tabId); } catch (e) { /* ignore */ }
      }
      notifySidePanel({ type: 'taskCompleted', reasoning, status: 'completed', tabId });
    },

    onError: async (error) => {
      if (isDebuggerAttached(tabId)) {
        try { await detachDebugger(tabId); } catch (e) { /* ignore */ }
      }
      notifySidePanel({ type: 'taskError', error, status: 'error', tabId });
    },

    onPlanReady: async (plan) => {
      return new Promise((resolve) => {
        pendingApprovals.set(tabId, { resolve, plan });
        notifySidePanel({ type: 'planReady', plan, tabId });
      });
    },

    onClarifyNeeded: (clarifyInfo) => {
      notifySidePanel({
        type: 'clarifyNeeded',
        questions: clarifyInfo.questions,
        isOptionBased: clarifyInfo.isOptionBased,
        tabId
      });
    },

    onConfidenceReport: (confidence) => {
      notifySidePanel({
        type: 'confidenceReport',
        overall: confidence.overall,
        breakdown: confidence.breakdown,
        recommendation: confidence.recommendation,
        tabId
      });
    },

    onAssumeAnnounce: (info) => {
      pendingAssumeAnnounce.set(tabId, {
        onCorrect: info.onCorrect,
        onCancel: info.onCancel
      });
      notifySidePanel({
        type: 'assumeAnnounce',
        assumptions: info.assumptions,
        plan: info.plan,
        autoExecuteDelay: info.autoExecuteDelay,
        tabId
      });
    },

    onSelfRefineProgress: (progress) => {
      notifySidePanel({
        type: 'selfRefineUpdate',
        ...progress,
        tabId
      });
    },

    onMidExecDialog: (info) => {
      pendingMidExecDecisions.set(tabId, { onDecision: info.onDecision });
      notifySidePanel({
        type: 'midExecDialog',
        failedStep: info.failedStep,
        error: info.error,
        analysis: info.analysis,
        options: info.options,
        suggestedAction: info.suggestedAction,
        tabId
      });
    },

    capturePageState: async () => await capturePageState(tabId),

    executeAction: async (action) => {
      try {
        if (action.targetId && ['click', 'type'].includes(action.action)) {
          const scrollResult = await sendToContentScript({
            action: 'scrollElementIntoView',
            targetId: action.targetId
          }, tabId);
          if (!scrollResult.success) return scrollResult;
          const { center } = scrollResult;

          switch (action.action) {
            case 'click':
              await cdpClick(tabId, center.x, center.y);
              return { success: true, action: 'click', method: 'cdp' };
            case 'type':
              await cdpClick(tabId, center.x, center.y);
              await sleep(100);
              await cdpClearAndType(tabId, action.value);
              return { success: true, action: 'type', value: action.value, method: 'cdp' };
          }
        }

        if (action.action === 'scroll') {
          const amount = action.amount || 500;
          amount > 0 ? await cdpScrollDown(tabId, amount) : await cdpScrollUp(tabId, Math.abs(amount));
          return { success: true, action: 'scroll', amount, method: 'cdp' };
        }

        if (action.action === 'keypress' || action.action === 'pressKey') {
          await cdpPressKey(tabId, action.key || action.value);
          return { success: true, action: 'keypress', key: action.key || action.value, method: 'cdp' };
        }

        return await sendToContentScript({
          action: 'executeAction',
          type: action.action,
          targetId: action.targetId,
          value: action.value,
          amount: action.amount
        }, tabId);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  });

  return { success: true, message: 'V2 clarification submitted' };
}

/**
 * Handle assumption correction during assume-announce
 */
async function handleCorrectAssumption(field, newValue, tabId) {
  console.log('[Background] Assumption corrected for tab', tabId, ':', field, '->', newValue);

  const pending = pendingAssumeAnnounce.get(tabId);
  if (pending && pending.onCorrect) {
    pending.onCorrect({ field, newValue });
    pendingAssumeAnnounce.delete(tabId);
    return { success: true, message: 'Assumption corrected' };
  }

  return { success: false, error: 'No pending assume-announce' };
}

/**
 * Handle cancel during assume-announce
 */
async function handleCancelAssumeAnnounce(tabId) {
  console.log('[Background] Assume-announce cancelled for tab', tabId);

  const pending = pendingAssumeAnnounce.get(tabId);
  if (pending && pending.onCancel) {
    pending.onCancel();
    pendingAssumeAnnounce.delete(tabId);
    return { success: true, message: 'Assume-announce cancelled' };
  }

  return { success: false, error: 'No pending assume-announce' };
}

/**
 * Handle mid-execution decision (retry/skip/replan/abort)
 */
async function handleMidExecDecision(decision, tabId) {
  console.log('[Background] Mid-exec decision for tab', tabId, ':', decision);

  const pending = pendingMidExecDecisions.get(tabId);
  if (pending && pending.onDecision) {
    pending.onDecision(decision);
    pendingMidExecDecisions.delete(tabId);

    // Also update state
    await recordMidExecDecision(decision, tabId);

    return { success: true, message: `Decision recorded: ${decision}` };
  }

  return { success: false, error: 'No pending mid-exec decision' };
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

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// CDP Debugger Lifecycle
// ============================================================================

// Setup listener for user canceling via Chrome's native "Started debugging" banner
setupDebuggerDetachListener(async (tabId) => {
  console.log('[Background] User cancelled debugging via Chrome banner for tab', tabId);

  // Stop the agent task for this tab
  await stopAgentLoop(tabId);

  // Notify side panel
  notifySidePanel({
    type: 'taskStopped',
    status: 'stopped',
    reason: 'User cancelled via Chrome debugging banner',
    tabId
  });
});

console.log('[Background] Service worker started');
