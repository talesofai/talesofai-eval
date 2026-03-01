# agent-eval

`agent-eval` is an evaluation toolkit for prompt cases and agent traces.

## What works out of the box

- Plain cases (`type: plain`) are fully usable in open source mode.
- CLI (`agent-eval`) and programmatic API can load cases, run traces, score results, and print reports.

## Runtime note

- Agent cases (`type: agent`) run with the OSS minimal runtime in `packages/eval` (OpenAI-compatible API + MCP tools).
- Character injection can optionally use upstream APIs via environment configuration.

## Quick start

```bash
pnpm install
pnpm build
node packages/eval/dist/cli.js --help
```

## npm direct usage

```bash
npm i -g agent-eval
agent-eval --help
# or
npx agent-eval --help
```

Before running, create `.env` from template:

```bash
cp packages/eval/.env.example packages/eval/.env
```
