# Golden Dataset for V2 Browser Agent Evaluation

This directory contains the authoritative golden dataset for regression testing the V2 Conversational AI Layer.

## Structure

```
tests/golden/
├── intent/              # Intent & Planning evaluation
│   ├── easy/           # Simple, unambiguous tasks
│   ├── medium/         # Tasks with some ambiguity
│   └── hard/           # Complex, multi-step, or ambiguous tasks
├── clarification/       # Clarification flow evaluation
├── action-plan/         # Action plan quality evaluation
└── _meta/
    ├── schema.json      # JSON Schema for validation
    └── README.md        # This file
```

## Difficulty Levels

| Level | Confidence Range | Characteristics |
|-------|------------------|-----------------|
| **Easy** | >= 0.9 | Clear task, single target, direct action |
| **Medium** | 0.5 - 0.9 | Some ambiguity, assumptions needed |
| **Hard** | < 0.5 | Vague task, multiple interpretations, clarification required |

## Target Distribution

| Category | Easy | Medium | Hard | Total |
|----------|------|--------|------|-------|
| Intent & Planning | 32-48 | 32-48 | 16-24 | 80-120 |
| Clarification | 20-30 | 20-30 | 10-15 | 50-75 |
| Action Plans | 28-42 | 28-42 | 14-21 | 70-105 |
| **Total** | 80-120 | 80-120 | 40-60 | 200-300 |

## Example Format

Each example is a JSON file following `schema.json`:

```json
{
  "id": "intent-easy-001",
  "category": "intent",
  "difficulty": "easy",
  "description": "Simple click on clearly identified button",
  "task": "Click the Login button",
  "pageContext": {
    "url": "https://example.com",
    "elements": [
      { "id": "ai-target-1", "type": "button", "text": "Login", "visible": true }
    ]
  },
  "expectedResponse": {
    "understood": true,
    "confidence": { "overall": 0.95 },
    "summary": "Click the Login button",
    "steps": [
      { "step": 1, "action": "click", "targetId": "ai-target-1" }
    ]
  },
  "expectedEvaluation": {
    "pass": true,
    "minScore": 0.9,
    "expectedConfidenceZone": "proceed"
  },
  "tags": ["login", "single-action", "button"]
}
```

## Running Golden Tests

```bash
# Run all golden dataset tests
npm run test:golden

# Run specific category
npm run test:golden -- --filter=intent

# Run specific difficulty
npm run test:golden -- --filter=easy
```

## Adding New Examples

1. Create a JSON file in the appropriate directory
2. Follow the naming convention: `{category}-{difficulty}-{number}.json`
3. Validate against schema: `npm run validate:golden`
4. Run regression: `npm run test:golden`

## Maintenance

- Review and update quarterly
- Add examples from production failures
- Remove outdated examples when V2 behavior changes
- Maintain difficulty distribution balance
