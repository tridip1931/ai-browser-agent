/**
 * AI Browser Agent - State Manager
 *
 * Handles state persistence for service worker survival.
 * Service workers terminate after ~30 seconds of inactivity,
 * so we checkpoint state to chrome.storage.session after every action.
 *
 * State is now TAB-SPECIFIC - each tab has its own agent state.
 */

const STATE_KEY_PREFIX = 'agent-state-tab-';
const CONFIG_KEY = 'agent-config';

/**
 * Get the storage key for a specific tab
 * @param {number} tabId - Tab ID
 * @returns {string} Storage key
 */
function getStateKey(tabId) {
  if (!tabId) {
    console.warn('[StateManager] No tabId provided, using fallback');
    return 'agent-state-fallback';
  }
  return `${STATE_KEY_PREFIX}${tabId}`;
}

/**
 * V2 Status values (dialogue state machine)
 *
 * idle              → Ready for task
 * planning          → Analyzing task, building plan
 * clarifying        → Waiting for user answer to questions
 * refining          → Self-refine loop running
 * assume_announce   → Showing assumptions, auto-executing after delay
 * awaiting_approval → Plan displayed, waiting for Execute/Cancel
 * executing         → Running actions
 * mid_exec_dialog   → Paused for user decision on failure
 * replanning        → Building new plan from current state
 * completed         → Task finished successfully
 * error             → Task failed
 */

/**
 * Default dialogue state for V2
 */
const DEFAULT_DIALOGUE_STATE = {
  clarificationRound: 0,      // 0-3 (max 3 clarification rounds)
  maxClarificationRounds: 3,
  refineIteration: 0,         // 0-3 (max 3 refine iterations)
  maxRefineIterations: 3,
  pendingQuestions: [],       // Questions waiting for user answer
  assumptions: [],            // [{ field, assumedValue, confidence }]
  autoExecuteDelay: 3000,     // ms delay for assume+announce pattern
  autoExecuteTimerId: null    // Timer ID for cancellation
};

/**
 * Default execution state for V2
 */
const DEFAULT_EXECUTION_STATE = {
  currentStepIndex: 0,
  totalSteps: 0,
  completedSteps: [],         // [{ stepIndex, action, result, timestamp }]
  failedSteps: [],            // [{ stepIndex, error, retryCount, resolution }]
  checkpoint: null            // { beforeStepIndex, pageState, timestamp }
};

/**
 * Default confidence breakdown
 */
const DEFAULT_CONFIDENCE = {
  overall: 0,                 // 0-1 weighted average
  intentClarity: 0,           // 0-1 how clear is the user intent
  targetMatch: 0,             // 0-1 elementsFound / elementsNeeded
  valueConfidence: 0          // 0-1 valuesExplicit / valuesNeeded
};

/**
 * Default agent state (V2 extended)
 */
const DEFAULT_STATE = {
  // Core status (V2 dialogue state machine)
  status: 'idle', // idle | planning | clarifying | refining | assume_announce |
                  // awaiting_approval | executing | mid_exec_dialog |
                  // replanning | completed | error
  currentTask: null,
  actionHistory: [],
  startTime: null,
  lastActionTime: null,
  error: null,
  iteration: 0,
  maxIterations: 50,
  tabId: null,

  // V2: Conversation tracking
  conversationHistory: [],    // [{ role, content, timestamp, messageType }]

  // V2: Dialogue state
  dialogueState: { ...DEFAULT_DIALOGUE_STATE },

  // V2: Execution state
  executionState: { ...DEFAULT_EXECUTION_STATE },

  // V2: Plan tracking
  currentPlan: null,          // { id, version, summary, confidence, steps, assumptions, risks }
  planHistory: [],            // Previous plan versions for comparison

  // V2: Confidence
  confidence: { ...DEFAULT_CONFIDENCE }
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  backendUrl: 'http://localhost:3000',
  provider: 'groq', // Using Groq (free, ultra-fast llama-3.3-70b)
  includeScreenshots: false,
  confirmAllActions: false, // Auto-approve for Phase 4 testing
  maxIterations: 10, // Reduced to prevent runaway loops
  actionDelay: 1000 // ms between actions (increased for stability)
};

