# AgentSpec

> Testing framework for AI agents — Jest for non-deterministic AI behavior

[![npm version](https://img.shields.io/npm/v/@ozperium/agentspec)](https://www.npmjs.com/package/@ozperium/agentspec)
[![GitHub](https://img.shields.io/github/stars/Ozperium/agentspec)](https://github.com/Ozperium/agentspec)

AI agents are non-deterministic. When you change a prompt, swap a model, or update a tool, behavior shifts in ways you can't predict. AgentSpec lets you write tests that catch those shifts before they reach production.

## Quick start

```bash
npm install -g @ozperium/agentspec
agentspec init
```

This creates `agentspec.yaml`:

```yaml
name: "my-agent-tests"
tests:
  - name: "handles greeting"
    input: "hello"
    expect:
      contains: "help"
```

Run tests:

```bash
agentspec run
```

## Assertions for non-deterministic output

AgentSpec provides assertions designed for AI output, not just string equality:

```yaml
tests:
  - name: "handles expired token"
    input: "my token expired"
    expect:
      contains: "refresh token"
      not_contains: "I don't know"
      max_latency_ms: 5000

  - name: "routes billing question"
    input: "I want a refund"
    expect:
      contains_any: ["billing", "refund", "support"]
      tool_called: "transfer_to_billing"

  - name: "response is semantically on-topic"
    input: "how do I reset my password?"
    expect:
      semantically_similar: "reset password credentials"
      min_confidence: 0.5

  - name: "JSON output has correct structure"
    input: "get user profile"
    expect:
      json_path: "data.email"
      json_value: "user@example.com"

  - name: "matches error code pattern"
    input: "simulate error"
    expect:
      regex: "ERR-\\d{5}"
```

## LLM-as-judge

Use a local model to evaluate response quality — no API costs, full privacy:

```bash
# Use local Ollama as judge
agentspec run --judge-endpoint http://127.0.0.1:11434/v1/chat/completions --judge-model qwen2.5:7b
```

```yaml
tests:
  - name: "response is helpful"
    input: "How do I reset my password?"
    expect:
      llm_judge: "The response should explain how to reset a password"
```

## Behavior diff reports

AgentSpec stores the last passing output per test. When behavior changes, you see exactly what shifted:

```
⚠️ REGRESSION support agent > handles expired token
  ⚠  Behavior REGRESSED — test was passing, now failing
  + added: your, token, has, expired, please, contact, support
  - removed: you, need, refresh, the, token, settings, security
```

## Testing real agents

Use `--endpoint` to test any HTTP-accessible agent:

```bash
agentspec run --endpoint https://my-agent.example.com/chat
```

AgentSpec POSTs `{input: "..."}` to your endpoint and expects `{output: "..."}` in the response.

## CI/CD integration

```bash
# Exit code 1 on failure
agentspec run --ci

# JUnit XML for CI systems
agentspec run --junit > results.xml

# JSON output
agentspec run --json
```

### GitHub Action

```yaml
- uses: agentspec/action@v1
  with:
    test-dir: tests
    format: junit
```

## CLI commands

```
agentspec run [--dir tests] [--ci] [--json] [--junit] [--watch] [--test "pattern"]
agentspec init
agentspec list [--dir tests]
agentspec version
```

## Why AgentSpec?

| Problem | AgentSpec |
|---------|-----------|
| Agent behavior changes with model updates | Regression tests catch the shift |
| "It worked yesterday" debugging | Diff reports show what changed |
| Manual testing before each deploy | CI/CD gates with `--ci` exit codes |
| Jest/Vitest don't handle non-deterministic output | `contains_any`, `regex`, `llm_judge`, `semantically_similar` |
| No CI integration for AI features | GitHub Action + JUnit XML |

## Roadmap

- [x] YAML test definitions
- [x] Core assertions (contains, not_contains, contains_any, contains_all, regex)
- [x] Metadata assertions (max_latency_ms, max_tokens, tool_called)
- [x] Semantic similarity (word overlap)
- [x] JSON path assertions
- [x] CLI with run/init/list commands
- [x] CI mode with exit codes
- [x] JUnit XML and JSON output
- [x] Test filtering
- [x] GitHub Action
- [x] **Behavior diff reports** — see what changed between runs
- [x] **LLM-as-judge** — use a local model (Ollama) to evaluate output quality
- [x] **HTTP agent adapter** — test real agents via `--endpoint`
- [ ] Auto-test generation from conversation history
- [ ] Python agent support
- [ ] Watch mode with file watcher
- [ ] Web dashboard
- [ ] GitHub PR integration (comment on PRs with behavior diffs)

## Part of the AI Dev Workflow Stack

AgentSpec is one tool in a three-part observability stack for AI development:

| Tool | What it does | Install |
|------|-------------|---------|
| **AgentSpec** | Test AI agent behavior — catch regressions before production | `npm i -g @ozperium/agentspec` |
| **[AICostTracker](https://github.com/Ozperium/aicost-tracker)** | Track token usage and costs across projects | `npm i -g @ozperium/aicost-tracker` |
| **[quota](https://github.com/Ozperium/quota)** | Monitor AI rate limits — know what's left before it stops you | `npm i -g @ozperium/quota` |

## License

MIT