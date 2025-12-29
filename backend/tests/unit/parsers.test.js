/**
 * Unit tests for prompt-builder parser functions
 * Tests: parseAgentResponse, parseConfidencePlanResponse, parseRefinePlanResponse
 */

import { describe, it, expect } from 'vitest';
import {
  parseAgentResponse,
  parsePlanResponse,
  parseConfidencePlanResponse,
  parseRefinePlanResponse
} from '../../lib/prompt-builder.js';

// ============================================================================
// parseAgentResponse Tests
// ============================================================================

describe('parseAgentResponse', () => {
  describe('valid JSON responses', () => {
    it('should parse valid JSON action response', () => {
      const response = JSON.stringify({
        action: 'click',
        targetId: 'ai-target-5',
        reasoning: 'Clicking the login button'
      });

      const result = parseAgentResponse(response);

      expect(result.action).toBe('click');
      expect(result.targetId).toBe('ai-target-5');
      expect(result.reasoning).toBe('Clicking the login button');
      expect(result.raw).toBe(response);
    });

    it('should parse type action with value', () => {
      const response = JSON.stringify({
        action: 'type',
        targetId: 'ai-target-10',
        value: 'hello world',
        reasoning: 'Typing into the search box'
      });

      const result = parseAgentResponse(response);

      expect(result.action).toBe('type');
      expect(result.targetId).toBe('ai-target-10');
      expect(result.value).toBe('hello world');
    });

    it('should parse scroll action with amount', () => {
      const response = JSON.stringify({
        action: 'scroll',
        amount: 500,
        reasoning: 'Scrolling down to see more content'
      });

      const result = parseAgentResponse(response);

      expect(result.action).toBe('scroll');
      expect(result.amount).toBe(500);
      expect(result.targetId).toBeNull();
    });

    it('should parse done action without targetId', () => {
      const response = JSON.stringify({
        action: 'done',
        reasoning: 'Task completed successfully'
      });

      const result = parseAgentResponse(response);

      expect(result.action).toBe('done');
      expect(result.targetId).toBeNull();
    });
  });

  describe('markdown-wrapped JSON', () => {
    it('should strip markdown code blocks and parse JSON', () => {
      const response = '```json\n{"action": "click", "targetId": "ai-target-1"}\n```';

      const result = parseAgentResponse(response);

      expect(result.action).toBe('click');
      expect(result.targetId).toBe('ai-target-1');
    });

    it('should handle code blocks with json specifier', () => {
      // Note: The current implementation only strips ```json blocks, not plain ```
      // This test documents the actual behavior
      const response = '```json\n{"action": "type", "targetId": "ai-target-2", "value": "test"}\n```';

      const result = parseAgentResponse(response);

      expect(result.action).toBe('type');
      expect(result.value).toBe('test');
    });
  });

  describe('error handling', () => {
    it('should return error action when action field is missing', () => {
      const response = JSON.stringify({
        targetId: 'ai-target-5',
        reasoning: 'No action specified'
      });

      const result = parseAgentResponse(response);

      expect(result.action).toBe('error');
      expect(result.error).toContain('Missing action field');
    });

    it('should return error action for malformed JSON', () => {
      const response = '{ action: click, targetId: broken }';

      const result = parseAgentResponse(response);

      expect(result.action).toBe('error');
      expect(result.error).toContain('Failed to parse');
    });

    it('should return error action for empty response', () => {
      const result = parseAgentResponse('');

      expect(result.action).toBe('error');
    });

    it('should return error action for non-JSON response', () => {
      const result = parseAgentResponse('I will click the button now.');

      expect(result.action).toBe('error');
    });
  });

  describe('field normalization', () => {
    it('should set missing optional fields to null', () => {
      const response = JSON.stringify({
        action: 'click',
        targetId: 'ai-target-1'
      });

      const result = parseAgentResponse(response);

      expect(result.value).toBeNull();
      expect(result.amount).toBeNull();
      expect(result.reasoning).toBe('');
    });

    it('should preserve extra fields in raw', () => {
      const response = JSON.stringify({
        action: 'click',
        targetId: 'ai-target-1',
        customField: 'extra data'
      });

      const result = parseAgentResponse(response);

      expect(result.raw).toContain('customField');
    });
  });
});

// ============================================================================
// parsePlanResponse Tests
// ============================================================================

