/**
 * AI Browser Agent - Groq Provider
 *
 * Groq API integration for ultra-fast agent reasoning.
 * Uses OpenAI-compatible API format.
 *
 * Groq offers:
 * - llama-3.3-70b-versatile (best for reasoning)
 * - llama-3.1-8b-instant (fastest)
 * - mixtral-8x7b-32768 (good balance)
 *
 * Free tier: 14,400 requests/day, no credit card required
 * Sign up: https://console.groq.com/
 */

import OpenAI from 'openai';

export class GroqProvider {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('Groq API key is required');
    }

    // Groq uses OpenAI-compatible API at a different base URL
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1'
    });
    this.name = 'groq';
  }

  /**
   * Complete a prompt using Groq
   * @param {string|Array} prompt - Text prompt or messages array
   * @param {Object} options - Completion options
   * @returns {string} Model response text
   */
  async complete(prompt, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.1,
      model = 'llama-3.3-70b-versatile'  // Best for reasoning tasks
    } = options;

    // Handle both string prompts and message arrays
    let messages;
    if (typeof prompt === 'string') {
      messages = [{ role: 'user', content: prompt }];
    } else {
      messages = prompt;
    }

    console.log('[Groq] Calling model:', model);

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages
      });

      const text = response.choices[0]?.message?.content || '';
      console.log('[Groq] Response length:', text.length);

      return text;
    } catch (error) {
      console.error('[Groq] API error:', error.message);
      throw error;
    }
  }

  /**
   * Check if the provider is available
   */
  isAvailable() {
    return !!this.client;
  }
}

export default GroqProvider;
