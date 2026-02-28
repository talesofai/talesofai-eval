# agent-eval

`agent-eval` is an evaluation toolkit for prompt cases and agent traces.

## What works out of the box

- Plain cases (`type: plain`) are fully usable in open source mode.
- CLI (`agent-eval`) and programmatic API can load cases, run traces, score results, and print reports.

## Internal dependency note

- Agent cases (`type: agent`) rely on TalesOfAI internal infrastructure (preset/runtime APIs and MCP environment).
- The internal runner is included as private workspace packages (`@agent-eval/agent-runner`, `@agent-eval/apis`) in copy-and-own mode.

## Quick start

```bash
pnpm install
pnpm build
node packages/eval/dist/cli.js --help
```