// ============================================================================
// State Management
// ============================================================================

/**
 * Load the current agent state for a specific tab
 * @param {number} tabId - Tab ID
 * @returns {Object} Current state or default
 */
export async function loadState(tabId) {
  try {
    const stateKey = getStateKey(tabId);
    const result = await chrome.storage.session.get(stateKey);
    const state = result[stateKey];

    if (!state) {
      console.log('[StateManager] No saved state for tab', tabId, '- using default');
      return { ...DEFAULT_STATE, tabId };
    }

    console.log('[StateManager] Loaded state for tab', tabId, ':', state.status);
    return state;
  } catch (error) {
    console.error('[StateManager] Failed to load state:', error);
    return { ...DEFAULT_STATE, tabId };
  }
}

/**
 * Save the current agent state for a specific tab
 * @param {Object} state - State to save
 * @param {number} tabId - Tab ID
 */
export async function saveState(state, tabId) {
  try {
    const stateKey = getStateKey(tabId);
    const stateWithTab = { ...state, tabId };
    await chrome.storage.session.set({ [stateKey]: stateWithTab });
    console.log('[StateManager] Saved state for tab', tabId, ':', state.status);
  } catch (error) {
    console.error('[StateManager] Failed to save state:', error);
    throw error;
  }
}

/**
 * Update specific fields in the state for a specific tab
 * @param {Object} updates - Fields to update
 * @param {number} tabId - Tab ID
 * @returns {Object} Updated state
 */
export async function updateState(updates, tabId) {
  const state = await loadState(tabId);
  const newState = { ...state, ...updates };
  await saveState(newState, tabId);
  return newState;
}

/**
 * Reset state to default for a specific tab
 * @param {number} tabId - Tab ID
 */
export async function resetState(tabId) {
  const state = { ...DEFAULT_STATE, tabId };
  await saveState(state, tabId);
  return state;
}

/**
 * Clear state for a specific tab (used when tab closes)
 * @param {number} tabId - Tab ID
 */
export async function clearTabState(tabId) {
  try {
    const stateKey = getStateKey(tabId);
    await chrome.storage.session.remove(stateKey);
    console.log('[StateManager] Cleared state for closed tab', tabId);
  } catch (error) {
    console.error('[StateManager] Failed to clear tab state:', error);
  }
}

/**
 * Add an action to the history for a specific tab
 * @param {Object} action - Action that was executed
 * @param {Object} result - Result of the action
 * @param {number} tabId - Tab ID
 */
export async function addActionToHistory(action, result, tabId) {
  const state = await loadState(tabId);

  const historyEntry = {
    ...action,
    result: result.success,
    error: result.error || null,
    timestamp: Date.now()
  };

  state.actionHistory.push(historyEntry);
  state.lastActionTime = Date.now();
  state.iteration++;

  // Keep only last 100 actions to prevent memory issues
  if (state.actionHistory.length > 100) {
    state.actionHistory = state.actionHistory.slice(-100);
  }

  await saveState(state, tabId);
  return state;
}

// ============================================================================
// Task Management
// ============================================================================

/**
 * Start a new task for a specific tab
 * @param {string} task - Task description
 * @param {number} tabId - Tab ID
 */
export async function startTask(task, tabId) {
  const state = {
    ...DEFAULT_STATE,
    status: 'running',
    currentTask: task,
    startTime: Date.now(),
    actionHistory: [],
    tabId
  };

  await saveState(state, tabId);
  return state;
}

/**
 * Complete the current task for a specific tab
 * @param {string} result - Completion message
 * @param {number} tabId - Tab ID
 */
export async function completeTask(result, tabId) {
  return await updateState({
    status: 'completed',
    result: result,
    lastActionTime: Date.now()
  }, tabId);
}

/**
 * Mark task as failed for a specific tab
 * @param {string} error - Error message
 * @param {number} tabId - Tab ID
 */
export async function failTask(error, tabId) {
  return await updateState({
    status: 'error',
    error: error,
    lastActionTime: Date.now()
  }, tabId);
}

