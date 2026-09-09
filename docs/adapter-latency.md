# Adapter-reported latency vs runner wallclock

AgentSpec evaluates latency checks (`max_latency_ms`) from two clocks:

1. **Adapter clock (`AgentOutput.latencyMs`)**: optional field returned by adapters.
   - When present, this is treated as the authoritative value for assertion checks.
   - It is validated for `number`, `finite`, and `>= 0`.
   - Invalid values fail the test with a captured execution error.

2. **Runner wallclock (`duration_ms`)**: measured by `Date.now()` in the suite runner around `agent.run`.
   - Stored in `TestResult.duration_ms`; `RunResult.duration_ms` measures the whole run, including assertions.
   - Used for reporting and for `max_latency_ms` only when `latencyMs` is absent.

Reason: adapter latency can include transport/model timing that differs from the local wrapper elapsed time.
The reported value is trusted when provided, but it is _not_ blindly accepted unless it is a valid number.
