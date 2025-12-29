/**
 * Dialogue Test Harness
 *
 * A testing utility for simulating end-to-end dialogue flows in the V2 agent.
 * Provides mock LLM responses, simulated user interactions, and state assertions.
 */

import {
  loadState,
  saveState,
  resetState,
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
  startExecution,
  stopTask,
  getConfidenceZone,
  shouldAsk,
  shouldAssumeAnnounce,
  shouldProceed
} from '../../lib/state-manager.js';

// ============================================================================
// Mock LLM Provider
// ============================================================================

/**
 * Mock LLM provider for testing
 * Allows setting predetermined responses for planning, clarification, etc.
 */
export class MockLLMProvider {
  constructor() {
    this.responses = [];
    this.callHistory = [];
    this.currentIndex = 0;
  }

  /**
   * Queue a response to be returned by the next call
   * @param {Object} response - The response to return
   */
  queueResponse(response) {
    this.responses.push(response);
  }

  /**
   * Queue multiple responses
   * @param {Object[]} responses - Array of responses
   */
  queueResponses(responses) {
    this.responses.push(...responses);
  }

  /**
   * Get the next queued response
   * @param {Object} request - The request being made (logged)
   * @returns {Object} The next queued response
   */
  async getResponse(request) {
    this.callHistory.push(request);

    if (this.currentIndex >= this.responses.length) {
      throw new Error('MockLLMProvider: No more responses queued');
    }

    const response = this.responses[this.currentIndex];
    this.currentIndex++;
    return response;
  }

  /**
   * Reset the provider state
   */
  reset() {
    this.responses = [];
    this.callHistory = [];
    this.currentIndex = 0;
  }

  /**
   * Get call history
   * @returns {Object[]} Array of requests made
   */
  getCallHistory() {
    return this.callHistory;
  }

  /**
   * Get remaining responses count
   * @returns {number}
   */
  getRemainingResponses() {
    return this.responses.length - this.currentIndex;
  }
}

// ============================================================================
// Mock Action Executor
// ============================================================================

/**
 * Mock action executor for testing
 */
export class MockActionExecutor {
  constructor() {
    this.executedActions = [];
    this.shouldFail = false;
    this.failOnStep = -1; // -1 = don't fail, 0+ = fail on specific step
    this.failureError = 'Element not found';
  }

  /**
   * Configure to fail on a specific step
   * @param {number} stepIndex - Step to fail on (-1 to disable)
   * @param {string} error - Error message
   */
  setFailOnStep(stepIndex, error = 'Element not found') {
    this.failOnStep = stepIndex;
    this.failureError = error;
  }

  /**
   * Configure to always fail
   * @param {boolean} shouldFail
   */
  setAlwaysFail(shouldFail, error = 'Execution failed') {
    this.shouldFail = shouldFail;
    this.failureError = error;
  }

  /**
   * Execute an action
   * @param {Object} action - The action to execute
   * @returns {Object} Result with success/error
   */
  async execute(action) {
    const stepIndex = this.executedActions.length;
    this.executedActions.push(action);

    // Check if this step should fail
    if (this.shouldFail || stepIndex === this.failOnStep) {
      return {
        success: false,
        error: this.failureError
      };
    }

    return {
      success: true,
      result: `Executed ${action.action} on ${action.targetId || 'page'}`
    };
  }

  /**
   * Get all executed actions
   * @returns {Object[]}
   */
  getExecutedActions() {
    return this.executedActions;
  }

  /**
   * Reset the executor
   */
  reset() {
    this.executedActions = [];
    this.shouldFail = false;
    this.failOnStep = -1;
  }
}

// ============================================================================
// Callback Tracker
// ============================================================================

/**
 * Tracks callbacks fired during a test
 */
export class CallbackTracker {
  constructor() {
    this.callbacks = {
      onProgress: [],
      onAction: [],
      onActionStarted: [],
      onComplete: [],
      onError: [],
      onClarifyNeeded: [],
      onAssumeAnnounce: [],
      onMidExecDialog: [],
      onPlanReady: []
    };
    this.planApproval = true; // Default: approve plans
    this.midExecDecision = 'abort'; // Default mid-exec decision
  }

  /**
   * Set whether to approve plans
   * @param {boolean} approve
   */
  setApproveAllPlans(approve) {
    this.planApproval = approve;
  }