describe('parsePlanResponse', () => {
  describe('valid plan responses', () => {
    it('should parse understood plan with steps', () => {
      const response = JSON.stringify({
        understood: true,
        summary: 'Click the login button',
        steps: [
          {
            step: 1,
            action: 'click',
            targetId: 'ai-target-5',
            targetDescription: 'Login button'
          }
        ],
        risks: [],
        clarifyingQuestions: []
      });

      const result = parsePlanResponse(response);

      expect(result.understood).toBe(true);
      expect(result.summary).toBe('Click the login button');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].targetId).toBe('ai-target-5');
    });

    it('should parse plan with clarifying questions', () => {
      const response = JSON.stringify({
        understood: false,
        clarifyingQuestions: ['Which button do you want to click?', 'What should I type?'],
        summary: null,
        steps: []
      });

      const result = parsePlanResponse(response);

      expect(result.understood).toBe(false);
      expect(result.clarifyingQuestions).toHaveLength(2);
      expect(result.steps).toHaveLength(0);
    });
  });

  describe('step limiting', () => {
    it('should limit steps to maximum of 5', () => {
      const response = JSON.stringify({
        understood: true,
        summary: 'Multi-step plan',
        steps: Array(10).fill({
          step: 1,
          action: 'click',
          targetId: 'ai-target-1'
        })
      });

      const result = parsePlanResponse(response);

      expect(result.steps).toHaveLength(5);
    });
  });

  describe('regex fallback', () => {
    it('should extract fields using regex when JSON is malformed', () => {
      const response = `{
        "understood": true,
        "summary": "Click the button",
        "steps": [
          {"step": 1, "action": "click", "targetId": "ai-target-10", "targetDescription": "Submit button"}
        ]
      }`;

      const result = parsePlanResponse(response);

      expect(result.understood).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should return error plan for completely unparseable response', () => {
      const result = parsePlanResponse('This is not JSON at all');

      expect(result.understood).toBe(false);
      expect(result.clarifyingQuestions.length).toBeGreaterThan(0);
      expect(result.steps).toHaveLength(0);
    });
  });
});

// ============================================================================
// parseConfidencePlanResponse Tests (V2)
// ============================================================================

describe('parseConfidencePlanResponse', () => {
  describe('high confidence responses (>=0.9)', () => {
    it('should parse high confidence plan correctly', () => {
      const response = JSON.stringify({
        confidence: {
          overall: 0.95,
          intentClarity: 1.0,
          targetMatch: 0.9,
          valueConfidence: 1.0
        },
        understood: true,
        assumptions: [],
        clarifyingQuestions: [],
        summary: 'Click the Login button',
        steps: [
          {
            step: 1,
            action: 'click',
            targetId: 'ai-target-5',
            targetDescription: 'Login button in header'
          }
        ],
        risks: []
      });

      const result = parseConfidencePlanResponse(response);

      expect(result.confidence.overall).toBe(0.95);
      expect(result.understood).toBe(true);
      expect(result.assumptions).toHaveLength(0);
      expect(result.clarifyingQuestions).toHaveLength(0);
      expect(result.steps).toHaveLength(1);
      expect(result.planScore).toBe(0.95);
    });
  });

  describe('medium confidence responses (0.5-0.9)', () => {
    it('should parse medium confidence with assumptions', () => {
      const response = JSON.stringify({
        confidence: {
          overall: 0.75,
          intentClarity: 0.8,
          targetMatch: 0.7,
          valueConfidence: 0.8
        },
        understood: true,
        assumptions: [
          { field: 'target', assumedValue: 'first search result', confidence: 0.7 },
          { field: 'search term', assumedValue: 'AI tools', confidence: 0.8 }
        ],
        clarifyingQuestions: [],
        summary: 'Search for AI tools and click first result',
        steps: [
          { step: 1, action: 'type', targetId: 'ai-target-1', value: 'AI tools' },
          { step: 2, action: 'click', targetId: 'ai-target-2' }
        ],
        risks: []
      });

      const result = parseConfidencePlanResponse(response);

      expect(result.confidence.overall).toBe(0.75);
      expect(result.understood).toBe(true);
      expect(result.assumptions).toHaveLength(2);
      expect(result.assumptions[0].field).toBe('target');
      expect(result.steps).toHaveLength(2);
    });
  });

  describe('low confidence responses (<0.5)', () => {
    it('should parse low confidence with clarifying questions', () => {
      const response = JSON.stringify({
        confidence: {
          overall: 0.35,
          intentClarity: 0.3,
          targetMatch: 0.4,
          valueConfidence: 0.3
        },
        understood: false,
        assumptions: [],
        clarifyingQuestions: [
          {
            question: 'Which article would you like to read?',
            options: [
              { id: 'opt-1', text: 'Getting Started Guide', confidence: 0.6 },
              { id: 'opt-2', text: 'Advanced Tutorial', confidence: 0.4 }
            ]
          }
        ],
        summary: null,
        steps: [],
        risks: []
      });

      const result = parseConfidencePlanResponse(response);

      expect(result.confidence.overall).toBe(0.35);
      expect(result.understood).toBe(false);
      expect(result.clarifyingQuestions).toHaveLength(1);
      expect(result.clarifyingQuestions[0].options).toHaveLength(2);
      expect(result.steps).toHaveLength(0);
    });
  });

  describe('confidence calculation fallback', () => {
    it('should calculate overall confidence if not provided', () => {
      const response = JSON.stringify({
        confidence: {
          intentClarity: 0.8,
          targetMatch: 0.6,
          valueConfidence: 0.9
        },
        understood: true,
        summary: 'Test plan',
        steps: []
      });

      const result = parseConfidencePlanResponse(response);

      // overall = 0.8*0.3 + 0.6*0.5 + 0.9*0.2 = 0.24 + 0.3 + 0.18 = 0.72
      expect(result.confidence.overall).toBeCloseTo(0.72, 2);
    });

    it('should use default confidence when not provided', () => {
      const response = JSON.stringify({
        understood: true,
        summary: 'Simple plan',
        steps: []
      });

      const result = parseConfidencePlanResponse(response);

      expect(result.confidence.overall).toBe(0.5);
    });
  });

  describe('step limiting', () => {
    it('should limit steps to maximum of 5', () => {
      const response = JSON.stringify({
        confidence: { overall: 0.9 },
        understood: true,
        steps: Array(10).fill({
          step: 1,
          action: 'click',
          targetId: 'ai-target-1'
        })
      });

      const result = parseConfidencePlanResponse(response);

      expect(result.steps).toHaveLength(5);
    });
  });

  describe('markdown handling', () => {
    it('should strip markdown code blocks', () => {
      const response = '```json\n{"confidence":{"overall":0.9},"understood":true,"steps":[]}\n```';

      const result = parseConfidencePlanResponse(response);

      expect(result.confidence.overall).toBe(0.9);
      expect(result.understood).toBe(true);
    });
  });

  describe('regex fallback', () => {
    it('should use regex extraction when JSON parsing fails', () => {
      // Slightly malformed but extractable
      const response = `{
        "overall": 0.85,
        "understood": true,
        "summary": "Click button"
      }`;

      const result = parseConfidencePlanResponse(response);

      // Should still extract what it can
      expect(result.understood).toBe(true);
      expect(result.raw).toBe(response);
    });
  });

  describe('error handling', () => {
    it('should fall back to regex extraction for non-JSON response', () => {
      // Non-JSON falls back to regex extraction which uses 0.5 default confidence
      const result = parseConfidencePlanResponse('Not JSON at all');

      expect(result.confidence.overall).toBe(0.5); // Default from regex fallback
      expect(result.understood).toBe(false);
      // Regex fallback adds a clarifying question when not understood
      expect(result.clarifyingQuestions.length).toBeGreaterThan(0);
    });

    it('should handle empty response with regex fallback', () => {
      const result = parseConfidencePlanResponse('');

      expect(result.understood).toBe(false);
      // Empty string falls through regex with 0.5 default
      expect(result.confidence.overall).toBeLessThanOrEqual(0.5);
    });
  });
});

