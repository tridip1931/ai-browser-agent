/**
 * Chrome API Mocks for Extension Unit Tests
 *
 * Provides mock implementations of chrome.storage.session and chrome.storage.local
 * for testing state-manager.js and other extension modules.
 */

/**
 * Create a mock Chrome storage area (session or local)
 */
function createMockStorageArea() {
  let data = {};

  return {
    get: async (keys) => {
      if (keys === null) {
        return { ...data };
      }
      if (typeof keys === 'string') {
        return { [keys]: data[keys] };
      }
      if (Array.isArray(keys)) {
        const result = {};
        keys.forEach(key => {
          if (data[key] !== undefined) {
            result[key] = data[key];
          }
        });
        return result;
      }
      // Object with defaults
      const result = {};
      Object.keys(keys).forEach(key => {
        result[key] = data[key] !== undefined ? data[key] : keys[key];
      });
      return result;
    },

    set: async (items) => {
      Object.assign(data, items);
    },

    remove: async (keys) => {
      if (typeof keys === 'string') {
        delete data[keys];
      } else if (Array.isArray(keys)) {
        keys.forEach(key => delete data[key]);
      }
    },

    clear: async () => {
      data = {};
    },

    // Test helper to inspect internal state
    _getData: () => ({ ...data }),
    _setData: (newData) => { data = { ...newData }; }
  };
}

/**
 * Create a full Chrome API mock
 */
export function createChromeMock() {
  const sessionStorage = createMockStorageArea();
  const localStorage = createMockStorageArea();

  return {
    storage: {
      session: sessionStorage,
      local: localStorage
    },
    runtime: {
      lastError: null,
      sendMessage: async () => {},
      onMessage: {
        addListener: () => {},
        removeListener: () => {}
      }
    },
    tabs: {
      query: async () => [],
      get: async () => null,
      sendMessage: async () => {}
    },
    // Test helpers
    _reset: () => {
      sessionStorage.clear();
      localStorage.clear();
    }
  };
}

/**
 * Install Chrome mock globally
 */
export function installChromeMock() {
  const mock = createChromeMock();
  globalThis.chrome = mock;
  return mock;
}

/**
 * Reset the global Chrome mock
 */
export function resetChromeMock() {
  if (globalThis.chrome && globalThis.chrome._reset) {
    globalThis.chrome._reset();
  }
}

export default { createChromeMock, installChromeMock, resetChromeMock };
