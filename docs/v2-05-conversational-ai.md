# V2 Part 5: Conversational AI Layer

## Overview

Transform single-round clarification into full multi-turn conversational planning with confidence-based decisions, option-based clarification, self-refine loops, and mid-execution dialogue.

## Design Principles

- **Confidence-aware** — Know when to ask vs assume vs proceed
- **Option-first** — Offer choices instead of open-ended questions
- **Iterative** — Refine plans before execution
- **Recoverable** — Handle failures gracefully with user input

---

## Current State vs Target

| Aspect | V1 (Current) | V2 (Target) |
|--------|--------------|-------------|
| Clarification rounds | 1 max | Up to 3 |
| Confidence scoring | None | 0-1 scale per decision |
| Question format | Open-ended text | Option-based + freeform |
| Assumption handling | None | "Assume + Announce" pattern |
| Mid-execution correction | Not supported | Pause, correct, continue |
| Plan iteration | None | Self-Refine loop (3 iterations) |
| Failure recovery | Log and continue | Analyze, offer options, replan |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FOUR-LAYER PROMPT ARCHITECTURE                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   SYSTEM    │──│   CONTEXT   │──│  FEW-SHOT   │──│ USER INPUT  │    │
│  │ (static)    │  │ (dynamic)   │  │ (examples)  │  │ (task)      │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONFIDENCE-BASED DECISION                          │
│                                                                         │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  0.0         0.5                              0.9                 1.0   │
│  └─── ASK ───┘└────────── ASSUME + ANNOUNCE ──────────┘└── PROCEED ──┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       DIALOGUE STATE MACHINE                            │
│                                                                         │
│   IDLE → PLANNING → CLARIFYING ↔ REFINING → APPROVAL → EXECUTING       │
│                          │                                  │           │
│                          └──────── MID_EXEC_DIALOG ─────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Dialogue State Machine

### States

| State | Description | Input Enabled |
|-------|-------------|---------------|
| `idle` | Ready for task | Yes |
| `planning` | Analyzing task, building plan | No |
| `clarifying` | Waiting for user answer | Yes |
| `refining` | Self-refine loop running | No |
| `assume_announce` | Showing assumptions, auto-executing | Yes (to correct) |
| `awaiting_approval` | Plan displayed, waiting for Execute/Cancel | No |
| `executing` | Running actions | No |
| `mid_exec_dialog` | Paused for user decision on failure | Yes |
| `replanning` | Building new plan from current state | No |
| `completed` / `error` | Task finished | Yes |

### State Transitions

```
planning + confidence >= 0.9     → awaiting_approval
planning + 0.5 <= conf < 0.9     → assume_announce (auto-continue in 3s)
planning + confidence < 0.5      → clarifying

clarifying + user_answer         → refining
refining + plan_improved         → awaiting_approval
refining + still_unclear         → clarifying (round 2)
refining + max_iterations        → awaiting_approval (best effort)

executing + step_fails           → mid_exec_dialog
mid_exec_dialog + user_retry     → executing (retry step)
mid_exec_dialog + user_skip      → executing (next step)
mid_exec_dialog + user_replan    → replanning
mid_exec_dialog + user_abort     → idle
```

---

## Confidence System

### Calculation

```javascript
confidence = {
  overall: weighted_average(
    intentClarity * 0.3,
    targetMatch * 0.5,
    valueConfidence * 0.2
  ),
  intentClarity: 1.0 - vagueTermPenalty - ambiguityPenalty,
  targetMatch: elementsFound / elementsNeeded,
  valueConfidence: valuesExplicit / valuesNeeded
}

// Risk multiplier for high-risk actions
if (hasHighRiskAction) confidence.overall *= 0.7;
```

### Decision Routing

| Confidence | Action | UI Behavior |
|------------|--------|-------------|
| >= 0.9 | Proceed | Show plan → approval buttons |
| 0.5 - 0.9 | Assume + Announce | Show assumptions + 3s countdown + proceed |
| < 0.5 | Ask | Show option-based questions |

### Confidence Factors

**Intent Clarity** (0-1):
- Reduce for vague terms: "something", "stuff", "whatever"
- Reduce for ambiguous references: "that", "it"
- Reduce for multiple action verbs

**Target Match** (0-1):
- Base score 0.6 for found element
- Boost for text similarity match
- Zero if element not found

**Value Confidence** (0-1):
- 1.0 if value explicitly in task
- 0.8 if reasonably inferred
- Lower for missing values

---

## Clarification Question System

### Question Types

| Type | When | Example |
|------|------|---------|
| `option_select` | Multiple valid targets | "Which article? [A] Tips [B] Psychology [C] Other" |
| `freeform` | Value needed | "What should I type in the search box?" |
| `confirm` | Risky action | "This will submit the form. Continue? [Yes] [No]" |

