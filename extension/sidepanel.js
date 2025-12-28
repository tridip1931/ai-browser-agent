/**
 * AI Browser Agent - Side Panel UI (sidepanel.js)
 *
 * Responsibilities:
 * - Handle user input and task submission
 * - Display chat messages and agent progress
 * - Show confirmation dialogs for risky actions
 * - Communicate with background service worker
 *
 * Now TAB-AWARE - each side panel instance is tied to a specific tab.
 */

// ============================================================================
// State
// ============================================================================

const state = {
  isRunning: false,
  currentTask: null,
  messages: [],
  currentTabId: null,  // Tab this side panel is associated with
  awaitingClarification: false,  // True when waiting for user to answer clarifying questions
  pendingPlan: null  // Store pending plan for approval
};

// ============================================================================
// Debug Logging System
// ============================================================================

const debugLog = [];
const MAX_DEBUG_ENTRIES = 500;

function logDebug(category, message, data = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    data: data ? JSON.parse(JSON.stringify(data)) : null,
    tabId: state.currentTabId
  };
  debugLog.push(entry);

  // Keep log size manageable
  if (debugLog.length > MAX_DEBUG_ENTRIES) {
    debugLog.shift();
  }

  // Also log to console with formatting
  const prefix = `[${category}] Tab ${state.currentTabId}:`;
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

function getDebugLogText() {
  const lines = debugLog.map(entry => {
    const dataStr = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
    return `${entry.timestamp} [${entry.category}] Tab ${entry.tabId}: ${entry.message}${dataStr}`;
  });
  return lines.join('\n');
}

function copyDebugLog() {
  const logText = getDebugLogText();
  navigator.clipboard.writeText(logText).then(() => {
    addMessage('system', 'Debug log copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy debug log:', err);
    addMessage('error', 'Failed to copy debug log');
  });
}

function clearDebugLog() {
  debugLog.length = 0;
  addMessage('system', 'Debug log cleared');
}

// Expose for console access
window.getDebugLog = () => debugLog;
window.copyDebugLog = copyDebugLog;
window.getDebugLogText = getDebugLogText;

// ============================================================================
// DOM Elements - initialized in DOMContentLoaded
// ============================================================================

let elements = {};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[SidePanel] Initializing...');

  // Initialize DOM elements now that DOM is ready
  // Note: Plan, clarify, and progress are now dynamically created as chat messages
  elements = {
    chatContainer: document.getElementById('chat-container'),
    emptyState: document.getElementById('empty-state'),
    taskInput: document.getElementById('task-input'),
    sendBtn: document.getElementById('send-btn'),
    statusBadge: document.getElementById('status-badge'),
    debugBtn: document.getElementById('debug-btn'),
    headerTitle: document.querySelector('.header-title')
  };

  // Debug: Log which elements were found
  console.log('[SidePanel] Elements check:', {
    chatContainer: !!elements.chatContainer,
    emptyState: !!elements.emptyState,
    taskInput: !!elements.taskInput,
    sendBtn: !!elements.sendBtn
  });

  // Capture the current tab this side panel is associated with
  await captureCurrentTab();

  // Notify background that side panel opened (for tab grouping)
  sendToBackground({
    action: 'sidePanelOpened',
    tabId: state.currentTabId
  }).catch(err => {
    console.log('[SidePanel] Could not notify background:', err);
  });

  // Set up event listeners
  setupEventListeners();

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  // Get initial status for this tab
  getAgentStatus();

  logDebug('SidePanel', 'Initialized for tab', { tabId: state.currentTabId });
});

/**
 * Capture the current tab ID when side panel opens
 */
async function captureCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      state.currentTabId = tab.id;
      state.currentTabTitle = tab.title;
      console.log('[SidePanel] Associated with tab:', tab.id, '-', tab.title);

      // Update header to show tab context
      updateHeaderForTab(tab);
    } else {
      console.warn('[SidePanel] Could not determine current tab');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to get current tab:', error);
  }
}

