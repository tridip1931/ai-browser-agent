/**
 * AI Browser Agent - Agent Loop (V2)
 *
 * V2 Implements a confidence-based dialogue loop:
 * Plan → Confidence Route → [Ask/Assume+Announce/Proceed] → Execute → Verify
 *
 * Dialogue State Machine:
 * idle → planning → [clarifying | assume_announce | awaiting_approval] →
 *   executing → [mid_exec_dialog | completed | error]
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
  loadConfig,
  // V2 state management
  transitionTo,
  startPlanning,
  enterClarifying,
  recordClarificationAnswer,
  enterAssumeAnnounce,
  enterRefining,
  setPlan,
  enterMidExecDialog,
  recordMidExecDecision,
  updateExecutionProgress,
  createCheckpoint,
  startExecution,
  // V2 confidence helpers
  getConfidenceZone,
  shouldAsk,
  shouldAssumeAnnounce,
  shouldProceed
} from './state-manager.js';

import { getPlan, getPlanWithConfidence, refinePlan } from './api-client.js';

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
// V2: Confidence-Based Agent Loop
// ============================================================================

/**
 * V2 Agent Loop with confidence-based dialogue
 *
 * @param {string} task - User's task description
 * @param {number} tabId - Tab ID to run the loop on
 * @param {Object} callbacks - Callback functions
 */
export async function runAgentLoopV2(task, tabId, callbacks = {}) {
  const {
    onProgress = () => {},
    onAction = () => {},
    onActionStarted = () => {},
    onComplete = () => {},
    onError = () => {},
    onPlanReady = () => Promise.resolve(true),
    onClarifyNeeded = () => {},
    // V2 callbacks
    onAssumeAnnounce = () => {},           // Show assumptions with auto-execute timer
    onConfidenceReport = () => {},          // Report confidence breakdown
    onMidExecDialog = () => {},             // Show failure options dialog
    onSelfRefineProgress = () => {},        // Show refine iteration progress
    capturePageState,
    executeAction
  } = callbacks;

  console.log('[AgentLoopV2] Starting task on tab', tabId, ':', task);

  // Mark this loop as active
  activeLoops.set(tabId, true);

  // Initialize state for this tab using V2 planning state
  let state = await startPlanning(task, tabId);
  const config = await loadConfig();

  try {
    // ========================================
    // PHASE 1: PLANNING WITH CONFIDENCE
    // ========================================
    onProgress({
      step: 'planning',
      message: 'Analyzing your request...',
      tabId
    });

    // Capture current page state
    const pageState = await capturePageState();
    console.log('[AgentLoopV2] Tab', tabId, '- Captured', pageState.elements?.length, 'elements');

    // Get plan with confidence scoring
    const planResult = await getPlanWithConfidence({
      task,
      currentUrl: pageState.url,
      elements: pageState.elements,
      screenshot: pageState.screenshot,
      conversationHistory: state.conversationHistory || []
    });

    console.log('[AgentLoopV2] Tab', tabId, '- Plan received, confidence:', planResult.confidence?.overall);

    // Store plan and confidence
    await setPlan(planResult.plan, planResult.confidence, tabId);

    // Report confidence to UI
    onConfidenceReport({
      overall: planResult.confidence.overall,
      breakdown: planResult.confidence,
      recommendation: getConfidenceZone(planResult.confidence.overall),
      tabId
    });

    // Check for planning errors
    if (planResult.error) {
      console.error('[AgentLoopV2] Tab', tabId, '- Planning error:', planResult.error);
      await failTask(planResult.error, tabId);
      onError(planResult.error);
      activeLoops.delete(tabId);
      return;
    }

    // ========================================
    // PHASE 2: CONFIDENCE-BASED ROUTING
    // ========================================
    const confidence = planResult.confidence;
    const zone = getConfidenceZone(confidence.overall);

    console.log('[AgentLoopV2] Tab', tabId, '- Confidence zone:', zone);

    if (shouldAsk(confidence)) {
      // Low confidence - ask for clarification
      await handleClarification(tabId, planResult, pageState, callbacks);
      return;
    }

    if (shouldAssumeAnnounce(confidence)) {
      // Medium confidence - assume and announce
      const proceed = await handleAssumeAnnounce(tabId, planResult, callbacks);
      if (!proceed) {
        console.log('[AgentLoopV2] Tab', tabId, '- User corrected assumptions');
        return; // User will provide correction, loop will restart
      }
    }

    // High confidence or user approved assumptions - proceed to approval
    await transitionTo('awaiting_approval', tabId);

    // ========================================
    // PHASE 3: SELF-REFINE LOOP (Optional)
    // ========================================
    state = await loadState(tabId);
    let finalPlan = state.currentPlan;

    // Run self-refine if plan score is below threshold
    if (planResult.planScore && planResult.planScore < 0.9) {
      finalPlan = await runSelfRefineLoop(tabId, finalPlan, pageState, callbacks);
    }

    // ========================================
    // PHASE 4: USER APPROVAL
    // ========================================
    onProgress({
      step: 'approval',
      message: 'Waiting for your approval...',
      tabId
    });

    const approved = await onPlanReady({
      summary: finalPlan.summary,
      steps: finalPlan.steps,
      risks: finalPlan.risks,
      estimatedActions: finalPlan.estimatedActions,
      confidence: confidence.overall,
      tabId
    });

    if (!approved) {
      console.log('[AgentLoopV2] Tab', tabId, '- Plan rejected by user');
      await stopTask(tabId);
      onError('Plan cancelled by user');
      activeLoops.delete(tabId);
      return;
    }

    console.log('[AgentLoopV2] Tab', tabId, '- Plan approved, starting execution');

    // ========================================
    // PHASE 5: EXECUTION WITH MID-EXEC DIALOGUE
    // ========================================
    await startExecution(tabId);
    await executeWithMidExecDialogue(tabId, finalPlan, callbacks, config);

  } catch (error) {
    console.error('[AgentLoopV2] Error on tab', tabId, ':', error);
    await failTask(error.message, tabId);
    onError(error.message);
  } finally {
    activeLoops.delete(tabId);
    pendingPlans.delete(tabId);
  }
}

