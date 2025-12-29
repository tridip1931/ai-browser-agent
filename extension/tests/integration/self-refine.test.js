/**
 * Self-Refine Flow Integration Tests
 *
 * Tests the plan refinement loop:
 * - Entering refining state
 * - Maximum 3 iterations
 * - Early exit when score >= 0.9
 * - Iteration tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DialogueTestHarness } from './dialogue-harness.js';
import { resetChromeMock } from '../unit/mocks/chrome-api.js';

describe('Self-Refine Flow', () => {
  let harness;

  beforeEach(async () => {
    resetChromeMock();
    harness = new DialogueTestHarness(12345);
    await harness.reset();
  });

  describe('Entering refining state', () => {
    it('should transition to refining state', async () => {
      await harness.startPlanningPhase('Complex task');
      await harness.enterRefiningState();

      await harness.assertState({
        status: 'refining'
      });
    });

    it('should increment refine iteration on entry', async () => {
      await harness.startPlanningPhase('Task');
      await harness.enterRefiningState();

      const state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(1);
    });

    it('should track default maxRefineIterations as 3', async () => {
      await harness.startPlanningPhase('Task');

      const state = await harness.getState();
      expect(state.dialogueState.maxRefineIterations).toBe(3);
    });
  });

  describe('Multiple refine iterations', () => {
    it('should allow up to 3 refine iterations', async () => {
      await harness.startPlanningPhase('Task needing refinement');

      // Iteration 1
      await harness.enterRefiningState();
      let state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(1);

      // Back to planning
      await harness.transitionToState('planning');

      // Iteration 2
      await harness.enterRefiningState();
      state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(2);

      // Back to planning
      await harness.transitionToState('planning');

      // Iteration 3
      await harness.enterRefiningState();
      state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(3);
    });

    it('should track iteration count across refinements', async () => {
      await harness.startPlanningPhase('Task');

      await harness.enterRefiningState();
      await harness.transitionToState('planning');
      await harness.enterRefiningState();

      const state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(2);
    });
  });

  describe('Early exit on high confidence', () => {
    it('should allow transition to awaiting_approval when confidence >= 0.9', async () => {
      await harness.startPlanningPhase('Task');

      // Initial plan with low confidence
      await harness.setPlanWithConfidence(
        { summary: 'Initial plan', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.7 }
      );

      // Enter refine
      await harness.enterRefiningState();

      // Refined plan reaches high confidence
      await harness.setPlanWithConfidence(
        { summary: 'Refined plan', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.92 }
      );

      // Can now proceed to approval
      await harness.transitionToState('awaiting_approval');

      await harness.assertState({ status: 'awaiting_approval' });

      const state = await harness.getState();
      expect(state.confidence.overall).toBe(0.92);
      expect(state.dialogueState.refineIteration).toBe(1);
    });

    it('should exit early if first refine achieves high confidence', async () => {
      await harness.startPlanningPhase('Task');

      await harness.setPlanWithConfidence(
        { summary: 'Good plan', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.95 }
      );

      await harness.enterRefiningState();

      // Only 1 iteration needed
      const state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(1);

      // Can proceed directly
      await harness.transitionToState('awaiting_approval');
      await harness.assertState({ status: 'awaiting_approval' });
    });
  });

  describe('Plan improvement tracking', () => {
    it('should track plan versions through refinement', async () => {
      await harness.startPlanningPhase('Task');

      // Initial plan
      await harness.setPlanWithConfidence(
        { summary: 'Plan v1', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.6 }
      );

      await harness.enterRefiningState();

      // Refined plan
      await harness.setPlanWithConfidence(
        { summary: 'Plan v2 - improved', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.8 }
      );

      const state = await harness.getState();
      expect(state.currentPlan.version).toBe(2);
      expect(state.planHistory).toHaveLength(1);
      expect(state.planHistory[0].summary).toBe('Plan v1');
    });

    it('should preserve plan history across multiple refinements', async () => {
      await harness.startPlanningPhase('Task');

      // Plan v1
      await harness.setPlanWithConfidence(
        { summary: 'v1', steps: [] },
        { overall: 0.5 }
      );

      await harness.enterRefiningState();

      // Plan v2
      await harness.setPlanWithConfidence(
        { summary: 'v2', steps: [] },
        { overall: 0.7 }
      );

      await harness.transitionToState('planning');
      await harness.enterRefiningState();

      // Plan v3
      await harness.setPlanWithConfidence(
        { summary: 'v3', steps: [] },
        { overall: 0.9 }
      );

      const state = await harness.getState();
      expect(state.currentPlan.version).toBe(3);
      expect(state.planHistory).toHaveLength(2);
    });
  });

  describe('Confidence improvement tracking', () => {
    it('should track confidence changes through refinement', async () => {
      await harness.startPlanningPhase('Task');

      // Low confidence
      await harness.setPlanWithConfidence(
        { summary: 'Plan', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.5, intentClarity: 0.6, targetMatch: 0.4, valueConfidence: 0.5 }
      );

      let state = await harness.getState();
      const initialConfidence = state.confidence.overall;

      await harness.enterRefiningState();

      // Improved confidence
      await harness.setPlanWithConfidence(
        { summary: 'Better plan', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.85, intentClarity: 0.9, targetMatch: 0.8, valueConfidence: 0.85 }
      );

      state = await harness.getState();
      expect(state.confidence.overall).toBeGreaterThan(initialConfidence);
    });
  });

  describe('Refine to execution flow', () => {
    it('should complete: plan → refine → approve → execute', async () => {
      await harness.startPlanningPhase('Task');

      // Initial low-confidence plan
      await harness.setPlanWithConfidence(
        { summary: 'Initial', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.6 }
      );

      // Refine
      await harness.enterRefiningState();
      await harness.assertState({ status: 'refining' });

      // Improved plan
      await harness.setPlanWithConfidence(
        { summary: 'Refined', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.92 }
      );

      // Approve
      await harness.transitionToState('awaiting_approval');
      await harness.assertState({ status: 'awaiting_approval' });

      // Execute
      await harness.startExecutionPhase();
      await harness.completeStep(0, { success: true });
      await harness.transitionToState('completed');

      await harness.assertState({ status: 'completed' });
    });

    it('should allow multiple refine rounds before approval', async () => {
      await harness.startPlanningPhase('Complex task');

      // Round 1: 0.5 -> 0.65
      await harness.setPlanWithConfidence(
        { summary: 'v1', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.5 }
      );
      await harness.enterRefiningState();
      await harness.setPlanWithConfidence(
        { summary: 'v2', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.65 }
      );

      // Round 2: 0.65 -> 0.8
      await harness.transitionToState('planning');
      await harness.enterRefiningState();
      await harness.setPlanWithConfidence(
        { summary: 'v3', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.8 }
      );

      // Round 3: 0.8 -> 0.92
      await harness.transitionToState('planning');
      await harness.enterRefiningState();
      await harness.setPlanWithConfidence(
        { summary: 'v4', steps: [{ action: 'click', targetId: 'ai-target-1' }] },
        { overall: 0.92 }
      );

      // Final state
      const state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(3);
      expect(state.confidence.overall).toBe(0.92);
      expect(state.planHistory).toHaveLength(3);
    });
  });

  describe('Edge cases', () => {
    it('should handle stopping during refinement', async () => {
      await harness.startPlanningPhase('Task');
      await harness.enterRefiningState();

      await harness.stopCurrentTask();

      await harness.assertState({ status: 'idle' });

      const state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(0);
    });

    it('should preserve refine iteration on state transitions', async () => {
      await harness.startPlanningPhase('Task');
      await harness.enterRefiningState();
      await harness.enterRefiningState();

      const state = await harness.getState();
      expect(state.dialogueState.refineIteration).toBe(2);

      // Transition doesn't reset iteration
      await harness.transitionToState('planning');
      const afterTransition = await harness.getState();
      expect(afterTransition.dialogueState.refineIteration).toBe(2);
    });

    it('should handle empty plan during refinement', async () => {
      await harness.startPlanningPhase('Task');

      await harness.setPlanWithConfidence(
        { summary: 'Empty steps', steps: [] },
        { overall: 0.6 }
      );

      await harness.enterRefiningState();

      const state = await harness.getState();
      expect(state.status).toBe('refining');
      expect(state.currentPlan.steps).toHaveLength(0);
    });
  });

  describe('Tab isolation in refinement', () => {
    it('should maintain separate refine states per tab', async () => {
      const harness1 = new DialogueTestHarness(77771);
      const harness2 = new DialogueTestHarness(77772);

      await harness1.reset();
      await harness2.reset();

      // Tab 1: 2 refine iterations
      await harness1.startPlanningPhase('Task 1');
      await harness1.enterRefiningState();
      await harness1.transitionToState('planning');
      await harness1.enterRefiningState();

      // Tab 2: 1 refine iteration
      await harness2.startPlanningPhase('Task 2');
      await harness2.enterRefiningState();

      const state1 = await harness1.getState();
      const state2 = await harness2.getState();

      expect(state1.dialogueState.refineIteration).toBe(2);
      expect(state2.dialogueState.refineIteration).toBe(1);
    });
  });
});
