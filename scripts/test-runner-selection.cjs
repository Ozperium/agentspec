const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAll } = require('../dist/runner');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-runner-'));
const calls = [];
const agent = { run: async input => { calls.push(input); return { text: input }; } };
fs.writeFileSync(path.join(root, 'suite.yaml'), `name: support
tests:
  - name: selected
    input: selected
    expect:
      contains: selected
  - name: excluded
    input: excluded
    expect:
      contains: excluded
`);
(async () => {
  try {
    const result = await runAll(root, agent, '^selected$');
    assert.equal(result.total, 1);
    assert.deepEqual(calls, ['selected'], 'filtered tests must not execute or incur model/tool side effects');
    await assert.rejects(() => runAll(root, agent, 'absent'), /no.*test|matched/i);
    await assert.rejects(() => runAll(path.join(root, 'missing'), agent), /no.*suite|no.*test/i);
    fs.writeFileSync(path.join(root, 'metadata.yaml'), 'name: metadata\ntests:\n  - name: requires output\n    input: hello\n    expect:\n      max_latency_ms: 1000\n');
    const missingText = await runAll(root, { run: async () => ({ latencyMs: 0 }) }, '^metadata$');
    assert.equal(missingText.failed, 1, 'metadata-only contracts still require a valid agent output');
    assert.match(missingText.results[0].error, /text|output/i);
    console.log('Runner selection checks passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
