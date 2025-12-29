/**
 * Fixture data for plan response evaluation tests
 *
 * Categories:
 * - highConfidence: >=0.9, clear task, direct execution
 * - mediumConfidence: 0.5-0.9, some assumptions needed
 * - lowConfidence: <0.5, clarification required
 * - edge cases: malformed, empty, unusual inputs
 */

// ============================================================================
// High Confidence Responses (>=0.9)
// ============================================================================

export const highConfidence = [
  {
    id: 'high-001',
    description: 'Simple click on clearly identified button',
    task: 'Click the Login button',
    pageContext: {
      url: 'https://example.com',
      elements: [
        { id: 'ai-target-1', type: 'button', text: 'Login', visible: true },
        { id: 'ai-target-2', type: 'button', text: 'Sign Up', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.95, intentClarity: 1.0, targetMatch: 0.95, valueConfidence: 1.0 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Click the Login button',
      steps: [
        { step: 1, action: 'click', targetId: 'ai-target-1', targetDescription: 'Login button' }
      ],
      risks: []
    },
    expected: { pass: true, minScore: 0.9 }
  },
  {
    id: 'high-002',
    description: 'Type into search box and submit',
    task: 'Search for "JavaScript tutorials"',
    pageContext: {
      url: 'https://google.com',
      elements: [
        { id: 'ai-target-1', type: 'input', placeholder: 'Search', visible: true },
        { id: 'ai-target-2', type: 'button', text: 'Google Search', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.92, intentClarity: 0.95, targetMatch: 0.9, valueConfidence: 0.95 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Search for JavaScript tutorials',
      steps: [
        { step: 1, action: 'type', targetId: 'ai-target-1', value: 'JavaScript tutorials', targetDescription: 'Search input' },
        { step: 2, action: 'click', targetId: 'ai-target-2', targetDescription: 'Search button' }
      ],
      risks: []
    },
    expected: { pass: true, minScore: 0.85 }
  },
  {
    id: 'high-003',
    description: 'Navigate to a specific page',
    task: 'Go to the About page',
    pageContext: {
      url: 'https://example.com',
      elements: [
        { id: 'ai-target-1', type: 'a', text: 'Home', visible: true },
        { id: 'ai-target-2', type: 'a', text: 'About', visible: true },
        { id: 'ai-target-3', type: 'a', text: 'Contact', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.98, intentClarity: 1.0, targetMatch: 1.0, valueConfidence: 1.0 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Navigate to the About page',
      steps: [
        { step: 1, action: 'click', targetId: 'ai-target-2', targetDescription: 'About link' }
      ],
      risks: []
    },
    expected: { pass: true, minScore: 0.95 }
  }
];

// ============================================================================
// Medium Confidence Responses (0.5-0.9)
// ============================================================================

export const mediumConfidence = [
  {
    id: 'med-001',
    description: 'Ambiguous button selection - first result assumed',
    task: 'Click the submit button',
    pageContext: {
      url: 'https://example.com/form',
      elements: [
        { id: 'ai-target-1', type: 'button', text: 'Submit Form', visible: true },
        { id: 'ai-target-2', type: 'button', text: 'Submit Review', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.7, intentClarity: 0.9, targetMatch: 0.5, valueConfidence: 1.0 },
      understood: true,
      assumptions: [
        { field: 'target', assumedValue: 'Submit Form button', confidence: 0.7 }
      ],
      clarifyingQuestions: [],
      summary: 'Click the Submit Form button (assuming first submit button)',
      steps: [
        { step: 1, action: 'click', targetId: 'ai-target-1', targetDescription: 'Submit Form button' }
      ],
      risks: ['Multiple submit buttons exist - selected first one']
    },
    expected: { pass: true, minScore: 0.7 }
  },
  {
    id: 'med-002',
    description: 'Search with inferred query',
    task: 'Find information about the product',
    pageContext: {
      url: 'https://shop.example.com/product/123',
      elements: [
        { id: 'ai-target-1', type: 'input', placeholder: 'Search products', visible: true },
        { id: 'ai-target-2', type: 'button', text: 'Search', visible: true },
        { id: 'ai-target-3', type: 'div', text: 'Product XYZ Details', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.65, intentClarity: 0.6, targetMatch: 0.8, valueConfidence: 0.5 },
      understood: true,
      assumptions: [
        { field: 'search term', assumedValue: 'product information', confidence: 0.5 }
      ],
      clarifyingQuestions: [],
      summary: 'Search for product information',
      steps: [
        { step: 1, action: 'type', targetId: 'ai-target-1', value: 'product information', targetDescription: 'Search input' },
        { step: 2, action: 'click', targetId: 'ai-target-2', targetDescription: 'Search button' }
      ],
      risks: ['Search term inferred - may not match user intent']
    },
    expected: { pass: true, minScore: 0.6 }
  },
  {
    id: 'med-003',
    description: 'Form fill with partial information',
    task: 'Fill out the contact form',
    pageContext: {
      url: 'https://example.com/contact',
      elements: [
        { id: 'ai-target-1', type: 'input', name: 'name', placeholder: 'Your Name', visible: true },
        { id: 'ai-target-2', type: 'input', name: 'email', placeholder: 'Email', visible: true },
        { id: 'ai-target-3', type: 'textarea', name: 'message', placeholder: 'Message', visible: true },
        { id: 'ai-target-4', type: 'button', text: 'Send', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.55, intentClarity: 0.8, targetMatch: 0.9, valueConfidence: 0.2 },
      understood: true,
      assumptions: [
        { field: 'name', assumedValue: '[user name]', confidence: 0.3 },
        { field: 'email', assumedValue: '[user email]', confidence: 0.3 },
        { field: 'message', assumedValue: '[message content]', confidence: 0.2 }
      ],
      clarifyingQuestions: [],
      summary: 'Fill contact form with placeholder values',
      steps: [
        { step: 1, action: 'type', targetId: 'ai-target-1', value: '[name]', targetDescription: 'Name field' },
        { step: 2, action: 'type', targetId: 'ai-target-2', value: '[email]', targetDescription: 'Email field' },
        { step: 3, action: 'type', targetId: 'ai-target-3', value: '[message]', targetDescription: 'Message field' },
        { step: 4, action: 'click', targetId: 'ai-target-4', targetDescription: 'Send button' }
      ],
      risks: ['Form values not specified - using placeholders']
    },
    expected: { pass: true, minScore: 0.5 }
  }
];

// ============================================================================
// Low Confidence Responses (<0.5)
// ============================================================================

export const lowConfidence = [
  {
    id: 'low-001',
    description: 'Vague task requiring clarification',
    task: 'Do the thing',
    pageContext: {
      url: 'https://example.com',
      elements: [
        { id: 'ai-target-1', type: 'button', text: 'Action A', visible: true },
        { id: 'ai-target-2', type: 'button', text: 'Action B', visible: true },
        { id: 'ai-target-3', type: 'a', text: 'Link C', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.2, intentClarity: 0.1, targetMatch: 0.3, valueConfidence: 0.2 },
      understood: false,
      assumptions: [],
      clarifyingQuestions: [
        {
          question: 'What action would you like me to perform?',
          options: [
            { id: 'opt-1', text: 'Click Action A', confidence: 0.3 },
            { id: 'opt-2', text: 'Click Action B', confidence: 0.3 },
            { id: 'opt-3', text: 'Click Link C', confidence: 0.2 }
          ]
        }
      ],
      summary: null,
      steps: [],
      risks: []
    },
    expected: { pass: true, minScore: 0.3 }
  },
  {
    id: 'low-002',
    description: 'No matching elements found',
    task: 'Click the delete button',
    pageContext: {
      url: 'https://example.com/view',
      elements: [
        { id: 'ai-target-1', type: 'button', text: 'Edit', visible: true },
        { id: 'ai-target-2', type: 'button', text: 'Share', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.15, intentClarity: 0.9, targetMatch: 0.0, valueConfidence: 1.0 },
      understood: false,
      assumptions: [],
      clarifyingQuestions: [
        {
          question: 'I cannot find a delete button on this page. Would you like to:',
          options: [
            { id: 'opt-1', text: 'Scroll down to find it', confidence: 0.4 },
            { id: 'opt-2', text: 'Navigate to a different page', confidence: 0.3 },
            { id: 'opt-3', text: 'Perform a different action', confidence: 0.3 }
          ]
        }
      ],
      summary: null,
      steps: [],
      risks: []
    },
    expected: { pass: true, minScore: 0.2 }
  },
  {
    id: 'low-003',
    description: 'Multiple interpretations possible',
    task: 'Sign in',
    pageContext: {
      url: 'https://example.com',
      elements: [
        { id: 'ai-target-1', type: 'button', text: 'Sign in with Google', visible: true },
        { id: 'ai-target-2', type: 'button', text: 'Sign in with Apple', visible: true },
        { id: 'ai-target-3', type: 'a', text: 'Sign in with email', visible: true },
        { id: 'ai-target-4', type: 'input', name: 'email', visible: true }
      ]
    },
    response: {
      confidence: { overall: 0.35, intentClarity: 0.8, targetMatch: 0.3, valueConfidence: 0.2 },
      understood: false,
      assumptions: [],
      clarifyingQuestions: [
        {
          question: 'How would you like to sign in?',
          options: [
            { id: 'opt-1', text: 'Sign in with Google', confidence: 0.4 },
            { id: 'opt-2', text: 'Sign in with Apple', confidence: 0.3 },
            { id: 'opt-3', text: 'Sign in with email', confidence: 0.3 }
          ]
        }
      ],
      summary: null,
      steps: [],
      risks: []
    },
    expected: { pass: true, minScore: 0.3 }
  }
];

// ============================================================================
// Edge Cases and Error Scenarios
// ============================================================================

export const edgeCases = [
  {
    id: 'edge-001',
    description: 'Empty steps array with high confidence (invalid)',
    task: 'Click the button',
    response: {
      confidence: { overall: 0.95, intentClarity: 1.0, targetMatch: 0.9, valueConfidence: 1.0 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Click the button',
      steps: [], // Invalid: understood=true but no steps
      risks: []
    },
    expected: { pass: false }
  },
  {
    id: 'edge-002',
    description: 'Missing targetId for click action (invalid)',
    task: 'Click the login button',
    response: {
      confidence: { overall: 0.8, intentClarity: 0.9, targetMatch: 0.7, valueConfidence: 1.0 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Click login',
      steps: [
        { step: 1, action: 'click', targetDescription: 'Login button' } // Missing targetId
      ],
      risks: []
    },
    expected: { pass: false }
  },
  {
    id: 'edge-003',
    description: 'Confidence out of range (invalid)',
    task: 'Do something',
    response: {
      confidence: { overall: 1.5, intentClarity: -0.2, targetMatch: 0.5, valueConfidence: 2.0 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Do something',
      steps: [
        { step: 1, action: 'click', targetId: 'ai-target-1' }
      ],
      risks: []
    },
    expected: { pass: false }
  },
  {
    id: 'edge-004',
    description: 'Invalid action type',
    task: 'Delete the item',
    response: {
      confidence: { overall: 0.8, intentClarity: 0.9, targetMatch: 0.8, valueConfidence: 1.0 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Delete the item',
      steps: [
        { step: 1, action: 'destroy', targetId: 'ai-target-1' } // Invalid action
      ],
      risks: []
    },
    expected: { pass: false }
  },
  {
    id: 'edge-005',
    description: 'Too many steps (exceeds limit)',
    task: 'Complete the multi-step process',
    response: {
      confidence: { overall: 0.7, intentClarity: 0.8, targetMatch: 0.7, valueConfidence: 0.6 },
      understood: true,
      assumptions: [],
      clarifyingQuestions: [],
      summary: 'Complete process',
      steps: [
        { step: 1, action: 'click', targetId: 'ai-target-1' },
        { step: 2, action: 'click', targetId: 'ai-target-2' },
        { step: 3, action: 'click', targetId: 'ai-target-3' },
        { step: 4, action: 'click', targetId: 'ai-target-4' },
        { step: 5, action: 'click', targetId: 'ai-target-5' },
        { step: 6, action: 'click', targetId: 'ai-target-6' }, // Exceeds 5 step limit
        { step: 7, action: 'click', targetId: 'ai-target-7' }
      ],
      risks: []
    },
    expected: { pass: false }
  },
  {
    id: 'edge-006',
    description: 'Understood=false but no clarifying questions (invalid)',
    task: 'Unclear task',
    response: {
      confidence: { overall: 0.3, intentClarity: 0.2, targetMatch: 0.3, valueConfidence: 0.4 },
      understood: false,
      assumptions: [],
      clarifyingQuestions: [], // Invalid: should have questions
      summary: null,
      steps: [],
      risks: []
    },
    expected: { pass: false }
  }
];

// ============================================================================
// All fixtures combined
// ============================================================================

export const allFixtures = [
  ...highConfidence,
  ...mediumConfidence,
  ...lowConfidence,
  ...edgeCases
];

export default {
  highConfidence,
  mediumConfidence,
  lowConfidence,
  edgeCases,
  allFixtures
};