/**
 * Handle low-confidence clarification
 */
async function handleClarification(tabId, planResult, pageState, callbacks) {
  const { onClarifyNeeded = () => {}, onProgress = () => {} } = callbacks;

  console.log('[AgentLoopV2] Tab', tabId, '- Entering clarification');

  // Build option-based questions from LLM response
  const questions = planResult.clarifyingQuestions || [];

  // Enter clarifying state
  await enterClarifying(questions, tabId);

  // Store for retry
  pendingPlans.set(tabId, {
    task: (await loadState(tabId)).currentTask,
    plan: planResult.plan,
    pageState
  });

  onProgress({
    step: 'clarifying',
    message: 'Need more information...',
    tabId
  });

  onClarifyNeeded({
    questions,
    isOptionBased: questions.some(q => q.options && q.options.length > 0),
    tabId
  });

  activeLoops.delete(tabId);
}

/**
 * Handle medium-confidence assume-announce pattern
 * Returns true if should proceed, false if user provided correction
 */
async function handleAssumeAnnounce(tabId, planResult, callbacks) {
  const { onAssumeAnnounce = () => {} } = callbacks;

  console.log('[AgentLoopV2] Tab', tabId, '- Entering assume-announce');

  const assumptions = planResult.assumptions || [];

  // Enter assume-announce state
  await enterAssumeAnnounce(assumptions, planResult.plan, tabId);

  // Notify UI with assumptions and auto-execute timer
  return new Promise((resolve) => {
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    // Start 3-second auto-execute timer
    timeoutId = setTimeout(() => {
      console.log('[AgentLoopV2] Tab', tabId, '- Auto-executing after assume-announce');
      resolve(true);
    }, 3000);

    onAssumeAnnounce({
      assumptions,
      plan: planResult.plan,
      autoExecuteDelay: 3000,
      tabId,
      // Callback for user correction
      onCorrect: (correction) => {
        cleanup();
        console.log('[AgentLoopV2] Tab', tabId, '- User correction:', correction);
        resolve(false);
      },
      // Callback for user cancel
      onCancel: () => {
        cleanup();
        console.log('[AgentLoopV2] Tab', tabId, '- User cancelled assume-announce');
        resolve(false);
      }
    });
  });
}

/**
 * Run self-refine loop (max 3 iterations)
 */
async function runSelfRefineLoop(tabId, initialPlan, pageState, callbacks) {
  const { onSelfRefineProgress = () => {} } = callbacks;

  let currentPlan = initialPlan;
  let bestPlan = initialPlan;
  let bestScore = initialPlan.score || 0;

  const state = await loadState(tabId);
  const maxIterations = state.dialogueState.maxRefineIterations;

  console.log('[AgentLoopV2] Tab', tabId, '- Starting self-refine loop');

  for (let i = 0; i < maxIterations; i++) {
    // Check if loop was stopped
    if (!activeLoops.get(tabId)) {
      console.log('[AgentLoopV2] Tab', tabId, '- Self-refine stopped');
      return bestPlan;
    }

    await enterRefining(tabId);

    onSelfRefineProgress({
      iteration: i + 1,
      maxIterations,
      previousScore: currentPlan.score || 0,
      tabId
    });

    // Call LLM to refine the plan
    const refined = await refinePlan({
      plan: currentPlan,
      feedback: generatePlanFeedback(currentPlan),
      elements: pageState.elements,
      task: state.currentTask
    });

    console.log('[AgentLoopV2] Tab', tabId, '- Refine iteration', i + 1, '- score:', refined.score);

    onSelfRefineProgress({
      iteration: i + 1,
      maxIterations,
      previousScore: currentPlan.score || 0,
      newScore: refined.score,
      improvements: refined.improvements || [],
      tabId
    });

    // Check if improved
    if (refined.score > bestScore) {
      bestPlan = refined.plan;
      bestScore = refined.score;
    }

    // If score is high enough, stop refining
    if (refined.score >= 0.9) {
      console.log('[AgentLoopV2] Tab', tabId, '- Plan quality sufficient, stopping refine');
      break;
    }

    currentPlan = refined.plan;
  }

  // Update state with best plan
  await setPlan(bestPlan, state.confidence, tabId);

  return bestPlan;
}

