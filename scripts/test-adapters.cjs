const assert = require('node:assert/strict');
const http = require('node:http');
const { VercelAIAgent } = require('../dist/vercel-agent');
const { HTTPAgent } = require('../dist/http-agent');

const emptySuite = { agent: {} };

async function rejectsWith(promise, pattern) {
  await assert.rejects(promise, error => {
    assert.match(String(error && error.message), pattern);
    return true;
  });
}

async function testVercelContracts() {
  const agent = new VercelAIAgent({
    timeoutMs: 100,
    generate: async () => ({
      text: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalUsage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
      steps: [
        { toolCalls: [{ toolName: 'lookup' }] },
        { toolCalls: [{ toolName: 'lookup' }, { toolName: 'write' }] },
      ],
    }),
  });
  const output = await agent.run('input', emptySuite);
  assert.equal(output.text, '', 'empty Vercel text is valid');
  assert.equal(output.tokens, 9, 'totalUsage wins for multi-step output');
  assert.deepEqual(output.toolsCalled, ['lookup', 'write'], 'Vercel tools are deduplicated across steps');

  const zero = await new VercelAIAgent({
    generate: async () => ({ text: 'zero', usage: { totalTokens: 0 }, toolCalls: [] }),
  }).run('input', emptySuite);
  assert.equal(zero.tokens, 0, 'numeric zero token usage is preserved');
  assert.deepEqual(zero.toolsCalled, [], 'an explicit empty tool list is known');

  const unknown = await new VercelAIAgent({ generate: async () => ({ text: 'unknown' }) }).run('input', emptySuite);
  assert.equal(Object.prototype.hasOwnProperty.call(unknown, 'tokens'), false, 'missing Vercel usage stays unknown');
  assert.equal(Object.prototype.hasOwnProperty.call(unknown, 'toolsCalled'), false, 'missing Vercel tools stay unknown');

  const streamed = await new VercelAIAgent({
    generate: () => ({
      text: Promise.resolve('streamed'),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
    }),
  }).run('input', emptySuite);
  assert.equal(streamed.text, 'streamed', 'awaitable streamText text is supported');
  assert.equal(streamed.tokens, 3, 'awaitable streamText usage is supported');

  await rejectsWith(
    new VercelAIAgent({ generate: async () => ({}) }).run('input', emptySuite),
    /malformed response|text/
  );
  await rejectsWith(
    new VercelAIAgent({ generate: async () => ({ text: 123 }) }).run('input', emptySuite),
    /text/
  );
  await rejectsWith(
    new VercelAIAgent({ generate: async () => ({ text: 'bad', usage: { totalTokens: '0' } }) }).run('input', emptySuite),
    /usage/
  );
  await rejectsWith(
    new VercelAIAgent({ generate: async () => ({ text: 'bad', usage: { totalTokens: 'bad' }, totalUsage: { totalTokens: 1 } }) }).run('input', emptySuite),
    /totalUsage|usage/
  );
  await rejectsWith(
    new VercelAIAgent({ generate: async () => ({ text: 'bad', toolCalls: [{ toolName: 7 }] }) }).run('input', emptySuite),
    /tool/
  );
  await rejectsWith(
    new VercelAIAgent({ generate: async () => ({ text: 'bad', toolCalls: null }) }).run('input', emptySuite),
    /tool/
  );
  await rejectsWith(
    new VercelAIAgent({ generate: async () => ({ text: 'bad', steps: null }) }).run('input', emptySuite),
    /steps/
  );
  await rejectsWith(
    new VercelAIAgent({ generate: async () => { throw new Error('provider failed'); } }).run('input', emptySuite),
    /provider failed/
  );

  const started = Date.now();
  await new VercelAIAgent({
    timeoutMs: 1000,
    generate: async () => ({ text: 'fast' }),
  }).run('input', emptySuite);
  assert.ok(Date.now() - started < 300, 'successful Vercel calls clean up their timeout timer');

  await rejectsWith(
    new VercelAIAgent({
      timeoutMs: 10,
      generate: () => new Promise(() => {}),
    }).run('input', emptySuite),
    /timeout/
  );
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ output: 'late' }));
      }, 100);
      return;
    }
    if (url.pathname === '/too-large') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(10 * 1024 * 1024 + 1));
      return;
    }
    if (url.pathname === '/status') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: 'do not accept this' }));
      return;
    }
    if (url.pathname === '/text') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('plain text');
      return;
    }
    if (url.pathname === '/missing') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'not an adapter response' }));
      return;
    }
    if (url.pathname === '/error-json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'application failed' }));
      return;
    }
    if (url.pathname === '/invalid') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: 'ok', tokens: '0' }));
      return;
    }
    if (url.pathname === '/invalid-usage') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: 'ok', tokens: 0, usage: { total_tokens: 'bad' } }));
      return;
    }
    if (url.pathname === '/invalid-tools') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: 'ok', tools_called: [], toolsCalled: [7] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: '', tokens: 0, toolsCalled: [], latency_ms: 0 }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function testHttpContracts() {
  const server = await startServer();
  const port = server.address().port;
  const endpoint = path => `http://127.0.0.1:${port}${path}`;
  try {
    const empty = await new HTTPAgent({ endpoint: endpoint('/') }).run('input', emptySuite);
    assert.equal(empty.text, '', 'empty HTTP output is valid');
    assert.equal(empty.tokens, 0, 'numeric zero HTTP tokens are preserved');
    assert.deepEqual(empty.toolsCalled, [], 'explicit empty HTTP tools are known');
    assert.equal(empty.latencyMs, 0, 'numeric zero HTTP latency is preserved');

    const plain = await new HTTPAgent({ endpoint: endpoint('/text') }).run('input', emptySuite);
    assert.equal(plain.text, 'plain text', 'successful non-JSON text remains supported');

    const missing = await new HTTPAgent({ endpoint: endpoint('/missing') }).run('input', emptySuite).catch(error => error);
    assert.match(missing.message, /output|response|malformed/i, 'missing JSON output is an error');
    await rejectsWith(new HTTPAgent({ endpoint: endpoint('/error-json') }).run('input', emptySuite), /application failed|error/);
    await rejectsWith(new HTTPAgent({ endpoint: endpoint('/status') }).run('input', emptySuite), /500/);
    await rejectsWith(new HTTPAgent({ endpoint: endpoint('/invalid') }).run('input', emptySuite), /tokens|invalid/);
    await rejectsWith(new HTTPAgent({ endpoint: endpoint('/invalid-usage') }).run('input', emptySuite), /usage|invalid/);
    await rejectsWith(new HTTPAgent({ endpoint: endpoint('/invalid-tools') }).run('input', emptySuite), /tools|invalid/);
    await rejectsWith(new HTTPAgent({ endpoint: 'ftp://127.0.0.1:1/invalid' }).run('input', emptySuite), /protocol|http|https/);
    await rejectsWith(new HTTPAgent({ endpoint: endpoint('/slow'), timeout_ms: 10 }).run('input', emptySuite), /timeout/);
    await rejectsWith(new HTTPAgent({ endpoint: endpoint('/too-large') }).run('input', emptySuite), /10MB|size|large/);

    const unknown = await new HTTPAgent({ endpoint: endpoint('/text') }).run('input', emptySuite);
    assert.equal(Object.prototype.hasOwnProperty.call(unknown, 'tokens'), false, 'missing HTTP usage stays unknown');
    assert.equal(Object.prototype.hasOwnProperty.call(unknown, 'toolsCalled'), false, 'missing HTTP tools stay unknown');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function testCurrentSdkIfRequested() {
  const verifyDir = process.env.AGENTSPEC_AI_VERIFY_DIR;
  if (!verifyDir) return;

  const { pathToFileURL } = require('node:url');
  const ai = await import(pathToFileURL(require('node:path').join(verifyDir, 'node_modules/ai/dist/index.js')).href);
  const testApi = await import(pathToFileURL(require('node:path').join(verifyDir, 'node_modules/ai/dist/test/index.js')).href);
  const model = new testApi.MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: 'sdk output' }],
      finishReason: 'stop',
      usage: {
        inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 3, text: 3, reasoning: 0 },
      },
      warnings: [],
    },
  });
  const output = await new VercelAIAgent({
    generate: input => ai.generateText({ model, prompt: input }),
  }).run('sdk prompt', emptySuite);
  assert.equal(output.text, 'sdk output');
  assert.equal(output.tokens, 5);

  const streamModel = new testApi.MockLanguageModelV4({
    doStream: {
      stream: testApi.convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'stream output' },
        { type: 'text-end', id: 'text-1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 2, text: 2, reasoning: 0 },
          },
        },
      ]),
    },
  });
  const streamed = await new VercelAIAgent({
    generate: input => ai.streamText({ model: streamModel, prompt: input }),
  }).run('sdk prompt', emptySuite);
  assert.equal(streamed.text, 'stream output');
  assert.equal(streamed.tokens, 3);
  console.log(`Current ai SDK ${require(require('node:path').join(verifyDir, 'node_modules/ai/package.json')).version} generateText/streamText(MockLanguageModelV4) verified; this used mock provider output, not model inference`);
}

(async () => {
  await testVercelContracts();
  await testHttpContracts();
  await testCurrentSdkIfRequested();
  console.log('Adapter contract checks passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
