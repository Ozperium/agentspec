const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runSuite } = require('../dist/runner');
const llmJudge = require('../dist/llm-judge');

const originalLlmJudge = llmJudge.llmJudge;
llmJudge.llmJudge = async () => ({ passed: true, score: 1, reasoning: 'stubbed judge' });

class FixedAgent {
  constructor(outputsByInput) {
    this.outputsByInput = outputsByInput;
  }

  async run(input) {
    return this.outputsByInput[input] ?? this.outputsByInput.default;
  }
}

function suiteYaml(name, tests) {
  const lines = [`name: ${JSON.stringify(name)}`, 'tests:'];

  for (const test of tests) {
    lines.push(`  - name: ${JSON.stringify(test.name)}`);
    lines.push(`    input: ${JSON.stringify(test.input)}`);
    lines.push('    expect:');
    lines.push(`      max_latency_ms: ${test.max_latency_ms}`);
    if (test.llm_judge) {
      lines.push(`      llm_judge: ${JSON.stringify(test.llm_judge)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function withStepClock(run, startMs, stepMs) {
  const originalNow = Date.now;
  let now = startMs;

  Date.now = () => {
    const value = now;
    now += stepMs;
    return value;
  };

  try {
    return await run();
  } finally {
    Date.now = originalNow;
  }
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-latency-'));

  try {
    const syncSuitePath = path.join(tempDir, 'sync-latency.yaml');
    const asyncSuitePath = path.join(tempDir, 'async-latency.yaml');

    fs.writeFileSync(
      syncSuitePath,
      suiteYaml('adapter-latency-sync', [
        {
          name: 'reported-latency-over-gate',
          input: 'reported-latency-over-gate',
          max_latency_ms: 1000,
        },
        {
          name: 'reported-latency-zero',
          input: 'reported-latency-zero',
          max_latency_ms: 0,
        },
        {
          name: 'missing-latency-uses-wallclock',
          input: 'missing-latency-uses-wallclock',
          max_latency_ms: 80,
        },
        {
          name: 'invalid-latency-null',
          input: 'invalid-latency-null',
          max_latency_ms: 1000,
        },
        {
          name: 'invalid-latency-string',
          input: 'invalid-latency-string',
          max_latency_ms: 1000,
        },
        {
          name: 'invalid-latency-nan',
          input: 'invalid-latency-nan',
          max_latency_ms: 1000,
        },
        {
          name: 'invalid-latency-infinity',
          input: 'invalid-latency-infinity',
          max_latency_ms: 1000,
        },
        {
          name: 'invalid-latency-negative',
          input: 'invalid-latency-negative',
          max_latency_ms: 1000,
        },
      ])
    );

    fs.writeFileSync(
      asyncSuitePath,
      suiteYaml('adapter-latency-async', [
        {
          name: 'async-reported-latency',
          input: 'async-reported-latency',
          max_latency_ms: 20,
          llm_judge: 'Should be semantically accurate',
        },
      ])
    );

    const syncAgent = new FixedAgent({
      'reported-latency-over-gate': { text: 'x', latencyMs: 5000, tokens: 1, toolsCalled: [] },
      'reported-latency-zero': { text: 'x', latencyMs: 0, tokens: 1, toolsCalled: [] },
      'missing-latency-uses-wallclock': { text: 'x', tokens: 1, toolsCalled: [] },
      'invalid-latency-null': { text: 'x', latencyMs: null, tokens: 1, toolsCalled: [] },
      'invalid-latency-string': { text: 'x', latencyMs: 'bad', tokens: 1, toolsCalled: [] },
      'invalid-latency-nan': { text: 'x', latencyMs: Number.NaN, tokens: 1, toolsCalled: [] },
      'invalid-latency-infinity': { text: 'x', latencyMs: Infinity, tokens: 1, toolsCalled: [] },
      'invalid-latency-negative': { text: 'x', latencyMs: -1, tokens: 1, toolsCalled: [] },
    });

    const asyncAgent = new FixedAgent({
      'async-reported-latency': { text: 'x', latencyMs: 10, tokens: 1, toolsCalled: [] },
    });

    const [
      overGate,
      zeroGate,
      wallclock,
      ...invalid
    ] = await withStepClock(() => runSuite(syncSuitePath, syncAgent), 1000, 50);

    assert.equal(overGate.passed, false, 'reported latency should be used for sync assertions');
    assert.equal(zeroGate.passed, true, 'reported zero should pass zero-latency gate');
    assert.equal(wallclock.passed, true, 'missing latency should use wallclock');
    assert.equal(wallclock.duration_ms, 50, 'duration_ms should be measured wrapper duration');
    assert.equal(overGate.duration_ms, 50, 'reported latency must not replace measured duration');
    assert.equal(zeroGate.duration_ms, 50, 'reported zero must not replace measured duration');
    assert.equal(overGate.assertions[0].actual, '5000ms');
    assert.equal(zeroGate.assertions[0].actual, '0ms');
    assert.equal(wallclock.assertions[0].actual, '50ms');
    assert.equal(invalid.length, 5, 'all invalid latency cases must execute');
    assert.ok(
      invalid.every(r => r.passed === false && typeof r.error === 'string' && r.error.includes('latencyMs')),
      'invalid latency values should fail with error'
    );

    const [asyncResult] = await withStepClock(() => runSuite(asyncSuitePath, asyncAgent), 5000, 50);
    assert.equal(asyncResult.passed, true, 'async assertions should use same resolved latency value');
    assert.equal(asyncResult.duration_ms, 50);
    assert.equal(asyncResult.assertions[0].actual, '10ms');
    assert.equal(asyncResult.assertions[1].assertion, 'llm_judge');

    console.log('Runner latency regression checks passed');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    llmJudge.llmJudge = originalLlmJudge;
  }
})();
