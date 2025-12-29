# V2 Part 2: Monochromatic UI Redesign

## Overview

Transform the colorful chat interface into a clean, monochromatic design with orange accent color. Inspired by Readwise's Claude integration.

## Design Principles

- **Monochromatic** — Grayscale with single accent color
- **Minimal** — Remove gradients, reduce visual noise
- **Terminal-like** — Focus on information density
- **Clean typography** — System fonts, consistent sizing

---

## Color Palette

| Element | Current (V1) | New (V2) |
|---------|--------------|----------|
| Background | White (#fff) | Light gray (#fafafa) |
| Header | Purple gradient | Dark charcoal (#1a1a1a) |
| Accent | Multiple colors | Orange (#f97316) |
| Text primary | Black | Charcoal (#1a1a1a) |
| Text secondary | Gray | Medium gray (#666) |
| Borders | Various | Light gray (#e5e5e5) |
| Success | Green (#28a745) | Orange (#f97316) |
| Error | Red (#dc3545) | Keep red (#ef4444) |

---

## CSS Variables

Add to top of `<style>` in `sidepanel.html`:

```css
:root {
  --bg-primary: #fafafa;
  --bg-secondary: #fff;
  --bg-dark: #1a1a1a;
  --accent: #f97316;
  --accent-light: #fff7ed;
  --text-primary: #1a1a1a;
  --text-secondary: #666;
  --text-muted: #999;
  --border: #e5e5e5;
  --error: #ef4444;
  --radius-sm: 4px;
  --radius-md: 8px;
}
```

---

## Component Styles

### Header

```css
.header {
  background: var(--bg-dark);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: none;
}

.header-title {
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

.status-badge {
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--accent);
  border-radius: 12px;
}

.status-badge.running {
  background: var(--accent);
  color: #fff;
}
```

### Input Area

```css
.input-area {
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}

.task-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.task-input:focus {
  outline: none;
  border-color: var(--accent);
}

.task-input::placeholder {
  color: var(--text-muted);
}

/* Hide send button, submit on Enter */
.send-button {
  display: none;
}
```

### Chat Container

```css
.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: var(--bg-primary);
}
```

### Messages

```css
.message {
  margin-bottom: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.message.user {
  color: var(--text-primary);
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.message.agent {
  color: var(--text-secondary);
}

.message.system {
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.message.error {
  color: var(--error);
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 8px 12px;
  border-radius: var(--radius-md);
}
```

### Buttons

```css
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--bg-primary);
}
```

---

## Visual Comparison

### Before (V1)
- Purple gradient header
- Colorful status badges (green, yellow, red)
- Emoji icons everywhere
- Rounded pill input
- Card-based messages with shadows

### After (V2)
- Dark charcoal header
- Orange accent only
- Minimal icons (dots, lines)
- Clean rectangular input
- Flat messages with subtle borders

---

## Migration Steps

1. Add CSS variables at top of `<style>`
2. Replace all hardcoded colors with variables
3. Update header styles
4. Update input area styles
5. Update message styles
6. Update button styles
7. Remove gradients and shadows
8. Test all states (idle, running, error)

---

## Testing Checklist

- [ ] Header displays correctly with dark background
- [ ] Status badge shows orange outline (idle) or filled (running)
- [ ] Input field has correct styling and focus state
- [ ] Messages display with proper typography
- [ ] Buttons have correct hover states
- [ ] Error states show red properly
- [ ] No remnants of old colorful styling
