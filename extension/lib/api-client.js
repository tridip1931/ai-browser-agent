/**
 * AI Browser Agent - API Client
 *
 * Handles communication with the backend proxy server.
 */

import { loadConfig } from './state-manager.js';

/**
 * Get the next action from the LLM via backend
 * @param {Object} params - Request parameters
 * @returns {Object} Action to execute
 */
export async function getNextAction(params) {
  const {
    task,
    currentUrl,
    elements,
    screenshot,
    actionHistory,
    taskType = 'multi-step'
  } = params;

  const config = await loadConfig();

  console.log('[APIClient] Requesting next action from backend');

  try {
    const response = await fetch(`${config.backendUrl}/api/reason`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task,
        currentUrl,
        elements,
        screenshot: config.includeScreenshots ? screenshot : undefined,
        actionHistory,
        provider: config.provider,
        taskType
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // Check for injection warning
      if (error.requiresConfirmation) {
        return {
          action: 'confirm',
          requiresConfirmation: true,
          reason: error.error || 'Suspicious content detected',
          details: error.details
        };
      }

      throw new Error(error.error || `Backend error: ${response.status}`);
    }

    const action = await response.json();
    console.log('[APIClient] Received action:', action.action);

    return action;

  } catch (error) {
    console.error('[APIClient] Request failed:', error);

    // Check if backend is unreachable
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Cannot reach backend server. Is it running at ' + config.backendUrl + '?');
    }

    throw error;
  }
}

/**
 * Get execution plan from LLM via backend
 * @param {Object} params - Planning parameters
 * @returns {Object} Plan with steps or clarifying questions
 */
export async function getPlan(params) {
  const {
    task,
    currentUrl,
    elements,
    screenshot,
    conversationHistory = []
  } = params;

  const config = await loadConfig();

  console.log('[APIClient] Requesting plan from backend');

  try {
    const response = await fetch(`${config.backendUrl}/api/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task,
        currentUrl,
        elements,
        screenshot: config.includeScreenshots ? screenshot : undefined,
        conversationHistory,
        provider: config.provider
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // Check for injection warning
      if (error.requiresConfirmation) {
        return {
          error: true,
          requiresConfirmation: true,
          message: error.error || 'Suspicious content detected'
        };
      }

      throw new Error(error.error || `Backend error: ${response.status}`);
    }

    const plan = await response.json();
    console.log('[APIClient] Received plan:', plan.understood ? `${plan.steps?.length} steps` : 'needs clarification');

    return plan;

  } catch (error) {
    console.error('[APIClient] Plan request failed:', error);

    // Check if backend is unreachable
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Cannot reach backend server. Is it running at ' + config.backendUrl + '?');
    }

    throw error;
  }
}

/**
 * Verify an action was successful
 * @param {Object} action - Action that was executed
 * @param {Object} beforeState - State before action
 * @param {Object} afterState - State after action
 * @returns {Object} Verification result
 */
export async function verifyAction(action, beforeState, afterState) {
  const config = await loadConfig();

  try {
    const response = await fetch(`${config.backendUrl}/api/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action,
        beforeState,
        afterState
      })
    });

    if (!response.ok) {
      // Verification endpoint is optional, don't fail if not available
      console.log('[APIClient] Verification endpoint not available');
      return { success: true, verified: false };
    }

    return await response.json();

  } catch (error) {
    console.log('[APIClient] Verification failed, continuing:', error.message);
    return { success: true, verified: false };
  }
}

/**
 * Check backend health
 * @returns {Object} Health status
 */
export async function checkBackendHealth() {
  const config = await loadConfig();

  try {
    const response = await fetch(`${config.backendUrl}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return {
        healthy: false,
        error: `Backend returned ${response.status}`
      };
    }

    const health = await response.json();
    return {
      healthy: true,
      ...health
    };

  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  }
}

/**
 * Get usage statistics
 * @returns {Object} Usage stats
 */
export async function getUsageStats() {
  const config = await loadConfig();

  try {
    const response = await fetch(`${config.backendUrl}/api/usage`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();

  } catch (error) {
    console.log('[APIClient] Usage stats not available');
    return null;
  }
}

/**
 * Test connection to backend
 * @returns {boolean} True if connected
 */
export async function testConnection() {
  const health = await checkBackendHealth();
  return health.healthy;
}
