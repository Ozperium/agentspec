const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { llmJudge } = require('../dist/llm-judge');
const { evaluateAssertions } = require('../dist/assertions');
const { loadTestSuite } = require('../dist/loader');

async function withJudgeResponse(content, checkRequest, config = {}) {
  let requestError;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        if (checkRequest) checkRequest(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      } catch (error) {
        requestError = error;
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('request contract failed');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    const result = await llmJudge('input', 'output', 'criteria', {
      endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
      model: 'stub-model',
      timeout_ms: 1000,
      ...config,
    });
    if (requestError) throw requestError;
    return result;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function assertInvalidJudge(result, message) {
  assert.equal(result.passed, false, message);
  assert.equal(result.score, 0, `${message}: invalid result must have zero score`);
  assert.match(result.reasoning, /invalid|error/i, `${message}: diagnostic should be clear`);
}

function assertSuiteRejected(yaml, expectedMessage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentspec-contract-'));
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, yaml);
  try {
    assert.throws(() => loadTestSuite(file), new RegExp(expectedMessage, 'i'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const request = {};
  const stringBoolean = await withJudgeResponse(
    '{"passed":"false","score":0.9,"reasoning":"Looks acceptable"}'
  );
  assertInvalidJudge(stringBoolean, 'string passed must not be truthy');

  const validFalse = await withJudgeResponse(
    '{"passed":false,"score":0.2,"reasoning":"The response misses the required guidance."}',
    body => Object.assign(request, body)
  );
  assert.deepEqual(validFalse, {
    passed: false,
    score: 0.2,
    reasoning: 'The response misses the required guidance.',
  });
  assert.equal(request.max_tokens, 1500, 'default judge budget should be at least 1500');
  assert.doesNotMatch(request.messages[0].content, /Input given to agent|Agent's response/, 'candidate data must not be interpolated into system instructions');
  assert.deepEqual(JSON.parse(request.messages[1].content), { input: 'input', output: 'output' });

  const customRequest = {};
  const validTrueFenced = await withJudgeResponse(
    '```json\n{"passed":true,"score":1,"reasoning":"The response meets the criterion."}\n```',
    body => Object.assign(customRequest, body),
    { max_tokens: 2048 }
  );
  assert.deepEqual(validTrueFenced, {
    passed: true,
    score: 1,
    reasoning: 'The response meets the criterion.',
  });
  assert.equal(customRequest.max_tokens, 2048, 'configured judge budget should be forwarded');
  assertInvalidJudge(
    await withJudgeResponse('{"passed":true,"score":1,"reasoning":"not requested"}', undefined, { max_tokens: 1499 }),
    'too-small judge budget'
  );

  for (const [label, content] of [
    ['multiple JSON objects', '{"passed":true,"score":1,"reasoning":"one"} {"passed":false,"score":0,"reasoning":"two"}'],
    ['score above range', '{"passed":true,"score":1.1,"reasoning":"too high"}'],
    ['negative score', '{"passed":true,"score":-0.1,"reasoning":"too low"}'],
    ['missing score', '{"passed":true,"reasoning":"missing score"}'],
    ['non-string reasoning', '{"passed":true,"score":1,"reasoning":false}'],
    ['empty reasoning', '{"passed":true,"score":1,"reasoning":"   "}'],
    ['surrounding fence prose', 'Here is the verdict:\n```json\n{"passed":true,"score":1,"reasoning":"ok"}\n```'],
  ]) {
    assertInvalidJudge(await withJudgeResponse(content), label);
  }

  assert.throws(() => evaluateAssertions('answer', { contains_typo: 'answer' }), /unknown/i, 'programmatic callers must not silently drop unknown checks');
  assert.throws(() => evaluateAssertions('answer', {}), /assertion/i);
  assert.throws(() => evaluateAssertions('answer', { contains: undefined }), /assertion/i, 'optional undefined fields are not an effective assertion');
  const syncJudge = evaluateAssertions('answer', { llm_judge: 'be helpful' });
  assert.equal(syncJudge.length, 1);
  assert.equal(syncJudge[0].passed, false, 'the sync API must not pretend it evaluated an async judge');
  const missingTokens = evaluateAssertions('answer', { max_tokens: 10 });
  assert.equal(missingTokens.length, 1, 'max_tokens must not be skipped when metadata is absent');
  assert.equal(missingTokens[0].passed, false);
  assert.match(missingTokens[0].message, /token/i);

  const missingLatency = evaluateAssertions('answer', { max_latency_ms: 10 });
  assert.equal(missingLatency.length, 1, 'max_latency_ms must not be skipped when metadata is absent');
  assert.equal(missingLatency[0].passed, false);
  assert.match(missingLatency[0].message, /latenc/i);

  const missingTool = evaluateAssertions('answer', { tool_called: 'search' });
  assert.equal(missingTool.length, 1, 'tool_called must not be skipped when metadata is absent');
  assert.equal(missingTool[0].passed, false);
  assert.match(missingTool[0].message, /tool/i);

  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, '12']) {
    const result = evaluateAssertions('answer', { max_tokens: 10 }, { tokens: value });
    assert.equal(result.length, 1, `invalid token metadata ${String(value)} must be reported`);
    assert.equal(result[0].passed, false);
    assert.match(result[0].message, /token|invalid/i);
  }

  for (const pathName of ['__proto__', 'constructor', 'toString']) {
    const result = evaluateAssertions('{}', { json_path: pathName });
    assert.equal(result.length, 1);
    assert.equal(result[0].passed, false, `inherited JSON path ${pathName} must not pass`);
  }
  const explicitJsonKeys = evaluateAssertions(
    '{"constructor":{"__proto__":{"value":"ok"}},"items":["zero",{"toString":"yes"}]}',
    { json_path: 'constructor.__proto__.value', json_value: 'ok' },
  );
  assert.equal(explicitJsonKeys[0].passed, true, 'explicit JSON constructor and __proto__ keys remain valid');
  const arrayIndexPath = evaluateAssertions(
    '{"constructor":{"__proto__":{"value":"ok"}},"items":["zero",{"toString":"yes"}]}',
    { json_path: 'items.1.toString', json_value: 'yes' },
  );
  assert.equal(arrayIndexPath[0].passed, true, 'array index JSON paths remain valid');

  assertSuiteRejected('name: empty\ntests: []\n', 'at least one test');
  assertSuiteRejected(
    'name: bad\ntests:\n  - name: one\n    input: hi\n    expect:\n      contains_typo: hi\n',
    'unknown expectation key'
  );
  assertSuiteRejected(
    'name: custom\ntests:\n  - name: one\n    input: hi\n    expect:\n      custom: check\n',
    'unsupported custom'
  );
  assertSuiteRejected(
    'name: negative\ntests:\n  - name: one\n    input: hi\n    expect:\n      max_tokens: -1\n',
    'max_tokens.*non-negative'
  );

  const streamingServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const interval = setInterval(() => res.write(' '), 5);
    const finish = setTimeout(() => res.end('{}'), 150);
    res.on('close', () => { clearInterval(interval); clearTimeout(finish); });
  });
  await new Promise(resolve => streamingServer.listen(0, '127.0.0.1', resolve));
  try {
    const timed = await llmJudge('input', 'output', 'criteria', { endpoint: `http://127.0.0.1:${streamingServer.address().port}`, timeout_ms: 30 });
    assert.match(timed.reasoning, /Request timeout/, 'judge timeout must bound the whole request, not only idle sockets');
  } finally {
    await new Promise(resolve => streamingServer.close(resolve));
  }
  const badProtocol = await llmJudge('input', 'output', 'criteria', { endpoint: 'file:///tmp/unsupported' });
  assert.match(badProtocol.reasoning, /protocol|http.*https/i);
  console.log('Contract hardening checks passed');
}

main().catch(error => {
  console.error(`Contract hardening checks failed: ${error.message}`);
  process.exit(1);
});
