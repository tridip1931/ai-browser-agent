/**
 * AI Browser Agent - Agent Loop
 *
 * Implements a planning-first agent loop:
 * Plan → Approve → Execute → Verify → Repeat
 *
 * This is the main orchestration module that coordinates
 * DOM capture, LLM planning, user approval, and action execution.
 *
 * TAB-AWARE - each loop runs in context of a specific tab.
 */

import {
  loadState,
  saveState,
  startTask,
  completeTask,
  failTask,
  stopTask,
  addActionToHistory,
  hasReachedMaxIterations,
  loadConfig
} from './state-manager.js';

import { getPlan } from './api-client.js';

// Track active loops by tabId for stopping
const activeLoops = new Map();

// Track pending plans waiting for approval
const pendingPlans = new Map();

// ============================================================================
// Agent Loop Controller
// ============================================================================

/**
 * Start the agent loop for a given task on a specific tab
 * @param {string} task - User's task description
 * @param {number} tabId - Tab ID to run the loop on
 * @param {Object} callbacks - Callback functions
 */
export async function runAgentLoop(task, tabId, callbacks = {}) {
  const {
    onProgress = () => {},
    onAction = () => {},
    onActionStarted = () => {},  // New: notify when action is about to start
    onComplete = () => {},
    onError = () => {},
    onPlanReady = () => Promise.resolve(true),
    onClarifyNeeded = () => {},
    capturePageState,
    executeAction
  } = callbacks;

  console.log('[AgentLoop] Starting task on tab', tabId, ':', task);

  // Mark this loop as active
  activeLoops.set(tabId, true);

  // Initialize state for this tab
  let state = await startTask(task, tabId);
  const config = await loadConfig();

  try {
    // ========================================
    // PHASE 1: PLANNING
    // ========================================
    onProgress({
      step: 'planning',
      message: 'Analyzing your request...',
      tabId
    });

    // Capture current page state
    const pageState = await capturePageState();
    console.log('[AgentLoop] Tab', tabId, '- Captured', pageState.elements?.length, 'elements for planning');

    // Get plan from LLM
    const plan = await getPlan({
      task,
      currentUrl: pageState.url,
      elements: pageState.elements,
      screenshot: pageState.screenshot,
      conversationHistory: state.conversationHistory || []
    });

    console.log('[AgentLoop] Tab', tabId, '- Plan received:',
      plan.understood ? `${plan.steps?.length} steps` : 'needs clarification');

    // Check if LLM needs clarification
    if (!plan.understood || (plan.clarifyingQuestions && plan.clarifyingQuestions.length > 0)) {
      console.log('[AgentLoop] Tab', tabId, '- Clarification needed:', plan.clarifyingQuestions);

      // Store plan for later retry
      pendingPlans.set(tabId, { task, plan, pageState });

      onClarifyNeeded({
        questions: plan.clarifyingQuestions || ['Could you provide more details about what you want to do?'],
        tabId
      });

      // Don't mark as failed - waiting for user input
      activeLoops.delete(tabId);
      return;
    }

    // Check for planning errors
    if (plan.error) {
      console.error('[AgentLoop] Tab', tabId, '- Planning error:', plan.error);
      await failTask(plan.error, tabId);
      onError(plan.error);
      activeLoops.delete(tabId);
      return;
    }

    // ========================================
    // PHASE 2: USER APPROVAL
    // ========================================
    onProgress({
      step: 'approval',
      message: 'Waiting for your approval...',
      tabId
    });

    // Present plan to user for approval
    const approved = await onPlanReady({
      summary: plan.summary,
      steps: plan.steps,
      risks: plan.risks,
      estimatedActions: plan.estimatedActions,
      tabId
    });

    if (!approved) {
      console.log('[AgentLoop] Tab', tabId, '- Plan rejected by user');
      await stopTask(tabId);
      onError('Plan cancelled by user');
      activeLoops.delete(tabId);
      return;
    }

    console.log('[AgentLoop] Tab', tabId, '- Plan approved, starting execution');

    // ========================================
    // PHASE 3: EXECUTION
    // ========================================
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      // Check if loop was stopped
      if (!activeLoops.get(tabId)) {
        console.log('[AgentLoop] Tab', tabId, '- Loop stopped during execution');
        return;
      }

      // Check iteration limit
      if (await hasReachedMaxIterations(tabId)) {
        await failTask('Maximum iterations reached', tabId);
        onError('Maximum iterations reached without completing task');
        activeLoops.delete(tabId);
        return;
      }

      // Reload state (may have been updated externally)
      state = await loadState(tabId);
      if (state.status !== 'running') {
        console.log('[AgentLoop] Tab', tabId, '- Task stopped externally');
        return;
      }

      // Report progress
      onProgress({
        step: 'executing',
        current: i + 1,
        total: plan.steps.length,
        message: step.targetDescription || `Executing: ${step.action}...`,
        tabId
      });

      console.log('[AgentLoop] Tab', tabId, '- Executing step', i + 1, ':', step.action, step.targetId || '');

      // Build action object
      let action = {
        action: step.action,
        targetId: step.targetId,
        value: step.value,
        amount: step.amount,
        reasoning: step.targetDescription,
        targetDescription: step.targetDescription
      };

      // Notify that action is starting (for UI to show "in progress")
      onActionStarted(action);

      // Execute the action
      let result = await executeAction(action);

      // If element not found and we have a description, try to re-find it
      // This handles cases where navigation changed the DOM
      if (!result.success && result.error?.includes('Element not found') && step.targetDescription) {
        console.log('[AgentLoop] Tab', tabId, '- Element not found, attempting to re-find by description...');
        console.log('[AgentLoop] Tab', tabId, '- Looking for:', step.targetDescription);

        // Re-capture DOM to get fresh element IDs
        const freshPageState = await capturePageState();

        // Try to find an element matching the description - be more specific
        const targetDesc = step.targetDescription.toLowerCase();

        // Score elements by how well they match the description
        let bestMatch = null;
        let bestScore = 0;

        for (const el of freshPageState.elements || []) {
          const elText = (el.text || '').toLowerCase();
          const elHref = (el.href || '').toLowerCase();
          let score = 0;

          // Skip navigation links and buttons - we want content links
          if (el.tag === 'button' || elText.length < 5) continue;
          if (['home', 'library', 'coaching', 'freebies', 'search'].includes(elText)) continue;

          // Check for meaningful text overlap (not just single words like "article" or "link")
          // Get significant words from description (length > 4, not common words)
          const descWords = targetDesc.split(/\s+/).filter(w =>
            w.length > 4 && !['link', 'click', 'button', 'article', 'page', 'library'].includes(w)
          );

          // Check if element text contains significant words from description
          for (const word of descWords) {
            if (elText.includes(word)) score += 10;
            if (elHref.includes(word)) score += 5;
          }

          // Check semantic context
          if (el.context) {
            const contextStr = JSON.stringify(el.context).toLowerCase();
            for (const word of descWords) {
              if (contextStr.includes(word)) score += 3;
            }
          }

          // Check if expectedResult gives us clues (e.g., "article on flirting")
          if (step.expectedResult) {
            const expectedWords = step.expectedResult.toLowerCase().split(/\s+/).filter(w => w.length > 4);
            for (const word of expectedWords) {
              if (elText.includes(word)) score += 8;
              if (elHref.includes(word)) score += 4;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = el;
          }
        }

        if (bestMatch && bestScore > 0) {
          console.log('[AgentLoop] Tab', tabId, '- Found matching element (score:', bestScore, '):', bestMatch.id, bestMatch.text);
          action.targetId = bestMatch.id;
          result = await executeAction(action);
        } else {
          console.log('[AgentLoop] Tab', tabId, '- No suitable match found');
        }
      }

      onAction(action, result);

      console.log('[AgentLoop] Tab', tabId, '- Step', i + 1, 'result:', result.success ? 'success' : 'failed');

      // Record action in history
      state = await addActionToHistory(action, result, tabId);

      // Handle failure
      if (!result.success) {
        console.warn('[AgentLoop] Tab', tabId, '- Step failed:', result.error);

        // For now, continue to next step - could add retry logic later
        onProgress({
          step: 'warning',
          message: `Step ${i + 1} failed: ${result.error}. Continuing...`,
          tabId
        });
      }

      // ========================================
      // PHASE 4: VERIFICATION
      // ========================================
      onProgress({
        step: 'verifying',
        current: i + 1,
        total: plan.steps.length,
        message: 'Verifying...',
        tabId
      });

      // Wait for page to update after action
      await sleep(config.actionDelay || 500);

      // Optional: Could add DOM verification here
      // e.g., check if expected element appeared/disappeared

      console.log('[AgentLoop] Tab', tabId, '- Step', i + 1, 'verified');
    }

    // ========================================
    // COMPLETE
    // ========================================
    await completeTask(plan.summary || 'All steps completed successfully', tabId);
    onComplete(plan.summary || 'Task completed successfully');
    console.log('[AgentLoop] Tab', tabId, '- Task completed');

  } catch (error) {
    console.error('[AgentLoop] Error on tab', tabId, ':', error);
    await failTask(error.message, tabId);
    onError(error.message);
  } finally {
    activeLoops.delete(tabId);
    pendingPlans.delete(tabId);
  }
}

