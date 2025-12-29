/**
 * Vitest setup file for extension tests
 *
 * Installs Chrome API mocks before each test
 */

import { beforeEach, afterEach } from 'vitest';
import { installChromeMock, resetChromeMock } from './mocks/chrome-api.js';

// Install Chrome mock globally before tests run
installChromeMock();

beforeEach(() => {
  // Reset storage between tests
  resetChromeMock();
});

afterEach(() => {
  // Cleanup after each test
  resetChromeMock();
});
