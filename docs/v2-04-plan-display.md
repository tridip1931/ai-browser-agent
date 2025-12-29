# V2 Part 4: Plan Display Simplification

## Overview

Simplify the execution plan display from colorful cards with emojis to clean numbered lists with monochrome styling.

## Design Principles

- **Readable** — Clear numbered sequence
- **Minimal** — No gradients, shadows, or emojis
- **Actionable** — Obvious approve/reject buttons
- **Consistent** — Same styling as activity feed

---

## Current vs New

### Before (V1)

Multi-colored card with:
- Gradient background
- Numbered steps with emoji icons
- Rounded corners with shadows
- Colored status badges

### After (V2)

```
┌──────────────────────────────────┐
│ Execution Plan                   │
│ ──────────────────────────────── │
│ 1. Click "Search" button         │
│ 2. Type "AI automation"          │
│ 3. Press Enter                   │
│ 4. Scroll down                   │
│                                  │
│ [Execute]  [Cancel]              │
└──────────────────────────────────┘
```

---

## HTML Structure

```html
<div class="plan-card" id="plan-card">
  <div class="plan-header">Execution Plan</div>
  <div class="plan-steps" id="plan-steps">
    <!-- Steps inserted dynamically -->
  </div>
  <div class="plan-actions">
    <button class="btn-primary" id="approve-plan">Execute</button>
    <button class="btn-secondary" id="reject-plan">Cancel</button>
  </div>
</div>
```

---

## JavaScript Implementation

### Show Plan

```javascript
function showPlanCard(plan) {
  const planCard = document.getElementById('plan-card');
  const stepsContainer = document.getElementById('plan-steps');

  // Clear previous steps
  stepsContainer.innerHTML = '';

  // Add each step
  plan.steps.forEach((step, index) => {
    const stepEl = document.createElement('div');
    stepEl.className = 'plan-step';
    stepEl.innerHTML = `
      <span class="step-num">${index + 1}.</span>
      <span class="step-text">${formatStepText(step)}</span>
    `;
    stepsContainer.appendChild(stepEl);
  });

  // Show the card
  planCard.style.display = 'block';
  scrollToBottom();
}
```

### Format Step Text

```javascript
function formatStepText(step) {
  switch (step.action || step.type) {
    case 'click':
      return `Click "${step.targetDescription || step.targetId}"`;

    case 'type':
      return `Type "${truncate(step.value, 25)}"`;

    case 'scroll':
      return `Scroll ${step.direction || 'down'}`;

    case 'wait':
      return `Wait ${step.ms || 1000}ms`;

    case 'pressKey':
    case 'keypress':
      return `Press ${step.key}`;

    case 'navigate':
      return `Go to ${truncate(step.url, 25)}`;

    default:
      return step.description || `${step.action}`;
  }
}
```

### Handle Approval

```javascript
document.getElementById('approve-plan').addEventListener('click', () => {
  hidePlanCard();
  sendMessage({ action: 'approvePlan' });
});

document.getElementById('reject-plan').addEventListener('click', () => {
  hidePlanCard();
  sendMessage({ action: 'rejectPlan' });
  showSystemMessage('Plan cancelled');
});

function hidePlanCard() {
  document.getElementById('plan-card').style.display = 'none';
}
```

---

## CSS Styles

```css
/* Plan Card Container */
.plan-card {
  display: none;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  margin: 12px 0;
}

/* Plan Header */
.plan-header {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

/* Plan Steps Container */
.plan-steps {
  margin-bottom: 16px;
}

/* Individual Step */
.plan-step {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.plan-step .step-num {
  color: var(--text-muted);
  min-width: 20px;
  text-align: right;
}

.plan-step .step-text {
  flex: 1;
}

/* Action Buttons */
.plan-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

/* Primary Button (Execute) */
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:active {
  opacity: 0.8;
}

/* Secondary Button (Cancel) */
.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-secondary:hover {
  background: var(--bg-primary);
}
```

---

## Step Highlighting During Execution

When plan is approved and executing, highlight current step:

```css
.plan-step.current {
  color: var(--text-primary);
  font-weight: 500;
}

.plan-step.current .step-num {
  color: var(--accent);
}

.plan-step.completed {
  color: var(--text-muted);
}

.plan-step.completed .step-num::after {
  content: ' ●';
  color: var(--accent);
  font-size: 8px;
}
```

### Update Step Progress

```javascript
function updatePlanProgress(currentStep) {
  const steps = document.querySelectorAll('.plan-step');

  steps.forEach((step, index) => {
    step.classList.remove('current', 'completed');

    if (index < currentStep) {
      step.classList.add('completed');
    } else if (index === currentStep) {
      step.classList.add('current');
    }
  });
}
```

---

## Compact Mode (Optional)

For plans with many steps, show condensed view:

```css
.plan-card.compact .plan-step {
  padding: 4px 0;
  font-size: 12px;
}

.plan-card.compact .plan-header {
  font-size: 12px;
  margin-bottom: 8px;
  padding-bottom: 6px;
}
```

```javascript
function showPlanCard(plan) {
  const planCard = document.getElementById('plan-card');

  // Use compact mode for plans with >5 steps
  if (plan.steps.length > 5) {
    planCard.classList.add('compact');
  } else {
    planCard.classList.remove('compact');
  }

  // ... rest of implementation
}
```

---

## Inline Plan Display (Alternative)

For simpler tasks, show plan inline in activity feed instead of card:

```javascript
function showInlinePlan(plan) {
  // Header
  const headerEl = document.createElement('div');
  headerEl.className = 'activity-item system';
  headerEl.innerHTML = `<span class="activity-text">Plan (${plan.steps.length} steps):</span>`;
  elements.chatContainer.appendChild(headerEl);

  // Steps as activity items
  plan.steps.forEach((step, index) => {
    const stepEl = document.createElement('div');
    stepEl.className = 'activity-item pending';
    stepEl.id = `plan-step-${index}`;
    stepEl.innerHTML = `
      <span class="activity-indicator pending">○</span>
      <span class="activity-text">${formatStepText(step)}</span>
    `;
    elements.chatContainer.appendChild(stepEl);
  });

  scrollToBottom();
}
```

---

## Migration Checklist

- [ ] Update plan card HTML structure
- [ ] Add `showPlanCard()` function
- [ ] Add `formatStepText()` helper
- [ ] Add plan card CSS
- [ ] Add button event handlers
- [ ] Implement step progress highlighting
- [ ] Test with various plan lengths
- [ ] Remove old gradient/emoji styles
- [ ] Test approve/cancel flow
