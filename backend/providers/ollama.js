/**
 * AI Browser Agent - Ollama Provider
 *
 * Local LLM integration via Ollama for privacy-first inference.
 * Requires Ollama running locally: https://ollama.ai
 */

export class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
    this.name = 'ollama';
  }

  /**
   * Complete a prompt using local Ollama
   * @param {string|Array} prompt - Text prompt or messages array
   * @param {Object} options - Completion options
   * @returns {string} Model response text
   */
  async complete(prompt, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.1,
      model = 'llama3.2' // Default to Llama 3.2
    } = options;

    // Convert to string if messages array
    let promptText = prompt;
    if (Array.isArray(prompt)) {
      promptText = prompt
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n');
    }

    console.log('[Ollama] Calling model:', model);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          prompt: promptText,
          stream: false,
          options: {
            temperature,
            num_predict: maxTokens
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const text = data.response || '';

      console.log('[Ollama] Response length:', text.length);
      return text;

    } catch (error) {
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch')) {
        throw new Error('Ollama is not running. Start it with: ollama serve');
      }
      throw error;
    }
  }

  /**
   * Complete with vision using LLaVA or similar
   * @param {string} prompt - Text prompt
   * @param {string} imageBase64 - Base64 encoded image
   * @param {Object} options - Completion options
   * @returns {string} Model response text
   */
  async completeWithVision(prompt, imageBase64, options = {}) {
    const {
      maxTokens = 1000,
      temperature = 0.1,
      model = 'llava' // Vision-capable model
    } = options;

    // Strip data URL prefix if present
    let imageData = imageBase64;
    if (imageBase64.startsWith('data:')) {
      imageData = imageBase64.split(',')[1];
    }

    console.log('[Ollama] Vision call with model:', model);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          prompt,
          images: [imageData],
          stream: false,
          options: {
            temperature,
            num_predict: maxTokens
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return data.response || '';

    } catch (error) {
      if (error.message.includes('ECONNREFUSED')) {
        throw new Error('Ollama is not running. Start it with: ollama serve');
      }
      throw error;
    }
  }

  /**
   * List available models
   */
  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      console.error('[Ollama] Failed to list models:', error);
      return [];
    }
  }

  /**
   * Check if Ollama is running and accessible
   */
  async isAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Pull a model if not already available
   */
  async pullModel(model) {
    console.log('[Ollama] Pulling model:', model);

    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: model, stream: false })
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.status}`);
    }

    return await response.json();
  }
}

export default OllamaProvider;
