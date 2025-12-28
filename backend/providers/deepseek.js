/**
 * AI Browser Agent - DeepSeek Provider
 *
 * DeepSeek API integration for agent reasoning.
 * Uses OpenAI-compatible API format.
 *
 * DeepSeek offers:
 * - deepseek-chat (general purpose, fast)
 * - deepseek-reasoner (better reasoning, slower)
 */

import OpenAI from 'openai';

export class DeepSeekProvider {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('DeepSeek API key is required');
    }

    // DeepSeek uses OpenAI-compatible API at a different base URL
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com'
    });
    this.name = 'deepseek';
  }

  /**
   * Complete a prompt using DeepSeek
   * @param {string|Array} prompt - Text prompt or messages array
   * @param {Object} options - Completion options
   * @returns {string} Model response text
   */
  async complete(prompt, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.1,
      model = 'deepseek-chat'  // or 'deepseek-reasoner' for better reasoning
    } = options;

    // Handle both string prompts and message arrays
    let messages;
    if (typeof prompt === 'string') {
      messages = [{ role: 'user', content: prompt }];
    } else {
      messages = prompt;
    }

    console.log('[DeepSeek] Calling model:', model);

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages
      });

      const text = response.choices[0]?.message?.content || '';
      console.log('[DeepSeek] Response length:', text.length);

      return text;
    } catch (error) {
      console.error('[DeepSeek] API error:', error.message);
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

export default DeepSeekProvider;
