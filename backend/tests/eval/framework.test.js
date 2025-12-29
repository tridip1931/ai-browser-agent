/**
 * Tests for the V2 Evaluation Framework
 * Tests heuristic evaluators, embedding evaluators, and the combined runner
 */

import { describe, it, expect } from 'vitest';
import {
  heuristics,
  embeddings,
  evaluateResponse
} from './framework.js';
import {
  highConfidence,
  mediumConfidence,
  lowConfidence,
  edgeCases
} from '../fixtures/plan-responses.js';

// ============================================================================
// Heuristic Evaluator Tests
// ============================================================================

describe('heuristics.hasRequiredFields', () => {
  it('should pass when all required fields exist', () => {
    const response = {
      understood: true,
      summary: 'Test',
      steps: [],
      confidence: { overall: 0.9 }
    };
    const result = heuristics.hasRequiredFields(response, ['understood', 'summary', 'steps', 'confidence']);

    expect(result.pass).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.score).toBe(1.0);
  });

  it('should fail when required fields are missing', () => {
    const response = {
      understood: true,
      steps: []
    };
    const result = heuristics.hasRequiredFields(response, ['understood', 'summary', 'steps', 'confidence']);

    expect(result.pass).toBe(false);
    expect(result.missing).toContain('summary');
    expect(result.missing).toContain('confidence');
    expect(result.score).toBe(0.5); // 2/4 present
  });

  it('should treat null values as missing', () => {
    const response = {
      understood: true,
      summary: null,
      steps: [],
      confidence: { overall: 0.9 }
    };
    const result = heuristics.hasRequiredFields(response, ['understood', 'summary', 'steps', 'confidence']);

    expect(result.pass).toBe(false);
    expect(result.missing).toContain('summary');
  });
});

describe('heuristics.confidenceInRange', () => {
  it('should pass for valid confidence values', () => {
    const confidence = {
      overall: 0.85,
      intentClarity: 0.9,
      targetMatch: 0.8,
      valueConfidence: 0.75
    };
    const result = heuristics.confidenceInRange(confidence);

    expect(result.pass).toBe(true);
    expect(result.invalid).toHaveLength(0);
    expect(result.score).toBe(1.0);
  });

  it('should fail for out-of-range values', () => {
    const confidence = {
      overall: 1.5, // Invalid
      intentClarity: -0.1, // Invalid
      targetMatch: 0.8,
      valueConfidence: 0.75
    };
    const result = heuristics.confidenceInRange(confidence);

    expect(result.pass).toBe(false);
    expect(result.invalid).toContain('overall');
    expect(result.invalid).toContain('intentClarity');
    expect(result.score).toBe(0.5); // 2/4 valid
  });

  it('should pass for boundary values 0 and 1', () => {
    const confidence = {
      overall: 0,
      intentClarity: 1,
      targetMatch: 0.5,
      valueConfidence: 0.5
    };
    const result = heuristics.confidenceInRange(confidence);

    expect(result.pass).toBe(true);
  });
});

describe('heuristics.stepsHaveTargetIds', () => {
  it('should pass when all actions have targetIds', () => {
    const steps = [
      { action: 'click', targetId: 'ai-target-1' },
      { action: 'type', targetId: 'ai-target-2', value: 'test' }
    ];
    const result = heuristics.stepsHaveTargetIds(steps);

    expect(result.pass).toBe(true);
    expect(result.stepsWithoutTarget).toHaveLength(0);
    expect(result.score).toBe(1.0);
  });

  it('should fail when click action missing targetId', () => {
    const steps = [
      { action: 'click' }, // Missing targetId
      { action: 'type', targetId: 'ai-target-2', value: 'test' }
    ];
    const result = heuristics.stepsHaveTargetIds(steps);

    expect(result.pass).toBe(false);
    expect(result.stepsWithoutTarget).toContain(0);
    expect(result.score).toBe(0.5);
  });

  it('should pass for actions that do not need targetId', () => {
    const steps = [
      { action: 'scroll', amount: 500 },
      { action: 'done' },
      { action: 'wait', duration: 1000 }
    ];
    const result = heuristics.stepsHaveTargetIds(steps);

    expect(result.pass).toBe(true);
  });
});