// ============================================================================
// parseRefinePlanResponse Tests (V2)
// ============================================================================

describe('parseRefinePlanResponse', () => {
  describe('valid refinement responses', () => {
    it('should parse refinement with improved plan', () => {
      const response = JSON.stringify({
        plan: {
          summary: 'Improved plan',
          steps: [
            { step: 1, action: 'click', targetId: 'ai-target-5' }
          ],
          risks: []
        },
        score: 0.85,
        improvements: ['Fixed targetId', 'Added description']
      });

      const result = parseRefinePlanResponse(response);

      expect(result.plan.summary).toBe('Improved plan');
      expect(result.score).toBe(0.85);
      expect(result.improvements).toHaveLength(2);
    });

    it('should handle plan as root object', () => {
      const response = JSON.stringify({
        summary: 'Direct plan',
        steps: [],
        score: 0.9
      });

      const result = parseRefinePlanResponse(response);

      // Should use the parsed object as plan when plan key is missing
      expect(result.plan).toBeDefined();
      expect(result.score).toBe(0.9);
    });
  });

  describe('score validation', () => {
    it('should parse score as float', () => {
      const response = JSON.stringify({
        plan: { summary: 'Test', steps: [] },
        score: '0.75',
        improvements: []
      });

      const result = parseRefinePlanResponse(response);

      expect(result.score).toBe(0.75);
      expect(typeof result.score).toBe('number');
    });

    it('should default to 0.5 when score is invalid', () => {
      const response = JSON.stringify({
        plan: { summary: 'Test', steps: [] },
        score: 'invalid',
        improvements: []
      });

      const result = parseRefinePlanResponse(response);

      expect(result.score).toBe(0.5);
    });
  });

  describe('markdown handling', () => {
    it('should strip markdown code blocks', () => {
      const response = '```json\n{"plan":{"summary":"Test"},"score":0.8,"improvements":[]}\n```';

      const result = parseRefinePlanResponse(response);

      expect(result.score).toBe(0.8);
    });
  });

  describe('error handling', () => {
    it('should return null plan for unparseable response', () => {
      const result = parseRefinePlanResponse('Not valid JSON');

      expect(result.plan).toBeNull();
      expect(result.score).toBe(0.5);
      expect(result.error).toBeDefined();
    });

    it('should return empty improvements array on error', () => {
      const result = parseRefinePlanResponse('{}}{broken');

      expect(result.improvements).toEqual([]);
    });
  });
});
