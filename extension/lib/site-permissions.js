/**
 * AI Browser Agent - Site Permissions Module
 *
 * Manages per-site permission settings stored in chrome.storage.local.
 *
 * Permission modes:
 * - 'ask': Always ask before executing actions (default)
 * - 'autonomous': Execute allowed actions without confirmation
 */

const PERMISSIONS_KEY = 'site-permissions';

/**
 * Default permission settings for new sites
 */
const DEFAULT_SITE_PERMISSION = {
  mode: 'ask', // 'ask' | 'autonomous'
  allowedActions: ['click', 'scroll', 'type', 'select'], // Actions allowed in autonomous mode
  deniedActions: [], // Actions that always require confirmation
  createdAt: null,
  updatedAt: null,
  useCount: 0
};

/**
 * Get permission settings for a specific domain
 * @param {string} domain - The domain to check
 * @returns {Object|null} Permission settings or null
 */
export async function getSitePermission(domain) {
  try {
    const normalizedDomain = normalizeDomain(domain);
    const result = await chrome.storage.local.get(PERMISSIONS_KEY);
    const permissions = result[PERMISSIONS_KEY] || {};

    return permissions[normalizedDomain] || null;
  } catch (error) {
    console.error('[SitePermissions] Failed to get permission:', error);
    return null;
  }
}

/**
 * Set permission settings for a domain
 * @param {string} domain - The domain to set
 * @param {Object} settings - Permission settings
 */
export async function setSitePermission(domain, settings) {
  try {
    const normalizedDomain = normalizeDomain(domain);
    const result = await chrome.storage.local.get(PERMISSIONS_KEY);
    const permissions = result[PERMISSIONS_KEY] || {};

    const now = Date.now();
    permissions[normalizedDomain] = {
      ...DEFAULT_SITE_PERMISSION,
      ...settings,
      createdAt: permissions[normalizedDomain]?.createdAt || now,
      updatedAt: now
    };

    await chrome.storage.local.set({ [PERMISSIONS_KEY]: permissions });
    console.log('[SitePermissions] Set permission for:', normalizedDomain);

    return permissions[normalizedDomain];
  } catch (error) {
    console.error('[SitePermissions] Failed to set permission:', error);
    throw error;
  }
}

/**
 * Update specific fields of a site's permissions
 * @param {string} domain - The domain to update
 * @param {Object} updates - Fields to update
 */
export async function updateSitePermission(domain, updates) {
  const existing = await getSitePermission(domain);
  const settings = { ...existing, ...updates };
  return await setSitePermission(domain, settings);
}

/**
 * Remove permission settings for a domain
 * @param {string} domain - The domain to remove
 */
export async function removeSitePermission(domain) {
  try {
    const normalizedDomain = normalizeDomain(domain);
    const result = await chrome.storage.local.get(PERMISSIONS_KEY);
    const permissions = result[PERMISSIONS_KEY] || {};

    delete permissions[normalizedDomain];

    await chrome.storage.local.set({ [PERMISSIONS_KEY]: permissions });
    console.log('[SitePermissions] Removed permission for:', normalizedDomain);
  } catch (error) {
    console.error('[SitePermissions] Failed to remove permission:', error);
    throw error;
  }
}

/**
 * Get all site permissions
 * @returns {Object} All stored permissions
 */
export async function getAllSitePermissions() {
  try {
    const result = await chrome.storage.local.get(PERMISSIONS_KEY);
    return result[PERMISSIONS_KEY] || {};
  } catch (error) {
    console.error('[SitePermissions] Failed to get all permissions:', error);
    return {};
  }
}

/**
 * Set site to autonomous mode
 * @param {string} domain - The domain
 * @param {string[]} allowedActions - Actions to allow without confirmation
 */
export async function enableAutonomousMode(domain, allowedActions = null) {
  return await setSitePermission(domain, {
    mode: 'autonomous',
    allowedActions: allowedActions || DEFAULT_SITE_PERMISSION.allowedActions
  });
}

/**
 * Set site to ask mode (require confirmation for all actions)
 * @param {string} domain - The domain
 */
export async function enableAskMode(domain) {
  return await setSitePermission(domain, {
    mode: 'ask'
  });
}

/**
 * Add an action to the allowed list
 * @param {string} domain - The domain
 * @param {string} action - Action to allow
 */
export async function allowAction(domain, action) {
  const existing = await getSitePermission(domain) || { ...DEFAULT_SITE_PERMISSION };
  const allowedActions = new Set(existing.allowedActions || []);
  allowedActions.add(action);

  return await setSitePermission(domain, {
    ...existing,
    allowedActions: Array.from(allowedActions)
  });
}

/**
 * Remove an action from the allowed list
 * @param {string} domain - The domain
 * @param {string} action - Action to deny
 */
export async function denyAction(domain, action) {
  const existing = await getSitePermission(domain) || { ...DEFAULT_SITE_PERMISSION };
  const allowedActions = new Set(existing.allowedActions || []);
  allowedActions.delete(action);

  const deniedActions = new Set(existing.deniedActions || []);
  deniedActions.add(action);

  return await setSitePermission(domain, {
    ...existing,
    allowedActions: Array.from(allowedActions),
    deniedActions: Array.from(deniedActions)
  });
}

/**
 * Increment use count for a site
 * @param {string} domain - The domain
 */
export async function incrementUseCount(domain) {
  const existing = await getSitePermission(domain);
  if (existing) {
    await updateSitePermission(domain, {
      useCount: (existing.useCount || 0) + 1
    });
  }
}

/**
 * Check if an action is allowed for a site
 * @param {string} domain - The domain
 * @param {string} action - Action to check
 * @returns {boolean}
 */
export async function isActionAllowed(domain, action) {
  const permission = await getSitePermission(domain);

  if (!permission) return false;
  if (permission.mode !== 'autonomous') return false;
  if (permission.deniedActions?.includes(action)) return false;

  return permission.allowedActions?.includes(action) || false;
}

/**
 * Clear all site permissions
 */
export async function clearAllPermissions() {
  try {
    await chrome.storage.local.remove(PERMISSIONS_KEY);
    console.log('[SitePermissions] Cleared all permissions');
  } catch (error) {
    console.error('[SitePermissions] Failed to clear permissions:', error);
    throw error;
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Normalize a domain for consistent storage
 * @param {string} domain - URL or domain string
 * @returns {string} Normalized domain
 */
function normalizeDomain(domain) {
  try {
    // Handle full URLs
    if (domain.includes('://')) {
      const url = new URL(domain);
      return url.hostname.replace(/^www\./, '');
    }

    // Handle domain strings
    return domain.replace(/^www\./, '').toLowerCase();
  } catch (error) {
    // Fallback to simple normalization
    return domain.toLowerCase().replace(/^www\./, '');
  }
}

/**
 * Get domain from URL
 * @param {string} url - Full URL
 * @returns {string} Domain
 */
export function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