/**
 * Pause the current task for a specific tab
 * @param {number} tabId - Tab ID
 */
export async function pauseTask(tabId) {
  return await updateState({
    status: 'paused'
  }, tabId);
}

/**
 * Resume a paused task for a specific tab
 * @param {number} tabId - Tab ID
 */
export async function resumeTask(tabId) {
  const state = await loadState(tabId);

  if (state.status !== 'paused') {
    throw new Error('No paused task to resume');
  }

  return await updateState({
    status: 'running'
  }, tabId);
}

/**
 * Stop the current task for a specific tab
 * @param {number} tabId - Tab ID
 */
export async function stopTask(tabId) {
  return await updateState({
    status: 'idle',
    currentTask: null,
    dialogueState: { ...DEFAULT_DIALOGUE_STATE },
    executionState: { ...DEFAULT_EXECUTION_STATE },
    currentPlan: null,
    confidence: { ...DEFAULT_CONFIDENCE }
  }, tabId);
}

// ============================================================================
// V2: Dialogue State Management
// ============================================================================

/**
 * Transition to a new dialogue state
 * @param {string} newStatus - New status value
 * @param {number} tabId - Tab ID
 * @param {Object} additionalUpdates - Additional state updates
 */
export async function transitionTo(newStatus, tabId, additionalUpdates = {}) {
  const validStatuses = [
    'idle', 'planning', 'clarifying', 'refining', 'assume_announce',
    'awaiting_approval', 'executing', 'mid_exec_dialog', 'replanning',
    'completed', 'error'
  ];

  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }

  console.log('[StateManager] Transitioning to:', newStatus);
  return await updateState({
    status: newStatus,
    lastActionTime: Date.now(),
    ...additionalUpdates
  }, tabId);
}

/**
 * Start planning phase
 * @param {string} task - Task description
 * @param {number} tabId - Tab ID
 */
export async function startPlanning(task, tabId) {
  const state = {
    ...DEFAULT_STATE,
    status: 'planning',
    currentTask: task,
    startTime: Date.now(),
    tabId,
    conversationHistory: [
      { role: 'user', content: task, timestamp: Date.now(), messageType: 'task' }
    ]
  };

  await saveState(state, tabId);
  return state;
}

/**
 * Enter clarifying state with questions
 * @param {Array} questions - Questions to ask user
 * @param {number} tabId - Tab ID
 */
export async function enterClarifying(questions, tabId) {
  const state = await loadState(tabId);

  const newDialogueState = {
    ...state.dialogueState,
    clarificationRound: state.dialogueState.clarificationRound + 1,
    pendingQuestions: questions
  };

  // Check if we've hit max rounds
  if (newDialogueState.clarificationRound > newDialogueState.maxClarificationRounds) {
    console.log('[StateManager] Max clarification rounds reached, proceeding with best effort');
    return await transitionTo('awaiting_approval', tabId);
  }

  return await updateState({
    status: 'clarifying',
    dialogueState: newDialogueState,
    conversationHistory: [
      ...state.conversationHistory,
      {
        role: 'assistant',
        content: questions.map(q => q.question || q).join('\n'),
        timestamp: Date.now(),
        messageType: 'clarification'
      }
    ]
  }, tabId);
}

/**
 * Record user's clarification answer
 * @param {string} answer - User's answer
 * @param {string} selectedOptionId - Selected option ID if applicable
 * @param {number} tabId - Tab ID
 */
export async function recordClarificationAnswer(answer, selectedOptionId, tabId) {
  const state = await loadState(tabId);

  return await updateState({
    dialogueState: {
      ...state.dialogueState,
      pendingQuestions: [] // Clear pending questions
    },
    conversationHistory: [
      ...state.conversationHistory,
      {
        role: 'user',
        content: answer,
        timestamp: Date.now(),
        messageType: 'clarification_answer',
        selectedOptionId
      }
    ]
  }, tabId);
}

/**
 * Enter assume-announce state with assumptions
 * @param {Array} assumptions - Assumptions being made
 * @param {Object} plan - The plan to execute
 * @param {number} tabId - Tab ID
 */
