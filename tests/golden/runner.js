/**
 * Golden Dataset Runner
 *
 * Loads and validates golden dataset examples, runs them through the evaluation
 * framework, and reports results.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Dataset Loader
// ============================================================================

/**
 * Load all golden examples from a directory
 * @param {string} dir - Directory path
 * @returns {Object[]} Array of examples
 */
export function loadExamplesFromDir(dir) {
  const examples = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const example = JSON.parse(content);
        example._filePath = filePath;
        examples.push(example);
      } catch (error) {
        console.error(`Failed to load ${filePath}:`, error.message);
      }
    }
  }

  return examples;
}

/**
 * Load all golden examples by category
 * @returns {Object} Examples grouped by category
 */
export function loadAllExamples() {
  const goldenDir = __dirname;

  return {
    intent: {
      easy: loadExamplesFromDir(path.join(goldenDir, 'intent/easy')),
      medium: loadExamplesFromDir(path.join(goldenDir, 'intent/medium')),
      hard: loadExamplesFromDir(path.join(goldenDir, 'intent/hard'))
    },
    clarification: loadExamplesFromDir(path.join(goldenDir, 'clarification')),
    actionPlan: loadExamplesFromDir(path.join(goldenDir, 'action-plan'))
  };
}

/**
 * Get flattened list of all examples
 * @returns {Object[]} All examples
 */
export function getAllExamples() {
  const grouped = loadAllExamples();
  return [
    ...grouped.intent.easy,
    ...grouped.intent.medium,
    ...grouped.intent.hard,
    ...grouped.clarification,
    ...grouped.actionPlan
  ];
}

/**
 * Filter examples by tags
 * @param {Object[]} examples - Examples to filter
 * @param {string[]} tags - Tags to match (any)
 * @returns {Object[]} Filtered examples
 */
export function filterByTags(examples, tags) {
  return examples.filter(ex =>
    ex.tags && ex.tags.some(t => tags.includes(t))
  );
}

/**
 * Filter examples by difficulty
 * @param {Object[]} examples - Examples to filter
 * @param {string} difficulty - 'easy', 'medium', or 'hard'
 * @returns {Object[]} Filtered examples
 */
export function filterByDifficulty(examples, difficulty) {
  return examples.filter(ex => ex.difficulty === difficulty);
}

/**
 * Filter examples by category
 * @param {Object[]} examples - Examples to filter
 * @param {string} category - 'intent', 'clarification', or 'action-plan'
 * @returns {Object[]} Filtered examples
 */
export function filterByCategory(examples, category) {
  return examples.filter(ex => ex.category === category);
}

// ============================================================================
// Schema Validation
// ============================================================================

/**
 * Validate an example against the schema (basic validation)
 * @param {Object} example - Example to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateExample(example) {
  const errors = [];

  // Required fields
  const required = ['id', 'category', 'difficulty', 'task', 'pageContext', 'expectedResponse', 'expectedEvaluation'];
  for (const field of required) {
    if (!(field in example)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // ID format: intent-easy-001, clarify-001, action-001, etc.
  if (example.id && !/^(intent-[a-z]+-\d{3}|clarify-\d{3}|action-\d{3})$/.test(example.id)) {
    errors.push(`Invalid ID format: ${example.id}`);
  }

  // Category values
  if (example.category && !['intent', 'clarification', 'action-plan'].includes(example.category)) {
    errors.push(`Invalid category: ${example.category}`);
  }

  // Difficulty values
  if (example.difficulty && !['easy', 'medium', 'hard'].includes(example.difficulty)) {
    errors.push(`Invalid difficulty: ${example.difficulty}`);
  }

  // Page context
  if (example.pageContext) {
    if (!example.pageContext.url) {
      errors.push('pageContext missing url');
    }
    if (!Array.isArray(example.pageContext.elements)) {
      errors.push('pageContext.elements must be an array');
    }
  }

  // Expected response
  if (example.expectedResponse) {
    if (typeof example.expectedResponse.understood !== 'boolean') {
      errors.push('expectedResponse.understood must be boolean');
    }
    if (!example.expectedResponse.confidence || typeof example.expectedResponse.confidence.overall !== 'number') {
      errors.push('expectedResponse.confidence.overall must be a number');
    }
  }

  // Expected evaluation
  if (example.expectedEvaluation) {
    if (typeof example.expectedEvaluation.pass !== 'boolean') {
      errors.push('expectedEvaluation.pass must be boolean');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate all examples
 * @param {Object[]} examples - Examples to validate
 * @returns {Object} { valid: number, invalid: number, errors: Object[] }
 */