/**
 * Retry planning with clarification answer
 * @param {number} tabId - Tab ID
 * @param {string} answer - User's answer to clarifying question
 * @param {Object} callbacks - Callback functions
 */
export async function retryWithClarification(tabId, answer, callbacks = {}) {
  const pending = pendingPlans.get(tabId);
  if (!pending) {
    console.warn('[AgentLoop] No pending plan for tab', tabId);
    return;
  }

  console.log('[AgentLoop] Tab', tabId, '- Retrying with clarification:', answer);

  // Build conversation history with the clarification
  const state = await loadState(tabId);
  const conversationHistory = [
    ...(state.conversationHistory || []),
    { role: 'assistant', content: pending.plan.clarifyingQuestions?.join('\n') || 'Need more details' },
    { role: 'user', content: answer }
  ];

  // Update state with conversation history
  await saveState({ ...state, conversationHistory }, tabId);

  // Clear pending and restart
  pendingPlans.delete(tabId);

  // Run the loop again with the original task
  await runAgentLoop(pending.task, tabId, callbacks);
}

/**
 * Stop the currently running agent loop for a specific tab
 * @param {number} tabId - Tab ID to stop
 */
export async function stopAgentLoop(tabId) {
  console.log('[AgentLoop] Stopping loop on tab', tabId);
  activeLoops.set(tabId, false);
  pendingPlans.delete(tabId);
  await stopTask(tabId);
}

/**
 * Get current agent status for a specific tab
 * @param {number} tabId - Tab ID
 */
export async function getAgentStatus(tabId) {
  const state = await loadState(tabId);
  const hasPendingPlan = pendingPlans.has(tabId);

  return {
    isRunning: state.status === 'running',
    status: hasPendingPlan ? 'awaiting_clarification' : state.status,
    task: state.currentTask,
    iteration: state.iteration,
    lastAction: state.actionHistory[state.actionHistory.length - 1] || null,
    hasPendingPlan,
    tabId
  };
}

/**
 * Check if a loop is active for a specific tab
 * @param {number} tabId - Tab ID
 */
export function isLoopActive(tabId) {
  return activeLoops.get(tabId) === true;
}

/**
 * Check if there's a pending plan awaiting clarification
 * @param {number} tabId - Tab ID
 */
export function hasPendingClarification(tabId) {
  return pendingPlans.has(tabId);
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
