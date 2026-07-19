import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { AgentRunner, AgentOutput, TestSuite } from './runner';

export interface HTTPAgentConfig {
  endpoint: string;       // POST endpoint that accepts {input, ...} and returns {output, tokens?, toolsCalled?}
  headers?: Record<string, string>;
  timeout_ms?: number;   // default: 60000
  input_field?: string;   // default: "input"
  output_field?: string;  // default: "output" or "text" or "response"
}

export class HTTPAgent implements AgentRunner {
  config: HTTPAgentConfig;

  constructor(config: HTTPAgentConfig) {
    this.config = config;
  }

  async run(input: string, suite: TestSuite): Promise<AgentOutput> {
    const endpoint = this.config.endpoint;
    const timeout = this.config.timeout_ms || 60000;
    const inputField = this.config.input_field || 'input';
    const body = JSON.stringify({ [inputField]: input, ...(suite.agent || {}) });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    try {
      const response = await this.httpRequest(endpoint, body, headers, timeout);
      const outputField = this.config.output_field || 'output';
      const text = response[outputField] || response.text || response.response || JSON.stringify(response);
      return {
        text: typeof text === 'string' ? text : JSON.stringify(text),
        tokens: response.tokens || response.usage?.total_tokens,
        latencyMs: response.latency_ms,
        toolsCalled: response.tools_called || response.toolsCalled || [],
      };
    } catch (e) {
      throw new Error(`HTTP agent error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private httpRequest(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              // Non-JSON response — return as text
              resolve({ output: data });
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Agent request timeout'));
      });

      req.write(body);
      req.end();
    });
  }
}