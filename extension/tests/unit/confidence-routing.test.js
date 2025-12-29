/**
 * Unit tests for confidence routing functions
 * Tests: getConfidenceZone, shouldAsk, shouldAssumeAnnounce, shouldProceed
 */

import { describe, it, expect } from 'vitest';
import {
  getConfidenceZone,
  shouldAsk,
  shouldAssumeAnnounce,
  shouldProceed
} from '../../lib/state-manager.js';

// ============================================================================
// getConfidenceZone Tests
// ============================================================================

describe('getConfidenceZone', () => {
  describe('low confidence zone (ask)', () => {
    it('should return "ask" for confidence 0.0', () => {
      expect(getConfidenceZone(0.0)).toBe('ask');
    });

    it('should return "ask" for confidence 0.1', () => {
      expect(getConfidenceZone(0.1)).toBe('ask');
    });

    it('should return "ask" for confidence 0.3', () => {
      expect(getConfidenceZone(0.3)).toBe('ask');
    });

    it('should return "ask" for confidence 0.49', () => {
      expect(getConfidenceZone(0.49)).toBe('ask');
    });

    it('should return "ask" for confidence 0.499', () => {
      expect(getConfidenceZone(0.499)).toBe('ask');
    });
  });

  describe('medium confidence zone (assume_announce)', () => {
    it('should return "assume_announce" for confidence 0.5', () => {
      expect(getConfidenceZone(0.5)).toBe('assume_announce');
    });

    it('should return "assume_announce" for confidence 0.6', () => {
      expect(getConfidenceZone(0.6)).toBe('assume_announce');
    });

    it('should return "assume_announce" for confidence 0.75', () => {
      expect(getConfidenceZone(0.75)).toBe('assume_announce');
    });

    it('should return "assume_announce" for confidence 0.89', () => {
      expect(getConfidenceZone(0.89)).toBe('assume_announce');
    });

    it('should return "assume_announce" for confidence 0.899', () => {
      expect(getConfidenceZone(0.899)).toBe('assume_announce');
    });
  });

  describe('high confidence zone (proceed)', () => {
    it('should return "proceed" for confidence 0.9', () => {
      expect(getConfidenceZone(0.9)).toBe('proceed');
    });

    it('should return "proceed" for confidence 0.95', () => {
      expect(getConfidenceZone(0.95)).toBe('proceed');
    });

    it('should return "proceed" for confidence 1.0', () => {
      expect(getConfidenceZone(1.0)).toBe('proceed');
    });

    it('should return "proceed" for confidence 0.901', () => {
      expect(getConfidenceZone(0.901)).toBe('proceed');
    });
  });

  describe('edge cases', () => {
    it('should handle negative confidence as "ask"', () => {
      // Negative should fall through to ask
      expect(getConfidenceZone(-0.1)).toBe('ask');
    });

    it('should handle confidence > 1.0 as "proceed"', () => {
      // Greater than 1 should still be proceed
      expect(getConfidenceZone(1.5)).toBe('proceed');
    });

    it('should handle exactly at threshold boundaries correctly', () => {
      // 0.5 is the lower bound of assume_announce
      expect(getConfidenceZone(0.5)).toBe('assume_announce');
      // 0.9 is the lower bound of proceed
      expect(getConfidenceZone(0.9)).toBe('proceed');
    });
  });
});

// ============================================================================
// shouldAsk Tests
// ============================================================================

describe('shouldAsk', () => {
  describe('should return true for low confidence', () => {
    it('should return true for overall < 0.5', () => {
      expect(shouldAsk({ overall: 0.3 })).toBe(true);
    });

    it('should return true for overall = 0', () => {
      expect(shouldAsk({ overall: 0 })).toBe(true);
    });

    it('should return true for overall = 0.49', () => {
      expect(shouldAsk({ overall: 0.49 })).toBe(true);
    });
  });

  describe('should return false for medium/high confidence', () => {
    it('should return false for overall = 0.5', () => {
      expect(shouldAsk({ overall: 0.5 })).toBe(false);
    });

    it('should return false for overall = 0.7', () => {
      expect(shouldAsk({ overall: 0.7 })).toBe(false);
    });

    it('should return false for overall = 0.95', () => {
      expect(shouldAsk({ overall: 0.95 })).toBe(false);
    });
  });

  describe('handles full confidence object', () => {
    it('should only use overall field', () => {
      const confidence = {
        overall: 0.3,
        intentClarity: 0.9,
        targetMatch: 0.9,
        valueConfidence: 0.9
      };
      // Should only look at overall, not other fields
      expect(shouldAsk(confidence)).toBe(true);
    });

    it('should ignore other confidence fields', () => {
      const confidence = {
        overall: 0.6,
        intentClarity: 0.1,  // Low but ignored
        targetMatch: 0.1,    // Low but ignored
        valueConfidence: 0.1 // Low but ignored
      };
      expect(shouldAsk(confidence)).toBe(false);
    });
  });
});

// ============================================================================
// shouldAssumeAnnounce Tests
// ============================================================================

