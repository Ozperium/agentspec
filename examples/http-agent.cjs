// Local HTTP fixture for the AgentSpec quick start. No model or network access.
const http = require('node:http');

const port = Number(process.env.PORT || 3000);

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/chat') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'POST /chat only' }));
    return;
  }

  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    try {
      const { input } = JSON.parse(body);
      if (typeof input !== 'string') throw new Error('input must be a string');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ output: `hello from the HTTP fixture: ${input}` }));
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Expected JSON with a string input' }));
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`AgentSpec HTTP fixture listening at http://127.0.0.1:${port}/chat`);
});
