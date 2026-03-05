## [0.1.1] - 2026-03-05

### Breaking Change
- Agent cases using parameter-templated legacy system prompt path now require `input.model` to be present in case data.
- Runner no longer silently continues when tool calls are emitted without available tools. It now returns an explicit error trace.

### Add
- Added unified `runPlain` execution path usage from agent/runtime entry points to reduce runner behavior drift.
- Added explicit runner error when the model emits tool calls while tools are unavailable: `Model attempted tool calls but tools are not available`.
- Added end-to-end MCP tool error propagation (`isError`) into tool result messages and trace output for scorer/metrics consistency.
- Added assertions normalization reuse in config-check so judge requirement checks follow assertions-first policy.
- Added regression tests:
  - tool availability behavior
  - tool executor `isError` propagation and span semantics
  - assertions normalization and judge config checks
  - wrapped tool output parsing in trace metrics
  - JSON run share event coverage

### Remove
- Removed duplicate runner implementation: `packages/eval/src/runner/plain.ts`.

## [0.1.0] - initial release