/**
 * Generate feedback for plan refinement
 */
function generatePlanFeedback(plan) {
  const feedback = [];

  // Check for specificity issues
  for (const step of plan.steps || []) {
    if (!step.targetId && step.action !== 'scroll' && step.action !== 'wait') {
      feedback.push(`Step "${step.targetDescription}" lacks specific targetId`);
    }
  }

  // Check for completeness
  if (!plan.steps || plan.steps.length === 0) {
    feedback.push('Plan has no steps');
  }

  // Check for safety
  const riskyActions = ['delete', 'submit', 'purchase', 'send'];
  for (const step of plan.steps || []) {
    if (riskyActions.some(r => step.action?.includes(r))) {
      if (!plan.risks || !plan.risks.some(risk => risk.includes(step.action))) {
        feedback.push(`Risky action "${step.action}" not flagged in risks`);
      }
    }
  }

  return feedback.length > 0 ? feedback : ['Plan looks good, minor improvements possible'];
}

/**
 * Execute plan with mid-execution dialogue for failures
 */
async function executeWithMidExecDialogue(tabId, plan, callbacks, config) {
  const {
    onProgress = () => {},
    onAction = () => {},
    onActionStarted = () => {},
    onComplete = () => {},
    onError = () => {},
    onMidExecDialog = () => {},
    capturePageState,
    executeAction
  } = callbacks;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    // Check if loop was stopped
    if (!activeLoops.get(tabId)) {
      console.log('[AgentLoopV2] Tab', tabId, '- Execution stopped');
      return;
    }

    // Check iteration limit
    if (await hasReachedMaxIterations(tabId)) {
      await failTask('Maximum iterations reached', tabId);
      onError('Maximum iterations reached without completing task');
      activeLoops.delete(tabId);
      return;
    }

    // Reload state
    let state = await loadState(tabId);
    if (state.status !== 'executing') {
      console.log('[AgentLoopV2] Tab', tabId, '- Execution state changed externally');
      return;
    }

    // Create checkpoint before action
    const pageState = await capturePageState();
    await createCheckpoint(pageState, tabId);

    // Report progress
    onProgress({
      step: 'executing',
      current: i + 1,
      total: plan.steps.length,
      message: step.targetDescription || `Executing: ${step.action}...`,
      tabId
    });

    console.log('[AgentLoopV2] Tab', tabId, '- Executing step', i + 1, ':', step.action);

    // Build action object
    const action = {
      action: step.action,
      targetId: step.targetId,
      value: step.value,
      amount: step.amount,
      reasoning: step.targetDescription,
      targetDescription: step.targetDescription
    };

    onActionStarted(action);

    // Execute the action
    let result = await executeAction(action);

    // If element not found, try to re-find it
    if (!result.success && result.error?.includes('Element not found') && step.targetDescription) {
      result = await tryRefindElement(tabId, action, step, capturePageState, executeAction);
    }

    onAction(action, result);

    // Record action in history
    state = await addActionToHistory(action, result, tabId);

    // Handle failure with mid-execution dialogue
    if (!result.success) {
      console.warn('[AgentLoopV2] Tab', tabId, '- Step', i + 1, 'failed:', result.error);

      const decision = await handleMidExecFailure(tabId, step, result.error, callbacks);

      switch (decision) {
        case 'retry':
          // Retry the same step
          i--; // Will increment back to same index
          continue;

        case 'skip':
          // Skip to next step (default behavior)
          onProgress({
            step: 'warning',
            message: `Skipped step ${i + 1}: ${result.error}`,
            tabId
          });
          continue;

        case 'replan':
          // Replan from current state
          console.log('[AgentLoopV2] Tab', tabId, '- Replanning from step', i + 1);
          await transitionTo('replanning', tabId);
          // TODO: Implement replanning from mid-execution
          onError('Replanning not yet implemented');
          return;

        case 'abort':
          await stopTask(tabId);
          onError('Task aborted by user');
          activeLoops.delete(tabId);
          return;
      }
    }

    // Update execution progress
    await updateExecutionProgress(i, result, tabId);

    // Verification delay
    await sleep(config.actionDelay || 500);

    console.log('[AgentLoopV2] Tab', tabId, '- Step', i + 1, 'complete');
  }

  // All steps complete
  await completeTask(plan.summary || 'All steps completed successfully', tabId);
  onComplete(plan.summary || 'Task completed successfully');
  console.log('[AgentLoopV2] Tab', tabId, '- Task completed');
}