  /**
   * Set the decision for mid-execution dialogs
   * @param {'retry' | 'skip' | 'replan' | 'abort'} decision
   */
  setMidExecDecision(decision) {
    this.midExecDecision = decision;
  }

  /**
   * Get callback handlers
   * @returns {Object}
   */
  getHandlers() {
    return {
      onProgress: (data) => {
        this.callbacks.onProgress.push({ timestamp: Date.now(), data });
      },
      onAction: (action, result) => {
        this.callbacks.onAction.push({ timestamp: Date.now(), action, result });
      },
      onActionStarted: (action) => {
        this.callbacks.onActionStarted.push({ timestamp: Date.now(), action });
      },
      onComplete: (result) => {
        this.callbacks.onComplete.push({ timestamp: Date.now(), result });
      },
      onError: (error) => {
        this.callbacks.onError.push({ timestamp: Date.now(), error });
      },
      onClarifyNeeded: (data) => {
        this.callbacks.onClarifyNeeded.push({ timestamp: Date.now(), data });
      },
      onPlanReady: async (plan) => {
        this.callbacks.onPlanReady.push({ timestamp: Date.now(), plan });
        return this.planApproval;
      }
    };
  }

  /**
   * Get the count of times a callback was fired
   * @param {string} name - Callback name
   * @returns {number}
   */
  getCallCount(name) {
    return this.callbacks[name]?.length || 0;
  }

  /**
   * Get all calls for a specific callback
   * @param {string} name - Callback name
   * @returns {Object[]}
   */
  getCalls(name) {
    return this.callbacks[name] || [];
  }

  /**
   * Assert a callback was fired a specific number of times
   * @param {string} name - Callback name
   * @param {number} expectedCount - Expected call count
   * @returns {boolean}
   */
  assertCallCount(name, expectedCount) {
    const actual = this.getCallCount(name);
    if (actual !== expectedCount) {
      throw new Error(`Expected ${name} to be called ${expectedCount} times, but was called ${actual} times`);
    }
    return true;
  }

  /**
   * Reset all tracked callbacks
   */
  reset() {
    Object.keys(this.callbacks).forEach(key => {
      this.callbacks[key] = [];
    });
  }
}

// ============================================================================
// Dialogue Test Harness
// ============================================================================

/**
 * Main test harness for dialogue flow testing
 */
export class DialogueTestHarness {
  constructor(tabId = 99999) {
    this.tabId = tabId;
    this.mockLLM = new MockLLMProvider();
    this.mockExecutor = new MockActionExecutor();
    this.callbackTracker = new CallbackTracker();
    this.pageState = {
      url: 'https://example.com',
      elements: [
        { id: 'ai-target-1', type: 'button', text: 'Submit', visible: true },
        { id: 'ai-target-2', type: 'input', placeholder: 'Enter text', visible: true },
        { id: 'ai-target-3', type: 'a', text: 'Link', href: '/page', visible: true }
      ]
    };
  }

  /**
   * Set the simulated page state
   * @param {Object} pageState
   */
  setPageState(pageState) {
    this.pageState = pageState;
  }

  /**
   * Queue an LLM response
   * @param {Object} response
   */
  queueLLMResponse(response) {
    this.mockLLM.queueResponse(response);
  }

  /**
   * Configure action execution to fail on a specific step
   * @param {number} stepIndex
   * @param {string} error
   */
  setFailOnStep(stepIndex, error) {
    this.mockExecutor.setFailOnStep(stepIndex, error);
  }

  /**
   * Configure whether to approve plans
   * @param {boolean} approve
   */
  setApproveAllPlans(approve) {
    this.callbackTracker.setApproveAllPlans(approve);
  }

  /**
   * Get capturePageState function for use in agent loop
   * @returns {Function}
   */
  getCapturePageState() {
    return async () => this.pageState;
  }

  /**
   * Get executeAction function for use in agent loop
   * @returns {Function}
   */
  getExecuteAction() {
    return (action) => this.mockExecutor.execute(action);
  }

  /**
   * Get all callback handlers
   * @returns {Object}
   */
  getCallbacks() {
    const handlers = this.callbackTracker.getHandlers();
    return {
      ...handlers,
      capturePageState: this.getCapturePageState(),
      executeAction: this.getExecuteAction()
    };
  }

