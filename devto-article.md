---
title: "Testing AI Agents with AgentSpec: Jest for Non-Deterministic Behavior"
published: false
description: "AI agents are non-deterministic. When you change a prompt or swap a model, behavior shifts. Here's how to catch those shifts before they reach production."
tags: ai, testing, agents, devtools
cover_image: ""
---

AI agents are non-deterministic. This is both their superpower and their biggest testing challenge.

When you change a prompt, swap a model, or update a tool definition, the agent's behavior shifts in ways you can't predict. Traditional test tools (Jest, Vitest, Playwright) are built for deterministic code — they expect exact string matching. AI agents don't work that way.

Last week, I changed a system prompt in a support agent. It still passed all our Jest tests (the function still returned a string). But the agent had stopped offering password reset help — a regression that only surfaced when a user complained.

That's why I built [AgentSpec](https://github.com/Ozperium/agentspec).

## What is AgentSpec?

AgentSpec is a testing framework designed specifically for AI agents. It provides assertions that handle non-deterministic output, behavior diff reports that show what changed, and CI/CD integration out of the box.

## Assertions for AI output

Instead of exact string matching, AgentSpec provides assertions that work with the variability of AI responses:

```yaml
# agentspec.yaml
name: "support agent"
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
      contains_any: ["billing", "refund", "support team"]
      tool_called: "transfer_to_billing"

  - name: "response is on-topic"
    input: "how do I reset my password?"
    expect:
      semantically_similar: "reset password credentials"
      min_confidence: 0.5
```

Available assertions:
- **contains / not_contains** — substring checks
- **contains_any / contains_all** — flexible multi-string matching
- **regex** — pattern matching (error codes, IDs)
- **tool_called** — verify specific tools were invoked
- **max_latency_ms / max_tokens** — performance and cost gates
- **semantically_similar** — word-overlap similarity (no API needed)
- **json_path** — extract and verify fields from JSON agent output
- **llm_judge** — use a local LLM to evaluate output quality

## Behavior diff reports

This is the killer feature. AgentSpec stores the last passing output per test. When behavior changes, you see exactly what shifted:

```
⚠️ REGRESSION support agent > handles expired token
  ⚠  Behavior REGRESSED — test was passing, now failing
  + added: your, token, has, expired, please, contact, support
  - removed: you, need, refresh, the, token, settings, security
```

Instead of just knowing a test failed, you know WHAT changed. This turns debugging from "what broke?" into "the model stopped saying 'refresh token' and started saying 'renew credentials'."

## LLM-as-judge with local models

The most powerful assertion is `llm_judge` — use an LLM to evaluate whether a response meets quality criteria that can't be expressed as string matching:

```yaml
tests:
  - name: "response is helpful"
    input: "How do I reset my password?"
    expect:
      llm_judge: "The response should explain how to reset a password"
```

By default, AgentSpec uses a local Ollama model as the judge — no API costs, no data leaving your machine:

```bash
agentspec run --judge-endpoint http://127.0.0.1:11434/v1/chat/completions --judge-model qwen2.5:7b
```

## Testing real agents

AgentSpec includes an HTTP agent adapter to test any HTTP-accessible AI agent:

```bash
agentspec run --endpoint https://my-agent.example.com/chat
```

It POSTs `{input: "..."}` to your endpoint and reads the response. Works with any agent that exposes an HTTP API.

## CI/CD integration

AgentSpec is designed to drop into any CI pipeline:

```bash
# Exit code 1 on failure
agentspec run --ci

# JUnit XML for CI systems
agentspec run --junit > results.xml
```

There's also a GitHub Action:

```yaml
- uses: agentspec/action@v1
  with:
    test-dir: tests
```

## Get started

```bash
npm install -g @ozperium/agentspec
agentspec init
agentspec run
```

That's it. YAML test definitions, assertions for non-deterministic output, diff reports, CI integration. No cloud, no account, no telemetry.

- **GitHub:** [Ozperium/agentspec](https://github.com/Ozperium/agentspec)
- **Landing:** [agentspec.pages.dev](https://agentspec.pages.dev)

I'd love feedback on:
1. Is YAML the right format, or would you prefer TS test definitions?
2. What assertions are you missing for your AI agents?
3. Would you use LLM-as-judge with a local model?