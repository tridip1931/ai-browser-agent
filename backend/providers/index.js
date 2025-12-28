/**
 * AI Browser Agent - Provider Factory
 *
 * Manages LLM provider instances and provides a unified interface.
 */

import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { DeepSeekProvider } from './deepseek.js';
import { GroqProvider } from './groq.js';

// Provider instances (lazily initialized)
let providers = null;

/**
 * Initialize providers based on available API keys
 */
function initializeProviders() {
  if (providers) return providers;

  providers = {};

  // Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      providers.anthropic = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
      console.log('[Providers] Anthropic provider initialized');
    } catch (error) {
      console.error('[Providers] Failed to initialize Anthropic:', error.message);
    }
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      providers.openai = new OpenAIProvider(process.env.OPENAI_API_KEY);
      console.log('[Providers] OpenAI provider initialized');
    } catch (error) {
      console.error('[Providers] Failed to initialize OpenAI:', error.message);
    }
  }

  // Ollama (always available if running locally)
  try {
    providers.ollama = new OllamaProvider(
      process.env.OLLAMA_URL || 'http://localhost:11434'
    );
    console.log('[Providers] Ollama provider initialized');
  } catch (error) {
    console.error('[Providers] Failed to initialize Ollama:', error.message);
  }

  // DeepSeek (free tier available)
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      providers.deepseek = new DeepSeekProvider(process.env.DEEPSEEK_API_KEY);
      console.log('[Providers] DeepSeek provider initialized');
    } catch (error) {
      console.error('[Providers] Failed to initialize DeepSeek:', error.message);
    }
  }

  // Groq (free tier: 14,400 req/day, no credit card)
  if (process.env.GROQ_API_KEY) {
    try {
      providers.groq = new GroqProvider(process.env.GROQ_API_KEY);
      console.log('[Providers] Groq provider initialized');
    } catch (error) {
      console.error('[Providers] Failed to initialize Groq:', error.message);
    }
  }

  return providers;
}

/**
 * Get a provider by name
 * @param {string} name - Provider name (anthropic, openai, ollama)
 * @returns {Object|null} Provider instance or null
 */
export function getProvider(name = 'anthropic') {
  const allProviders = initializeProviders();

  // Return requested provider
  if (allProviders[name]) {
    return allProviders[name];
  }

  // Fallback to first available
  const available = Object.keys(allProviders);
  if (available.length > 0) {
    console.log(`[Providers] ${name} not available, falling back to ${available[0]}`);
    return allProviders[available[0]];
  }

  console.error('[Providers] No providers available');
  return null;
}

/**
 * Get list of available providers
 * @returns {string[]} List of provider names
 */
export function getAvailableProviders() {
  const allProviders = initializeProviders();
  return Object.keys(allProviders);
}

/**
 * Check if a specific provider is available
 * @param {string} name - Provider name
 * @returns {boolean}
 */
export function isProviderAvailable(name) {
  const allProviders = initializeProviders();
  return !!allProviders[name];
}

/**
 * Get provider status information
 * @returns {Object} Status for all providers
 */
export function getProviderStatus() {
  return {
    anthropic: {
      available: !!process.env.ANTHROPIC_API_KEY,
      configured: isProviderAvailable('anthropic')
    },
    openai: {
      available: !!process.env.OPENAI_API_KEY,
      configured: isProviderAvailable('openai')
    },
    ollama: {
      available: true, // Always potentially available
      configured: isProviderAvailable('ollama'),
      url: process.env.OLLAMA_URL || 'http://localhost:11434'
    },
    deepseek: {
      available: !!process.env.DEEPSEEK_API_KEY,
      configured: isProviderAvailable('deepseek')
    },
    groq: {
      available: !!process.env.GROQ_API_KEY,
      configured: isProviderAvailable('groq')
    }
  };
}

export default {
  getProvider,
  getAvailableProviders,
  isProviderAvailable,
  getProviderStatus
};
