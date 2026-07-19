Show HN: AgentSpec — Testing framework for AI agents (Jest for non-deterministic behavior)

Hi HN,

I built AgentSpec because AI agents are non-deterministic, and existing test tools (Jest, Vitest, Playwright) aren't designed for that. When you change a prompt, swap a model, or update a tool definition, the agent's behavior shifts in ways you can't catch with exact string matching.

AgentSpec is a CLI testing framework with assertions designed for AI output:

- `contains` / `not_contains` — substring checks
- `contains_any` / `contains_all` — flexible multi-string matching
- `regex` — pattern matching (e.g., error codes, IDs)
- `tool_called` — verify specific tools were invoked
- `max_latency_ms` / `max_tokens` — performance and cost gates
- `semantically_similar` — word-overlap similarity (no API needed, works offline)
- `json_path` — extract and verify fields from JSON agent output

Tests are defined in YAML:

```yaml
name: "support agent"
tests:
  - name: "handles expired token"
    input: "my token expired"
    expect:
      contains: "refresh token"
      not_contains: "I don't know"
      max_latency_ms: 5000
```

CI/CD integration: exit codes, JUnit XML, JSON output, and a GitHub Action. Drop it into any CI pipeline.

It's local-first — no cloud, no account, no telemetry. Tests run on your machine.

The current version uses a mock agent for demonstration. To test real agents, you implement the `AgentRunner` interface (a single `run(input) → output` method) and pass it to the test runner. I'm working on built-in adapters for common agent frameworks (LangChain, Vercel AI SDK, custom HTTP endpoints) for the next release.

MIT licensed, npm installable, TypeScript.

Repo: https://github.com/Ozperium/agentspec
npm: https://www.npmjs.com/package/agentspec

What's on the roadmap:
- Diff reports (show what changed between passing and failing runs)
- LLM-as-judge assertion (with local model support via Ollama)
- Auto-test generation from conversation history
- Built-in agent adapters (LangChain, Vercel AI SDK, HTTP)

I'd love feedback on:
1. Is YAML the right format, or would you prefer TS test definitions?
2. What assertions are you missing for your AI agents?
3. Would you use the LLM-as-judge feature with a local model?