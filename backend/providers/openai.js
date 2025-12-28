/**
 * AI Browser Agent - OpenAI Provider
 *
 * GPT-4 API integration for agent reasoning.
 */

import OpenAI from 'openai';

export class OpenAIProvider {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({ apiKey });
    this.name = 'openai';
  }

  /**
   * Complete a prompt using GPT-4
   * @param {string|Array} prompt - Text prompt or messages array
   * @param {Object} options - Completion options
   * @returns {string} Model response text
   */
  async complete(prompt, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.1,
      model = 'gpt-4-turbo-preview'
    } = options;

    // Handle both string prompts and message arrays
    let messages;
    if (typeof prompt === 'string') {
      messages = [{ role: 'user', content: prompt }];
    } else {
      messages = prompt;
    }

    console.log('[OpenAI] Calling model:', model);

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages
    });

    const text = response.choices[0]?.message?.content || '';
    console.log('[OpenAI] Response length:', text.length);

    return text;
  }

  /**
   * Complete with vision (screenshot support)
   * @param {string} prompt - Text prompt
   * @param {string} imageBase64 - Base64 encoded image
   * @param {Object} options - Completion options
   * @returns {string} Model response text
   */
  async completeWithVision(prompt, imageBase64, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.1,
      model = 'gpt-4o' // Vision-capable model
    } = options;

    // Ensure proper data URL format
    let imageUrl = imageBase64;
    if (!imageBase64.startsWith('data:')) {
      imageUrl = `data:image/png;base64,${imageBase64}`;
    }

    const messages = [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: imageUrl,
            detail: 'auto'
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ]
    }];

    console.log('[OpenAI] Vision call with model:', model);

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * Check if the provider is available
   */
  isAvailable() {
    return !!this.client;
  }
}

export default OpenAIProvider;