### Rules

1. **Max 3 questions per round** — Batch related questions
2. **Options first** — Prefer choices over open-ended
3. **Max 3 clarification rounds** — Then proceed with best effort
4. **Assume + Announce** for medium confidence — State assumption, proceed unless corrected

### UI Display

```
┌──────────────────────────────────────────────┐
│ Which article would you like to read?        │
│                                              │
│ ○ Flirting Tips for Beginners (85%)          │
│ ○ Advanced Flirting Techniques (72%)         │
│ ○ Other (specify below)                      │
│                                              │
│ [________________________] [Submit]          │
└──────────────────────────────────────────────┘
```

---

## Assume + Announce Pattern

For medium confidence (0.5-0.9), state assumptions and proceed unless corrected:

```
┌──────────────────────────────────────────────┐
│ I'll proceed with these assumptions:         │
│                                              │
│ • Target: "First search result" (75%)        │
│ • Search term: "AI tools" (90%)              │
│                                              │
│ Executing in 3s... [Correct] [Cancel]        │
└──────────────────────────────────────────────┘
```

### Implementation

```javascript
function displayAssumeAnnounce(assumptions, plan) {
  const autoExecuteDelay = 3000; // 3 seconds

  showAssumeCard({
    assumptions,
    plan,
    countdown: autoExecuteDelay / 1000
  });

  // Start countdown
  const timeout = setTimeout(() => {
    proceedWithPlan(plan);
  }, autoExecuteDelay);

  // Allow user to cancel
  onCorrectClick(() => {
    clearTimeout(timeout);
    showClarificationUI();
  });

  onCancelClick(() => {
    clearTimeout(timeout);
    resetToIdle();
  });
}
```

---

## Self-Refine Loop

### Flow

```
GENERATE initial plan
    │
    ▼
FEEDBACK: Evaluate plan (score 0-1)
    │
    ├── score >= 0.9 → DONE (proceed to approval)
    │
    ▼
REFINE: Improve based on feedback
    │
    ▼
Check improvement
    │
    ├── improved → loop (max 3 iterations)
    └── not improved → DONE (use current best)
```

### Feedback Prompt

```javascript
const feedbackPrompt = `
Evaluate this browser automation plan. Score 0-1.

## Task
${task}

## Plan
${JSON.stringify(plan)}

## Available Elements
${elements}

## Criteria
1. Correctness: Do steps accomplish the task?
2. Specificity: Are targetIds valid?
3. Completeness: All necessary steps included?
4. Safety: Irreversible actions flagged?

## Response
{
  "score": 0.0-1.0,
  "issues": ["Issue 1", "Issue 2"],
  "suggestions": ["Fix 1", "Fix 2"]
}
`;
```

### Refine Prompt

```javascript
const refinePrompt = `
Improve this plan based on feedback.

## Original Plan
${JSON.stringify(plan)}

## Feedback
${JSON.stringify(feedback)}

## Available Elements
${elements}

Generate improved plan addressing the issues.
`;
```

---

## Mid-Execution Dialogue

### Failure Analysis

When a step fails:

1. **Capture current page state**
2. **Analyze failure cause**
3. **Find recovery options**
4. **Present to user**

```javascript
async function analyzeFailure(step, error, pageState) {
  // Element not found
  if (error.includes('element not found')) {
    const similar = findSimilarElements(step, pageState.elements);

    if (similar.length > 0) {
      return {
        cause: 'Element moved after navigation',
        canRetry: true,
        retryStrategy: `Found similar: "${similar[0].text}"`,
        suggestedTargetId: similar[0].id,
        canSkip: true,
        canReplan: true,
        recommendedAction: 'retry'
      };
    }
  }

  // Timeout
  if (error.includes('timeout')) {
    return {
      cause: 'Page took too long to respond',
      canRetry: true,
      canSkip: true,
      recommendedAction: 'retry'
    };
  }

  return {
    cause: 'Unknown error',
    canRetry: true,
    canSkip: true,
    canReplan: true,
    recommendedAction: 'replan'
  };
}
```

### Failure Dialog UI

```
┌──────────────────────────────────────────────┐
│ Step 2 failed: Element not found             │
│                                              │
│ Cause: Page navigated, element IDs changed   │
│                                              │
│ Options:                                     │
│ [Retry] - Found similar: "Sign In" button    │
│ [Skip]  - Continue to step 3                 │
│ [Replan] - Create new plan from here         │
│ [Stop]  - Cancel task                        │
└──────────────────────────────────────────────┘
```

---

## Extended State Schema

