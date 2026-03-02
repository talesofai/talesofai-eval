# agent-eval

Evaluation toolkit for prompt cases and agent traces. Supports reproducible testing, trace recording/replay, and LLM-as-a-judge scoring.

## What Works Out of the Box

- **Plain cases** (`type: plain`): Direct chat completion evaluation
- **Agent cases** (`type: agent`): Full agent runtime with MCP tools
- CLI and programmatic API for loading, running, and scoring

## Quick Start (Monorepo Contributors)

```bash
# 1. Install dependencies
pnpm install

# 2. Build the package
pnpm build

# 3. Configure environment (place at repo root for root-level execution)
cp packages/eval/.env.example .env
# Edit .env with your API keys

# 4. Verify setup
pnpm agent-eval doctor

# 5. Run built-in examples
pnpm agent-eval run --case all
```

## Quick Start (npm Users)

```bash
# Install globally
npm i -g agent-eval

# Or use npx (no install)
npx agent-eval --help

# Configure and run
cp packages/eval/.env.example .env
agent-eval doctor
agent-eval run --case all
```

## Documentation

- [CLI Usage & Case Format](packages/eval/README.md) - Full documentation for users
- [Development Guide](TODOS.md) - Roadmap and internal notes

## Project Structure

```
.
├── packages/eval/          # Main CLI package (npm: agent-eval)
│   ├── src/               # Source code
│   ├── cases/             # Example eval cases
│   └── README.md          # Detailed usage docs
├── specs/                 # Design specifications
└── README.md              # This file
```

## License

MIT