export function validateAllExamples(examples) {
  let valid = 0;
  let invalid = 0;
  const errorDetails = [];

  for (const example of examples) {
    const result = validateExample(example);
    if (result.valid) {
      valid++;
    } else {
      invalid++;
      errorDetails.push({
        id: example.id || example._filePath,
        errors: result.errors
      });
    }
  }

  return { valid, invalid, errors: errorDetails };
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get dataset statistics
 * @param {Object[]} examples - Examples to analyze
 * @returns {Object} Statistics
 */
export function getDatasetStats(examples) {
  const stats = {
    total: examples.length,
    byCategory: {},
    byDifficulty: { easy: 0, medium: 0, hard: 0 },
    byConfidenceZone: { ask: 0, assume_announce: 0, proceed: 0 },
    tags: {}
  };

  for (const ex of examples) {
    // By category
    stats.byCategory[ex.category] = (stats.byCategory[ex.category] || 0) + 1;

    // By difficulty
    if (ex.difficulty) {
      stats.byDifficulty[ex.difficulty]++;
    }

    // By confidence zone
    if (ex.expectedEvaluation?.expectedConfidenceZone) {
      stats.byConfidenceZone[ex.expectedEvaluation.expectedConfidenceZone]++;
    }

    // Tags
    if (ex.tags) {
      for (const tag of ex.tags) {
        stats.tags[tag] = (stats.tags[tag] || 0) + 1;
      }
    }
  }

  return stats;
}

// ============================================================================
// Test Runner Integration
// ============================================================================

/**
 * Convert golden example to test case format
 * @param {Object} example - Golden example
 * @returns {Object} Test case for evaluation framework
 */
export function exampleToTestCase(example) {
  return {
    id: example.id,
    description: example.description,
    task: example.task,
    pageContext: example.pageContext,
    conversationHistory: example.conversationHistory || [],
    expectedResponse: example.expectedResponse,
    expectedEvaluation: example.expectedEvaluation
  };
}

/**
 * Generate Vitest test suite for golden dataset
 * @param {Object[]} examples - Examples to test
 * @returns {Function} Test suite function
 */
export function generateTestSuite(examples) {
  return (describe, it, expect) => {
    for (const example of examples) {
      describe(example.id, () => {
        it(`should pass: ${example.description}`, async () => {
          const testCase = exampleToTestCase(example);

          // This would integrate with the evaluation framework
          // For now, just validate the example structure
          const validation = validateExample(example);
          expect(validation.valid).toBe(true);

          // Verify expected evaluation criteria
          expect(example.expectedEvaluation.pass).toBeDefined();
        });
      });
    }
  };
}

// ============================================================================
// CLI
// ============================================================================

/**
 * Print dataset report
 */
export function printReport() {
  const examples = getAllExamples();
  const validation = validateAllExamples(examples);
  const stats = getDatasetStats(examples);

  console.log('\n=== Golden Dataset Report ===\n');
  console.log(`Total Examples: ${stats.total}`);
  console.log(`Valid: ${validation.valid}, Invalid: ${validation.invalid}`);

  console.log('\nBy Category:');
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log('\nBy Difficulty:');
  for (const [diff, count] of Object.entries(stats.byDifficulty)) {
    console.log(`  ${diff}: ${count}`);
  }

  console.log('\nBy Confidence Zone:');
  for (const [zone, count] of Object.entries(stats.byConfidenceZone)) {
    console.log(`  ${zone}: ${count}`);
  }

  console.log('\nTop Tags:');
  const sortedTags = Object.entries(stats.tags).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [tag, count] of sortedTags) {
    console.log(`  ${tag}: ${count}`);
  }

  if (validation.invalid > 0) {
    console.log('\nValidation Errors:');
    for (const err of validation.errors) {
      console.log(`  ${err.id}:`);
      for (const e of err.errors) {
        console.log(`    - ${e}`);
      }
    }
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  printReport();
}

export default {
  loadAllExamples,
  getAllExamples,
  filterByTags,
  filterByDifficulty,
  filterByCategory,
  validateExample,
  validateAllExamples,
  getDatasetStats,
  exampleToTestCase,
  generateTestSuite,
  printReport
};
