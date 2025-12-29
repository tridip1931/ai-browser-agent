/**
 * AI Browser Agent - Backend Proxy Server
 *
 * Responsibilities:
 * - Secure storage of API keys (environment variables only)
 * - LLM provider abstraction (Anthropic, OpenAI, Ollama)
 * - Rate limiting and cost tracking
 * - Prompt injection detection
 * - Action audit logging
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';

import { getProvider } from './providers/index.js';
import {
  buildAgentPrompt,
  parseAgentResponse,
  buildPlanningPrompt,
  parsePlanResponse,
  // V2 confidence-based planning
  buildConfidencePlanningPrompt,
  parseConfidencePlanResponse,
  buildRefinePlanPrompt,
  parseRefinePlanResponse
} from './lib/prompt-builder.js';
import { detectInjection } from './middleware/injection-filter.js';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// Middleware
// ============================================================================

// CORS - allow extension requests
app.use(cors({
  origin: [
    'chrome-extension://*',
    'http://localhost:*'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' })); // Large for screenshots

// Request logging
app.use((req, res, next) => {
  console.log(`[Server] ${req.method} ${req.path}`);
  next();
});

// Rate limiting - 60 requests per minute (increased for agent loops)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Rate limit exceeded. Please wait before making more requests.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

// ============================================================================
// Routes
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      ollama: true, // Always available if Ollama is running
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      groq: !!process.env.GROQ_API_KEY
    }
  });
});

/**
 * Main agent reasoning endpoint
 *
 * Request body:
 * - task: string - The user's task description
 * - currentUrl: string - Current page URL
 * - elements: array - Interactive elements on the page
 * - screenshot: string (optional) - Base64 screenshot
 * - actionHistory: array - Previous actions taken
 * - provider: string (optional) - LLM provider to use
 */
app.post('/api/reason', async (req, res) => {
  try {
    const {
      task,
      currentUrl,
      elements,
      screenshot,
      actionHistory = [],
      provider: providerName = 'anthropic',
      taskType = 'multi-step'
    } = req.body;

    // Validate required fields
    if (!task) {
      return res.status(400).json({ error: 'Task is required' });
    }

    if (!elements || !Array.isArray(elements)) {
      return res.status(400).json({ error: 'Elements array is required' });
    }

    // Check for prompt injection in page content
    const injectionCheck = detectInjection(elements);
    if (injectionCheck.detected) {
      console.warn('[Server] Prompt injection detected:', injectionCheck);
      return res.status(400).json({
        error: 'Suspicious content detected on page',
        requiresConfirmation: true,
        details: injectionCheck
      });
    }

    // Get the appropriate LLM provider
    const provider = getProvider(providerName);
    if (!provider) {
      return res.status(400).json({
        error: `Provider "${providerName}" not available`
      });
    }

    // Build the prompt - filter actions based on taskType
    const availableActions = taskType === 'one-shot'
      ? ['click', 'type', 'scroll']  // No "done" for one-shot (system decides)
      : ['click', 'type', 'scroll', 'wait', 'done'];

    const prompt = buildAgentPrompt({
      task,
      currentUrl,
      elements,
      screenshot,
      actionHistory,
      taskType,
      availableActions
    });

    console.log('[Server] Calling provider:', providerName);

    // Call the LLM
    const response = await provider.complete(prompt, {
      maxTokens: 1000,
      temperature: 0.1 // Low temperature for reliable actions
    });

    // Parse the response into structured action
    const action = parseAgentResponse(response);

    console.log('[Server] Action:', action);

    // Log for audit
    logAction({
      task,
      url: currentUrl,
      action,
      provider: providerName,
      timestamp: new Date().toISOString()
    });

    res.json(action);

  } catch (error) {
    console.error('[Server] Reason error:', error);
    res.status(500).json({
      error: 'Failed to process request',
      message: error.message
    });
  }
});

/**
 * Planning endpoint - Breaks down user task into atomic steps
 *
 * Request body:
 * - task: string - The user's natural language request
 * - currentUrl: string - Current page URL
 * - elements: array - Interactive elements on the page
 * - screenshot: string (optional) - Base64 screenshot
 * - conversationHistory: array (optional) - Previous clarifying Q&A
 * - provider: string (optional) - LLM provider to use
 */
