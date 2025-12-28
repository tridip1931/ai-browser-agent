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
 * Default agent state
 */
const DEFAULT_STATE = {
  status: 'idle', // idle | running | paused | completed | error
  currentTask: null,
  actionHistory: [],
  startTime: null,
  lastActionTime: null,
  error: null,
  iteration: 0,
  maxIterations: 50,
  tabId: null
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
    currentTask: null
  }, tabId);
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
