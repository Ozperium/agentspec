const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-watch-'));
fs.mkdirSync(path.join(root, 'tests'));
const file = path.join(root, 'tests/suite.yaml');
const good = 'name: watch\ntests:\n  - name: greeting\n    input: hello\n    expect:\n      contains: hello\n';
fs.writeFileSync(file, good);
const child = spawn(process.execPath, [path.resolve(__dirname, '../dist/cli.js'), 'run', '--mock', '--watch'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
let history = '';
child.stdout.on('data', data => { output += data; history += data; });
child.stderr.on('data', data => { output += data; history += data; });
function waitFor(pattern) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`watch output timed out: ${output}`)); }, 5000);
    const onData = () => { if (pattern.test(output)) { cleanup(); resolve(); } };
    const onExit = () => { cleanup(); reject(new Error(`watch process exited before recovery: ${history}`)); };
    function cleanup() { clearTimeout(timer); child.stdout.off('data', onData); child.stderr.off('data', onData); child.off('exit', onExit); }
    child.stdout.on('data', onData); child.stderr.on('data', onData); child.once('exit', onExit); onData();
  });
}
(async () => {
  try {
    await waitFor(/Watching for changes/);
    output = '';
    fs.writeFileSync(file, 'name: broken\ntests: []\n');
    await waitFor(/Invalid test suite/);
    output = '';
    fs.writeFileSync(file, good);
    await waitFor(/1 passed/);
    assert.equal(child.exitCode, null);
    console.log('Watch invalid-suite recovery passed');
  } finally {
    if (child.exitCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exit;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
