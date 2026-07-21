# Agents

Custom subagents for Claude Code. Each agent is a `<name>.md` file with YAML frontmatter (`name`, `description`, optional `tools`) followed by its system prompt.

Agents in this project:

- **firestore-auditor** — reviews consistency between Firestore queries (`src/services/firestore.js`), `firestore.rules`, and `firestore.indexes.json`. Read-only.
- **expo-checker** — verifies API usage against the Expo SDK 56 versioned docs before code lands. Read-only.
- **test-writer** — writes jest-expo tests for services/utils/contexts matching `src/__tests__/` conventions.
- **ui-reviewer** — reviews screens/components for theme, dark-mode, navigation, and reuse conventions. Read-only.