describe('heuristics.stepCountInRange', () => {
  it('should pass for steps within range', () => {
    const steps = [{ action: 'click' }, { action: 'type' }];
    const result = heuristics.stepCountInRange(steps, 1, 5);

    expect(result.pass).toBe(true);
    expect(result.count).toBe(2);
  });

  it('should fail for too many steps', () => {
    const steps = Array(7).fill({ action: 'click', targetId: 'ai-target-1' });
    const result = heuristics.stepCountInRange(steps, 1, 5);

    expect(result.pass).toBe(false);
    expect(result.count).toBe(7);
  });

  it('should fail for empty steps when min is 1', () => {
    const result = heuristics.stepCountInRange([], 1, 5);

    expect(result.pass).toBe(false);
    expect(result.count).toBe(0);
  });
});

describe('heuristics.actionsAreValid', () => {
  it('should pass for valid action types', () => {
    const steps = [
      { action: 'click' },
      { action: 'type' },
      { action: 'scroll' },
      { action: 'hover' }
    ];
    const result = heuristics.actionsAreValid(steps);

    expect(result.pass).toBe(true);
    expect(result.invalidActions).toHaveLength(0);
  });

  it('should fail for invalid action types', () => {
    const steps = [
      { action: 'click' },
      { action: 'destroy' }, // Invalid
      { action: 'explode' }  // Invalid
    ];
    const result = heuristics.actionsAreValid(steps);

    expect(result.pass).toBe(false);
    expect(result.invalidActions).toContain('destroy');
    expect(result.invalidActions).toContain('explode');
  });
});

describe('heuristics.clarifyingQuestionsConsistent', () => {
  it('should pass when understood=true with no questions', () => {
    const response = { understood: true, clarifyingQuestions: [] };
    const result = heuristics.clarifyingQuestionsConsistent(response);

    expect(result.pass).toBe(true);
  });

  it('should fail when understood=false with no questions', () => {
    const response = { understood: false, clarifyingQuestions: [] };
    const result = heuristics.clarifyingQuestionsConsistent(response);

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('no clarifyingQuestions');
  });

  it('should pass when understood=false with questions', () => {
    const response = {
      understood: false,
      clarifyingQuestions: [{ question: 'What do you mean?' }]
    };
    const result = heuristics.clarifyingQuestionsConsistent(response);

    expect(result.pass).toBe(true);
  });

  it('should fail when understood=true with too many questions', () => {
    const response = {
      understood: true,
      clarifyingQuestions: [
        { question: 'Q1?' },
        { question: 'Q2?' },
        { question: 'Q3?' },
        { question: 'Q4?' }
      ]
    };
    const result = heuristics.clarifyingQuestionsConsistent(response);

    expect(result.pass).toBe(false);
  });
});

