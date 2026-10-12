# Changelog

## 0.2.0

### Breaking workflow changes

- Choose an agent explicitly: `--endpoint`, `--agent <module.cjs>`, or demo-only `--mock`. There is no silent mock fallback.
- Failed tests always return exit code 1. Empty runs, invalid flags and malformed/unsupported assertions fail rather than report success.
- Accept the complete baseline with `--update-baseline`. Normal runs never overwrite it; failing, filtered and watch-mode runs cannot replace it.
- Accepted baselines use `.agentspec/baseline.json`. Review and accept a new run to migrate from 0.1.x's last-run snapshots.
- Required token/tool metadata must be present. Missing evidence fails the relevant assertion.

### Reliability

- Strict judge verdict types, finite score range and non-empty reasoning; malformed output fails closed.
- HTTP failures cannot masquerade as successful model output; zero usage and empty output are preserved.
- Vercel adapter consumes current and legacy usage fields and supplied step tool names; timeout timers are cleared.
- LangChain rejects missing/non-string output instead of manufacturing empty text, preserves known empty output and clears timeout timers.
- JSON-path checks traverse only own JSON properties, not inherited prototype fields.
- Filtering happens before agent execution, avoiding unselected model calls and tool side effects.
- `init` does not overwrite existing tests; CLI version comes from package metadata.
- Watch reruns are serialized and recover from invalid suite edits.
- Programmatic assertion APIs reject unsupported/empty checks; synchronous checks do not silently skip an LLM judge.
- The GitHub Action builds its checked-out source and requires an explicit real target or intentional mock.

### Verification and examples

- Deterministic boundary, CLI, baseline and action tests; six expected-failure conformance fixtures.
- Clean tarball-install smoke exercises a local HTTP agent, repeated regression detection and JSON/JUnit output.
- Optional real local Ollama example with positive cases and a deliberately rejected judge criterion.

### Still out of scope

No built-in repeated-trial statistics, full trajectory/side-effect evaluation, calibrated confidence, hosted dashboard, or automatic test generation. `semantically_similar` remains word overlap, not embeddings.