  /**
   * Assert the current state matches expected
   * @param {Object} expected - Expected state properties
   */
  async assertState(expected) {
    const state = await loadState(this.tabId);

    for (const [key, value] of Object.entries(expected)) {
      if (key === 'dialogueState') {
        for (const [dKey, dValue] of Object.entries(value)) {
          if (state.dialogueState[dKey] !== dValue) {
            throw new Error(
              `State assertion failed: dialogueState.${dKey} expected ${dValue}, got ${state.dialogueState[dKey]}`
            );
          }
        }
      } else if (key === 'executionState') {
        for (const [eKey, eValue] of Object.entries(value)) {
          if (typeof eValue === 'number') {
            if (state.executionState[eKey] !== eValue) {
              throw new Error(
                `State assertion failed: executionState.${eKey} expected ${eValue}, got ${state.executionState[eKey]}`
              );
            }
          }
        }
      } else if (state[key] !== value) {
        throw new Error(`State assertion failed: ${key} expected ${value}, got ${state[key]}`);
      }
    }
    return true;
  }

  /**
   * Assert a callback was fired a specific number of times
   * @param {string} name - Callback name
   * @param {number} count - Expected count
   */
  assertCallbackFired(name, count) {
    return this.callbackTracker.assertCallCount(name, count);
  }

  /**
   * Get callback calls
   * @param {string} name - Callback name
   * @returns {Object[]}
   */
  getCallbackCalls(name) {
    return this.callbackTracker.getCalls(name);
  }

  /**
   * Simulate a user answering a clarification question
   * @param {string} answer - The user's answer
   * @param {string} selectedOptionId - Selected option ID (optional)
   */
  async simulateUserAnswer(answer, selectedOptionId = null) {
    await recordClarificationAnswer(answer, selectedOptionId, this.tabId);
    // Transition back to planning to re-process with new info
    await transitionTo('planning', this.tabId);
  }

  /**
   * Simulate a mid-execution decision
   * @param {'retry' | 'skip' | 'replan' | 'abort'} decision
   */
  async simulateMidExecDecision(decision) {
    return await recordMidExecDecision(decision, this.tabId);
  }

  /**
   * Get the executed actions
   * @returns {Object[]}
   */
  getExecutedActions() {
    return this.mockExecutor.getExecutedActions();
  }

  /**
   * Get the current state
   * @returns {Object}
   */
  async getState() {
    return await loadState(this.tabId);
  }

  /**
   * Reset the harness for a new test
   */
  async reset() {
    this.mockLLM.reset();
    this.mockExecutor.reset();
    this.callbackTracker.reset();
    await resetState(this.tabId);
  }

  // =========================================================================
  // Flow Simulation Helpers
  // =========================================================================

  /**
   * Simulate starting a planning phase
   * @param {string} task
   */
  async startPlanningPhase(task) {
    return await startPlanning(task, this.tabId);
  }

  /**
   * Simulate setting a plan with confidence
   * @param {Object} plan
   * @param {Object} confidence
   */
  async setPlanWithConfidence(plan, confidence) {
    return await setPlan(plan, confidence, this.tabId);
  }

  /**
   * Simulate entering clarification state
   * @param {Array} questions
   */
  async enterClarificationState(questions) {
    return await enterClarifying(questions, this.tabId);
  }

  /**
   * Simulate entering assume-announce state
   * @param {Array} assumptions
   * @param {Object} plan
   */
  async enterAssumeAnnounceState(assumptions, plan) {
    return await enterAssumeAnnounce(assumptions, plan, this.tabId);
  }

  /**
   * Simulate entering refining state
   */
  async enterRefiningState() {
    return await enterRefining(this.tabId);
  }

  /**
   * Simulate starting execution
   */
  async startExecutionPhase() {
    return await startExecution(this.tabId);
  }

  /**
   * Simulate a step completion
   * @param {number} stepIndex
   * @param {Object} result
   */
  async completeStep(stepIndex, result) {
    return await updateExecutionProgress(stepIndex, result, this.tabId);
  }

  /**
   * Simulate entering mid-execution dialog
   * @param {Object} failedStep
   * @param {string} error
   */
  async enterMidExecDialogState(failedStep, error) {
    return await enterMidExecDialog(failedStep, error, this.tabId);
  }

  /**
   * Simulate stopping the task
   */
  async stopCurrentTask() {
    return await stopTask(this.tabId);
  }

  /**
   * Transition to a specific state
   * @param {string} status
   * @param {Object} updates
   */
  async transitionToState(status, updates = {}) {
    return await transitionTo(status, this.tabId, updates);
  }
}

export default DialogueTestHarness;