describe('heuristics.assumptionsValid', () => {
  it('should pass for valid assumptions', () => {
    const assumptions = [
      { field: 'target', assumedValue: 'first button', confidence: 0.7 },
      { field: 'action', assumedValue: 'click', confidence: 0.9 }
    ];
    const result = heuristics.assumptionsValid(assumptions);

    expect(result.pass).toBe(true);
    expect(result.invalid).toHaveLength(0);
  });

  it('should fail for assumptions missing required fields', () => {
    const assumptions = [
      { field: 'target' }, // Missing assumedValue
      { assumedValue: 'click' } // Missing field
    ];
    const result = heuristics.assumptionsValid(assumptions);

    expect(result.pass).toBe(false);
    expect(result.invalid).toHaveLength(2);
  });

  it('should pass for empty assumptions array', () => {
    const result = heuristics.assumptionsValid([]);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

// ============================================================================
// Embedding Evaluator Tests (Mocked)
// ============================================================================

describe('embeddings.intentSimilarity', () => {
  it('should skip when no embedding function provided', async () => {
    const result = await embeddings.intentSimilarity('task', 'summary', null);

    expect(result.skipped).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('should calculate similarity with mock embedding function', async () => {
    // Mock embedding function that returns similar vectors for similar text
    const mockGetEmbedding = async (text) => {
      if (text.includes('login')) return [0.9, 0.1, 0.0];
      if (text.includes('Login')) return [0.85, 0.15, 0.0];
      return [0.5, 0.5, 0.0];
    };

    const result = await embeddings.intentSimilarity(
      'Click the login button',
      'Login button click',
      mockGetEmbedding
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
  });
});

// ============================================================================
// Combined Evaluator Tests with Fixtures
// ============================================================================

describe('evaluateResponse with fixtures', () => {
  describe('high confidence responses', () => {
    highConfidence.forEach(fixture => {
      it(`should pass: ${fixture.description}`, async () => {
        const result = await evaluateResponse(
          fixture.response,
          { task: fixture.task, elements: fixture.pageContext?.elements }
        );

        expect(result.tier1.overall.pass).toBe(true);
        expect(result.overall.pass).toBe(fixture.expected.pass);
        if (fixture.expected.minScore) {
          expect(result.overall.score).toBeGreaterThanOrEqual(fixture.expected.minScore);
        }
      });
    });
  });

  describe('medium confidence responses', () => {
    mediumConfidence.forEach(fixture => {
      it(`should pass: ${fixture.description}`, async () => {
        const result = await evaluateResponse(
          fixture.response,
          { task: fixture.task, elements: fixture.pageContext?.elements }
        );

        expect(result.tier1.overall.pass).toBe(true);
        expect(result.overall.pass).toBe(fixture.expected.pass);
      });
    });
  });

  describe('low confidence responses', () => {
    lowConfidence.forEach(fixture => {
      it(`should pass: ${fixture.description}`, async () => {
        const result = await evaluateResponse(
          fixture.response,
          { task: fixture.task, elements: fixture.pageContext?.elements }
        );

        expect(result.tier1.overall.pass).toBe(true);
        expect(result.overall.pass).toBe(fixture.expected.pass);
      });
    });
  });

  describe('edge cases (invalid responses)', () => {
    edgeCases.forEach(fixture => {
      it(`should detect invalid: ${fixture.description}`, async () => {
        const result = await evaluateResponse(
          fixture.response,
          { task: fixture.task }
        );

        // Edge cases should fail tier1 or have overall.pass = false
        if (fixture.expected.pass === false) {
          expect(result.overall.pass).toBe(false);
        }
      });
    });
  });
});

// ============================================================================
// Specific Edge Case Tests
// ============================================================================

describe('evaluateResponse edge cases', () => {
  it('should fail empty steps with understood=true', async () => {
    const response = {
      confidence: { overall: 0.95 },
      understood: true,
      clarifyingQuestions: [],
      summary: 'Click the button',
      steps: []
    };

    const result = await evaluateResponse(response, { task: 'Click button' });

    // stepCount should fail (0 steps when min is 1)
    expect(result.tier1.stepCount.pass).toBe(false);
  });

  it('should fail missing targetId for click', async () => {
    const response = {
      confidence: { overall: 0.8 },
      understood: true,
      clarifyingQuestions: [],
      summary: 'Click',
      steps: [{ action: 'click' }] // No targetId
    };

    const result = await evaluateResponse(response, { task: 'Click button' });

    expect(result.tier1.targetIds.pass).toBe(false);
  });

  it('should fail invalid confidence range', async () => {
    const response = {
      confidence: { overall: 1.5, intentClarity: -0.1 },
      understood: true,
      clarifyingQuestions: [],
      summary: 'Test',
      steps: [{ action: 'click', targetId: 'ai-target-1' }]
    };

    const result = await evaluateResponse(response, { task: 'Test' });

    expect(result.tier1.confidenceRange.pass).toBe(false);
  });

  it('should fail invalid action type', async () => {
    const response = {
      confidence: { overall: 0.8 },
      understood: true,
      clarifyingQuestions: [],
      summary: 'Delete',
      steps: [{ action: 'destroy', targetId: 'ai-target-1' }]
    };

    const result = await evaluateResponse(response, { task: 'Delete item' });

    expect(result.tier1.validActions.pass).toBe(false);
  });

  it('should fail too many steps', async () => {
    const response = {
      confidence: { overall: 0.7 },
      understood: true,
      clarifyingQuestions: [],
      summary: 'Multi-step',
      steps: Array(7).fill({ action: 'click', targetId: 'ai-target-1' })
    };

    const result = await evaluateResponse(response, { task: 'Do task' });

    expect(result.tier1.stepCount.pass).toBe(false);
  });

  it('should fail understood=false without questions', async () => {
    const response = {
      confidence: { overall: 0.3 },
      understood: false,
      clarifyingQuestions: [],
      summary: null,
      steps: []
    };

    const result = await evaluateResponse(response, { task: 'Unclear' });

    expect(result.tier1.clarifyingConsistent.pass).toBe(false);
  });
});