/**
 * Update header to show current tab context
 */
function updateHeaderForTab(tab) {
  if (elements.headerTitle) {
    // Show truncated title
    const maxLen = 25;
    const shortTitle = tab.title.length > maxLen
      ? tab.title.substring(0, maxLen) + '...'
      : tab.title;
    elements.headerTitle.textContent = shortTitle;
    elements.headerTitle.title = tab.title; // Full title on hover
  }
}

function setupEventListeners() {
  // Send button click
  elements.sendBtn.addEventListener('click', handleSubmit);

  // Enter key to submit
  elements.taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  });

  // Example task clicks
  document.querySelectorAll('.example-item').forEach(item => {
    item.addEventListener('click', () => {
      const task = item.dataset.task;
      elements.taskInput.value = task;
      handleSubmit();
    });
  });

  // Debug button click
  if (elements.debugBtn) {
    elements.debugBtn.addEventListener('click', copyDebugLog);
  }

  // Note: Plan approval and clarification buttons are now dynamically attached
  // when the plan/clarify cards are created
}

// ============================================================================
// Task Submission
// ============================================================================

async function handleSubmit() {
  const input = elements.taskInput.value.trim();

  if (!input) return;

  // Clear input immediately
  elements.taskInput.value = '';

  // Hide empty state
  hideEmptyState();

  // Add user message
  addMessage('user', input);

  // Check if we're awaiting clarification
  if (state.awaitingClarification) {
    logDebug('SidePanel', 'Submitting clarification answer', { answer: input });
    state.awaitingClarification = false;

    // Update input placeholder back to normal
    elements.taskInput.placeholder = 'Describe what you want me to do...';

    addMessage('system', 'Processing your answer...');

    try {
      await sendToBackground({
        action: 'submitClarification',
        answer: input,
        tabId: state.currentTabId
      });
    } catch (error) {
      logDebug('Clarify', 'Submit clarification error', { error: error.message });
      addMessage('error', `Error: ${error.message}`);
      setRunningState(false);
    }
    return;
  }

  // Check if task is running (stop it)
  if (state.isRunning) {
    await stopTask();
    return;
  }

  // Start new task
  await startTask(input);
}

async function startTask(task) {
  logDebug('SidePanel', 'Starting task', { task, tabId: state.currentTabId });

  if (!state.currentTabId) {
    addMessage('error', 'Error: Could not determine current tab. Please refresh.');
    return;
  }

  setRunningState(true);
  state.currentTask = task;

  try {
    logDebug('SidePanel', 'Sending startTask to background');
    const response = await sendToBackground({
      action: 'startTask',
      task: task,
      tabId: state.currentTabId  // Include tab ID
    });

    logDebug('SidePanel', 'Received response from background', response);

    if (!response.success) {
      throw new Error(response.error || 'Failed to start task');
    }

    addMessage('system', 'Task started. Analyzing page...');
  } catch (error) {
    logDebug('SidePanel', 'Start task error', { error: error.message });
    addMessage('error', `Error: ${error.message}`);
    setRunningState(false);
  }
}

async function stopTask() {
  logDebug('SidePanel', 'Stopping task', { tabId: state.currentTabId });

  try {
    await sendToBackground({
      action: 'stopTask',
      tabId: state.currentTabId  // Include tab ID
    });
    addMessage('system', 'Task stopped by user');
  } catch (error) {
    console.error('[SidePanel] Stop task error:', error);
  }

  setRunningState(false);
}

// ============================================================================
// Background Communication
// ============================================================================