app.post('/api/plan', async (req, res) => {
  try {
    const {
      task,
      currentUrl,
      elements,
      screenshot,
      conversationHistory = [],
      provider: providerName = 'ollama'
    } = req.body;

    // Validate required fields
    if (!task) {
      return res.status(400).json({ error: 'Task is required' });
    }

    if (!elements || !Array.isArray(elements)) {
      return res.status(400).json({ error: 'Elements array is required' });
    }

    // Check for prompt injection
    const injectionCheck = detectInjection(elements);
    if (injectionCheck.detected) {
      console.warn('[Server] Prompt injection detected:', injectionCheck);
      return res.status(400).json({
        error: 'Suspicious content detected on page',
        requiresConfirmation: true,
        details: injectionCheck
      });
    }

    // Get the appropriate LLM provider
    const provider = getProvider(providerName);
    if (!provider) {
      return res.status(400).json({
        error: `Provider "${providerName}" not available`
      });
    }

    // Build the planning prompt
    const prompt = buildPlanningPrompt({
      task,
      currentUrl,
      elements,
      screenshot,
      conversationHistory
    });

    // DEBUG: Log elements with context to diagnose semantic understanding
    console.log('[Server] Creating plan with provider:', providerName);
    console.log('[Server] Total elements received:', elements.length);

    // Find and log elements matching common search terms for debugging
    const flirtingElements = elements.filter(el =>
      (el.text || '').toLowerCase().includes('flirt') ||
      (el.href || '').toLowerCase().includes('flirt') ||
      JSON.stringify(el.context || {}).toLowerCase().includes('flirt')
    );
    if (flirtingElements.length > 0) {
      console.log('[Server] Found elements matching "flirt":');
      flirtingElements.forEach(el => {
        console.log(`  [${el.id}] "${el.text?.substring(0, 50)}"`);
      });
    }

    console.log('[Server] First 20 elements:');
    elements.slice(0, 20).forEach((el, i) => {
      const ctx = el.context ? JSON.stringify(el.context) : 'no context';
      console.log(`  [${el.id}] ${el.tag} "${el.text?.substring(0, 30) || ''}" - ${ctx}`);
    });

    // Call the LLM
    const response = await provider.complete(prompt, {
      maxTokens: 2000,
      temperature: 0.2 // Slightly higher for creative planning
    });

    // Parse the response into structured plan
    const plan = parsePlanResponse(response);

    console.log('[Server] Plan:', plan.understood ? `${plan.steps?.length} steps` : 'needs clarification');

    // Log for audit
    logAction({
      type: 'plan',
      task,
      url: currentUrl,
      plan: {
        understood: plan.understood,
        stepsCount: plan.steps?.length || 0,
        hasQuestions: plan.clarifyingQuestions?.length > 0
      },
      provider: providerName,
      timestamp: new Date().toISOString()
    });

    res.json(plan);

  } catch (error) {
    console.error('[Server] Plan error:', error);
    res.status(500).json({
      error: 'Failed to create plan',
      message: error.message
    });
  }
});

/**
 * Verify an action (optional endpoint for complex verification)
 */
