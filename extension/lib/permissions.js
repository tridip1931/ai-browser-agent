/**
 * AI Browser Agent - Permissions Module
 *
 * Manages action permissions and high-risk action detection.
 * Based on Anthropic research showing 11.2% injection success rate
 * even with mitigations - justifying conservative "ask before acting" defaults.
 */

import { getSitePermission } from './site-permissions.js';

/**
 * High-risk actions that ALWAYS require user confirmation
 */
export const HIGH_RISK_ACTIONS = [
  'purchase',    // Any payment-related action
  'checkout',    // Cart checkout
  'buy',         // Purchase buttons
  'pay',         // Payment submission
  'subscribe',   // Subscription signup
  'publish',     // Posting content publicly
  'post',        // Social media posting
  'tweet',       // Twitter/X posting
  'send',        // Sending messages
  'submit',      // Form submissions (context-dependent)
  'delete',      // Permanent deletion
  'remove',      // Removal actions
  'unsubscribe', // Subscription changes
  'cancel',      // Cancellation actions
  'share',       // Sharing personal data
  'password',    // Password changes
  'email',       // Email changes
  'phone',       // Phone number changes
  'address',     // Address changes
  'payment',     // Payment method changes
  'card',        // Credit card operations
  'bank',        // Banking operations
  'transfer',    // Money transfers
  'logout',      // Session termination
  'signout'      // Sign out actions
];

/**
 * Keywords that indicate sensitive content
 */
const SENSITIVE_KEYWORDS = [
  'password',
  'credit card',
  'ssn',
  'social security',
  'bank account',
  'routing number',
  'pin',
  'cvv',
  'secret',
  'private key'
];

/**
 * Check if an action requires user confirmation
 * @param {Object} action - The action to check
 * @param {string} domain - Current page domain
 * @returns {Object} Confirmation requirement result
 */
export async function requiresConfirmation(action, domain) {
  const actionType = action.action?.toLowerCase() || '';
  const targetText = action.text?.toLowerCase() || '';
  const value = action.value?.toLowerCase() || '';

  // 1. Check for high-risk action types
  for (const risk of HIGH_RISK_ACTIONS) {
    if (actionType.includes(risk) || targetText.includes(risk)) {
      return {
        required: true,
        reason: 'high-risk-action',
        riskLevel: 'high',
        description: `This action involves "${risk}" which requires confirmation`
      };
    }
  }

  // 2. Check for sensitive data in value
  for (const keyword of SENSITIVE_KEYWORDS) {
    if (value.includes(keyword)) {
      return {
        required: true,
        reason: 'sensitive-data',
        riskLevel: 'high',
        description: `This action involves sensitive data (${keyword})`
      };
    }
  }

  // 3. Check site-specific permissions
  const sitePerm = await getSitePermission(domain);

  if (!sitePerm) {
    return {
      required: true,
      reason: 'no-site-permission',
      riskLevel: 'medium',
      description: 'First-time automation on this site'
    };
  }

  if (sitePerm.mode === 'ask') {
    return {
      required: true,
      reason: 'user-preference',
      riskLevel: 'low',
      description: 'User prefers to confirm actions on this site'
    };
  }

  // 4. Check if action type is in site's allowed list
  if (sitePerm.allowedActions && !sitePerm.allowedActions.includes(action.action)) {
    return {
      required: true,
      reason: 'action-not-allowed',
      riskLevel: 'medium',
      description: `Action "${action.action}" not in allowed list for this site`
    };
  }

  // Autonomous mode - no confirmation needed
  return {
    required: false,
    reason: 'autonomous-mode'
  };
}

/**
 * Analyze action risk level
 * @param {Object} action - The action to analyze
 * @returns {string} Risk level: 'low' | 'medium' | 'high' | 'critical'
 */
export function analyzeRiskLevel(action) {
  const actionType = action.action?.toLowerCase() || '';
  const targetText = action.text?.toLowerCase() || '';

  // Critical: Financial actions
  const criticalPatterns = ['purchase', 'buy', 'pay', 'transfer', 'checkout'];
  for (const pattern of criticalPatterns) {
    if (actionType.includes(pattern) || targetText.includes(pattern)) {
      return 'critical';
    }
  }

  // High: Data modification
  const highPatterns = ['delete', 'remove', 'password', 'publish', 'send'];
  for (const pattern of highPatterns) {
    if (actionType.includes(pattern) || targetText.includes(pattern)) {
      return 'high';
    }
  }

  // Medium: State changes
  const mediumPatterns = ['submit', 'post', 'share', 'logout'];
  for (const pattern of mediumPatterns) {
    if (actionType.includes(pattern) || targetText.includes(pattern)) {
      return 'medium';
    }
  }

  // Low: Standard interactions
  return 'low';
}

/**
 * Check if action is a form submission
 */
export function isFormSubmission(action) {
  const actionType = action.action?.toLowerCase() || '';
  const targetText = action.text?.toLowerCase() || '';
  const tagName = action.tag?.toLowerCase() || '';

  const submitPatterns = ['submit', 'send', 'post', 'confirm', 'continue', 'next'];

  // Check button type
  if (tagName === 'button' || action.type === 'submit') {
    for (const pattern of submitPatterns) {
      if (targetText.includes(pattern)) {
        return true;
      }
    }
  }

  return actionType === 'submit';
}

/**
 * Check if action involves navigation
 */
export function isNavigation(action) {
  return action.tag === 'a' && action.href;
}

/**
 * Get human-readable description of why confirmation is needed
 */
export function getConfirmationReason(result) {
  const reasons = {
    'high-risk-action': 'This is a high-risk action that could have significant consequences.',
    'sensitive-data': 'This action involves sensitive personal information.',
    'no-site-permission': 'This is your first time automating on this website.',
    'user-preference': 'You have chosen to confirm all actions on this site.',
    'action-not-allowed': 'This action type has not been pre-approved for this site.'
  };

  return reasons[result.reason] || 'Confirmation required for safety.';
}

/**
 * Format action for confirmation dialog
 */
export function formatActionForConfirmation(action) {
  const parts = [];

  switch (action.action) {
    case 'click':
      parts.push(`Click on "${action.text || action.targetId}"`);
      break;
    case 'type':
      parts.push(`Type "${action.value}" into ${action.text || action.targetId}`);
      break;
    case 'scroll':
      parts.push(`Scroll ${action.amount > 0 ? 'down' : 'up'} by ${Math.abs(action.amount)}px`);
      break;
    case 'select':
      parts.push(`Select "${action.value}" from ${action.text || action.targetId}`);
      break;
    default:
      parts.push(`${action.action} on ${action.text || action.targetId || 'page'}`);
  }

  if (action.reasoning) {
    parts.push(`\nReason: ${action.reasoning}`);
  }

  return parts.join('');
}