function sendToBackground(message) {
  // Always include the current tab ID
  const messageWithTab = {
    ...message,
    tabId: state.currentTabId
  };

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(messageWithTab, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function handleBackgroundMessage(message, sender, sendResponse) {
  // Only process messages for this tab (or messages without tabId for backwards compat)
  if (message.tabId && message.tabId !== state.currentTabId) {
    // Message is for a different tab, ignore it
    return;
  }

  logDebug('SidePanel', 'Received message from background', message);

  if (message.source !== 'background') return;

  switch (message.type) {
    case 'taskStarted':
      logDebug('Task', 'Task started', { task: message.task });
      setRunningState(true);
      break;

    case 'taskStopped':
      logDebug('Task', 'Task stopped');
      setRunningState(false);
      addMessage('system', 'Task stopped');
      break;

    case 'taskCompleted':
      logDebug('Task', 'Task completed', { reasoning: message.reasoning });
      setRunningState(false);
      addMessage('agent', message.reasoning || message.result || 'Task completed successfully!');
      break;

    case 'taskError':
      logDebug('Task', 'Task error', { error: message.error });
      setRunningState(false);
      addMessage('error', `Error: ${message.error}`);
      break;

    case 'agentProgress':
      logDebug('Progress', message.status, message);
      addMessage('system', message.status);
      break;

    case 'progress':
      // Handle progress updates from agent loop
      logDebug('Progress', message.message || message.step, message);
      if (message.message) {
        // Format based on progress phase
        if (message.step === 'planning' || message.step === 'approval') {
          addMessage('system', message.message);
        } else if (message.current && message.total) {
          // Execution progress with step numbers
          addMessage('system', `[${message.current}/${message.total}] ${message.message}`);
          // Also update the plan card step highlighting
          updateExecutionProgress(message);
        } else {
          addMessage('system', message.message);
        }
      }
      break;

    case 'agentThinking':
      logDebug('Agent', 'Thinking', { reasoning: message.reasoning });
      addMessage('agent', message.reasoning);
      break;

    case 'actionExecuted':
      logDebug('Action', 'Action executed', {
        action: message.action,
        result: message.result
      });
      // Update the in-progress card if it exists, otherwise create new card
      if (state.currentActionCardId) {
        const status = message.result?.success !== false ? 'success' : 'failed';
        updateActionCard(state.currentActionCardId, status, message.result);
        state.currentActionCardId = null;
      } else {
        // Fallback: create a new card if we didn't have one in progress
        const status = message.result?.success !== false ? 'success' : 'failed';
        showActionCard(message.action, status, message.result);
      }
      break;

    case 'actionStarted':
      // Show action card in progress
      logDebug('Action', 'Action started', { action: message.action });
      state.currentActionCardId = showActionCard(message.action, 'in-progress');
      break;

    case 'confirmAction':
      logDebug('Confirm', 'Confirmation required', message);
      showConfirmation(message);
      break;

    case 'planReady':
      logDebug('Plan', 'Plan ready for approval', message.plan);
      displayPlan(message.plan);
      break;

    case 'clarifyNeeded':
      logDebug('Clarify', 'Clarification needed', message.questions);
      displayClarifyingQuestions(message.questions);
      break;

    case 'executionProgress':
      logDebug('Execution', 'Progress update', message);
      updateExecutionProgress(message);
      break;

    default:
      logDebug('SidePanel', 'Unknown message type', { type: message.type });
  }

  sendResponse({ received: true });
  return true;
}

async function getAgentStatus() {
  try {
    const response = await sendToBackground({
      action: 'getStatus',
      tabId: state.currentTabId
    });

    logDebug('SidePanel', 'Got agent status', response);

    if (response.status === 'running') {
      setRunningState(true);
      state.currentTask = response.task;
      hideEmptyState();
      addMessage('system', `Task in progress: ${response.task || 'Unknown task'}`);
    } else if (response.status === 'awaiting_clarification') {
      // Tab has pending clarification - need input enabled
      setRunningState(true);
      state.currentTask = response.task;
      state.awaitingClarification = true;
      hideEmptyState();
      addMessage('system', 'Waiting for your clarification...');
      // Re-enable input for clarification
      elements.taskInput.disabled = false;
      elements.taskInput.placeholder = 'Type your answer...';
      elements.taskInput.focus();
    } else if (response.hasPendingPlan) {
      // Tab has a pending plan awaiting approval
      setRunningState(true);
      state.currentTask = response.task;
      hideEmptyState();
      addMessage('system', 'Plan awaiting approval');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to get status:', error);
  }
}

// ============================================================================
// UI Updates
// ============================================================================

function addMessage(type, content) {
  hideEmptyState();

  const messageEl = document.createElement('div');
  messageEl.className = `message ${type}`;
  messageEl.textContent = content;

  elements.chatContainer.appendChild(messageEl);
  scrollToBottom();

  state.messages.push({ type, content, timestamp: Date.now() });
}

/**
 * Show an action card in the chat
 * @param {Object} action - The action being executed
 * @param {string} status - 'in-progress', 'success', or 'failed'
 * @param {Object} result - Optional result object with success/error
 */
function showActionCard(action, status = 'in-progress', result = null) {
  hideEmptyState();

  // Get action details
  const actionType = action.action || action.type || 'action';
  const target = action.targetDescription || action.targetId || '';
  const value = action.value || '';

  // Icon based on action type
  const actionIcons = {
    'click': '👆',
    'type': '⌨️',
    'scroll': '📜',
    'wait': '⏳',
    'select': '📋',
    'hover': '👋',
    'done': '✅'
  };

  const icon = actionIcons[actionType] || '⚡';

  // Status icon
  const statusIcons = {
    'in-progress': '<div class="spinner"></div>',
    'success': '✓',
    'failed': '✕'
  };

  // Human-readable action description
  const actionDescriptions = {
    'click': `Clicking on`,
    'type': `Typing into`,
    'scroll': action.amount > 0 ? 'Scrolling down' : 'Scrolling up',
    'wait': 'Waiting',
    'select': 'Selecting from',
    'hover': 'Hovering over',
    'done': 'Completed'
  };

  const actionDesc = actionDescriptions[actionType] || actionType;

  // Create action card
  const cardEl = document.createElement('div');
  cardEl.className = `action-card ${status}`;
  cardEl.id = `action-${Date.now()}`;

  let cardContent = `
    <div class="action-icon">${status === 'in-progress' ? statusIcons['in-progress'] : icon}</div>
    <div class="action-content">
      <div class="action-type">
        ${actionDesc}
        <span class="badge">${status === 'in-progress' ? 'running' : status}</span>
      </div>
      ${target ? `<div class="action-target">${target}</div>` : ''}
      ${value ? `<div class="action-value">"${value}"</div>` : ''}
    </div>
  `;

  // Add error message if failed
  if (status === 'failed' && result?.error) {
    cardContent += `<div class="action-time" style="color: #dc3545;">${result.error}</div>`;
  }

  cardEl.innerHTML = cardContent;
  elements.chatContainer.appendChild(cardEl);
  scrollToBottom();

  return cardEl.id;
}

/**
 * Update an existing action card's status
 * @param {string} cardId - The card element ID
 * @param {string} status - 'success' or 'failed'
 * @param {Object} result - Optional result object
 */
function updateActionCard(cardId, status, result = null) {
  const cardEl = document.getElementById(cardId);
  if (!cardEl) return;

  // Update class
  cardEl.classList.remove('in-progress');
  cardEl.classList.add(status);

  // Update icon
  const iconEl = cardEl.querySelector('.action-icon');
  if (iconEl) {
    iconEl.innerHTML = status === 'success' ? '✓' : '✕';
  }

  // Update badge
  const badgeEl = cardEl.querySelector('.badge');
  if (badgeEl) {
    badgeEl.textContent = status;
  }

  // Add error if failed
  if (status === 'failed' && result?.error) {
    const timeEl = cardEl.querySelector('.action-time');
    if (timeEl) {
      timeEl.style.color = '#dc3545';
      timeEl.textContent = result.error;
    }
  }
}

/**
 * Legacy function for backwards compatibility
 */
function addActionLog(action) {
  showActionCard(action, 'success');
}

function showConfirmation(message) {
  const confirmEl = document.createElement('div');
  confirmEl.className = 'confirmation';
  confirmEl.innerHTML = `
    <div class="confirmation-title">Confirm Action</div>
    <div class="confirmation-text">
      ${message.description || `Perform ${message.actionType} action?`}
    </div>
    <div class="confirmation-actions">
      <button class="btn btn-primary" data-action="allow">Allow</button>
      <button class="btn btn-danger" data-action="deny">Deny</button>
    </div>
  `;

  const buttons = confirmEl.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const decision = btn.dataset.action;
      confirmEl.remove();

      await sendToBackground({
        action: 'confirmationResponse',
        requestId: message.requestId,
        decision: decision,
        tabId: state.currentTabId
      });

      addMessage('system', decision === 'allow' ? 'Action allowed' : 'Action denied');
    });
  });

  elements.chatContainer.appendChild(confirmEl);
  scrollToBottom();
}

