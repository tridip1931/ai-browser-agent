/**
 * V2 Evaluation Framework
 *
 * Tiered evaluation system for assessing LLM outputs:
 * - Tier 1: Heuristics (free, always run first)
 * - Tier 2: Embeddings (~$0.0001/eval, run if heuristics pass)
 * - Tier 3: LLM Judge (~$0.001/eval, run if embeddings pass)
 */

// ============================================================================
// Tier 1: Heuristic Evaluators (Free)
// ============================================================================

export const heuristics = {
  /**
   * Check if response has all required fields
   * @param {Object} response - Parsed response object
   * @param {string[]} requiredFields - List of required field names
   * @returns {{ pass: boolean, missing: string[] }}
   */
  hasRequiredFields(response, requiredFields) {
    const missing = requiredFields.filter(field => {
      const value = response[field];
      return value === undefined || value === null;
    });
    return {
      pass: missing.length === 0,
      missing,
      score: missing.length === 0 ? 1.0 : 1 - (missing.length / requiredFields.length)
    };
  },

  /**
   * Check if confidence values are in valid range [0, 1]
   * @param {Object} confidence - Confidence object with overall, intentClarity, etc.
   * @returns {{ pass: boolean, invalid: string[] }}
   */
  confidenceInRange(confidence) {
    const fields = ['overall', 'intentClarity', 'targetMatch', 'valueConfidence'];
    const invalid = [];

    for (const field of fields) {
      const value = confidence[field];
      if (value !== undefined && (typeof value !== 'number' || value < 0 || value > 1)) {
        invalid.push(field);
      }
    }

    return {
      pass: invalid.length === 0,
      invalid,
      score: invalid.length === 0 ? 1.0 : 1 - (invalid.length / fields.length)
    };
  },

  /**
   * Check if all steps have valid targetIds
   * @param {Object[]} steps - Array of step objects
   * @returns {{ pass: boolean, stepsWithoutTarget: number[] }}
   */
  stepsHaveTargetIds(steps) {
    const stepsWithoutTarget = [];

    steps.forEach((step, index) => {
      // Some actions don't need targetId (scroll, done, wait)
      const noTargetActions = ['scroll', 'done', 'wait', 'navigate'];
      if (!noTargetActions.includes(step.action) && !step.targetId) {
        stepsWithoutTarget.push(index);
      }
    });

    return {
      pass: stepsWithoutTarget.length === 0,
      stepsWithoutTarget,
      score: steps.length > 0
        ? 1 - (stepsWithoutTarget.length / steps.length)
        : 1.0
    };
  },

  /**
   * Check if text is valid JSON
   * @param {string} text - Raw text to check
   * @returns {{ pass: boolean, error?: string }}
   */
  jsonValid(text) {
    try {
      JSON.parse(text);
      return { pass: true, score: 1.0 };
    } catch (error) {
      return { pass: false, error: error.message, score: 0.0 };
    }
  },

  /**
   * Check if step count is within acceptable range
   * @param {Object[]} steps - Array of step objects
   * @param {number} min - Minimum steps (default 1)
   * @param {number} max - Maximum steps (default 5)
   * @returns {{ pass: boolean, count: number }}
   */
  stepCountInRange(steps, min = 1, max = 5) {
    const count = steps.length;
    const pass = count >= min && count <= max;
    return {
      pass,
      count,
      score: pass ? 1.0 : (count < min ? count / min : max / count)
    };
  },

  /**
   * Check if action types are valid
   * @param {Object[]} steps - Array of step objects
   * @returns {{ pass: boolean, invalidActions: string[] }}
   */
  actionsAreValid(steps) {
    const validActions = ['click', 'type', 'scroll', 'select', 'hover', 'wait', 'navigate', 'done'];
    const invalidActions = [];

    steps.forEach(step => {
      if (!validActions.includes(step.action)) {
        invalidActions.push(step.action);
      }
    });

    return {
      pass: invalidActions.length === 0,
      invalidActions,
      score: steps.length > 0
        ? 1 - (invalidActions.length / steps.length)
        : 1.0
    };
  },

  /**
   * Check if clarifying questions exist when understood is false
   * @param {Object} planResponse - Plan response object
   * @returns {{ pass: boolean, reason?: string }}
   */
  clarifyingQuestionsConsistent(planResponse) {
    const { understood, clarifyingQuestions } = planResponse;

    // If not understood, should have questions
    if (!understood && (!clarifyingQuestions || clarifyingQuestions.length === 0)) {
      return {
        pass: false,
        reason: 'understood=false but no clarifyingQuestions',
        score: 0.0
      };
    }

    // If understood, questions are optional but shouldn't be excessive
    if (understood && clarifyingQuestions && clarifyingQuestions.length > 3) {
      return {
        pass: false,
        reason: 'understood=true but too many clarifyingQuestions',
        score: 0.5
      };
    }

    return { pass: true, score: 1.0 };
  },

  /**
   * Check if assumptions are properly structured
   * @param {Object[]} assumptions - Array of assumption objects
   * @returns {{ pass: boolean, invalid: number[] }}
   */
  assumptionsValid(assumptions) {
    if (!Array.isArray(assumptions)) {
      return { pass: false, invalid: [], score: 0.0 };
    }

    const invalid = [];
    assumptions.forEach((assumption, index) => {
      if (!assumption.field || !assumption.assumedValue) {
        invalid.push(index);
      }
    });

    return {
      pass: invalid.length === 0,
      invalid,
      score: assumptions.length > 0
        ? 1 - (invalid.length / assumptions.length)
        : 1.0
    };
  }
};