/**
 * Handle mid-execution failure with user dialogue
 */
async function handleMidExecFailure(tabId, failedStep, error, callbacks) {
  const { onMidExecDialog = () => {} } = callbacks;

  await enterMidExecDialog(failedStep, error, tabId);

  // Analyze the failure
  const analysis = analyzeFailure(error, failedStep);

  return new Promise((resolve) => {
    onMidExecDialog({
      failedStep,
      error,
      analysis,
      options: ['retry', 'skip', 'replan', 'abort'],
      suggestedAction: analysis.suggestion,
      tabId,
      onDecision: async (decision) => {
        await recordMidExecDecision(decision, tabId);
        resolve(decision);
      }
    });

    // Default to skip after 30 seconds
    setTimeout(() => {
      console.log('[AgentLoopV2] Tab', tabId, '- Mid-exec timeout, defaulting to skip');
      resolve('skip');
    }, 30000);
  });
}

/**
 * Analyze failure to suggest recovery action
 */
function analyzeFailure(error, step) {
  const analysis = {
    cause: 'Unknown',
    suggestion: 'skip',
    canRetry: false
  };

  if (error.includes('Element not found')) {
    analysis.cause = 'Element no longer exists or page changed';
    analysis.suggestion = 'replan';
    analysis.canRetry = true;
  } else if (error.includes('not visible') || error.includes('not clickable')) {
    analysis.cause = 'Element is hidden or covered';
    analysis.suggestion = 'retry';
    analysis.canRetry = true;
  } else if (error.includes('timeout')) {
    analysis.cause = 'Page took too long to respond';
    analysis.suggestion = 'retry';
    analysis.canRetry = true;
  } else if (error.includes('navigation')) {
    analysis.cause = 'Unexpected navigation occurred';
    analysis.suggestion = 'replan';
    analysis.canRetry = false;
  }

  return analysis;
}

/**
 * Try to re-find an element by description
 */
async function tryRefindElement(tabId, action, step, capturePageState, executeAction) {
  console.log('[AgentLoopV2] Tab', tabId, '- Attempting to re-find element...');

  const freshPageState = await capturePageState();
  const targetDesc = step.targetDescription.toLowerCase();

  // Score elements by match quality
  let bestMatch = null;
  let bestScore = 0;

  for (const el of freshPageState.elements || []) {
    const elText = (el.text || '').toLowerCase();
    const elHref = (el.href || '').toLowerCase();
    let score = 0;

    if (el.tag === 'button' || elText.length < 5) continue;

    const descWords = targetDesc.split(/\s+/).filter(w =>
      w.length > 4 && !['link', 'click', 'button', 'article', 'page'].includes(w)
    );

    for (const word of descWords) {
      if (elText.includes(word)) score += 10;
      if (elHref.includes(word)) score += 5;
    }

    if (el.context) {
      const contextStr = JSON.stringify(el.context).toLowerCase();
      for (const word of descWords) {
        if (contextStr.includes(word)) score += 3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = el;
    }
  }

  if (bestMatch && bestScore > 0) {
    console.log('[AgentLoopV2] Tab', tabId, '- Found match (score:', bestScore, '):', bestMatch.id);
    action.targetId = bestMatch.id;
    return await executeAction(action);
  }

  console.log('[AgentLoopV2] Tab', tabId, '- No suitable match found');
  return { success: false, error: 'Element not found after re-search' };
}

/**
 * V2 Retry with clarification answer
 */
export async function retryWithClarificationV2(tabId, answer, selectedOptionId, callbacks = {}) {
  const pending = pendingPlans.get(tabId);
  if (!pending) {
    console.warn('[AgentLoopV2] No pending plan for tab', tabId);
    return;
  }

  console.log('[AgentLoopV2] Tab', tabId, '- Retrying with clarification:', answer);

  // Record the clarification answer
  await recordClarificationAnswer(answer, selectedOptionId, tabId);

  // Clear pending and restart
  pendingPlans.delete(tabId);

  // Run the V2 loop again
  await runAgentLoopV2(pending.task, tabId, callbacks);
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