app.post('/api/verify', async (req, res) => {
  try {
    const { action, expectedOutcome, actualState } = req.body;

    // Simple verification - could be enhanced with LLM
    const success = true; // Placeholder

    res.json({
      success,
      verified: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Server] Verify error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get usage statistics (placeholder for cost tracking)
 */
app.get('/api/usage', (req, res) => {
  res.json({
    totalRequests: 0,
    totalTokens: 0,
    estimatedCost: 0,
    message: 'Cost tracking will be implemented in Phase 6'
  });
});

// ============================================================================
// V2: Confidence-Based Planning Endpoints
// ============================================================================

/**
 * V2 Planning endpoint with confidence scoring
 *
 * Request body:
 * - task: string - The user's natural language request
 * - currentUrl: string - Current page URL
 * - elements: array - Interactive elements on the page
 * - screenshot: string (optional) - Base64 screenshot
 * - conversationHistory: array (optional) - Previous clarifying Q&A
 * - provider: string (optional) - LLM provider to use
 *
 * Response:
 * - plan: object - The execution plan
 * - confidence: object - {overall, intentClarity, targetMatch, valueConfidence}
 * - assumptions: array - Assumptions made (for medium confidence)
 * - clarifyingQuestions: array - Questions to ask (for low confidence)
 */
app.post('/api/plan-with-confidence', async (req, res) => {
  try {
    const {
      task,
      currentUrl,
      elements,
      screenshot,
      conversationHistory = [],
      provider: providerName = 'groq'
    } = req.body;

    // Validate required fields
    if (!task) {
      return res.status(400).json({ error: 'Task is required' });
    }

    if (!elements || !Array.isArray(elements)) {
      return res.status(400).json({ error: 'Elements array is required' });
    }

    // Check for prompt injection
    const injectionCheck = detectInjection(elements);
    if (injectionCheck.detected) {
      console.warn('[Server] Prompt injection detected:', injectionCheck);
      return res.status(400).json({
        error: 'Suspicious content detected on page',
        requiresConfirmation: true,
        details: injectionCheck
      });
    }

    // Get the appropriate LLM provider
    const provider = getProvider(providerName);
    if (!provider) {
      return res.status(400).json({
        error: `Provider "${providerName}" not available`
      });
    }

    // Build the V2 confidence-based planning prompt
    const prompt = buildConfidencePlanningPrompt({
      task,
      currentUrl,
      elements,
      screenshot,
      conversationHistory
    });

    console.log('[Server] V2 Creating plan with confidence, provider:', providerName);
    console.log('[Server] Total elements received:', elements.length);

    // Call the LLM
    const response = await provider.complete(prompt, {
      maxTokens: 2500,
      temperature: 0.2
    });

    // Parse the response into structured plan with confidence
    const result = parseConfidencePlanResponse(response);

    console.log('[Server] V2 Plan:', {
      understood: result.understood,
      confidence: result.confidence?.overall,
      stepsCount: result.steps?.length || 0,
      hasAssumptions: result.assumptions?.length > 0,
      hasQuestions: result.clarifyingQuestions?.length > 0
    });

    // Log for audit
    logAction({
      type: 'plan-with-confidence',
      task,
      url: currentUrl,
      result: {
        understood: result.understood,
        confidence: result.confidence?.overall,
        stepsCount: result.steps?.length || 0,
        assumptionsCount: result.assumptions?.length || 0,
        questionsCount: result.clarifyingQuestions?.length || 0
      },
      provider: providerName,
      timestamp: new Date().toISOString()
    });

    // Return structured response
    res.json({
      plan: {
        summary: result.summary,
        steps: result.steps,
        risks: result.risks,
        estimatedActions: result.estimatedActions
      },
      confidence: result.confidence,
      assumptions: result.assumptions,
      clarifyingQuestions: result.clarifyingQuestions,
      planScore: result.planScore,
      understood: result.understood
    });

  } catch (error) {
    console.error('[Server] V2 Plan error:', error);
    res.status(500).json({
      error: 'Failed to create plan',
      message: error.message
    });
  }
});

/**
 * V2 Plan refinement endpoint (Self-Refine loop)
 *
 * Request body:
 * - plan: object - Current plan to refine
 * - feedback: array - Feedback items to address
 * - elements: array - Current page elements
 * - task: string - Original task
 * - provider: string (optional) - LLM provider to use
 *
 * Response:
 * - plan: object - Refined plan
 * - score: number - Quality score 0-1
 * - improvements: array - List of improvements made
 */
app.post('/api/refine-plan', async (req, res) => {
  try {
    const {
      plan,
      feedback,
      elements,
      task,
      provider: providerName = 'groq'
    } = req.body;

    // Validate required fields
    if (!plan) {
      return res.status(400).json({ error: 'Plan is required' });
    }

    if (!feedback || !Array.isArray(feedback)) {
      return res.status(400).json({ error: 'Feedback array is required' });
    }

    // Get the appropriate LLM provider
    const provider = getProvider(providerName);
    if (!provider) {
      return res.status(400).json({
        error: `Provider "${providerName}" not available`
      });
    }

    // Build the refinement prompt
    const prompt = buildRefinePlanPrompt({
      plan,
      feedback,
      elements: elements || [],
      task: task || 'Refine the plan'
    });

    console.log('[Server] V2 Refining plan, provider:', providerName);
    console.log('[Server] Feedback items:', feedback.length);

    // Call the LLM
    const response = await provider.complete(prompt, {
      maxTokens: 2000,
      temperature: 0.2
    });

    // Parse the refinement response
    const result = parseRefinePlanResponse(response);

    console.log('[Server] V2 Refined plan:', {
      score: result.score,
      improvements: result.improvements?.length || 0
    });

    // Log for audit
    logAction({
      type: 'refine-plan',
      originalSteps: plan.steps?.length || 0,
      refinedSteps: result.plan?.steps?.length || 0,
      score: result.score,
      improvements: result.improvements,
      provider: providerName,
      timestamp: new Date().toISOString()
    });

    res.json({
      plan: result.plan || plan, // Fallback to original if refinement failed
      score: result.score,
      improvements: result.improvements
    });

  } catch (error) {
    console.error('[Server] V2 Refine error:', error);
    res.status(500).json({
      error: 'Failed to refine plan',
      message: error.message
    });
  }
});

// ============================================================================
// Audit Logging
// ============================================================================

const actionLog = [];

function logAction(entry) {
  actionLog.push(entry);

  // Keep only last 1000 entries in memory
  if (actionLog.length > 1000) {
    actionLog.shift();
  }

  // In production, you'd persist this to a database
  console.log('[Audit]', JSON.stringify(entry));
}

// ============================================================================
// Error Handling
// ============================================================================

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`[Server] AI Browser Agent backend running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);

  // Log available providers
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('[Server] Anthropic provider: enabled');
  }
  if (process.env.OPENAI_API_KEY) {
    console.log('[Server] OpenAI provider: enabled');
  }
  if (process.env.DEEPSEEK_API_KEY) {
    console.log('[Server] DeepSeek provider: enabled');
  }
  if (process.env.GROQ_API_KEY) {
    console.log('[Server] Groq provider: enabled');
  }
  console.log('[Server] Ollama provider: enabled (requires local Ollama)');
});

export default app;
