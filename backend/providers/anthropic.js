/**
 * AI Browser Agent - Anthropic Provider
 *
 * Claude API integration for agent reasoning.
 */

import Anthropic from '@anthropic-ai/sdk';

export class AnthropicProvider {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.client = new Anthropic({ apiKey });
    this.name = 'anthropic';
  }

  /**
   * Complete a prompt using Claude
   * @param {string|Array} prompt - Text prompt or messages array
   * @param {Object} options - Completion options
   * @returns {string} Model response text
   */
  async complete(prompt, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.1,
      model = 'claude-sonnet-4-20250514'
    } = options;

    // Handle both string prompts and message arrays
    let messages;
    if (typeof prompt === 'string') {
      messages = [{ role: 'user', content: prompt }];
    } else {
      messages = prompt;
    }

    console.log('[Anthropic] Calling model:', model);

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages
    });

    // Extract text from response
    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    console.log('[Anthropic] Response length:', text.length);

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
      model = 'claude-sonnet-4-20250514'
    } = options;

    // Extract media type from base64 data URL if present
    let mediaType = 'image/png';
    let imageData = imageBase64;

    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mediaType = match[1];
        imageData = match[2];
      }
    }

    const messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageData
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ]
    }];

    console.log('[Anthropic] Vision call with model:', model);

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    return text;
  }

  /**
   * Check if the provider is available
   */
  isAvailable() {
    return !!this.client;
  }
}

export default AnthropicProvider;
