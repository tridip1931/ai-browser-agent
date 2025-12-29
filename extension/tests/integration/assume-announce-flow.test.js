/**
 * Assume-Announce Flow Integration Tests
 *
 * Tests the medium confidence path (0.5-0.9):
 * - Assumptions are displayed to user
 * - 3-second auto-execute timer
 * - User can correct assumptions
 * - User can cancel before auto-execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DialogueTestHarness } from './dialogue-harness.js';
import { getConfidenceZone } from '../../lib/state-manager.js';

describe('Assume-Announce Flow (0.5-0.9)', () => {
  let harness;

  beforeEach(async () => {
    harness = new DialogueTestHarness(12345);
    await harness.reset();
  });

  describe('Confidence zone routing', () => {
    it('should identify 0.5 as assume_announce zone', () => {
      expect(getConfidenceZone(0.5)).toBe('assume_announce');
    });

    it('should identify 0.7 as assume_announce zone', () => {
      expect(getConfidenceZone(0.7)).toBe('assume_announce');
    });

    it('should identify 0.89 as assume_announce zone', () => {
      expect(getConfidenceZone(0.89)).toBe('assume_announce');
    });

    it('should identify 0.49 as ask zone (below threshold)', () => {
      expect(getConfidenceZone(0.49)).toBe('ask');
    });

    it('should identify 0.9 as proceed zone (at threshold)', () => {
      expect(getConfidenceZone(0.9)).toBe('proceed');
    });
  });

  describe('Enter assume-announce state', () => {
    beforeEach(async () => {
      await harness.startPlanningPhase('Click the submit button');
    });

    it('should transition to assume_announce with assumptions', async () => {
      const assumptions = [
        { field: 'target', assumedValue: 'Submit Form button', confidence: 0.7 }
      ];

      const plan = {
        summary: 'Click the Submit Form button',
        steps: [{ action: 'click', targetId: 'ai-target-1' }]
      };

      await harness.enterAssumeAnnounceState(assumptions, plan);

      await harness.assertState({
        status: 'assume_announce'
      });

      const state = await harness.getState();
      expect(state.dialogueState.assumptions).toEqual(assumptions);
      expect(state.currentPlan).toMatchObject(plan);
    });

    it('should add assume_announce message to conversation history', async () => {
      const assumptions = [
        { field: 'target', assumedValue: 'First submit button', confidence: 0.7 }
      ];

      await harness.enterAssumeAnnounceState(assumptions, { summary: 'Test', steps: [] });

      const state = await harness.getState();
      const lastMessage = state.conversationHistory[state.conversationHistory.length - 1];

      expect(lastMessage.messageType).toBe('assume_announce');
      expect(lastMessage.role).toBe('assistant');
      expect(lastMessage.content).toContain('target: First submit button');
    });

    it('should support multiple assumptions', async () => {
      const assumptions = [
        { field: 'target', assumedValue: 'Submit Form button', confidence: 0.7 },
        { field: 'action', assumedValue: 'click', confidence: 0.85 },
        { field: 'timing', assumedValue: 'immediate', confidence: 0.6 }
      ];

      await harness.enterAssumeAnnounceState(assumptions, { summary: 'Test', steps: [] });

      const state = await harness.getState();
      expect(state.dialogueState.assumptions).toHaveLength(3);
    });
  });

  describe('Auto-execute timer configuration', () => {
    it('should have default autoExecuteDelay of 3000ms', async () => {
      await harness.startPlanningPhase('Test task');

      const state = await harness.getState();
      expect(state.dialogueState.autoExecuteDelay).toBe(3000);
    });

    it('should preserve autoExecuteDelay in assume_announce state', async () => {
      await harness.startPlanningPhase('Test task');

      await harness.enterAssumeAnnounceState(
        [{ field: 'test', assumedValue: 'value', confidence: 0.7 }],
        { summary: 'Test', steps: [] }
      );

      const state = await harness.getState();
      expect(state.dialogueState.autoExecuteDelay).toBe(3000);
    });
  });

  describe('User correction flow', () => {
    beforeEach(async () => {
      await harness.startPlanningPhase('Click the submit button');

      await harness.enterAssumeAnnounceState(
        [{ field: 'target', assumedValue: 'Submit Form button', confidence: 0.7 }],
        {
          summary: 'Click Submit Form button',
          steps: [{ action: 'click', targetId: 'ai-target-1' }]
        }
      );
    });

    it('should allow transition back to planning after user correction', async () => {
      // User corrects the assumption
      await harness.simulateUserAnswer('No, I meant the Submit Review button');

      // System should re-plan with new information
      await harness.assertState({
        status: 'planning'
      });
    });

    it('should record correction in conversation history', async () => {
      await harness.simulateUserAnswer('Click the Submit Review button instead');

      const state = await harness.getState();
      const messages = state.conversationHistory.filter(m => m.role === 'user');
      const lastUserMessage = messages[messages.length - 1];

      expect(lastUserMessage.content).toBe('Click the Submit Review button instead');
      expect(lastUserMessage.messageType).toBe('clarification_answer');
    });

    it('should clear pending questions after user answer', async () => {
      await harness.simulateUserAnswer('Correction');

      const state = await harness.getState();
      expect(state.dialogueState.pendingQuestions).toHaveLength(0);
    });
  });

  describe('Cancel before auto-execution', () => {
    beforeEach(async () => {
      await harness.startPlanningPhase('Click submit');

      await harness.enterAssumeAnnounceState(
        [{ field: 'target', assumedValue: 'Submit button', confidence: 0.7 }],
        { summary: 'Click Submit', steps: [{ action: 'click', targetId: 'ai-target-1' }] }
      );
    });

    it('should allow user to stop task during assume_announce', async () => {
      await harness.stopCurrentTask();

      await harness.assertState({
        status: 'idle',
        currentTask: null
      });
    });

    it('should clear dialogue state on stop', async () => {
      await harness.stopCurrentTask();

      const state = await harness.getState();
      expect(state.dialogueState.assumptions).toHaveLength(0);
      expect(state.currentPlan).toBeNull();
    });
  });

  describe('Proceed to execution', () => {
    beforeEach(async () => {
      await harness.startPlanningPhase('Click submit button');

      const plan = {
        summary: 'Click Submit Form button',
        steps: [
          { step: 1, action: 'click', targetId: 'ai-target-1', targetDescription: 'Submit Form' }
        ]
      };

      await harness.setPlanWithConfidence(plan, {
        overall: 0.7,
        intentClarity: 0.9,
        targetMatch: 0.5,
        valueConfidence: 1.0
      });

      await harness.enterAssumeAnnounceState(
        [{ field: 'target', assumedValue: 'Submit Form button', confidence: 0.7 }],
        plan
      );
    });

    it('should transition to awaiting_approval when user confirms assumptions', async () => {
      await harness.transitionToState('awaiting_approval');

      await harness.assertState({
        status: 'awaiting_approval'
      });
    });

    it('should preserve plan when transitioning to approval', async () => {
      await harness.transitionToState('awaiting_approval');

      const state = await harness.getState();
      expect(state.currentPlan.summary).toBe('Click Submit Form button');
      expect(state.currentPlan.steps).toHaveLength(1);
    });

    it('should allow execution after approval', async () => {
      await harness.transitionToState('awaiting_approval');
      await harness.startExecutionPhase();

      await harness.assertState({
        status: 'executing'
      });
    });
  });

  describe('Full assume-announce flow', () => {
    it('should complete flow: plan → assume_announce → approve → execute', async () => {
      // 1. Start planning with ambiguous task
      await harness.startPlanningPhase('Click the submit button');
      await harness.assertState({ status: 'planning' });

      // 2. LLM returns medium confidence plan with assumptions
      const plan = {
        summary: 'Click Submit Form button (first submit)',
        steps: [{ action: 'click', targetId: 'ai-target-1' }],
        risks: ['Multiple submit buttons exist']
      };

      await harness.setPlanWithConfidence(plan, {
        overall: 0.7,
        intentClarity: 0.9,
        targetMatch: 0.5,
        valueConfidence: 1.0
      });

      // 3. Enter assume-announce (medium confidence)
      await harness.enterAssumeAnnounceState(
        [{ field: 'target', assumedValue: 'Submit Form button', confidence: 0.7 }],
        plan
      );
      await harness.assertState({ status: 'assume_announce' });

      // 4. User accepts assumptions (or timer expires) → approval
      await harness.transitionToState('awaiting_approval');
      await harness.assertState({ status: 'awaiting_approval' });

      // 5. User approves → execution
      await harness.startExecutionPhase();
      await harness.assertState({ status: 'executing' });

      // 6. Execute and complete
      await harness.completeStep(0, { success: true });
      await harness.transitionToState('completed');
      await harness.assertState({ status: 'completed' });

      // Verify conversation history captured the flow
      const state = await harness.getState();
      expect(state.conversationHistory.length).toBeGreaterThan(1);
    });

    it('should handle user rejection: assume_announce → planning', async () => {
      await harness.startPlanningPhase('Submit the form');

      await harness.enterAssumeAnnounceState(
        [{ field: 'target', assumedValue: 'First submit', confidence: 0.6 }],
        { summary: 'Click first submit', steps: [{ action: 'click', targetId: 'ai-target-1' }] }
      );

      await harness.assertState({ status: 'assume_announce' });

      // User rejects assumption
      await harness.simulateUserAnswer('No, I want to submit the review form');

      // Should go back to planning
      await harness.assertState({ status: 'planning' });

      // Conversation should show the correction
      const state = await harness.getState();
      const userMessages = state.conversationHistory.filter(m => m.role === 'user');
      expect(userMessages).toHaveLength(2); // Original task + correction
    });
  });

  describe('Assumptions validation', () => {
    it('should store assumption field, value, and confidence', async () => {
      await harness.startPlanningPhase('Task');

      const assumption = {
        field: 'targetElement',
        assumedValue: 'First matching button',
        confidence: 0.65
      };

      await harness.enterAssumeAnnounceState([assumption], { summary: 'Test', steps: [] });

      const state = await harness.getState();
      const stored = state.dialogueState.assumptions[0];

      expect(stored.field).toBe('targetElement');
      expect(stored.assumedValue).toBe('First matching button');
      expect(stored.confidence).toBe(0.65);
    });

    it('should handle empty assumptions array', async () => {
      await harness.startPlanningPhase('Task');

      // Edge case: medium confidence but no specific assumptions
      await harness.enterAssumeAnnounceState([], { summary: 'Test', steps: [] });

      const state = await harness.getState();
      expect(state.dialogueState.assumptions).toHaveLength(0);
      expect(state.status).toBe('assume_announce');
    });
  });

  describe('Tab isolation in assume-announce', () => {
    it('should maintain separate assume-announce states per tab', async () => {
      const harness1 = new DialogueTestHarness(11111);
      const harness2 = new DialogueTestHarness(22222);

      await harness1.reset();
      await harness2.reset();

      // Tab 1: In assume_announce
      await harness1.startPlanningPhase('Task 1');
      await harness1.enterAssumeAnnounceState(
        [{ field: 'target', assumedValue: 'Button A', confidence: 0.7 }],
        { summary: 'Tab 1 plan', steps: [] }
      );

      // Tab 2: In planning
      await harness2.startPlanningPhase('Task 2');

      // Verify isolation
      const state1 = await harness1.getState();
      const state2 = await harness2.getState();

      expect(state1.status).toBe('assume_announce');
      expect(state2.status).toBe('planning');
      expect(state1.dialogueState.assumptions[0].assumedValue).toBe('Button A');
      expect(state2.dialogueState.assumptions).toHaveLength(0);
    });
  });
});
