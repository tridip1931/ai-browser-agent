/**
 * Mid-Execution Dialogue Integration Tests
 *
 * Tests the error recovery flow during execution:
 * - Action failure detection
 * - User decision options: retry, skip, replan, abort
 * - State transitions based on decisions
 * - Failed step tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DialogueTestHarness } from './dialogue-harness.js';
import { resetChromeMock } from '../unit/mocks/chrome-api.js';

describe('Mid-Execution Dialogue', () => {
  let harness;

  beforeEach(async () => {
    resetChromeMock();
    harness = new DialogueTestHarness(12345);
    await harness.reset();

    // Set up a typical state ready for execution
    await harness.startPlanningPhase('Click button then type text');
    await harness.setPlanWithConfidence(
      {
        summary: 'Click button then type text',
        steps: [
          { step: 1, action: 'click', targetId: 'ai-target-1', targetDescription: 'Button' },
          { step: 2, action: 'type', targetId: 'ai-target-2', value: 'Hello', targetDescription: 'Input' }
        ]
      },
      { overall: 0.95 }
    );
    await harness.transitionToState('awaiting_approval');
    await harness.startExecutionPhase();
  });

  describe('Entering mid-exec dialog on failure', () => {
    it('should transition to mid_exec_dialog when step fails', async () => {
      const failedStep = { action: 'click', targetId: 'ai-target-1' };
      const error = 'Element not found: ai-target-1';

      await harness.enterMidExecDialogState(failedStep, error);

      await harness.assertState({
        status: 'mid_exec_dialog'
      });
    });

    it('should record failed step in execution state', async () => {
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Element obscured by overlay'
      );

      const state = await harness.getState();
      expect(state.executionState.failedSteps).toHaveLength(1);
      expect(state.executionState.failedSteps[0]).toMatchObject({
        error: 'Element obscured by overlay',
        retryCount: 0,
        resolution: null
      });
    });

    it('should preserve current step index on failure', async () => {
      // Complete first step
      await harness.completeStep(0, { success: true });

      // Fail on second step
      await harness.enterMidExecDialogState(
        { action: 'type', targetId: 'ai-target-2' },
        'Input field not interactive'
      );

      const state = await harness.getState();
      expect(state.executionState.currentStepIndex).toBe(1);
      expect(state.executionState.completedSteps).toHaveLength(1);
    });
  });

  describe('Retry decision', () => {
    beforeEach(async () => {
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Element not found'
      );
    });

    it('should transition back to executing on retry', async () => {
      await harness.simulateMidExecDecision('retry');

      await harness.assertState({
        status: 'executing'
      });
    });

    it('should record retry as resolution', async () => {
      await harness.simulateMidExecDecision('retry');

      const state = await harness.getState();
      expect(state.executionState.failedSteps[0].resolution).toBe('retry');
    });

    it('should keep current step index same for retry', async () => {
      const stateBefore = await harness.getState();
      const stepIndexBefore = stateBefore.executionState.currentStepIndex;

      await harness.simulateMidExecDecision('retry');

      const stateAfter = await harness.getState();
      expect(stateAfter.executionState.currentStepIndex).toBe(stepIndexBefore);
    });
  });

  describe('Skip decision', () => {
    beforeEach(async () => {
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Non-critical element not found'
      );
    });

    it('should transition back to executing on skip', async () => {
      await harness.simulateMidExecDecision('skip');

      await harness.assertState({
        status: 'executing'
      });
    });

    it('should record skip as resolution', async () => {
      await harness.simulateMidExecDecision('skip');

      const state = await harness.getState();
      expect(state.executionState.failedSteps[0].resolution).toBe('skip');
    });

    it('should increment step index on skip', async () => {
      const stateBefore = await harness.getState();
      const stepIndexBefore = stateBefore.executionState.currentStepIndex;

      await harness.simulateMidExecDecision('skip');

      const stateAfter = await harness.getState();
      expect(stateAfter.executionState.currentStepIndex).toBe(stepIndexBefore + 1);
    });
  });

  describe('Replan decision', () => {
    beforeEach(async () => {
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Page structure changed'
      );
    });

    it('should transition to replanning on replan decision', async () => {
      await harness.simulateMidExecDecision('replan');

      await harness.assertState({
        status: 'replanning'
      });
    });

    it('should record replan as resolution', async () => {
      await harness.simulateMidExecDecision('replan');

      const state = await harness.getState();
      expect(state.executionState.failedSteps[0].resolution).toBe('replan');
    });

    it('should preserve completed steps when replanning', async () => {
      // Complete first step before failure on second
      await harness.transitionToState('executing'); // Reset to executing
      await harness.completeStep(0, { success: true });

      // Fail on second step
      await harness.enterMidExecDialogState(
        { action: 'type', targetId: 'ai-target-2' },
        'Field not found'
      );

      await harness.simulateMidExecDecision('replan');

      const state = await harness.getState();
      expect(state.executionState.completedSteps).toHaveLength(1);
    });
  });

  describe('Abort decision', () => {
    beforeEach(async () => {
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Critical failure'
      );
    });

    it('should transition to idle on abort', async () => {
      await harness.simulateMidExecDecision('abort');

      await harness.assertState({
        status: 'idle'
      });
    });

    it('should record abort as resolution', async () => {
      await harness.simulateMidExecDecision('abort');

      const state = await harness.getState();
      expect(state.executionState.failedSteps[0].resolution).toBe('abort');
    });
  });

  describe('Multiple failures in same execution', () => {
    it('should track multiple failed steps', async () => {
      // First failure - retry
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'First failure'
      );
      await harness.simulateMidExecDecision('retry');

      // Second failure - skip
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Second failure'
      );
      await harness.simulateMidExecDecision('skip');

      const state = await harness.getState();
      expect(state.executionState.failedSteps).toHaveLength(2);
      expect(state.executionState.failedSteps[0].resolution).toBe('retry');
      expect(state.executionState.failedSteps[1].resolution).toBe('skip');
    });

    it('should track failures at different steps', async () => {
      // Fail on step 0
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Step 0 failed'
      );
      await harness.simulateMidExecDecision('skip');

      // Fail on step 1
      await harness.enterMidExecDialogState(
        { action: 'type', targetId: 'ai-target-2' },
        'Step 1 failed'
      );

      const state = await harness.getState();
      expect(state.executionState.failedSteps).toHaveLength(2);
    });
  });

  describe('Failed step timestamps', () => {
    it('should record timestamp when failure occurs', async () => {
      const beforeTime = Date.now();

      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Failure'
      );

      const afterTime = Date.now();
      const state = await harness.getState();

      expect(state.executionState.failedSteps[0].timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(state.executionState.failedSteps[0].timestamp).toBeLessThanOrEqual(afterTime + 100);
    });
  });

  describe('Recovery and completion', () => {
    it('should complete successfully after retry succeeds', async () => {
      // Fail first step
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Transient error'
      );
      await harness.simulateMidExecDecision('retry');

      // Now succeed
      await harness.completeStep(0, { success: true });
      await harness.completeStep(1, { success: true });
      await harness.transitionToState('completed');

      await harness.assertState({ status: 'completed' });

      const state = await harness.getState();
      expect(state.executionState.completedSteps).toHaveLength(2);
      expect(state.executionState.failedSteps).toHaveLength(1);
    });

    it('should complete with skipped steps', async () => {
      // Skip first step
      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        'Skip this'
      );
      await harness.simulateMidExecDecision('skip');

      // Complete second step
      await harness.completeStep(1, { success: true });
      await harness.transitionToState('completed');

      await harness.assertState({ status: 'completed' });

      const state = await harness.getState();
      expect(state.executionState.completedSteps).toHaveLength(1);
      expect(state.executionState.failedSteps).toHaveLength(1);
      expect(state.executionState.failedSteps[0].resolution).toBe('skip');
    });
  });

  describe('Tab isolation in mid-exec dialog', () => {
    it('should maintain separate mid-exec states per tab', async () => {
      const harness1 = new DialogueTestHarness(88881);
      const harness2 = new DialogueTestHarness(88882);

      await harness1.reset();
      await harness2.reset();

      // Set up both for execution
      for (const h of [harness1, harness2]) {
        await h.startPlanningPhase('Task');
        await h.setPlanWithConfidence(
          { summary: 'Click', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
          { overall: 0.95 }
        );
        await h.transitionToState('awaiting_approval');
        await h.startExecutionPhase();
      }

      // Tab 1: mid-exec dialog
      await harness1.enterMidExecDialogState({ action: 'click' }, 'Tab 1 error');

      // Tab 2: still executing
      const state1 = await harness1.getState();
      const state2 = await harness2.getState();

      expect(state1.status).toBe('mid_exec_dialog');
      expect(state2.status).toBe('executing');
    });
  });

  describe('Error message preservation', () => {
    it('should preserve full error message in failed step', async () => {
      const detailedError = 'Element [ai-target-1] not found: DOM query returned null after 3000ms timeout. Possible causes: element removed, selector changed, or page not fully loaded.';

      await harness.enterMidExecDialogState(
        { action: 'click', targetId: 'ai-target-1' },
        detailedError
      );

      const state = await harness.getState();
      expect(state.executionState.failedSteps[0].error).toBe(detailedError);
    });
  });
});