// ============================================================================
// Tier 2: Embedding-Based Evaluators (~$0.0001/eval)
// ============================================================================

export const embeddings = {
  /**
   * Calculate semantic similarity between task and summary
   * @param {string} task - Original user task
   * @param {string} summary - Generated summary
   * @param {Function} getEmbedding - Embedding function
   * @returns {Promise<{ score: number, pass: boolean }>}
   */
  async intentSimilarity(task, summary, getEmbedding) {
    if (!getEmbedding) {
      // Skip if no embedding function provided
      return { score: 0.5, pass: true, skipped: true };
    }

    const taskEmbedding = await getEmbedding(task);
    const summaryEmbedding = await getEmbedding(summary);

    const score = cosineSimilarity(taskEmbedding, summaryEmbedding);
    return {
      score,
      pass: score >= 0.7 // Threshold for intent match
    };
  },

  /**
   * Check if clarifying questions are relevant to context
   * @param {string} context - Page context or task
   * @param {string[]} questions - Clarifying questions
   * @param {Function} getEmbedding - Embedding function
   * @returns {Promise<{ score: number, pass: boolean }>}
   */
  async questionRelevance(context, questions, getEmbedding) {
    if (!getEmbedding || questions.length === 0) {
      return { score: 1.0, pass: true, skipped: true };
    }

    const contextEmbedding = await getEmbedding(context);
    let totalScore = 0;

    for (const question of questions) {
      const questionEmbedding = await getEmbedding(question);
      totalScore += cosineSimilarity(contextEmbedding, questionEmbedding);
    }

    const avgScore = totalScore / questions.length;
    return {
      score: avgScore,
      pass: avgScore >= 0.5 // Lower threshold for questions
    };
  }
};

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// Tier 3: LLM Judge Evaluators (~$0.001/eval)
// ============================================================================

