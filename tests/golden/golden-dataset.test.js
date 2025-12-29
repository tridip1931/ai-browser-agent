/**
 * Golden Dataset Tests
 *
 * Validates the golden dataset examples and provides a foundation for
 * running evaluation tests against the V2 agent.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadAllExamples,
  getAllExamples,
  validateExample,
  validateAllExamples,
  getDatasetStats,
  filterByTags,
  filterByDifficulty,
  filterByCategory,
  exampleToTestCase
} from './runner.js';

describe('Golden Dataset Validation', () => {
  let allExamples;
  let groupedExamples;

  beforeAll(() => {
    groupedExamples = loadAllExamples();
    allExamples = getAllExamples();
  });

  describe('Dataset Loading', () => {
    it('should load all examples', () => {
      expect(allExamples.length).toBeGreaterThan(0);
    });

    it('should load intent examples by difficulty', () => {
      expect(groupedExamples.intent.easy.length).toBeGreaterThan(0);
      expect(groupedExamples.intent.medium.length).toBeGreaterThan(0);
      expect(groupedExamples.intent.hard.length).toBeGreaterThan(0);
    });

    it('should load clarification examples', () => {
      expect(groupedExamples.clarification.length).toBeGreaterThan(0);
    });

    it('should load action-plan examples', () => {
      expect(groupedExamples.actionPlan.length).toBeGreaterThan(0);
    });

    it('should preserve file path metadata', () => {
      expect(allExamples[0]._filePath).toBeDefined();
      expect(allExamples[0]._filePath).toContain('.json');
    });
  });

  describe('Schema Validation', () => {
    it('should validate all examples against schema', () => {
      const result = validateAllExamples(allExamples);
      expect(result.invalid).toBe(0);
      expect(result.valid).toBe(allExamples.length);
    });

    it('should detect missing required fields', () => {
      const invalidExample = {
        id: 'test-001',
        category: 'intent'
        // Missing: difficulty, task, pageContext, expectedResponse, expectedEvaluation
      };

      const result = validateExample(invalidExample);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: difficulty');
      expect(result.errors).toContain('Missing required field: task');
    });

    it('should detect invalid ID format', () => {
      const invalidExample = {
        id: 'invalid-format',
        category: 'intent',
        difficulty: 'easy',
        task: 'Test',
        pageContext: { url: 'http://test.com', elements: [] },
        expectedResponse: { understood: true, confidence: { overall: 0.9 } },
        expectedEvaluation: { pass: true }
      };

      const result = validateExample(invalidExample);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid ID format'))).toBe(true);
    });

    it('should detect invalid category', () => {
      const invalidExample = {
        id: 'intent-easy-999',
        category: 'invalid-category',
        difficulty: 'easy',
        task: 'Test',
        pageContext: { url: 'http://test.com', elements: [] },
        expectedResponse: { understood: true, confidence: { overall: 0.9 } },
        expectedEvaluation: { pass: true }
      };

      const result = validateExample(invalidExample);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid category'))).toBe(true);
    });

    it('should detect invalid difficulty', () => {
      const invalidExample = {
        id: 'intent-easy-999',
        category: 'intent',
        difficulty: 'impossible',
        task: 'Test',
        pageContext: { url: 'http://test.com', elements: [] },
        expectedResponse: { understood: true, confidence: { overall: 0.9 } },
        expectedEvaluation: { pass: true }
      };

      const result = validateExample(invalidExample);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid difficulty'))).toBe(true);
    });
  });

  describe('Filtering', () => {
    it('should filter by tags', () => {
      const buttonExamples = filterByTags(allExamples, ['button']);
      expect(buttonExamples.length).toBeGreaterThan(0);
      buttonExamples.forEach(ex => {
        expect(ex.tags).toContain('button');
      });
    });

    it('should filter by multiple tags (OR)', () => {
      const filtered = filterByTags(allExamples, ['login', 'form']);
      expect(filtered.length).toBeGreaterThan(0);
      filtered.forEach(ex => {
        expect(ex.tags.some(t => ['login', 'form'].includes(t))).toBe(true);
      });
    });

    it('should filter by difficulty', () => {
      const easyExamples = filterByDifficulty(allExamples, 'easy');
      const mediumExamples = filterByDifficulty(allExamples, 'medium');
      const hardExamples = filterByDifficulty(allExamples, 'hard');

      expect(easyExamples.length).toBeGreaterThan(0);
      expect(mediumExamples.length).toBeGreaterThan(0);
      expect(hardExamples.length).toBeGreaterThan(0);

      easyExamples.forEach(ex => expect(ex.difficulty).toBe('easy'));
      mediumExamples.forEach(ex => expect(ex.difficulty).toBe('medium'));
      hardExamples.forEach(ex => expect(ex.difficulty).toBe('hard'));
    });

    it('should filter by category', () => {
      const intentExamples = filterByCategory(allExamples, 'intent');
      const clarificationExamples = filterByCategory(allExamples, 'clarification');
      const actionPlanExamples = filterByCategory(allExamples, 'action-plan');

      expect(intentExamples.length).toBeGreaterThan(0);
      expect(clarificationExamples.length).toBeGreaterThan(0);
      expect(actionPlanExamples.length).toBeGreaterThan(0);

      intentExamples.forEach(ex => expect(ex.category).toBe('intent'));
      clarificationExamples.forEach(ex => expect(ex.category).toBe('clarification'));
      actionPlanExamples.forEach(ex => expect(ex.category).toBe('action-plan'));
    });
  });

  describe('Statistics', () => {
    it('should calculate correct total', () => {
      const stats = getDatasetStats(allExamples);
      expect(stats.total).toBe(allExamples.length);
    });

    it('should calculate correct category breakdown', () => {
      const stats = getDatasetStats(allExamples);

      expect(stats.byCategory.intent).toBe(
        groupedExamples.intent.easy.length +
        groupedExamples.intent.medium.length +
        groupedExamples.intent.hard.length
      );
      expect(stats.byCategory.clarification).toBe(groupedExamples.clarification.length);
      expect(stats.byCategory['action-plan']).toBe(groupedExamples.actionPlan.length);
    });

    it('should calculate difficulty breakdown', () => {
      const stats = getDatasetStats(allExamples);
      const total = stats.byDifficulty.easy + stats.byDifficulty.medium + stats.byDifficulty.hard;
      expect(total).toBe(allExamples.length);
    });

    it('should calculate confidence zone breakdown', () => {
      const stats = getDatasetStats(allExamples);
      const total = stats.byConfidenceZone.ask +
        stats.byConfidenceZone.assume_announce +
        stats.byConfidenceZone.proceed;
      // Some examples might not have confidence zone defined
      expect(total).toBeGreaterThan(0);
    });

    it('should collect unique tags', () => {
      const stats = getDatasetStats(allExamples);
      expect(Object.keys(stats.tags).length).toBeGreaterThan(0);
    });
  });

  describe('Test Case Conversion', () => {
    it('should convert example to test case format', () => {
      const example = allExamples[0];
      const testCase = exampleToTestCase(example);

      expect(testCase.id).toBe(example.id);
      expect(testCase.task).toBe(example.task);
      expect(testCase.pageContext).toBe(example.pageContext);
      expect(testCase.expectedResponse).toBe(example.expectedResponse);
      expect(testCase.expectedEvaluation).toBe(example.expectedEvaluation);
    });

    it('should include conversation history if present', () => {
      // Find an example with conversation history
      const exampleWithHistory = allExamples.find(ex => ex.conversationHistory);

      if (exampleWithHistory) {
        const testCase = exampleToTestCase(exampleWithHistory);
        expect(testCase.conversationHistory).toBe(exampleWithHistory.conversationHistory);
      }
    });

    it('should default to empty conversation history', () => {
      const example = {
        id: 'test-001',
        task: 'Test task',
        pageContext: {},
        expectedResponse: {},
        expectedEvaluation: {}
      };

      const testCase = exampleToTestCase(example);
      expect(testCase.conversationHistory).toEqual([]);
    });
  });
});

describe('Golden Dataset Examples', () => {
  let allExamples;

  beforeAll(() => {
    allExamples = getAllExamples();
  });

  describe('Intent Examples', () => {
    it('should have valid intent structure for all examples', () => {
      const intentExamples = filterByCategory(allExamples, 'intent');

      intentExamples.forEach(example => {
        // Should have understood flag
        expect(typeof example.expectedResponse.understood).toBe('boolean');

        // Should have confidence scores
        expect(example.expectedResponse.confidence).toBeDefined();
        expect(typeof example.expectedResponse.confidence.overall).toBe('number');
        expect(example.expectedResponse.confidence.overall).toBeGreaterThanOrEqual(0);
        expect(example.expectedResponse.confidence.overall).toBeLessThanOrEqual(1);

        // Should have steps if understood
        if (example.expectedResponse.understood) {
          expect(Array.isArray(example.expectedResponse.steps)).toBe(true);
        }
      });
    });

    it('easy examples should have high confidence', () => {
      const easyIntent = filterByDifficulty(
        filterByCategory(allExamples, 'intent'),
        'easy'
      );

      easyIntent.forEach(example => {
        // Easy examples should typically have confidence >= 0.9
        expect(example.expectedResponse.confidence.overall).toBeGreaterThanOrEqual(0.85);
      });
    });

    it('hard examples should have lower confidence or clarification needs', () => {
      const hardIntent = filterByDifficulty(
        filterByCategory(allExamples, 'intent'),
        'hard'
      );

      hardIntent.forEach(example => {
        // Hard examples should have either:
        // - Lower confidence (< 0.9)
        // - Clarifying questions
        // - understood: false
        const hasLowConfidence = example.expectedResponse.confidence.overall < 0.9;
        const hasClarifyingQuestions = example.expectedResponse.clarifyingQuestions?.length > 0;
        const notUnderstood = example.expectedResponse.understood === false;

        expect(hasLowConfidence || hasClarifyingQuestions || notUnderstood).toBe(true);
      });
    });
  });

  describe('Clarification Examples', () => {
    it('should have valid clarification structure', () => {
      const clarificationExamples = filterByCategory(allExamples, 'clarification');

      clarificationExamples.forEach(example => {
        // Clarification examples should have either:
        // - Lower confidence (initial trigger)
        // - Clarifying questions (what to ask)
        // - Conversation history (multi-round flow)
        // Some examples show the resolved state after clarification (high confidence)
        const hasLowerConfidence = example.expectedResponse.confidence.overall < 0.9;
        const hasClarifyingQuestions = example.expectedResponse.clarifyingQuestions?.length > 0;
        const hasConversationHistory = example.conversationHistory?.length > 0;

        // Must have at least one clarification-related property
        expect(hasClarifyingQuestions || hasConversationHistory || hasLowerConfidence).toBe(true);
      });
    });

    it('should have valid clarifying question structure', () => {
      const clarificationExamples = filterByCategory(allExamples, 'clarification');

      clarificationExamples.forEach(example => {
        if (example.expectedResponse.clarifyingQuestions) {
          example.expectedResponse.clarifyingQuestions.forEach(q => {
            expect(q.question).toBeDefined();
            expect(typeof q.question).toBe('string');
            expect(q.question.length).toBeGreaterThan(0);
          });
        }
      });
    });
  });

  describe('Action Plan Examples', () => {
    it('should have valid action plan structure', () => {
      const actionPlanExamples = filterByCategory(allExamples, 'action-plan');

      actionPlanExamples.forEach(example => {
        // Should have steps
        expect(Array.isArray(example.expectedResponse.steps)).toBe(true);
        expect(example.expectedResponse.steps.length).toBeGreaterThan(0);

        // Each step should have required fields
        example.expectedResponse.steps.forEach(step => {
          expect(step.action).toBeDefined();
          expect(['click', 'type', 'scroll', 'select', 'hover', 'navigate', 'wait'].includes(step.action)).toBe(true);
        });
      });
    });

    it('should have targetId for interactive steps', () => {
      const actionPlanExamples = filterByCategory(allExamples, 'action-plan');

      actionPlanExamples.forEach(example => {
        example.expectedResponse.steps.forEach(step => {
          // Actions that target elements should have targetId
          if (['click', 'type', 'select', 'hover'].includes(step.action)) {
            expect(step.targetId).toBeDefined();
            expect(step.targetId).toMatch(/^ai-target-\d+$/);
          }
        });
      });
    });

    it('should have value for type actions', () => {
      const actionPlanExamples = filterByCategory(allExamples, 'action-plan');

      actionPlanExamples.forEach(example => {
        example.expectedResponse.steps.forEach(step => {
          if (step.action === 'type') {
            expect(step.value).toBeDefined();
            expect(typeof step.value).toBe('string');
          }
        });
      });
    });
  });

  describe('Confidence Routing Coverage', () => {
    it('should have examples for all confidence zones', () => {
      const stats = getDatasetStats(allExamples);

      expect(stats.byConfidenceZone.ask).toBeGreaterThan(0);
      expect(stats.byConfidenceZone.assume_announce).toBeGreaterThan(0);
      expect(stats.byConfidenceZone.proceed).toBeGreaterThan(0);
    });

    it('ask zone examples should have confidence < 0.5', () => {
      const askExamples = allExamples.filter(
        ex => ex.expectedEvaluation?.expectedConfidenceZone === 'ask'
      );

      askExamples.forEach(ex => {
        expect(ex.expectedResponse.confidence.overall).toBeLessThan(0.5);
      });
    });

    it('assume_announce zone examples should have confidence 0.5-0.9', () => {
      const announceExamples = allExamples.filter(
        ex => ex.expectedEvaluation?.expectedConfidenceZone === 'assume_announce'
      );

      announceExamples.forEach(ex => {
        expect(ex.expectedResponse.confidence.overall).toBeGreaterThanOrEqual(0.5);
        expect(ex.expectedResponse.confidence.overall).toBeLessThan(0.9);
      });
    });

    it('proceed zone examples should have confidence >= 0.9', () => {
      const proceedExamples = allExamples.filter(
        ex => ex.expectedEvaluation?.expectedConfidenceZone === 'proceed'
      );

      proceedExamples.forEach(ex => {
        expect(ex.expectedResponse.confidence.overall).toBeGreaterThanOrEqual(0.9);
      });
    });
  });
});

describe('Golden Dataset Coverage Metrics', () => {
  let allExamples;
  let stats;

  beforeAll(() => {
    allExamples = getAllExamples();
    stats = getDatasetStats(allExamples);
  });

  it('should have minimum example count per category', () => {
    // Minimum 3 examples per category for meaningful testing
    expect(stats.byCategory.intent).toBeGreaterThanOrEqual(3);
    expect(stats.byCategory.clarification).toBeGreaterThanOrEqual(3);
    expect(stats.byCategory['action-plan']).toBeGreaterThanOrEqual(3);
  });

  it('should have examples at each difficulty level', () => {
    expect(stats.byDifficulty.easy).toBeGreaterThan(0);
    expect(stats.byDifficulty.medium).toBeGreaterThan(0);
    expect(stats.byDifficulty.hard).toBeGreaterThan(0);
  });

  it('should have reasonable difficulty distribution', () => {
    // Easy should be >= 30% for baseline testing
    const easyRatio = stats.byDifficulty.easy / stats.total;
    expect(easyRatio).toBeGreaterThanOrEqual(0.3);

    // Hard should be >= 15% for edge case coverage
    const hardRatio = stats.byDifficulty.hard / stats.total;
    expect(hardRatio).toBeGreaterThanOrEqual(0.15);
  });

  it('should cover multiple UI patterns via tags', () => {
    // Should have diversity in tested patterns
    expect(Object.keys(stats.tags).length).toBeGreaterThanOrEqual(5);
  });

  // This test will start failing as we add more examples, which is desired
  it('should track progress toward target count', () => {
    const TARGET_COUNT = 200;
    const progress = (stats.total / TARGET_COUNT) * 100;

    console.log(`Golden Dataset Progress: ${stats.total}/${TARGET_COUNT} (${progress.toFixed(1)}%)`);

    // For now, we just have seed examples
    expect(stats.total).toBeGreaterThanOrEqual(15);
  });
});
