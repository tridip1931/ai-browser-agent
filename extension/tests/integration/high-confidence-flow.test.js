/**
 * High Confidence Flow Integration Tests
 *
 * Tests the happy path: Task → Planning → Approval → Execution → Complete
 * When confidence >= 0.9, the agent should proceed directly to approval
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DialogueTestHarness } from './dialogue-harness.js';

describe('High Confidence Flow (>= 0.9)', () => {
  let harness;

  beforeEach(async () => {
    harness = new DialogueTestHarness(12345);
    await harness.reset();
  });

  describe('Task → Planning → Awaiting Approval', () => {
    it('should transition from idle to planning when task submitted', async () => {
      await harness.startPlanningPhase('Click the Login button');

      await harness.assertState({
        status: 'planning',
        currentTask: 'Click the Login button'
      });
    });

    it('should store task in conversation history', async () => {
      await harness.startPlanningPhase('Click the Login button');

      const state = await harness.getState();
      expect(state.conversationHistory).toHaveLength(1);
      expect(state.conversationHistory[0]).toMatchObject({
        role: 'user',
        content: 'Click the Login button',
        messageType: 'task'
      });
    });

    it('should transition to awaiting_approval with high confidence plan', async () => {
      await harness.startPlanningPhase('Click the Login button');

      const highConfidencePlan = {
        summary: 'Click the Login button',
        steps: [
          { step: 1, action: 'click', targetId: 'ai-target-1', targetDescription: 'Login button' }
        ],
        assumptions: [],
        risks: []
      };

      const confidence = {
        overall: 0.95,
        intentClarity: 1.0,
        targetMatch: 0.95,
        valueConfidence: 1.0
      };

      await harness.setPlanWithConfidence(highConfidencePlan, confidence);
      await harness.transitionToState('awaiting_approval');

      await harness.assertState({
        status: 'awaiting_approval'
      });

      const state = await harness.getState();
      expect(state.currentPlan).toBeDefined();
      expect(state.currentPlan.summary).toBe('Click the Login button');
      expect(state.confidence.overall).toBe(0.95);
    });

    it('should correctly identify confidence zone as proceed', async () => {
      await harness.startPlanningPhase('Click button');

      await harness.setPlanWithConfidence(
        { summary: 'Click', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.92, intentClarity: 0.95, targetMatch: 0.9, valueConfidence: 1.0 }
      );

      const state = await harness.getState();
      // Import and use getConfidenceZone from state-manager
      // For now we verify the confidence is stored correctly
      expect(state.confidence.overall).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('Approval → Execution → Complete', () => {
    beforeEach(async () => {
      // Set up state as if planning completed with high confidence
      await harness.startPlanningPhase('Click the Login button');

      await harness.setPlanWithConfidence(
        {
          summary: 'Click the Login button',
          steps: [
            { step: 1, action: 'click', targetId: 'ai-target-1', targetDescription: 'Login button' }
          ]
        },
        { overall: 0.95, intentClarity: 1.0, targetMatch: 0.95, valueConfidence: 1.0 }
      );

      await harness.transitionToState('awaiting_approval');
    });

    it('should transition to executing after approval', async () => {
      await harness.startExecutionPhase();

      await harness.assertState({
        status: 'executing',
        executionState: {
          currentStepIndex: 0,
          totalSteps: 1
        }
      });
    });

    it('should track completed steps during execution', async () => {
      await harness.startExecutionPhase();

      // Simulate step completion
      await harness.completeStep(0, { success: true, result: 'Clicked Login button' });

      const state = await harness.getState();
      expect(state.executionState.completedSteps).toHaveLength(1);
      expect(state.executionState.completedSteps[0]).toMatchObject({
        stepIndex: 0,
        result: { success: true }
      });
      expect(state.executionState.currentStepIndex).toBe(1);
    });

    it('should transition to completed after all steps done', async () => {
      await harness.startExecutionPhase();
      await harness.completeStep(0, { success: true });

      // Manually transition to completed (in real agent loop this would be automatic)
      await harness.transitionToState('completed');

      await harness.assertState({
        status: 'completed'
      });
    });
  });

  describe('Multi-step execution', () => {
    beforeEach(async () => {
      await harness.startPlanningPhase('Search for JavaScript tutorials');

      await harness.setPlanWithConfidence(
        {
          summary: 'Search for JavaScript tutorials',
          steps: [
            { step: 1, action: 'type', targetId: 'ai-target-1', value: 'JavaScript tutorials' },
            { step: 2, action: 'click', targetId: 'ai-target-2', targetDescription: 'Search button' }
          ]
        },
        { overall: 0.92, intentClarity: 0.95, targetMatch: 0.9, valueConfidence: 0.95 }
      );

      await harness.transitionToState('awaiting_approval');
    });

    it('should correctly set total steps from plan', async () => {
      await harness.startExecutionPhase();

      const state = await harness.getState();
      expect(state.executionState.totalSteps).toBe(2);
    });

    it('should execute steps in order', async () => {
      await harness.startExecutionPhase();

      // Step 1
      await harness.assertState({
        executionState: { currentStepIndex: 0 }
      });

      await harness.completeStep(0, { success: true });

      // Step 2
      await harness.assertState({
        executionState: { currentStepIndex: 1 }
      });

      await harness.completeStep(1, { success: true });

      const state = await harness.getState();
      expect(state.executionState.completedSteps).toHaveLength(2);
      expect(state.executionState.currentStepIndex).toBe(2);
    });

    it('should track all completed steps with results', async () => {
      await harness.startExecutionPhase();

      await harness.completeStep(0, { success: true, result: 'Typed text' });
      await harness.completeStep(1, { success: true, result: 'Clicked search' });

      const state = await harness.getState();
      expect(state.executionState.completedSteps[0].result.result).toBe('Typed text');
      expect(state.executionState.completedSteps[1].result.result).toBe('Clicked search');
    });
  });

  describe('Plan versioning', () => {
    it('should increment plan version when setting new plan', async () => {
      await harness.startPlanningPhase('Task 1');

      await harness.setPlanWithConfidence(
        { summary: 'Plan v1', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.95 }
      );

      let state = await harness.getState();
      expect(state.currentPlan.version).toBe(1);

      // Set a new plan
      await harness.setPlanWithConfidence(
        { summary: 'Plan v2', steps: [{ action: 'click', targetId: 'ai-target-2' }] },
        { overall: 0.93 }
      );

      state = await harness.getState();
      expect(state.currentPlan.version).toBe(2);
      expect(state.planHistory).toHaveLength(1);
    });

    it('should store previous plans in history', async () => {
      await harness.startPlanningPhase('Task');

      await harness.setPlanWithConfidence(
        { summary: 'First plan', steps: [] },
        { overall: 0.9 }
      );

      await harness.setPlanWithConfidence(
        { summary: 'Second plan', steps: [] },
        { overall: 0.95 }
      );

      const state = await harness.getState();
      expect(state.planHistory).toHaveLength(1);
      expect(state.planHistory[0].summary).toBe('First plan');
      expect(state.currentPlan.summary).toBe('Second plan');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty steps array', async () => {
      await harness.startPlanningPhase('Empty task');

      await harness.setPlanWithConfidence(
        { summary: 'Nothing to do', steps: [] },
        { overall: 0.95 }
      );

      await harness.transitionToState('awaiting_approval');
      await harness.startExecutionPhase();

      const state = await harness.getState();
      expect(state.executionState.totalSteps).toBe(0);
    });

    it('should handle confidence exactly at 0.9 threshold', async () => {
      await harness.startPlanningPhase('Boundary task');

      await harness.setPlanWithConfidence(
        { summary: 'At threshold', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.9, intentClarity: 0.9, targetMatch: 0.9, valueConfidence: 0.9 }
      );

      const state = await harness.getState();
      // 0.9 should be in 'proceed' zone
      expect(state.confidence.overall).toBe(0.9);
    });

    it('should maintain tabId throughout the flow', async () => {
      const customTabId = 99999;
      const customHarness = new DialogueTestHarness(customTabId);
      await customHarness.reset();

      await customHarness.startPlanningPhase('Tab-specific task');

      const state = await customHarness.getState();
      expect(state.tabId).toBe(customTabId);
    });
  });

  describe('Full flow simulation', () => {
    it('should complete full high-confidence flow: task → plan → approve → execute → complete', async () => {
      // 1. User submits task
      await harness.startPlanningPhase('Click the About link');

      await harness.assertState({ status: 'planning' });

      // 2. LLM returns high-confidence plan
      await harness.setPlanWithConfidence(
        {
          summary: 'Navigate to About page',
          steps: [
            { step: 1, action: 'click', targetId: 'ai-target-2', targetDescription: 'About link' }
          ],
          assumptions: [],
          risks: []
        },
        { overall: 0.98, intentClarity: 1.0, targetMatch: 1.0, valueConfidence: 1.0 }
      );

      // 3. Transition to awaiting approval (high confidence skips clarification)
      await harness.transitionToState('awaiting_approval');
      await harness.assertState({ status: 'awaiting_approval' });

      // 4. User approves → start execution
      await harness.startExecutionPhase();
      await harness.assertState({ status: 'executing' });

      // 5. Execute the action
      const executedActions = harness.getExecutedActions();
      expect(executedActions).toHaveLength(0); // No real execution yet

      // 6. Complete the step
      await harness.completeStep(0, { success: true, result: 'Navigated to About page' });

      // 7. Mark as completed
      await harness.transitionToState('completed');
      await harness.assertState({ status: 'completed' });

      // Verify final state
      const finalState = await harness.getState();
      expect(finalState.executionState.completedSteps).toHaveLength(1);
      expect(finalState.currentPlan.summary).toBe('Navigate to About page');
    });
  });
});