export async function enterAssumeAnnounce(assumptions, plan, tabId) {
  const state = await loadState(tabId);

  return await updateState({
    status: 'assume_announce',
    dialogueState: {
      ...state.dialogueState,
      assumptions
    },
    currentPlan: plan,
    conversationHistory: [
      ...state.conversationHistory,
      {
        role: 'assistant',
        content: `Proceeding with assumptions: ${assumptions.map(a => `${a.field}: ${a.assumedValue}`).join(', ')}`,
        timestamp: Date.now(),
        messageType: 'assume_announce'
      }
    ]
  }, tabId);
}

/**
 * Enter refining state for self-refine loop
 * @param {number} tabId - Tab ID
 */
export async function enterRefining(tabId) {
  const state = await loadState(tabId);

  return await updateState({
    status: 'refining',
    dialogueState: {
      ...state.dialogueState,
      refineIteration: state.dialogueState.refineIteration + 1
    }
  }, tabId);
}

/**
 * Set the current plan with confidence
 * @param {Object} plan - Plan object with steps, summary, confidence
 * @param {Object} confidence - Confidence breakdown
 * @param {number} tabId - Tab ID
 */
export async function setPlan(plan, confidence, tabId) {
  const state = await loadState(tabId);

  // Add to plan history before replacing
  const planHistory = state.currentPlan
    ? [...state.planHistory, state.currentPlan]
    : state.planHistory;

  return await updateState({
    currentPlan: {
      ...plan,
      id: `plan-${Date.now()}`,
      version: planHistory.length + 1,
      createdAt: Date.now()
    },
    planHistory,
    confidence
  }, tabId);
}

/**
 * Enter mid-execution dialogue state
 * @param {Object} failedStep - The step that failed
 * @param {string} error - Error message
 * @param {number} tabId - Tab ID
 */
export async function enterMidExecDialog(failedStep, error, tabId) {
  const state = await loadState(tabId);

  // Record the failure
  const failedSteps = [
    ...state.executionState.failedSteps,
    {
      stepIndex: state.executionState.currentStepIndex,
      error,
      retryCount: 0,
      resolution: null,
      timestamp: Date.now()
    }
  ];

  return await updateState({
    status: 'mid_exec_dialog',
    executionState: {
      ...state.executionState,
      failedSteps
    }
  }, tabId);
}

/**
 * Record mid-execution decision
 * @param {string} decision - 'retry' | 'skip' | 'replan' | 'abort'
 * @param {number} tabId - Tab ID
 */
export async function recordMidExecDecision(decision, tabId) {
  const state = await loadState(tabId);

  // Update the last failed step with resolution
  const failedSteps = [...state.executionState.failedSteps];
  if (failedSteps.length > 0) {
    failedSteps[failedSteps.length - 1].resolution = decision;
  }

  let newStatus;
  switch (decision) {
    case 'retry':
    case 'skip':
      newStatus = 'executing';
      break;
    case 'replan':
      newStatus = 'replanning';
      break;
    case 'abort':
      newStatus = 'idle';
      break;
    default:
      newStatus = 'executing';
  }

  return await updateState({
    status: newStatus,
    executionState: {
      ...state.executionState,
      failedSteps,
      currentStepIndex: decision === 'skip'
        ? state.executionState.currentStepIndex + 1
        : state.executionState.currentStepIndex
    }
  }, tabId);
}

/**
 * Update execution progress
 * @param {number} stepIndex - Current step index
 * @param {Object} result - Step result
 * @param {number} tabId - Tab ID
 */
export async function updateExecutionProgress(stepIndex, result, tabId) {
  const state = await loadState(tabId);

  const completedSteps = [
    ...state.executionState.completedSteps,
    {
      stepIndex,
      action: state.currentPlan?.steps?.[stepIndex] || null,
      result,
      timestamp: Date.now()
    }
  ];

  return await updateState({
    executionState: {
      ...state.executionState,
      currentStepIndex: stepIndex + 1,
      completedSteps
    }
  }, tabId);
}

/**
 * Create execution checkpoint
 * @param {Object} pageState - Current page state
 * @param {number} tabId - Tab ID
 */
