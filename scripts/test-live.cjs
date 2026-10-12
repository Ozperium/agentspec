const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAll, setLLMJudgeConfig } = require('../dist');
const agent = require('../examples/ollama-agent.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-live-'));
  try {
    setLLMJudgeConfig({
      endpoint: process.env.AGENTSPEC_JUDGE_ENDPOINT || 'http://127.0.0.1:11434/v1/chat/completions',
      model: process.env.AGENTSPEC_JUDGE_MODEL || process.env.AGENTSPEC_MODEL || 'llama3.2:3b',
    });
    const positive = await runAll(path.join(__dirname, '../examples/ollama-tests'), agent);
    console.log(JSON.stringify({ kind: 'live-positive', ...positive }, null, 2));
    assert.equal(positive.total, 3);
    assert.equal(positive.failed, 0, 'real local model smoke failed');
    fs.writeFileSync(path.join(root, 'negative.yaml'), `name: negative-judge-control
tests:
  - name: rejects a factually wrong acceptance criterion
    input: What is the capital of Poland? Reply in one short sentence.
    expect:
      llm_judge: The answer must state that Berlin is the capital of Poland, not Warsaw.
`);
    const negative = await runAll(root, agent);
    console.log(JSON.stringify({ kind: 'live-negative-control', ...negative }, null, 2));
    assert.equal(negative.total, 1);
    assert.equal(negative.failed, 1, 'judge must reject the deliberately wrong criterion');
    assert.equal(negative.results[0].error, undefined, 'negative control must fail by judgment, not an infrastructure error');
    assert.equal(negative.results[0].assertions[0].assertion, 'llm_judge');
    assert.doesNotMatch(negative.results[0].assertions[0].message, /Judge error|Judge response invalid|invalid judge configuration|Request timeout/, 'negative control must produce a valid verdict');
    console.log('Live local-model smoke passed: 3 accepted cases and 1 valid rejected negative control');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
