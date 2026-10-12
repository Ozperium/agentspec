const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const cli = path.resolve(__dirname, '../dist/cli.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-cli-'));
function run(args) {
  return new Promise(resolve => execFile(process.execPath, [cli, ...args], { cwd: root, timeout: 10000 }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
}
(async () => {
  try {
    assert.equal((await run(['--help'])).code, 0);
    assert.equal((await run(['--version'])).code, 0);
    for (const args of [['init', '--help'], ['list', '--help'], ['version', '--help']]) {
      const help = await run(args);
      assert.equal(help.code, 0, `${args.join(' ')} should be accepted`);
      assert.equal(fs.existsSync(path.join(root, 'tests', 'getting-started.yaml')), false, `${args.join(' ')} must not create an init file`);
    }
    assert.equal((await run(['init'])).code, 0);
    const version = await run(['version']);
    assert.equal(version.stdout.trim(), `agentspec v${require('../package.json').version}`);
    const existing = path.join(root, 'tests', 'getting-started.yaml');
    const original = fs.readFileSync(existing, 'utf8');
    assert.equal((await run(['init'])).code, 1, 'init must not overwrite existing tests');
    assert.equal(fs.readFileSync(existing, 'utf8'), original);
    for (const args of [
      ['list', '--unknown-option'],
      ['list', '--dir'],
      ['list', 'extra'],
      ['init', 'extra'],
      ['version', '--unknown-option'],
      ['version', 'extra'],
      ['--help', 'extra'],
      ['--version', 'extra'],
    ]) {
      const invalid = await run(args);
      assert.equal(invalid.code, 1, `invalid non-run CLI must fail: ${args.join(' ')}`);
    }
    assert.equal((await run(['rn', '--mock', '--ci'])).code, 1, 'misspelled commands must not return a successful help screen');
    const implicit = await run(['run', '--ci']);
    assert.notEqual(implicit.code, 0, 'CI must not silently choose a mock agent');
    assert.match(implicit.stderr, /endpoint|agent|mock/);
    const demo = await run(['run', '--mock', '--ci', '--json']);
    assert.equal(demo.code, 0, demo.stderr);
    assert.equal(JSON.parse(demo.stdout).passed, 1);
    assert.equal(fs.existsSync(path.join(root, '.agentspec', 'baseline.json')), false);
    const accepted = await run(['run', '--mock', '--update-baseline', '--json']);
    assert.equal(accepted.code, 0, accepted.stderr);
    const baselinePath = path.join(root, '.agentspec', 'baseline.json');
    assert.ok(fs.existsSync(baselinePath), 'baseline acceptance must be explicit and available');
    const before = fs.readFileSync(baselinePath, 'utf8');
    const suitePath = path.join(root, 'tests', 'getting-started.yaml');
    fs.writeFileSync(suitePath, fs.readFileSync(suitePath, 'utf8').replace('contains: "hello"', 'contains: "absent"'));
    for (let i = 0; i < 2; i++) {
      const failed = await run(['run', '--mock', '--json']);
      assert.equal(failed.code, 1, 'test failures exit nonzero even outside CI');
      assert.equal(JSON.parse(failed.stdout).diffs[0].status, 'regression');
      assert.equal(fs.readFileSync(baselinePath, 'utf8'), before);
    }
    const badUpdate = await run(['run', '--mock', '--update-baseline', '--json']);
    assert.equal(badUpdate.code, 1);
    assert.equal(fs.readFileSync(baselinePath, 'utf8'), before);
    fs.writeFileSync(suitePath, fs.readFileSync(suitePath, 'utf8').replace('contains: "absent"', 'contains: "hello"'));
    for (const args of [
      ['run', '--mock', '--unknown-option'],
      ['run', '--mock', '--dir'],
      ['run', '--mock', '--endpoint'],
      ['run', '--mock', '--json', '--junit'],
      ['run', '--mock', '--update-baseline', '--test', 'greeting'],
      ['run', '--mock', '--update-baseline', '--watch'],
      ['run', '--mock', '--dir', 'missing'],
    ]) {
      const invalid = await run(args);
      assert.equal(invalid.code, 1, `invalid CLI must fail without hanging: ${args.join(' ')}`);
    }
    fs.writeFileSync(suitePath, fs.readFileSync(suitePath, 'utf8').replace('contains: "absent"', 'contains: "hello"'));
    const modulePath = path.join(root, 'agent.cjs');
    fs.writeFileSync(modulePath, 'module.exports = { run: async input => ({ text: "hello module", tokens: 0, toolsCalled: [] }) };');
    const moduleRun = await run(['run', '--agent', modulePath, '--json']);
    assert.equal(moduleRun.code, 0, moduleRun.stderr);
    assert.equal(JSON.parse(moduleRun.stdout).results[0].output, 'hello module');
    fs.writeFileSync(modulePath, 'module.exports = {};');
    assert.notEqual((await run(['run', '--agent', modulePath])).code, 0);
    console.log('CLI checks passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