function setRunningState(running) {
  state.isRunning = running;

  // Update status badge
  elements.statusBadge.textContent = running ? 'Running' : 'Ready';
  elements.statusBadge.className = `header-status ${running ? 'running' : ''}`;

  // Update input state
  elements.taskInput.disabled = running;
  elements.taskInput.placeholder = running
    ? 'Task in progress...'
    : 'Describe what you want me to do...';

  // Update button
  if (running) {
    elements.sendBtn.classList.add('stop-btn');
    elements.sendBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12"/>
      </svg>
    `;
    elements.sendBtn.title = 'Stop';
  } else {
    elements.sendBtn.classList.remove('stop-btn');
    elements.sendBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"/>
      </svg>
    `;
    elements.sendBtn.title = 'Send';
  }
}

function hideEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.style.display = 'none';
  }
}

function scrollToBottom() {
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// ============================================================================
// Utilities
// ============================================================================

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ============================================================================
// Plan Display - Now rendered as chat message card
// ============================================================================

function displayPlan(plan) {
  hideEmptyState();

  // Remove any existing plan card
  const existingPlan = document.getElementById('current-plan');
  if (existingPlan) {
    existingPlan.remove();
  }

  // Create plan card as chat message
  const planCard = document.createElement('div');
  planCard.className = 'message agent plan-card';
  planCard.id = 'current-plan';

  // Format action for human readability
  const formatAction = (step) => {
    const action = step.action;
    const target = step.targetDescription || step.targetId || '';

    switch (action) {
      case 'click':
        return `Click on "${target}"`;
      case 'type':
        return `Type "${step.value || ''}" into ${target}`;
      case 'scroll':
        return step.amount > 0 ? 'Scroll down' : 'Scroll up';
      case 'select':
        return `Select "${step.value || ''}" from ${target}`;
      case 'wait':
        return 'Wait for page to update';
      default:
        return `${action}: ${target}`;
    }
  };

  planCard.innerHTML = `
    <div class="plan-header">
      <strong>Here's my plan:</strong>
      ${plan.summary ? `<div class="plan-summary">${plan.summary}</div>` : ''}
    </div>
    <div class="plan-steps">
      ${plan.steps.map((step, i) => `
        <div class="plan-step" data-step="${i}">
          <span class="step-num">${step.step || i + 1}</span>
          <span class="step-content">
            <span class="step-action">${formatAction(step)}</span>
            ${step.expectedResult ? `<br><small class="step-expected">→ ${step.expectedResult}</small>` : ''}
          </span>
        </div>
      `).join('')}
    </div>
    ${plan.risks && plan.risks.length > 0 ? `<div class="plan-risks">⚠️ ${plan.risks.join(', ')}</div>` : ''}
    <div class="plan-actions">
      <button class="btn btn-primary" id="approve-plan-btn">Execute</button>
      <button class="btn btn-secondary" id="reject-plan-btn">Cancel</button>
    </div>
  `;

  elements.chatContainer.appendChild(planCard);
  scrollToBottom();

  // Attach event listeners to the new buttons
  planCard.querySelector('#approve-plan-btn').addEventListener('click', handleApprovePlan);
  planCard.querySelector('#reject-plan-btn').addEventListener('click', handleRejectPlan);

  // Store plan for reference
  state.pendingPlan = plan;

  logDebug('Plan', 'Plan displayed as chat card', { stepsCount: plan.steps?.length });
}

function hidePlanContainer() {
  // Remove the plan card from chat
  const planCard = document.getElementById('current-plan');
  if (planCard) {
    planCard.remove();
  }
  state.pendingPlan = null;
}

async function handleApprovePlan() {
  logDebug('Plan', 'User approved plan');

  // Disable the buttons to prevent double-click
  const planCard = document.getElementById('current-plan');
  if (planCard) {
    const approveBtn = planCard.querySelector('#approve-plan-btn');
    const rejectBtn = planCard.querySelector('#reject-plan-btn');
    if (approveBtn) approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
  }

  addMessage('agent', 'Plan approved. Starting execution...');

  try {
    await sendToBackground({
      action: 'approvePlan',
      tabId: state.currentTabId
    });
  } catch (error) {
    logDebug('Plan', 'Approve plan error', { error: error.message });
    addMessage('error', `Error: ${error.message}`);
  }
}

async function handleRejectPlan() {
  logDebug('Plan', 'User rejected plan');

  hidePlanContainer();
  setRunningState(false);
  addMessage('system', 'Plan cancelled');

  try {
    await sendToBackground({
      action: 'rejectPlan',
      tabId: state.currentTabId
    });
  } catch (error) {
    logDebug('Plan', 'Reject plan error', { error: error.message });
  }
}

// ============================================================================
// Clarifying Questions - Now rendered as chat message card
// ============================================================================

function displayClarifyingQuestions(questions) {
  const questionList = Array.isArray(questions) ? questions : [questions];

  // Don't show clarification UI if no questions or empty questions
  if (questionList.length === 0 || (questionList.length === 1 && !questionList[0])) {
    logDebug('Clarify', 'No questions to display, skipping');
    return;
  }

  hideEmptyState();

  // Create a chat message card for clarification
  const clarifyCard = document.createElement('div');
  clarifyCard.className = 'message agent clarify-card';
  clarifyCard.innerHTML = `
    <div class="clarify-header">I need some clarification:</div>
    <div class="clarify-questions">
      ${questionList.map(q => `<div class="clarify-question">• ${q}</div>`).join('')}
    </div>
  `;

  elements.chatContainer.appendChild(clarifyCard);
  scrollToBottom();

  // Set state so main input knows to handle as clarification
  state.awaitingClarification = true;

  // Enable input for clarification response
  elements.taskInput.disabled = false;
  elements.taskInput.placeholder = 'Type your answer...';
  elements.taskInput.focus();

  logDebug('Clarify', 'Questions displayed as chat card', { count: questionList.length });
}

// ============================================================================
// Execution Progress - Now shown as system messages + step highlighting
// ============================================================================

function updateExecutionProgress(progress) {
  // Only add message if we have meaningful info
  if (progress.current && progress.total) {
    addMessage('system', `[${progress.current}/${progress.total}] ${progress.message || 'Executing...'}`);
  }

  // Update step styling in the plan card if visible
  const planCard = document.getElementById('current-plan');
  if (planCard && progress.current) {
    const steps = planCard.querySelectorAll('.plan-step');
    steps.forEach((stepEl, index) => {
      if (index < progress.current - 1) {
        stepEl.classList.add('completed');
        stepEl.classList.remove('running');
      } else if (index === progress.current - 1) {
        stepEl.classList.add('running');
        stepEl.classList.remove('completed');
      } else {
        stepEl.classList.remove('completed', 'running');
      }
    });
  }
}

console.log('[SidePanel] Script loaded');
