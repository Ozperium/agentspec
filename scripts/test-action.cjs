const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parse } = require('yaml');
const repo = path.resolve(__dirname, '..');
const action = parse(fs.readFileSync(path.join(repo, 'action.yml'), 'utf8'));
assert.equal(action.inputs['node-version']?.default, '24', 'the default action runtime must support the verified AI SDK 7 prerequisite (Node >=22)');
assert.equal(action.runs.steps.find(step => step.name === 'Setup Node.js').with['node-version'], '${{ inputs.node-version }}');
assert.equal(action.runs.steps.some(step => step.run?.includes('npm install -g')), false, 'Action must run its checked-out version, not a stale registry package');
const validationIndex = action.runs.steps.findIndex(step => step.name === 'Validate fail-on-failure');
assert.ok(validationIndex >= 0, 'Action must prevalidate fail-on-failure');
const validationStep = action.runs.steps[validationIndex];
assert.equal(validationStep['continue-on-error'], undefined, 'fail-on-failure validation must be gating');
assert.ok(validationStep.run.includes('AGENTSPEC_FAIL_ON_FAILURE'), 'validation must inspect the raw explicit environment value');
const runStep = action.runs.steps.find(step => step.name === 'Run AgentSpec tests');
assert.equal(runStep['continue-on-error'], "${{ inputs.fail-on-failure == 'false' }}", 'only canonical false may make the test step non-gating');
function runValidation(value) {
  return spawnSync('bash', ['-euo', 'pipefail', '-c', validationStep.run], {
    encoding: 'utf8',
    env: { ...process.env, AGENTSPEC_FAIL_ON_FAILURE: value },
  });
}
for (const value of ['FALSE', 'tru', '0']) {
  assert.equal(runValidation(value).status, 1, `invalid fail-on-failure must fail before the test step: ${value}`);
}
assert.equal(runValidation('true').status, 0);
assert.equal(runValidation('false').status, 0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-action-'));
fs.mkdirSync(path.join(root, 'tests'));
fs.writeFileSync(path.join(root, 'tests', 'suite.yaml'), 'name: action\ntests:\n  - name: real agent\n    input: hello\n    expect:\n      contains: real\n');
const modulePath = path.join(root, 'agent with spaces.cjs');
fs.writeFileSync(modulePath, 'module.exports = { run: async () => ({ text: "real answer" }) };');
function run(overrides) {
  return spawnSync(process.execPath, [path.join(repo, 'scripts', 'run-action.cjs')], { cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env, AGENTSPEC_TEST_DIR: 'tests', AGENTSPEC_FORMAT: 'json', AGENTSPEC_AGENT_ENDPOINT: '', AGENTSPEC_AGENT_MODULE: '', AGENTSPEC_MOCK: 'false', AGENTSPEC_FAIL_ON_FAILURE: 'true', ...overrides } });
}
try {
  const absent = run({});
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /agent|endpoint|mock/);
  const good = run({ AGENTSPEC_AGENT_MODULE: modulePath });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).passed, 1);
  for (const value of ['FALSE', 'tru', '0']) {
    const invalid = run({ AGENTSPEC_AGENT_MODULE: modulePath, AGENTSPEC_FAIL_ON_FAILURE: value });
    assert.equal(invalid.status, 1, `invalid fail-on-failure must fail directly: ${value}`);
    assert.match(invalid.stderr, /fail-on-failure/);
  }
  assert.equal(run({ AGENTSPEC_AGENT_MODULE: modulePath, AGENTSPEC_FAIL_ON_FAILURE: 'false' }).status, 0);
  assert.equal(run({ AGENTSPEC_AGENT_MODULE: modulePath, AGENTSPEC_MOCK: 'true' }).status, 1);
  assert.equal(run({ AGENTSPEC_AGENT_MODULE: modulePath, AGENTSPEC_FORMAT: 'bogus' }).status, 1);
  fs.writeFileSync(modulePath, 'module.exports = { run: async () => ({ text: "broken" }) };');
  const bad = run({ AGENTSPEC_AGENT_MODULE: modulePath });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).failed, 1);
  const badNonGating = run({ AGENTSPEC_AGENT_MODULE: modulePath, AGENTSPEC_FAIL_ON_FAILURE: 'false' });
  assert.equal(badNonGating.status, 1, 'false must not mask failures inside the wrapper');
  console.log('Action source and real-agent checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
