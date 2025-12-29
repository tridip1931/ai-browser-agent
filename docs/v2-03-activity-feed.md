# V2 Part 3: Activity Feed Format

## Overview

Transform the chat-style action display into a terminal-like activity feed. Compact, scannable, with clear status indicators.

## Design Principles

- **Dense** — More information in less space
- **Scannable** — Quick visual parsing
- **Timeline-like** — Connected vertical flow
- **Status-first** — Immediate feedback on each action

---

## Current vs New

### Before (V1) — Card Style

```
┌─────────────────────────────────┐
│ 👆 click                        │
│ Target: ai-target-40            │
│ "Fundamentals To Flirting"      │
│                    [Running...] │
└─────────────────────────────────┘
```

### After (V2) — Activity Feed

```
● Click: "Fundamentals To Flirting"
│
● Type: "search query"
│
● Press key: Return
│
◐ Take screenshot
```

---

## Status Indicators

| Symbol | State | Color |
|--------|-------|-------|
| `◐` | Running | Orange (animated pulse) |
| `●` | Success | Orange (solid) |
| `✕` | Error | Red |
| `○` | Pending | Gray |

---

## Action Text Formats

| Action | Display Format |
|--------|---------------|
| Click | `Click: "{element text}"` |
| Type | `Type: "{value}"` |
| Scroll | `Scroll {direction}` |
| Wait | `Wait {ms}ms` |
| Screenshot | `Take screenshot` |
| Key press | `Press key: {key}` |
| Navigate | `Navigate: {url}` |

---

## JavaScript Implementation

### Format Action Text

```javascript
function formatActionText(action) {
  switch (action.action || action.type) {
    case 'click':
      const target = action.targetDescription || action.targetId;
      return `Click: "${truncate(target, 40)}"`;

    case 'type':
      return `Type: "${truncate(action.value, 30)}"`;

    case 'scroll':
      return `Scroll ${action.direction || 'down'}`;

    case 'wait':
      return `Wait ${action.ms || 1000}ms`;

    case 'screenshot':
      return 'Take screenshot';

    case 'keypress':
    case 'pressKey':
      return `Press key: ${action.key}`;

    case 'navigate':
      return `Navigate: ${truncate(action.url, 30)}`;

    default:
      return `${action.action}: ${action.targetDescription || ''}`;
  }
}

function truncate(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength
    ? text.substring(0, maxLength - 1) + '…'
    : text;
}
```

### Show Action in Feed

```javascript
function showActionCard(action) {
  const actionEl = document.createElement('div');
  actionEl.className = 'activity-item';
  actionEl.id = `action-${action.step || Date.now()}`;

  const actionText = formatActionText(action);

  actionEl.innerHTML = `
    <span class="activity-indicator running">◐</span>
    <span class="activity-text">${actionText}</span>
  `;

  elements.chatContainer.appendChild(actionEl);
  scrollToBottom();
}
```

### Update Action Status

```javascript
function updateActionCard(actionId, success) {
  const actionEl = document.getElementById(`action-${actionId}`);
  if (!actionEl) return;

  const indicator = actionEl.querySelector('.activity-indicator');
  indicator.className = `activity-indicator ${success ? 'success' : 'error'}`;
  indicator.textContent = success ? '●' : '✕';
}
```

---

## CSS Styles

```css
/* Activity Feed Container */
.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: var(--bg-primary);
}

/* Activity Item */
.activity-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-primary);
  border-left: 1px solid var(--border);
  margin-left: 8px;
  padding-left: 16px;
}

/* Status Indicator */
.activity-indicator {
  flex-shrink: 0;
  font-size: 10px;
  margin-left: -22px;
  width: 12px;
  text-align: center;
}

.activity-indicator.running {
  color: var(--accent);
  animation: pulse 1s infinite;
}

.activity-indicator.success {
  color: var(--accent);
}

.activity-indicator.error {
  color: var(--error);
}

.activity-indicator.pending {
  color: var(--text-muted);
}

/* Activity Text */
.activity-text {
  flex: 1;
  line-height: 1.4;
}

/* Pulse Animation */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

---

## User Messages in Feed

User tasks appear differently from agent actions:

```css
.activity-item.user-task {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin: 12px 0;
  padding: 12px 16px;
  border-left: none;
  margin-left: 0;
}

.activity-item.user-task .activity-indicator {
  display: none;
}

.activity-item.user-task .activity-text {
  color: var(--text-primary);
  font-weight: 500;
}
```

### User Task Display

```javascript
function showUserTask(task) {
  const taskEl = document.createElement('div');
  taskEl.className = 'activity-item user-task';
  taskEl.innerHTML = `
    <span class="activity-text">${escapeHtml(task)}</span>
  `;
  elements.chatContainer.appendChild(taskEl);
  scrollToBottom();
}
```

---

## System Messages

For status updates, errors, and completions:

```css
.activity-item.system {
  color: var(--text-muted);
  font-size: 12px;
  border-left: none;
  margin-left: 0;
  padding-left: 0;
  justify-content: center;
}

.activity-item.error {
  color: var(--error);
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  margin: 8px 0;
  border-left: none;
}
```

---

## Complete Feed Example

```
┌──────────────────────────────────────┐
│ Find article on flirting and read it │  ← User task
└──────────────────────────────────────┘
│
● Click: "Library"
│
● Scroll down
│
● Click: "Fundamentals To Flirting"
│
◐ Take screenshot                        ← Currently running
│

```

---

## Migration Checklist

- [ ] Update `showActionCard()` to use activity format
- [ ] Add `formatActionText()` helper function
- [ ] Update `updateActionCard()` for new indicator
- [ ] Add activity feed CSS to sidepanel.html
- [ ] Update user message display
- [ ] Test all action types render correctly
- [ ] Verify pulse animation works
- [ ] Test error state display