export const llmJudge = {
  /**
   * Evaluate plan quality using LLM judge
   * @param {string} task - Original task
   * @param {Object} plan - Generated plan
   * @param {Function} callLLM - LLM call function
   * @returns {Promise<{ score: number, feedback: string, pass: boolean }>}
   */
  async planQuality(task, plan, callLLM) {
    if (!callLLM) {
      return { score: 0.5, feedback: 'LLM judge skipped', pass: true, skipped: true };
    }

    const prompt = `You are an expert evaluator for browser automation plans.

TASK: ${task}

PLAN:
Summary: ${plan.summary || 'N/A'}
Steps:
${(plan.steps || []).map((s, i) => `${i + 1}. ${s.action} on ${s.targetId || 'page'}: ${s.targetDescription || ''}`).join('\n')}

Evaluate this plan on a scale of 1-10 for:
1. Completeness: Does it cover all necessary steps?
2. Correctness: Are the actions appropriate for the task?
3. Efficiency: Is it the most direct path to the goal?

Respond in JSON format:
{
  "completeness": <1-10>,
  "correctness": <1-10>,
  "efficiency": <1-10>,
  "overall": <1-10>,
  "feedback": "<brief explanation>"
}`;

    try {
      const response = await callLLM(prompt);
      const result = JSON.parse(response);

      return {
        score: result.overall / 10,
        completeness: result.completeness / 10,
        correctness: result.correctness / 10,
        efficiency: result.efficiency / 10,
        feedback: result.feedback,
        pass: result.overall >= 7
      };
    } catch (error) {
      return {
        score: 0,
        feedback: `Judge error: ${error.message}`,
        pass: false,
        error: true
      };
    }
  },

  /**
   * Evaluate if clarification was necessary
   * @param {string} task - Original task
   * @param {Object} context - Page context
   * @param {string[]} questions - Questions asked
   * @param {Function} callLLM - LLM call function
   * @returns {Promise<{ necessary: boolean, quality: number, feedback: string }>}
   */
  async clarificationNecessity(task, context, questions, callLLM) {
    if (!callLLM) {
      return { necessary: true, quality: 0.5, feedback: 'LLM judge skipped', skipped: true };
    }

    const prompt = `You are evaluating whether clarifying questions were appropriate.

TASK: "${task}"

CONTEXT: The page contains these interactive elements:
${context.elements ? context.elements.slice(0, 10).map(e => `- ${e.type}: ${e.text || e.label || e.id}`).join('\n') : 'No elements provided'}

QUESTIONS ASKED:
${questions.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : q.question}`).join('\n')}

Evaluate:
1. Was asking questions necessary, or could the task be completed without them?
2. Are the questions relevant and helpful?
3. Are there too many or too few questions?

