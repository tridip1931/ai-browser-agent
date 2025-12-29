/**
 * Unit tests for state machine and dialogue state management
 * Tests: transitionTo, startPlanning, enterClarifying, enterAssumeAnnounce,
 *        enterMidExecDialog, recordMidExecDecision, etc.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
  stopTask
} from '../../lib/state-manager.js';

const TEST_TAB_ID = 12345;

// ============================================================================
// transitionTo Tests
// ============================================================================

describe('transitionTo', () => {
  beforeEach(async () => {
    await resetState(TEST_TAB_ID);
  });

  describe('valid transitions', () => {
    it('should transition to planning', async () => {
      const state = await transitionTo('planning', TEST_TAB_ID);
      expect(state.status).toBe('planning');
    });

    it('should transition to clarifying', async () => {
      const state = await transitionTo('clarifying', TEST_TAB_ID);
      expect(state.status).toBe('clarifying');
    });

    it('should transition to refining', async () => {
      const state = await transitionTo('refining', TEST_TAB_ID);
      expect(state.status).toBe('refining');
    });

    it('should transition to assume_announce', async () => {
      const state = await transitionTo('assume_announce', TEST_TAB_ID);
      expect(state.status).toBe('assume_announce');
    });

    it('should transition to awaiting_approval', async () => {
      const state = await transitionTo('awaiting_approval', TEST_TAB_ID);
      expect(state.status).toBe('awaiting_approval');
    });

    it('should transition to executing', async () => {
      const state = await transitionTo('executing', TEST_TAB_ID);
      expect(state.status).toBe('executing');
    });

    it('should transition to mid_exec_dialog', async () => {
      const state = await transitionTo('mid_exec_dialog', TEST_TAB_ID);
      expect(state.status).toBe('mid_exec_dialog');
    });

    it('should transition to replanning', async () => {
      const state = await transitionTo('replanning', TEST_TAB_ID);
      expect(state.status).toBe('replanning');
    });

    it('should transition to completed', async () => {
      const state = await transitionTo('completed', TEST_TAB_ID);
      expect(state.status).toBe('completed');
    });

    it('should transition to error', async () => {
      const state = await transitionTo('error', TEST_TAB_ID);
      expect(state.status).toBe('error');
    });

    it('should transition to idle', async () => {
      await transitionTo('planning', TEST_TAB_ID);
      const state = await transitionTo('idle', TEST_TAB_ID);
      expect(state.status).toBe('idle');
    });
  });

  describe('invalid transitions', () => {
    it('should throw for invalid status', async () => {
      await expect(transitionTo('invalid_status', TEST_TAB_ID))
        .rejects.toThrow('Invalid status: invalid_status');
    });

    it('should throw for empty status', async () => {
      await expect(transitionTo('', TEST_TAB_ID))
        .rejects.toThrow('Invalid status:');
    });

    it('should throw for undefined status', async () => {
      await expect(transitionTo(undefined, TEST_TAB_ID))
        .rejects.toThrow();
    });
  });

  describe('additional updates', () => {
    it('should apply additional updates with transition', async () => {
      const state = await transitionTo('planning', TEST_TAB_ID, {
        currentTask: 'Test task'
      });
      expect(state.status).toBe('planning');
      expect(state.currentTask).toBe('Test task');
    });

    it('should update lastActionTime on transition', async () => {
      const before = Date.now();
      const state = await transitionTo('planning', TEST_TAB_ID);
      const after = Date.now();

      expect(state.lastActionTime).toBeGreaterThanOrEqual(before);
      expect(state.lastActionTime).toBeLessThanOrEqual(after);
    });
  });
});

// ============================================================================
// startPlanning Tests
// ============================================================================

describe('startPlanning', () => {
  beforeEach(async () => {
    await resetState(TEST_TAB_ID);
  });

  it('should set status to planning', async () => {
    const state = await startPlanning('Click the button', TEST_TAB_ID);
    expect(state.status).toBe('planning');
  });

  it('should set currentTask', async () => {
    const state = await startPlanning('Click the button', TEST_TAB_ID);
    expect(state.currentTask).toBe('Click the button');
  });

  it('should initialize conversationHistory with task', async () => {
    const state = await startPlanning('Click the button', TEST_TAB_ID);
    expect(state.conversationHistory).toHaveLength(1);
    expect(state.conversationHistory[0].role).toBe('user');
    expect(state.conversationHistory[0].content).toBe('Click the button');
    expect(state.conversationHistory[0].messageType).toBe('task');
  });

  it('should set startTime', async () => {
    const before = Date.now();
    const state = await startPlanning('Click the button', TEST_TAB_ID);
    const after = Date.now();

    expect(state.startTime).toBeGreaterThanOrEqual(before);
    expect(state.startTime).toBeLessThanOrEqual(after);
  });

  it('should set tabId', async () => {
    const state = await startPlanning('Click the button', TEST_TAB_ID);
    expect(state.tabId).toBe(TEST_TAB_ID);
  });
});

// ============================================================================
// enterClarifying Tests
// ============================================================================

describe('enterClarifying', () => {
  beforeEach(async () => {
    await startPlanning('Ambiguous task', TEST_TAB_ID);
  });

  it('should set status to clarifying', async () => {
    const questions = [{ question: 'Which button?' }];
    const state = await enterClarifying(questions, TEST_TAB_ID);
    expect(state.status).toBe('clarifying');
  });

  it('should increment clarificationRound', async () => {
    const questions = [{ question: 'Which button?' }];
    const state = await enterClarifying(questions, TEST_TAB_ID);
    expect(state.dialogueState.clarificationRound).toBe(1);
  });

  it('should store pending questions', async () => {
    const questions = [
      { question: 'Which button?' },
      { question: 'What text to enter?' }
    ];
    const state = await enterClarifying(questions, TEST_TAB_ID);
    expect(state.dialogueState.pendingQuestions).toHaveLength(2);
  });

  it('should add to conversation history', async () => {
    const questions = [{ question: 'Which button?' }];
    const state = await enterClarifying(questions, TEST_TAB_ID);

    const lastMessage = state.conversationHistory[state.conversationHistory.length - 1];
    expect(lastMessage.role).toBe('assistant');
    expect(lastMessage.messageType).toBe('clarification');
  });

  describe('max clarification rounds', () => {
    it('should transition to awaiting_approval after max rounds', async () => {
      const questions = [{ question: 'Q?' }];

      // Round 1
      await enterClarifying(questions, TEST_TAB_ID);
      await recordClarificationAnswer('Answer 1', null, TEST_TAB_ID);

      // Round 2
      await enterClarifying(questions, TEST_TAB_ID);
      await recordClarificationAnswer('Answer 2', null, TEST_TAB_ID);

      // Round 3
      await enterClarifying(questions, TEST_TAB_ID);
      await recordClarificationAnswer('Answer 3', null, TEST_TAB_ID);

      // Round 4 - should transition to awaiting_approval
      const state = await enterClarifying(questions, TEST_TAB_ID);
      expect(state.status).toBe('awaiting_approval');
    });
  });
});

// ============================================================================
// recordClarificationAnswer Tests
// ============================================================================

describe('recordClarificationAnswer', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
    await enterClarifying([{ question: 'Which one?' }], TEST_TAB_ID);
  });

  it('should clear pending questions', async () => {
    const state = await recordClarificationAnswer('The first one', null, TEST_TAB_ID);
    expect(state.dialogueState.pendingQuestions).toHaveLength(0);
  });

  it('should add answer to conversation history', async () => {
    const state = await recordClarificationAnswer('The first one', 'opt-1', TEST_TAB_ID);

    const lastMessage = state.conversationHistory[state.conversationHistory.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toBe('The first one');
    expect(lastMessage.messageType).toBe('clarification_answer');
    expect(lastMessage.selectedOptionId).toBe('opt-1');
  });
});

// ============================================================================
// enterAssumeAnnounce Tests
// ============================================================================

describe('enterAssumeAnnounce', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
  });

  it('should set status to assume_announce', async () => {
    const assumptions = [{ field: 'target', assumedValue: 'first button' }];
    const plan = { summary: 'Click button', steps: [] };

    const state = await enterAssumeAnnounce(assumptions, plan, TEST_TAB_ID);
    expect(state.status).toBe('assume_announce');
  });

  it('should store assumptions', async () => {
    const assumptions = [
      { field: 'target', assumedValue: 'first button', confidence: 0.7 },
      { field: 'action', assumedValue: 'click', confidence: 0.8 }
    ];
    const plan = { summary: 'Click button', steps: [] };

    const state = await enterAssumeAnnounce(assumptions, plan, TEST_TAB_ID);
    expect(state.dialogueState.assumptions).toHaveLength(2);
    expect(state.dialogueState.assumptions[0].field).toBe('target');
  });

  it('should store the plan', async () => {
    const assumptions = [];
    const plan = { summary: 'Click button', steps: [{ action: 'click' }] };

    const state = await enterAssumeAnnounce(assumptions, plan, TEST_TAB_ID);
    expect(state.currentPlan.summary).toBe('Click button');
  });

  it('should add to conversation history', async () => {
    const assumptions = [{ field: 'target', assumedValue: 'button' }];
    const plan = { summary: 'Click', steps: [] };

    const state = await enterAssumeAnnounce(assumptions, plan, TEST_TAB_ID);

    const lastMessage = state.conversationHistory[state.conversationHistory.length - 1];
    expect(lastMessage.role).toBe('assistant');
    expect(lastMessage.messageType).toBe('assume_announce');
    expect(lastMessage.content).toContain('target: button');
  });
});

// ============================================================================
// enterRefining Tests
// ============================================================================

describe('enterRefining', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
  });

  it('should set status to refining', async () => {
    const state = await enterRefining(TEST_TAB_ID);
    expect(state.status).toBe('refining');
  });

  it('should increment refineIteration', async () => {
    let state = await enterRefining(TEST_TAB_ID);
    expect(state.dialogueState.refineIteration).toBe(1);

    state = await enterRefining(TEST_TAB_ID);
    expect(state.dialogueState.refineIteration).toBe(2);

    state = await enterRefining(TEST_TAB_ID);
    expect(state.dialogueState.refineIteration).toBe(3);
  });
});

// ============================================================================
// setPlan Tests
// ============================================================================

describe('setPlan', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
  });

  it('should store the plan', async () => {
    const plan = {
      summary: 'Click login button',
      steps: [{ action: 'click', targetId: 'ai-target-5' }]
    };
    const confidence = { overall: 0.8 };

    const state = await setPlan(plan, confidence, TEST_TAB_ID);
    expect(state.currentPlan.summary).toBe('Click login button');
    expect(state.currentPlan.steps).toHaveLength(1);
  });

  it('should assign plan ID and version', async () => {
    const plan = { summary: 'Test', steps: [] };
    const confidence = { overall: 0.8 };

    const state = await setPlan(plan, confidence, TEST_TAB_ID);
    expect(state.currentPlan.id).toMatch(/^plan-\d+$/);
    expect(state.currentPlan.version).toBe(1);
  });

  it('should store confidence', async () => {
    const plan = { summary: 'Test', steps: [] };
    const confidence = { overall: 0.85, intentClarity: 0.9 };

    const state = await setPlan(plan, confidence, TEST_TAB_ID);
    expect(state.confidence.overall).toBe(0.85);
    expect(state.confidence.intentClarity).toBe(0.9);
  });

  it('should move previous plan to history', async () => {
    const plan1 = { summary: 'Plan 1', steps: [] };
    const plan2 = { summary: 'Plan 2', steps: [] };
    const confidence = { overall: 0.8 };

    await setPlan(plan1, confidence, TEST_TAB_ID);
    const state = await setPlan(plan2, confidence, TEST_TAB_ID);

    expect(state.planHistory).toHaveLength(1);
    expect(state.planHistory[0].summary).toBe('Plan 1');
    expect(state.currentPlan.summary).toBe('Plan 2');
    expect(state.currentPlan.version).toBe(2);
  });
});

// ============================================================================
// enterMidExecDialog Tests
// ============================================================================

describe('enterMidExecDialog', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
    await setPlan(
      { summary: 'Test', steps: [{ action: 'click' }, { action: 'type' }] },
      { overall: 0.9 },
      TEST_TAB_ID
    );
    await startExecution(TEST_TAB_ID);
  });

  it('should set status to mid_exec_dialog', async () => {
    const state = await enterMidExecDialog({ action: 'click' }, 'Element not found', TEST_TAB_ID);
    expect(state.status).toBe('mid_exec_dialog');
  });

  it('should record failed step', async () => {
    const state = await enterMidExecDialog({ action: 'click' }, 'Element not found', TEST_TAB_ID);

    expect(state.executionState.failedSteps).toHaveLength(1);
    expect(state.executionState.failedSteps[0].error).toBe('Element not found');
    expect(state.executionState.failedSteps[0].stepIndex).toBe(0);
  });
});

// ============================================================================
// recordMidExecDecision Tests
// ============================================================================

describe('recordMidExecDecision', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
    await setPlan(
      { summary: 'Test', steps: [{ action: 'click' }, { action: 'type' }] },
      { overall: 0.9 },
      TEST_TAB_ID
    );
    await startExecution(TEST_TAB_ID);
    await enterMidExecDialog({ action: 'click' }, 'Error', TEST_TAB_ID);
  });

  describe('retry decision', () => {
    it('should transition to executing', async () => {
      const state = await recordMidExecDecision('retry', TEST_TAB_ID);
      expect(state.status).toBe('executing');
    });

    it('should record resolution', async () => {
      const state = await recordMidExecDecision('retry', TEST_TAB_ID);
      expect(state.executionState.failedSteps[0].resolution).toBe('retry');
    });

    it('should not change step index', async () => {
      const state = await recordMidExecDecision('retry', TEST_TAB_ID);
      expect(state.executionState.currentStepIndex).toBe(0);
    });
  });

  describe('skip decision', () => {
    it('should transition to executing', async () => {
      const state = await recordMidExecDecision('skip', TEST_TAB_ID);
      expect(state.status).toBe('executing');
    });

    it('should increment step index', async () => {
      const state = await recordMidExecDecision('skip', TEST_TAB_ID);
      expect(state.executionState.currentStepIndex).toBe(1);
    });
  });

  describe('replan decision', () => {
    it('should transition to replanning', async () => {
      const state = await recordMidExecDecision('replan', TEST_TAB_ID);
      expect(state.status).toBe('replanning');
    });
  });

  describe('abort decision', () => {
    it('should transition to idle', async () => {
      const state = await recordMidExecDecision('abort', TEST_TAB_ID);
      expect(state.status).toBe('idle');
    });
  });
});

// ============================================================================
// updateExecutionProgress Tests
// ============================================================================

describe('updateExecutionProgress', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
    await setPlan(
      {
        summary: 'Test',
        steps: [
          { action: 'click', targetId: 'ai-target-1' },
          { action: 'type', targetId: 'ai-target-2', value: 'hello' }
        ]
      },
      { overall: 0.9 },
      TEST_TAB_ID
    );
    await startExecution(TEST_TAB_ID);
  });

  it('should add to completed steps', async () => {
    const state = await updateExecutionProgress(0, { success: true }, TEST_TAB_ID);
    expect(state.executionState.completedSteps).toHaveLength(1);
    expect(state.executionState.completedSteps[0].stepIndex).toBe(0);
  });

  it('should increment current step index', async () => {
    const state = await updateExecutionProgress(0, { success: true }, TEST_TAB_ID);
    expect(state.executionState.currentStepIndex).toBe(1);
  });

  it('should store result', async () => {
    const state = await updateExecutionProgress(0, { success: true, data: 'clicked' }, TEST_TAB_ID);
    expect(state.executionState.completedSteps[0].result.success).toBe(true);
  });
});

// ============================================================================
// startExecution Tests
// ============================================================================

describe('startExecution', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
    await setPlan(
      { summary: 'Test', steps: [{ action: 'click' }, { action: 'type' }] },
      { overall: 0.9 },
      TEST_TAB_ID
    );
  });

  it('should set status to executing', async () => {
    const state = await startExecution(TEST_TAB_ID);
    expect(state.status).toBe('executing');
  });

  it('should reset execution state', async () => {
    const state = await startExecution(TEST_TAB_ID);
    expect(state.executionState.currentStepIndex).toBe(0);
    expect(state.executionState.completedSteps).toHaveLength(0);
    expect(state.executionState.failedSteps).toHaveLength(0);
  });

  it('should set total steps from plan', async () => {
    const state = await startExecution(TEST_TAB_ID);
    expect(state.executionState.totalSteps).toBe(2);
  });
});

// ============================================================================
// stopTask Tests
// ============================================================================

describe('stopTask', () => {
  beforeEach(async () => {
    await startPlanning('Task', TEST_TAB_ID);
    await setPlan(
      { summary: 'Test', steps: [] },
      { overall: 0.9 },
      TEST_TAB_ID
    );
  });

  it('should set status to idle', async () => {
    const state = await stopTask(TEST_TAB_ID);
    expect(state.status).toBe('idle');
  });

  it('should clear current task', async () => {
    const state = await stopTask(TEST_TAB_ID);
    expect(state.currentTask).toBeNull();
  });

  it('should reset dialogue state', async () => {
    await enterClarifying([{ question: 'Q?' }], TEST_TAB_ID);
    const state = await stopTask(TEST_TAB_ID);
    expect(state.dialogueState.clarificationRound).toBe(0);
    expect(state.dialogueState.pendingQuestions).toHaveLength(0);
  });

  it('should clear plan', async () => {
    const state = await stopTask(TEST_TAB_ID);
    expect(state.currentPlan).toBeNull();
  });

  it('should reset confidence', async () => {
    const state = await stopTask(TEST_TAB_ID);
    expect(state.confidence.overall).toBe(0);
  });
});

// ============================================================================
// Tab Isolation Tests
// ============================================================================

describe('tab isolation', () => {
  const TAB_1 = 111;
  const TAB_2 = 222;

  beforeEach(async () => {
    await resetState(TAB_1);
    await resetState(TAB_2);
  });

  it('should maintain separate state per tab', async () => {
    await startPlanning('Task for tab 1', TAB_1);
    await startPlanning('Task for tab 2', TAB_2);

    const state1 = await loadState(TAB_1);
    const state2 = await loadState(TAB_2);

    expect(state1.currentTask).toBe('Task for tab 1');
    expect(state2.currentTask).toBe('Task for tab 2');
  });

  it('should not affect other tabs on transition', async () => {
    await startPlanning('Task 1', TAB_1);
    await startPlanning('Task 2', TAB_2);

    await transitionTo('clarifying', TAB_1);

    const state1 = await loadState(TAB_1);
    const state2 = await loadState(TAB_2);

    expect(state1.status).toBe('clarifying');
    expect(state2.status).toBe('planning');
  });

  it('should store correct tabId in state', async () => {
    await startPlanning('Task 1', TAB_1);
    await startPlanning('Task 2', TAB_2);

    const state1 = await loadState(TAB_1);
    const state2 = await loadState(TAB_2);

    expect(state1.tabId).toBe(TAB_1);
    expect(state2.tabId).toBe(TAB_2);
  });
});