describe('shouldAssumeAnnounce', () => {
  describe('should return true for medium confidence', () => {
    it('should return true for overall = 0.5', () => {
      expect(shouldAssumeAnnounce({ overall: 0.5 })).toBe(true);
    });

    it('should return true for overall = 0.6', () => {
      expect(shouldAssumeAnnounce({ overall: 0.6 })).toBe(true);
    });

    it('should return true for overall = 0.75', () => {
      expect(shouldAssumeAnnounce({ overall: 0.75 })).toBe(true);
    });

    it('should return true for overall = 0.89', () => {
      expect(shouldAssumeAnnounce({ overall: 0.89 })).toBe(true);
    });
  });

  describe('should return false for low/high confidence', () => {
    it('should return false for overall < 0.5', () => {
      expect(shouldAssumeAnnounce({ overall: 0.3 })).toBe(false);
    });

    it('should return false for overall = 0.49', () => {
      expect(shouldAssumeAnnounce({ overall: 0.49 })).toBe(false);
    });

    it('should return false for overall >= 0.9', () => {
      expect(shouldAssumeAnnounce({ overall: 0.9 })).toBe(false);
    });

    it('should return false for overall = 1.0', () => {
      expect(shouldAssumeAnnounce({ overall: 1.0 })).toBe(false);
    });
  });

  describe('handles full confidence object', () => {
    it('should only use overall field', () => {
      const confidence = {
        overall: 0.7,
        intentClarity: 0.3,  // Low but ignored
        targetMatch: 0.3,    // Low but ignored
        valueConfidence: 0.3 // Low but ignored
      };
      expect(shouldAssumeAnnounce(confidence)).toBe(true);
    });
  });
});

// ============================================================================
// shouldProceed Tests
// ============================================================================

describe('shouldProceed', () => {
  describe('should return true for high confidence', () => {
    it('should return true for overall = 0.9', () => {
      expect(shouldProceed({ overall: 0.9 })).toBe(true);
    });

    it('should return true for overall = 0.95', () => {
      expect(shouldProceed({ overall: 0.95 })).toBe(true);
    });

    it('should return true for overall = 1.0', () => {
      expect(shouldProceed({ overall: 1.0 })).toBe(true);
    });
  });

  describe('should return false for low/medium confidence', () => {
    it('should return false for overall < 0.5', () => {
      expect(shouldProceed({ overall: 0.3 })).toBe(false);
    });

    it('should return false for overall = 0.5', () => {
      expect(shouldProceed({ overall: 0.5 })).toBe(false);
    });

    it('should return false for overall = 0.89', () => {
      expect(shouldProceed({ overall: 0.89 })).toBe(false);
    });
  });

  describe('handles full confidence object', () => {
    it('should only use overall field', () => {
      const confidence = {
        overall: 0.95,
        intentClarity: 0.3,  // Low but ignored
        targetMatch: 0.3,    // Low but ignored
        valueConfidence: 0.3 // Low but ignored
      };
      expect(shouldProceed(confidence)).toBe(true);
    });
  });
});

// ============================================================================
// Combined Routing Logic Tests
// ============================================================================

describe('confidence routing logic (combined)', () => {
  describe('mutual exclusivity', () => {
    it('should have exactly one routing true for any confidence', () => {
      const testConfidences = [0.0, 0.25, 0.49, 0.5, 0.75, 0.89, 0.9, 1.0];

      for (const overall of testConfidences) {
        const conf = { overall };
        const routes = [
          shouldAsk(conf),
          shouldAssumeAnnounce(conf),
          shouldProceed(conf)
        ];
        const trueCount = routes.filter(Boolean).length;

        expect(trueCount).toBe(1);
      }
    });
  });

  describe('routing flow matches expected zones', () => {
    it('confidence 0.3 → ask', () => {
      const conf = { overall: 0.3 };
      expect(shouldAsk(conf)).toBe(true);
      expect(shouldAssumeAnnounce(conf)).toBe(false);
      expect(shouldProceed(conf)).toBe(false);
    });

    it('confidence 0.7 → assume_announce', () => {
      const conf = { overall: 0.7 };
      expect(shouldAsk(conf)).toBe(false);
      expect(shouldAssumeAnnounce(conf)).toBe(true);
      expect(shouldProceed(conf)).toBe(false);
    });

    it('confidence 0.95 → proceed', () => {
      const conf = { overall: 0.95 };
      expect(shouldAsk(conf)).toBe(false);
      expect(shouldAssumeAnnounce(conf)).toBe(false);
      expect(shouldProceed(conf)).toBe(true);
    });
  });

  describe('threshold boundary behavior', () => {
    it('0.49 vs 0.5 should route differently', () => {
      expect(shouldAsk({ overall: 0.49 })).toBe(true);
      expect(shouldAsk({ overall: 0.5 })).toBe(false);
      expect(shouldAssumeAnnounce({ overall: 0.49 })).toBe(false);
      expect(shouldAssumeAnnounce({ overall: 0.5 })).toBe(true);
    });

    it('0.89 vs 0.9 should route differently', () => {
      expect(shouldAssumeAnnounce({ overall: 0.89 })).toBe(true);
      expect(shouldAssumeAnnounce({ overall: 0.9 })).toBe(false);
      expect(shouldProceed({ overall: 0.89 })).toBe(false);
      expect(shouldProceed({ overall: 0.9 })).toBe(true);
    });
  });
});
