# AgentSpec

> Small, local regression contracts for AI applications.

[![npm version](https://img.shields.io/npm/v/@ozperium/agentspec)](https://www.npmjs.com/package/@ozperium/agentspec)
[![GitHub](https://img.shields.io/github/stars/Ozperium/agentspec)](https://github.com/Ozperium/agentspec)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Write YAML expectations, connect your **actual agent**, and fail the build when its output violates a contract. Runs locally; no AgentSpec account or hosted dashboard is required. Only `yaml` is a runtime dependency.

[Read the AgentSpec walkthrough on DEV](https://dev.to/pawfromoz/testing-ai-agents-with-agentspec-jest-for-non-deterministic-behavior-55kg) for a concrete regression-testing example.

AgentSpec is a single-run output/metadata test runner, not a statistical benchmark or a full agent-trajectory evaluator. A passing suite proves only the checks you wrote against the agent you selected.

## Quick start

```bash
npm install --save-dev @ozperium/agentspec
npx agentspec init
npx agentspec run --mock
```

This creates `tests/getting-started.yaml`. **`--mock` is an explicitly labeled echo demo, not an evaluation of your application.** `init` refuses to overwrite an existing file.

### First HTTP check

To exercise the real HTTP adapter without provider credentials, start the included local fixture in one terminal:

```bash
node ./node_modules/@ozperium/agentspec/examples/http-agent.cjs
```

Then, from the project where `tests/getting-started.yaml` was created, run:

```bash
npx agentspec run --endpoint http://127.0.0.1:3000/chat
```

This should pass one case through an actual HTTP request. The fixture is a deterministic local responder, not an AI agent; replace its endpoint with your own application before relying on results.

```yaml
name: my-agent-tests
tests:
  - name: handles greeting
    input: hello
    expect:
      contains: hello
```

Connect your real HTTP agent:

```bash
npx agentspec run --endpoint http://127.0.0.1:3000/chat
```

Choose exactly one of `--endpoint`, `--agent`, or `--mock`. There is no implicit mock fallback. Failed tests exit with code 1, with or without `--ci`. Missing suites and filters matching zero tests are errors, not green runs.

## HTTP contract

AgentSpec POSTs `{ "input": "hello" }`. Optional `suite.agent` properties are forwarded in the request; they do not automatically select a model or adapter.

Return JSON with a string `output` (alternatively `text` or `response`):

```json
{
  "output": "hello from the real agent",
  "tokens": 42,
  "latency_ms": 120,
  "tools_called": ["lookup_account"]
}
```

Successful plain-text responses are also supported. Non-2xx responses and malformed output fail the test. An empty output string and zero tokens are valid values. Do not return an error object as a successful agent response.

- `max_tokens` requires known token usage; missing metadata fails the assertion.
- `tool_called` requires known tool names; missing metadata fails the assertion. An empty array means no tool was called.
- Latency uses the adapter's reported `latency_ms` when present, otherwise the measured call time. The result's `duration_ms` remains the measured time.
- For bearer authentication, set `AGENTSPEC_AGENT_TOKEN` in your environment. Never put a secret into YAML or a command line.
- Use a custom `HTTPAgent` in a trusted module when you need custom headers or input/output field names.

## Vercel AI SDK and custom agents

The CLI can load a **trusted CommonJS module** exporting an `AgentRunner`, directly or as `agent`/`default`. Its `run(input, suite)` method returns `{ text, tokens?, latencyMs?, toolsCalled? }`. Module code executes with your user's permissions; only load code you trust.

For Vercel AI SDK, install your application's SDK/provider dependencies and export the adapter. AI SDK 7 requires Node >=22; the verified integration uses Node 24:

```bash
npm install ai @ai-sdk/openai
```

```js
// agentspec-agent.cjs
const { VercelAIAgent } = require('@ozperium/agentspec');

module.exports = new VercelAIAgent({
  generate: async (input) => {
    const { generateText } = await import('ai');
    const { openai } = await import('@ai-sdk/openai');
    return generateText({ model: openai('gpt-4o-mini'), prompt: input });
  },
});
```

```bash
npx agentspec run --agent ./agentspec-agent.cjs --json
```

Keep your provider key in its standard environment variable. The adapter consumes the final text, usage and tool names returned by the SDK, including step tool names when supplied. `tool_called` does **not** validate tool arguments, execution order, side effects, or authorization. A timeout stops waiting; it does not prove an upstream model call was cancelled.

The exported `runAll`, `HTTPAgent`, `LangChainAgent`, and `VercelAIAgent` can also be used programmatically.

## Assertions

```yaml
name: support-contracts
tests:
  - name: explains expired token recovery
    input: my token expired
    expect:
      contains: refresh token
      not_contains: send your password
      max_latency_ms: 5000
      max_tokens: 500

  - name: uses billing tool
    input: I want a refund
    expect:
      contains_any: [billing, refund, support]
      tool_called: transfer_to_billing

  - name: structured profile
    input: get the test user's profile
    expect:
      json_path: data.email
      json_value: user@example.com

  - name: reports a structured error code
    input: simulate an error
    expect:
      regex: 'ERR-\d{5}'
```

Other supported checks: `contains_all`, `semantically_similar`, and `llm_judge`.

**`semantically_similar` is a deterministic word-overlap heuristic, not embedding similarity.** Its `min_confidence` option is an overlap threshold, not calibrated confidence. Prefer concrete checks or a validated judge for semantic requirements.

Malformed suites, empty expectations, unsupported assertion keys and misspelled checks fail validation. AgentSpec does not silently ignore an assertion it cannot implement.

## Local LLM judge

Select the real agent and the judge separately:

```bash
npx agentspec run --agent ./agentspec-agent.cjs \
  --judge-endpoint http://127.0.0.1:11434/v1/chat/completions \
  --judge-model llama3.2:3b
```

```yaml
name: response-quality
tests:
  - name: explains password recovery
    input: How do I reset my password?
    expect:
      llm_judge: The response must describe password recovery without requesting the user's password.
```

The judge must return valid JSON with Boolean `passed`, finite `score` in `[0,1]`, and a non-empty `reasoning` string. Malformed verdicts, wrong field types, unavailable services and missing final output fail closed. The judge's Boolean verdict determines pass/fail; its score is reported, not a separate acceptance threshold.

A local judge avoids sending grading data to an external service, **only if your selected agent and judge endpoints are both local**. Judge quality remains model/rubric dependent; calibrate against labeled examples. This is not a guarantee of factuality or safety.

`evaluateAssertions` validates checks and refuses to pretend it ran an LLM judge; use `evaluateAssertionsAsync` for judge checks.

## Accepted baselines and regression diffs

Accept a reviewed, fully passing run explicitly:

```bash
npx agentspec run --endpoint http://127.0.0.1:3000/chat --update-baseline
```

This atomically writes `.agentspec/baseline.json`. Normal runs never overwrite it, even when they pass. Failed runs cannot be accepted. A filtered or watch-mode run cannot replace the complete baseline.

```bash
npx agentspec run --endpoint http://127.0.0.1:3000/chat --json
```

JSON includes `diffs`. Repeated failing runs continue to show a regression against the accepted version, rather than replacing the reference with a failed output. Output changes that still satisfy all assertions are reported as changes; they are not automatically failures.

Commit the accepted baseline with your contracts if you want the same reference in CI. Use only sanitized fixtures: baselines contain outputs and assertion diagnostics. Old per-test `.agentspec/*.json` snapshots from 0.1.x are not imported as accepted baselines; run a reviewed acceptance command to migrate. Corrupt accepted baselines are errors, not silently discarded history.

## CI and reports

```bash
npx agentspec run --agent ./agentspec-agent.cjs --ci
npx agentspec run --agent ./agentspec-agent.cjs --junit > results.xml
npx agentspec run --agent ./agentspec-agent.cjs --json > results.json
```

### GitHub Action

The action builds **its checked-out AgentSpec revision**, not whatever happens to be latest on npm. Supply a real endpoint or a trusted module; there is no default mock.

```yaml
name: Agent contracts
on:
  pull_request:
  push:
    branches: [main]
jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Start your application's test server in a preceding step.
      - uses: Ozperium/agentspec@main
        with:
          test-dir: tests
          agent-endpoint: http://127.0.0.1:3000/chat
          format: junit
        env:
          AGENTSPEC_AGENT_TOKEN: ${{ secrets.AGENT_TEST_TOKEN }}
```

Pin the action to a reviewed commit or release tag for reproducibility. For a module-based agent, install your application's dependencies before the action using the same Node version, then supply `agent-module: ./agentspec-agent.cjs`. The action defaults to Node 24; override `node-version` only to a version supported by your application and SDK. Only use `mock: 'true'` for an intentional echo demo. `fail-on-failure: 'false'` is explicitly non-gating.

## Runnable local-model example

From a source checkout, with Ollama running and a local model already installed:

```bash
npm ci
AGENTSPEC_MODEL=llama3.2:3b npm run test:live
```

This invokes the real local model for three checks and verifies a deliberately wrong criterion is rejected by the judge. It is opt-in, not part of deterministic CI. Change `AGENTSPEC_MODEL`, `AGENTSPEC_JUDGE_MODEL`, `AGENTSPEC_OLLAMA_ENDPOINT`, or `AGENTSPEC_JUDGE_ENDPOINT` for your local setup.

The packaged `examples/ollama-agent.cjs` and `examples/ollama-tests/live.yaml` are also runnable with the installed CLI.

## Development verification

```bash
npm ci
npm test                  # Deterministic regression and boundary tests
npm run test:conformance   # Requires all six deliberately failing fixtures
npm run test:package       # Pack, clean install, real HTTP, regression, JSON/JUnit
npm run test:live          # Optional real local agent and judge
```

`npm pack` builds current sources. Publishing runs deterministic, conformance and clean-package gates first.

### Reproduce the Vercel SDK integration check

The adapter is exercised against `ai@7.0.137` using the SDK's own `MockLanguageModelV4` for `generateText` and `streamText`. This verifies SDK plumbing, not real model quality. The check also runs in CI on Node 24 without adding an AI SDK runtime dependency to AgentSpec.

```bash
SDK_DIR="$(mktemp -d)"
npm install --prefix "$SDK_DIR" ai@7.0.137 --ignore-scripts --no-save --no-package-lock
AGENTSPEC_AI_VERIFY_DIR="$SDK_DIR" npm run test:ai-sdk
```

## Scope and limitations

- One agent invocation per case, no built-in repeated-trial statistics or calibrated confidence.
- Tool-name checks, not first-class conversation/trajectory or side-effect verification.
- Local accepted-output baselines, not a hosted experiment ledger or automatic model/prompt version tracking.
- Trusted module integration, not a sandbox.
- `--watch` monitors YAML changes in the selected directory root, serializes reruns and recovers from invalid edits; it is not a recursive project/code watcher.
- No dashboard, automatic test generation, or PR-comment bot.

## License

MIT
