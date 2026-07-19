# Contributing to AgentSpec

Thanks for your interest in AgentSpec! This is an early-stage project and contributions are welcome.

## Ways to contribute

- **Bug reports** — open an issue with steps to reproduce
- **Feature requests** — open an issue describing the use case
- **New assertions** — add assertion types that solve real testing problems
- **Agent adapters** — add adapters for popular agent frameworks (LangChain, Vercel AI SDK, etc.)
- **Examples** — add example test suites for common agent patterns
- **Docs** — improve README, add guides, fix typos

## Development setup

```bash
git clone https://github.com/Ozperium/agentspec.git
cd agentspec
npm install
npm run build
node dist/cli.js run --dir tests
```

## Project structure

```
src/
├── types/          # Type definitions
├── assertions/      # Assertion engine
├── loader.ts        # YAML test suite parser
├── runner.ts        # Test runner + MockAgent
├── http-agent.ts    # HTTP agent adapter
├── llm-judge.ts     # LLM-as-judge (OpenAI-compatible)
├── diff.ts          # Behavior diff engine
├── reporter.ts      # Output formatting (text, JSON, JUnit)
├── cli.ts           # CLI entry point
└── index.ts         # Public API
```

## Adding a new assertion

1. Add the type to `src/types/index.ts` (TestExpect interface)
2. Implement the check in `src/assertions/index.ts`
3. Add a test case in `tests/self-test.yaml`
4. Update README with the new assertion

## License

MIT — contributions are accepted under the same license.