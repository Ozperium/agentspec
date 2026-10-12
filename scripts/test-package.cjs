const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, execFile } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-package-'));
const version = require('../package.json').version;
let response = { output: 'hello real agent', tokens: 0, tools_called: [] };
let requests = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    assert.equal(JSON.parse(body).input, 'hello');
    requests++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  });
});
(async () => {
  try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--silent', '--pack-destination', root], { cwd: repo, encoding: 'utf8', timeout: 60000 }))[0];
    assert.equal(packed.version, version);
    const files = packed.files.map(file => file.path);
    for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'examples/ollama-agent.cjs', 'examples/ollama-tests/live.yaml']) assert.ok(files.includes(required), `missing packed file: ${required}`);
    assert.ok(files.every(file => !file.startsWith('.agentspec/') && !file.startsWith('node_modules/') && !file.endsWith('.env')));
    execFileSync('npm', ['install', path.join(root, packed.filename), '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    const installed = path.join(root, 'node_modules/@ozperium/agentspec');
    const api = require(installed);
    for (const name of ['runAll', 'HTTPAgent', 'VercelAIAgent', 'saveRun']) assert.equal(typeof api[name], 'function');
    const cli = path.join(installed, 'dist/cli.js');
    const run = args => new Promise(resolve => execFile(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
    assert.equal((await run(['version'])).stdout.trim(), `agentspec v${version}`);
    assert.equal((await run(['init'])).code, 0);
    assert.equal((await run(['run', '--ci'])).code, 1, 'installed CLI must refuse an implicit mock');
    assert.equal((await run(['run', '--mock', '--json'])).code, 0);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const accepted = await run(['run', '--endpoint', endpoint, '--update-baseline', '--json']);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).passed, 1);
    const baselinePath = path.join(root, '.agentspec/baseline.json');
    const baseline = fs.readFileSync(baselinePath, 'utf8');
    response = { output: 'broken real agent', tokens: 0, tools_called: [] };
    for (let attempt = 0; attempt < 2; attempt++) {
      const broken = await run(['run', '--endpoint', endpoint, '--json']);
      assert.equal(broken.code, 1);
      assert.equal(JSON.parse(broken.stdout).failed, 1);
      assert.equal(JSON.parse(broken.stdout).diffs[0].status, 'regression');
      assert.equal(fs.readFileSync(baselinePath, 'utf8'), baseline);
    }
    response = { output: 'hello real agent' };
    const junit = await run(['run', '--endpoint', endpoint, '--junit']);
    assert.equal(junit.code, 0, junit.stderr);
    assert.ok(junit.stdout.startsWith('<?xml'));
    assert.match(junit.stdout, /tests="1" failures="0"/);
    assert.equal(requests, 4);
    console.log(`Package smoke passed: @ozperium/agentspec@${version}, clean install, real HTTP, repeated regression, JSON/JUnit, ${files.length} packed files`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
