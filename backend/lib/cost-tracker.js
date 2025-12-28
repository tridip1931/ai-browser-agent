/**
 * AI Browser Agent - Cost Tracker
 *
 * Tracks token usage and estimated costs across LLM providers.
 * Useful for monitoring spending and optimizing token usage.
 */

// Pricing per 1M tokens (as of 2024, update as needed)
const PRICING = {
  anthropic: {
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 }
  },
  openai: {
    'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 }
  },
  ollama: {
    // Local models are free
    'default': { input: 0, output: 0 }
  }
};

// In-memory usage storage (replace with database in production)
const usageStore = {
  total: {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0
  },
  byProvider: {},
  byModel: {},
  history: []
};

/**
 * Record a completion request
 * @param {Object} params - Request parameters
 */
export function recordUsage(params) {
  const {
    provider,
    model,
    inputTokens = 0,
    outputTokens = 0,
    userId = 'default'
  } = params;

  const cost = calculateCost(provider, model, inputTokens, outputTokens);

  // Update totals
  usageStore.total.requests++;
  usageStore.total.inputTokens += inputTokens;
  usageStore.total.outputTokens += outputTokens;
  usageStore.total.estimatedCost += cost;

  // Update by provider
  if (!usageStore.byProvider[provider]) {
    usageStore.byProvider[provider] = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0
    };
  }
  usageStore.byProvider[provider].requests++;
  usageStore.byProvider[provider].inputTokens += inputTokens;
  usageStore.byProvider[provider].outputTokens += outputTokens;
  usageStore.byProvider[provider].estimatedCost += cost;

  // Update by model
  if (!usageStore.byModel[model]) {
    usageStore.byModel[model] = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0
    };
  }
  usageStore.byModel[model].requests++;
  usageStore.byModel[model].inputTokens += inputTokens;
  usageStore.byModel[model].outputTokens += outputTokens;
  usageStore.byModel[model].estimatedCost += cost;

  // Add to history (keep last 1000)
  usageStore.history.push({
    timestamp: Date.now(),
    provider,
    model,
    inputTokens,
    outputTokens,
    cost,
    userId
  });

  if (usageStore.history.length > 1000) {
    usageStore.history.shift();
  }

  console.log(`[CostTracker] Recorded: ${provider}/${model} - $${cost.toFixed(4)}`);

  return { cost, inputTokens, outputTokens };
}

/**
 * Calculate cost for a request
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @returns {number} Estimated cost in USD
 */
export function calculateCost(provider, model, inputTokens, outputTokens) {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return 0;

  const modelPricing = providerPricing[model] || providerPricing['default'];
  if (!modelPricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

  return inputCost + outputCost;
}

/**
 * Estimate tokens from text (rough approximation)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
  if (!text) return 0;

  // Rough estimate: ~4 characters per token for English
  // This is a very rough approximation
  return Math.ceil(text.length / 4);
}

/**
 * Get usage statistics
 * @returns {Object} Usage stats
 */
export function getUsageStats() {
  return {
    total: { ...usageStore.total },
    byProvider: { ...usageStore.byProvider },
    byModel: { ...usageStore.byModel },
    recentRequests: usageStore.history.slice(-10)
  };
}

/**
 * Get usage for a specific time period
 * @param {number} startTime - Start timestamp
 * @param {number} endTime - End timestamp
 * @returns {Object} Usage in period
 */
export function getUsageInPeriod(startTime, endTime) {
  const periodHistory = usageStore.history.filter(
    h => h.timestamp >= startTime && h.timestamp <= endTime
  );

  return {
    requests: periodHistory.length,
    inputTokens: periodHistory.reduce((sum, h) => sum + h.inputTokens, 0),
    outputTokens: periodHistory.reduce((sum, h) => sum + h.outputTokens, 0),
    estimatedCost: periodHistory.reduce((sum, h) => sum + h.cost, 0),
    history: periodHistory
  };
}

/**
 * Get today's usage
 * @returns {Object} Today's usage
 */
export function getTodaysUsage() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  return getUsageInPeriod(startOfDay.getTime(), Date.now());
}

/**
 * Reset usage statistics
 */
export function resetUsage() {
  usageStore.total = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0
  };
  usageStore.byProvider = {};
  usageStore.byModel = {};
  usageStore.history = [];

  console.log('[CostTracker] Usage reset');
}

/**
 * Get formatted cost string
 * @param {number} cost - Cost in USD
 * @returns {string} Formatted cost
 */
export function formatCost(cost) {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(2)}¢`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Get provider pricing info
 * @param {string} provider - Provider name
 * @returns {Object} Pricing info
 */
export function getProviderPricing(provider) {
  return PRICING[provider] || null;
}

export default {
  recordUsage,
  calculateCost,
  estimateTokens,
  getUsageStats,
  getUsageInPeriod,
  getTodaysUsage,
  resetUsage,
  formatCost,
  getProviderPricing
};
