const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveRun, computeDiffs, loadPreviousRun } = require('../dist/diff');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-workflow-'));
const cwd = process.cwd();
const good = { suite: 'support', test: 'refund', passed: true, output: 'approved', duration_ms: 1, assertions: [] };
const bad = { ...good, passed: false, output: 'rejected' };
try {
  process.chdir(root);
  saveRun([good]);
  saveRun([{ suite: 'minimal', test: 'shape', passed: true, output: 'accepted' }]);
  assert.equal(loadPreviousRun('minimal', 'shape').output, 'accepted', 'StoredRun fields are sufficient for public JS callers');
  saveRun([good]);
  assert.throws(() => saveRun([bad]), /passing|failed/i, 'failed runs must not overwrite an accepted baseline');
  assert.equal(loadPreviousRun('support', 'refund').output, 'approved');
  for (let i = 0; i < 2; i++) {
    assert.equal(computeDiffs([bad])[0].status, 'regression');
  }
  const collisionA = { ...good, suite: 'support!', output: 'first' };
  const collisionB = { ...good, suite: 'support?', output: 'second' };
  saveRun([collisionA, collisionB]);
  assert.equal(loadPreviousRun('support!', 'refund').output, 'first', 'distinct suite names must not collide');
  assert.equal(loadPreviousRun('support?', 'refund').output, 'second');
  assert.equal(loadPreviousRun('support', 'refund'), null, 'explicit update replaces the accepted test roster');
  const baselinePath = path.join(root, '.agentspec', 'baseline.json');
  const before = fs.readFileSync(baselinePath, 'utf8');
  for (const malformed of [
    { ...collisionA, suite: '' },
    { ...collisionA, test: '' },
    { ...collisionA, output: undefined },
    { ...collisionA, wake: 7 },
  ]) {
    assert.throws(() => saveRun([malformed]), /baseline/i, 'malformed public rows must be rejected');
    assert.equal(fs.readFileSync(baselinePath, 'utf8'), before, 'rejected rows must not replace the accepted baseline');
  }
  assert.throws(() => saveRun([{ suite: 'support', test: 'refund', passed: true }]), /baseline/i);
  assert.equal(fs.readFileSync(baselinePath, 'utf8'), before);
  assert.throws(() => saveRun([collisionA, collisionA]), /duplicate/i);
  assert.equal(fs.readFileSync(baselinePath, 'utf8'), before);
  const validBaseline = JSON.parse(before);
  const malformedBaselines = [
    { ...validBaseline, timestamp: undefined },
    { ...validBaseline, timestamp: 'not-a-timestamp' },
    { ...validBaseline, version: undefined },
    { ...validBaseline, version: 2 },
    { ...validBaseline, results: undefined },
    { ...validBaseline, results: [{ ...validBaseline.results[0], timestamp: undefined }] },
    { ...validBaseline, results: [{ ...validBaseline.results[0], timestamp: 'invalid' }] },
    { ...validBaseline, results: [{ ...validBaseline.results[0], suite: '' }] },
    { ...validBaseline, results: [{ ...validBaseline.results[0], test: '' }] },
    { ...validBaseline, results: [{ ...validBaseline.results[0], wake: 7 }] },
  ];
  for (const malformed of malformedBaselines) {
    fs.writeFileSync(baselinePath, JSON.stringify(malformed));
    assert.throws(() => computeDiffs([good]), /baseline/i, 'malformed accepted baselines must fail validation');
  }
  console.log('Workflow baseline checks passed');
} finally {
  process.chdir(cwd);
  fs.rmSync(root, { recursive: true, force: true });
}
