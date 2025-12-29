# Changelog

All notable changes to AI Browser Agent will be documented in this file.

## [2.0.0] - 2024-12-30

### Added

#### Conversational AI
- **Confidence-based routing** — 3-zone system determines dialogue flow
  - < 0.5: Ask clarifying questions
  - 0.5-0.9: Assume + Announce with 3s countdown
  - >= 0.9: Proceed directly to approval
- **Option-based clarification** — Multiple choice questions with freeform fallback
- **Multi-select support** — Users can select multiple options for clarification
- **Assume-announce pattern** — Shows assumptions with countdown timer, allows correction
- **Self-refine loop** — Up to 3 iterations to improve plan quality before execution
- **Mid-execution dialogue** — On step failure: retry, skip, replan, or abort

#### CDP Integration
- **Chrome DevTools Protocol** — Real mouse/keyboard events instead of synthetic
- **Native debug banner** — Chrome's "Started debugging this browser" indicator
- **User cancel support** — Users can cancel via Chrome's banner button
- **Full CDP action set** — click, doubleClick, type, clearAndType, pressKey, scroll, hover, screenshot

#### Evaluation Framework
- **327 automated tests** — 78 backend + 210 extension + 39 golden dataset
- **Golden dataset** — 39 test cases across intent, clarification, and action-plan categories
- **CI/CD pipeline** — GitHub Actions for automated testing on PRs
- **Vitest integration** — Modern test runner with coverage support

#### UI Improvements
- **Monochrome design** — Charcoal/gray palette with orange accent
- **Activity feed style** — Terminal-like action display
- **Confidence badge** — Shows current confidence level in header
- **Refine progress card** — Displays self-refine iteration progress
- **Mid-exec dialog** — Shows failure options with recommended action

### Changed
- Upgraded from content script synthetic events to CDP real events
- Replaced custom orange border with Chrome's native debugging banner
- State machine now tracks dialogue state (planning, clarifying, assume_announce, executing, mid_exec_dialog)
- Agent loop now uses V2 callbacks for all UI updates

### Technical
- `extension/lib/cdp-executor.js` — New CDP action library
- `extension/lib/state-manager.js` — V2 state machine with confidence helpers
- `extension/lib/agent-loop.js` — V2 agent loop with dialogue flow
- `backend/lib/prompt-builder.js` — V2 prompts with confidence scoring
- `tests/golden/` — Golden dataset with schema validation

---

## [1.0.0] - 2024-12-01

### Added
- Initial release
- ReAct-style agent loop (Observe → Reason → Act → Verify)
- Chrome MV3 extension with side panel UI
- Multi-provider LLM support (Anthropic, OpenAI, Ollama)
- DOM capture with element annotation
- Action execution (click, type, scroll)
- High-risk action confirmation
- Per-site permission management
- Visual indicator (orange border)