Respond in JSON format:
{
  "necessary": <true/false>,
  "quality": <1-10>,
  "feedback": "<brief explanation>"
}`;

    try {
      const response = await callLLM(prompt);
      const result = JSON.parse(response);

      return {
        necessary: result.necessary,
        quality: result.quality / 10,
        feedback: result.feedback,
        pass: result.necessary && result.quality >= 6
      };
    } catch (error) {
      return {
        necessary: false,
        quality: 0,
        feedback: `Judge error: ${error.message}`,
        pass: false,
        error: true
      };
    }
  }
};

// ============================================================================
// Combined Evaluation Runner
// ============================================================================

/**
 * Run tiered evaluation on a response
 * @param {Object} response - Response to evaluate
 * @param {Object} context - Evaluation context (task, elements, etc.)
 * @param {Object} options - Options (getEmbedding, callLLM functions)
 * @returns {Promise<Object>} Evaluation results
 */
export async function evaluateResponse(response, context, options = {}) {
  const results = {
    tier1: {},
    tier2: {},
    tier3: {},
    overall: { pass: true, score: 0 }
  };

  // Tier 1: Heuristics (always run)
  // For clarification responses (understood=false), summary can be null
  const requiredFields = response.understood === false
    ? ['understood', 'steps', 'confidence']  // summary optional when asking for clarification
    : ['understood', 'summary', 'steps', 'confidence'];
  results.tier1.requiredFields = heuristics.hasRequiredFields(response, requiredFields);

  if (response.confidence) {
    results.tier1.confidenceRange = heuristics.confidenceInRange(response.confidence);
  }

  if (response.steps) {
    results.tier1.targetIds = heuristics.stepsHaveTargetIds(response.steps);
    // Only check step count if understood=true (clarification responses can have 0 steps)
    if (response.understood === true) {
      results.tier1.stepCount = heuristics.stepCountInRange(response.steps);
    } else {
      // For clarification responses, empty steps is valid
      results.tier1.stepCount = heuristics.stepCountInRange(response.steps, 0, 5);
    }
    results.tier1.validActions = heuristics.actionsAreValid(response.steps);
  }

  results.tier1.clarifyingConsistent = heuristics.clarifyingQuestionsConsistent(response);

  if (response.assumptions) {
    results.tier1.assumptionsValid = heuristics.assumptionsValid(response.assumptions);
  }

  // Calculate Tier 1 score
  const tier1Scores = Object.values(results.tier1).map(r => r.score || (r.pass ? 1 : 0));
  results.tier1.overall = {
    score: tier1Scores.reduce((a, b) => a + b, 0) / tier1Scores.length,
    pass: Object.values(results.tier1).every(r => r.pass !== false)
  };

  // Tier 2: Embeddings (run if tier 1 passes and embedding function provided)
  if (results.tier1.overall.pass && options.getEmbedding) {
    if (context.task && response.summary) {
      results.tier2.intentSimilarity = await embeddings.intentSimilarity(
        context.task,
        response.summary,
        options.getEmbedding
      );
    }

    if (context.task && response.clarifyingQuestions?.length > 0) {
      results.tier2.questionRelevance = await embeddings.questionRelevance(
        context.task,
        response.clarifyingQuestions.map(q => typeof q === 'string' ? q : q.question),
        options.getEmbedding
      );
    }

    const tier2Scores = Object.values(results.tier2).map(r => r.score);
    if (tier2Scores.length > 0) {
      results.tier2.overall = {
        score: tier2Scores.reduce((a, b) => a + b, 0) / tier2Scores.length,
        pass: Object.values(results.tier2).every(r => r.pass !== false)
      };
    }
  }

  // Tier 3: LLM Judge (run if tier 2 passes and LLM function provided)
  const tier2Pass = !results.tier2.overall || results.tier2.overall.pass;
  if (results.tier1.overall.pass && tier2Pass && options.callLLM) {
    if (context.task && response.steps?.length > 0) {
      results.tier3.planQuality = await llmJudge.planQuality(
        context.task,
        response,
        options.callLLM
      );
    }

    if (response.clarifyingQuestions?.length > 0) {
      results.tier3.clarificationNecessity = await llmJudge.clarificationNecessity(
        context.task,
        context,
        response.clarifyingQuestions,
        options.callLLM
      );
    }

    const tier3Scores = Object.values(results.tier3).map(r => r.score);
    if (tier3Scores.length > 0) {
      results.tier3.overall = {
        score: tier3Scores.reduce((a, b) => a + b, 0) / tier3Scores.length,
        pass: Object.values(results.tier3).every(r => r.pass !== false)
      };
    }
  }

  // Calculate overall score (weighted average)
  const weights = { tier1: 0.4, tier2: 0.3, tier3: 0.3 };
  let totalWeight = 0;
  let totalScore = 0;

  if (results.tier1.overall) {
    totalScore += results.tier1.overall.score * weights.tier1;
    totalWeight += weights.tier1;
  }
  if (results.tier2.overall) {
    totalScore += results.tier2.overall.score * weights.tier2;
    totalWeight += weights.tier2;
  }
  if (results.tier3.overall) {
    totalScore += results.tier3.overall.score * weights.tier3;
    totalWeight += weights.tier3;
  }

  results.overall = {
    score: totalWeight > 0 ? totalScore / totalWeight : 0,
    pass: results.tier1.overall.pass &&
          (!results.tier2.overall || results.tier2.overall.pass) &&
          (!results.tier3.overall || results.tier3.overall.pass)
  };

  return results;
}

export default {
  heuristics,
  embeddings,
  llmJudge,
  evaluateResponse
};
