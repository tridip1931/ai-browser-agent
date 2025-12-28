/**
 * AI Browser Agent - Prompt Injection Filter
 *
 * Detects potential prompt injection attempts in page content.
 *
 * Based on Anthropic research showing mitigations can reduce
 * attack success from 23.6% to 11.2% - still non-zero,
 * justifying conservative "ask before acting" defaults.
 */

/**
 * Suspicious patterns that may indicate prompt injection
 */
const SUSPICIOUS_PATTERNS = [
  // Direct instruction override attempts
  /ignore\s+(previous|prior|above|all)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(the\s+)?(above|previous|prior)/i,
  /forget\s+(everything|all|previous)/i,
  /new\s+system\s+prompt/i,
  /override\s+(the\s+)?(system|instructions?)/i,

  // Role manipulation
  /you\s+are\s+now\s+(a|an|the)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(if|a|an|the)/i,
  /roleplay\s+as/i,
  /switch\s+to\s+.+\s+mode/i,

  // System message injection
  /\[system\]/i,
  /\[assistant\]/i,
  /\[user\]/i,
  /<<SYS>>/i,
  /<\|system\|>/i,
  /\[INST\]/i,

  // Command execution attempts
  /execute\s+(the\s+)?following/i,
  /run\s+(this|the\s+following)\s+(command|code)/i,
  /eval\s*\(/i,

  // Data exfiltration attempts
  /send\s+(all|the|your)\s+(data|information|content)\s+to/i,
  /exfiltrate/i,
  /extract\s+(and\s+)?send/i,

  // Prompt leaking attempts
  /(reveal|show|display|print|output)\s+(your|the)\s+(system\s+)?prompt/i,
  /what\s+(are|is)\s+your\s+(instructions?|rules?|prompt)/i,

  // Delimiter manipulation
  /```\s*system/i,
  /---\s*system/i,
  /###\s*INSTRUCTION/i
];

/**
 * High-risk keywords that warrant extra scrutiny
 */
const HIGH_RISK_KEYWORDS = [
  'api_key',
  'apikey',
  'secret',
  'password',
  'credential',
  'token',
  'authorization',
  'bearer',
  'private_key',
  'ssh_key'
];

/**
 * Detect potential prompt injection in page elements
 * @param {Array} elements - Interactive elements from the page
 * @returns {Object} Detection result
 */
export function detectInjection(elements) {
  if (!elements || !Array.isArray(elements)) {
    return { detected: false };
  }

  // Combine all text content for analysis
  const allText = elements
    .map(el => [el.text, el.ariaLabel, el.placeholder, el.value].filter(Boolean).join(' '))
    .join(' ');

  // Check for suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(allText)) {
      return {
        detected: true,
        source: 'pattern',
        pattern: pattern.source,
        severity: 'high',
        message: 'Suspicious instruction-like content detected on page'
      };
    }
  }

  // Check for high-risk keywords
  const lowerText = allText.toLowerCase();
  for (const keyword of HIGH_RISK_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return {
        detected: true,
        source: 'keyword',
        keyword: keyword,
        severity: 'medium',
        message: `Sensitive keyword "${keyword}" detected in page content`
      };
    }
  }

  // Check for unusual encoding or obfuscation
  if (hasObfuscation(allText)) {
    return {
      detected: true,
      source: 'obfuscation',
      severity: 'medium',
      message: 'Potentially obfuscated content detected'
    };
  }

  return { detected: false };
}

/**
 * Check for potential obfuscation techniques
 */
function hasObfuscation(text) {
  // Check for excessive Unicode characters that might be used to hide content
  const unicodeRatio = (text.match(/[^\x00-\x7F]/g) || []).length / text.length;
  if (unicodeRatio > 0.3 && text.length > 50) {
    return true;
  }

  // Check for base64-like patterns that might contain hidden instructions
  const base64Pattern = /[A-Za-z0-9+/=]{50,}/g;
  if (base64Pattern.test(text)) {
    return true;
  }

  // Check for repeated whitespace that might hide content
  if (/\s{20,}/.test(text)) {
    return true;
  }

  return false;
}

/**
 * Sanitize text by removing suspicious patterns
 * (Use with caution - may alter legitimate content)
 */
export function sanitizeText(text) {
  let sanitized = text;

  for (const pattern of SUSPICIOUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[FILTERED]');
  }

  return sanitized;
}

/**
 * Calculate a risk score for the content (0-100)
 */
export function calculateRiskScore(elements) {
  if (!elements || elements.length === 0) {
    return 0;
  }

  let score = 0;

  const allText = elements
    .map(el => [el.text, el.ariaLabel, el.placeholder].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();

  // Pattern matches
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(allText)) {
      score += 25;
    }
  }

  // Keyword matches
  for (const keyword of HIGH_RISK_KEYWORDS) {
    if (allText.includes(keyword)) {
      score += 15;
    }
  }

  // Obfuscation
  if (hasObfuscation(allText)) {
    score += 20;
  }

  // Cap at 100
  return Math.min(score, 100);
}

export default {
  detectInjection,
  sanitizeText,
  calculateRiskScore
};