export async function createCheckpoint(pageState, tabId) {
  const state = await loadState(tabId);

  return await updateState({
    executionState: {
      ...state.executionState,
      checkpoint: {
        beforeStepIndex: state.executionState.currentStepIndex,
        pageState,
        timestamp: Date.now()
      }
    }
  }, tabId);
}

/**
 * Start execution phase
 * @param {number} tabId - Tab ID
 */
export async function startExecution(tabId) {
  const state = await loadState(tabId);

  return await updateState({
    status: 'executing',
    executionState: {
      ...DEFAULT_EXECUTION_STATE,
      totalSteps: state.currentPlan?.steps?.length || 0
    }
  }, tabId);
}

// ============================================================================
// V2: Confidence Helpers
// ============================================================================

/**
 * Calculate confidence zone based on overall score
 * @param {number} confidence - Overall confidence 0-1
 * @returns {string} 'ask' | 'assume_announce' | 'proceed'
 */
export function getConfidenceZone(confidence) {
  if (confidence >= 0.9) return 'proceed';
  if (confidence >= 0.5) return 'assume_announce';
  return 'ask';
}

/**
 * Check if we should ask for clarification
 * @param {Object} confidence - Confidence breakdown
 * @returns {boolean}
 */
export function shouldAsk(confidence) {
  return getConfidenceZone(confidence.overall) === 'ask';
}

/**
 * Check if we should assume and announce
 * @param {Object} confidence - Confidence breakdown
 * @returns {boolean}
 */
export function shouldAssumeAnnounce(confidence) {
  return getConfidenceZone(confidence.overall) === 'assume_announce';
}

/**
 * Check if we should proceed directly
 * @param {Object} confidence - Confidence breakdown
 * @returns {boolean}
 */
export function shouldProceed(confidence) {
  return getConfidenceZone(confidence.overall) === 'proceed';
}

// ============================================================================
// Configuration Management (Global - shared across tabs)
// ============================================================================

/**
 * Load configuration
 */
export async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    return { ...DEFAULT_CONFIG, ...result[CONFIG_KEY] };
  } catch (error) {
    console.error('[StateManager] Failed to load config:', error);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration
 */
export async function saveConfig(config) {
  try {
    const newConfig = { ...DEFAULT_CONFIG, ...config };
    await chrome.storage.local.set({ [CONFIG_KEY]: newConfig });
    return newConfig;
  } catch (error) {
    console.error('[StateManager] Failed to save config:', error);
    throw error;
  }
}

/**
 * Update specific config fields
 */
export async function updateConfig(updates) {
  const config = await loadConfig();
  const newConfig = { ...config, ...updates };
  return await saveConfig(newConfig);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if the agent is currently running for a specific tab
 * @param {number} tabId - Tab ID
 */
export async function isRunning(tabId) {
  const state = await loadState(tabId);
  return state.status === 'running';
}

/**
 * Check if max iterations reached for a specific tab
 * @param {number} tabId - Tab ID
 */
export async function hasReachedMaxIterations(tabId) {
  const state = await loadState(tabId);
  const config = await loadConfig();
  return state.iteration >= config.maxIterations;
}

/**
 * Get a summary of the current state for display
 * @param {number} tabId - Tab ID
 */
export async function getStateSummary(tabId) {
  const state = await loadState(tabId);
  const config = await loadConfig();

  return {
    status: state.status,
    task: state.currentTask,
    iteration: state.iteration,
    maxIterations: config.maxIterations,
    actionsCount: state.actionHistory.length,
    lastAction: state.actionHistory[state.actionHistory.length - 1] || null,
    duration: state.startTime ? Date.now() - state.startTime : 0,
    error: state.error,
    tabId: state.tabId
  };
}

/**
 * Get all active tab states (for debugging)
 */
export async function getAllTabStates() {
  try {
    const allData = await chrome.storage.session.get(null);
    const tabStates = {};

    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith(STATE_KEY_PREFIX)) {
        tabStates[key] = value;
      }
    }

    return tabStates;
  } catch (error) {
    console.error('[StateManager] Failed to get all tab states:', error);
    return {};
  }
}