```javascript
{
  tabId: number,
  status: 'idle' | 'planning' | 'clarifying' | 'refining' |
          'assume_announce' | 'awaiting_approval' | 'executing' |
          'mid_exec_dialog' | 'replanning' | 'completed' | 'error',

  // Dialogue tracking
  conversationHistory: [{ role, content, timestamp, messageType }],
  dialogueState: {
    clarificationRound: 0,      // 0-3
    maxClarificationRounds: 3,
    refineIteration: 0,         // 0-3
    maxRefineIterations: 3,
    pendingQuestions: [],
    assumptions: [{ field, assumedValue, confidence }]
  },

  // Execution tracking
  executionState: {
    currentStepIndex: number,
    totalSteps: number,
    completedSteps: [],
    failedSteps: [{ stepIndex, error, retryCount, resolution }],
    checkpoint: { beforeStepIndex, pageState, timestamp }
  },

  // Plan tracking
  currentPlan: { id, version, summary, confidence, steps, assumptions, risks },
  planHistory: []  // Previous plan versions
}
```

---

## New Message Types

### Background → SidePanel

```javascript
// Assume + Announce
{
  type: 'assumeAnnounce',
  assumptions: [{ field, assumedValue, confidence }],
  plan: { summary, steps },
  autoExecuteDelay: 3000
}

// Option-based clarification
{
  type: 'clarifyWithOptions',
  question: 'Which article would you like?',
  options: [
    { id: 'opt-1', text: 'Flirting Tips', confidence: 0.85 },
    { id: 'opt-2', text: 'Advanced Techniques', confidence: 0.72 }
  ],
  allowFreeform: true
}

// Mid-execution failure
{
  type: 'midExecDialog',
  failedStep: { stepIndex, action, targetDescription, error },
  analysis: { cause, suggestion },
  options: ['retry', 'skip', 'replan', 'abort'],
  suggestedAction: 'replan'
}

// Self-refine progress
{
  type: 'selfRefineUpdate',
  iteration: 2,
  maxIterations: 3,
  previousScore: 0.6,
  newScore: 0.8,
  improvements: ['Added specific targetId', 'Clarified expected result']
}

// Confidence report
{
  type: 'confidenceReport',
  overall: 0.78,
  breakdown: { intentClarity: 0.9, targetMatch: 0.65, valueConfidence: 0.85 },
  recommendation: 'assume_announce'
}
```

### SidePanel → Background

```javascript
// Answer to clarification
{
  action: 'submitClarification',
  answer: 'The first article',
  selectedOptionId: 'opt-1'
}

// Correction during assume-announce
{
  action: 'correctAssumption',
  field: 'target',
  newValue: 'ai-target-15'
}

// Mid-exec decision
{
  action: 'midExecDecision',
  decision: 'retry' | 'skip' | 'replan' | 'abort'
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `extension/lib/state-manager.js` | Extended state schema |
| `extension/lib/agent-loop.js` | State machine, self-refine, mid-exec |
| `extension/background.js` | New message handlers |
| `extension/sidepanel.js` | Option UI, assume-announce, mid-exec dialog |
| `extension/sidepanel.html` | New UI components |
| `backend/lib/prompt-builder.js` | Four-layer prompts, confidence, feedback |
| `backend/server.js` | `/api/plan-with-confidence`, `/api/refine-plan` |

---

## Implementation Phases

### Phase 1: State Machine Foundation
1. Extend state schema in `state-manager.js`
2. Implement state transitions in `agent-loop.js`
3. Add new message handlers in `background.js`

### Phase 2: Confidence System
1. Add confidence calculation to `prompt-builder.js`
2. Create `/api/plan-with-confidence` endpoint
3. Implement decision routing based on zones

### Phase 3: Clarification System
1. Build option-based question UI
2. Implement assume-announce with 3s timer
3. Support multi-round clarification (up to 3)

### Phase 4: Self-Refine Loop
1. Add feedback and refine prompts
2. Implement refine loop in `agent-loop.js`
3. Show iteration progress in UI

### Phase 5: Mid-Execution Dialogue
1. Add failure analysis function
2. Build mid-exec dialog UI
3. Implement retry/skip/replan/abort

### Phase 6: Integration & Testing
1. End-to-end integration tests
2. Edge case handling
3. Performance optimization

---

## Testing Checklist

- [ ] Confidence >= 0.9 goes directly to approval
- [ ] Confidence 0.5-0.9 shows assume-announce with 3s countdown
- [ ] Confidence < 0.5 shows option-based questions
- [ ] Option selection works correctly
- [ ] Freeform input works when "Other" selected
- [ ] Cancel during assume-announce stops countdown
- [ ] Correct during assume-announce shows clarification
- [ ] Self-refine improves plan quality
- [ ] Max 3 refine iterations enforced
- [ ] Step failure shows mid-exec dialog
- [ ] Retry re-attempts with similar element
- [ ] Skip moves to next step
- [ ] Replan creates new plan from current state
- [ ] Abort returns to idle
- [ ] State persists across service worker restarts
