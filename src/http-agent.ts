import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { AgentRunner, AgentOutput, TestSuite } from './runner';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

type JSONRecord = Record<string, unknown>;

type RawResponse = {
  statusCode: number;
  body: string;
  contentType: string;
};

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
    const timeout = this.config.timeout_ms ?? 60000;
    const inputField = this.config.input_field ?? 'input';

    try {
      const body = JSON.stringify({ ...(suite.agent || {}), [inputField]: input });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };
      const response = await this.httpRequest(this.config.endpoint, body, headers, timeout);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`HTTP response status ${response.statusCode}`);
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(response.body);
      } catch {
        if (/\b(?:application\/json|[^\s;]+\+json)\b/i.test(response.contentType)) {
          throw new Error('malformed JSON response from agent endpoint');
        }
        // A successful non-JSON response is a valid plain-text adapter response.
        return { text: response.body };
      }

      return normalizeResponse(decoded, this.config.output_field ?? 'output');
    } catch (e) {
      throw new Error(`HTTP agent error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private httpRequest(endpoint: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(endpoint);
      } catch {
        reject(new Error('invalid endpoint URL'));
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new Error(`unsupported endpoint protocol: ${parsed.protocol || '(missing)'}`));
        return;
      }

      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        reject(error);
      };
      const succeed = (value: RawResponse): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(value);
      };

      try {
        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
          },
          res => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', chunk => {
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              size += buffer.byteLength;
              if (size > MAX_RESPONSE_BYTES) {
                fail(new Error('response exceeds 10MB limit'));
                req.destroy();
                res.destroy();
                return;
              }
              chunks.push(buffer);
            });
            res.on('error', error => fail(error instanceof Error ? error : new Error(String(error))));
            res.on('end', () => {
              succeed({
                statusCode: res.statusCode ?? 0,
                contentType: res.headers['content-type'] ?? '',
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          }
        );

        req.on('error', error => fail(error instanceof Error ? error : new Error(String(error))));
        req.setTimeout(timeoutMs, () => req.destroy(new Error('Agent request timeout')));
        timer = setTimeout(() => req.destroy(new Error('Agent request timeout')), timeoutMs);
        req.write(body);
        req.end();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

function normalizeResponse(value: unknown, outputField: string): AgentOutput {
  if (!isRecord(value)) {
    throw new Error('malformed JSON response: expected an object with output');
  }
  if ('error' in value && value.error !== undefined) {
    if (typeof value.error !== 'string') throw new Error('invalid error: expected a string');
    throw new Error(value.error);
  }

  let text: string | undefined;
  for (const field of [outputField, 'text', 'response']) {
    if (hasOwn(value, field)) {
      if (typeof value[field] !== 'string') throw new Error(`invalid ${field}: expected a string`);
      text = value[field];
      break;
    }
  }
  if (text === undefined) throw new Error('malformed JSON response: missing output');

  const tokens = readTokens(value);
  const toolsCalled = readTools(value);
  const latencyMs = readLatency(value);
  return {
    text,
    ...(tokens === undefined ? {} : { tokens }),
    ...(toolsCalled === undefined ? {} : { toolsCalled }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
  };
}

function readTokens(value: JSONRecord): number | undefined {
  const explicit = hasOwn(value, 'tokens') ? validateToken(value.tokens, 'tokens') : undefined;
  if (!hasOwn(value, 'usage')) return explicit;
  const usage = value.usage;
  if (!isRecord(usage)) throw new Error('invalid usage: expected an object');
  const fields = ['total_tokens', 'totalTokens', 'input_tokens', 'output_tokens', 'inputTokens', 'outputTokens', 'prompt_tokens', 'completion_tokens'] as const;
  for (const field of fields) {
    if (hasOwn(usage, field)) validateToken(usage[field], `usage.${field}`);
  }
  const total = usage.total_tokens ?? usage.totalTokens;
  if (total !== undefined) return explicit ?? (total as number);
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  if (input !== undefined && output !== undefined) return explicit ?? ((input as number) + (output as number));
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  if (prompt !== undefined && completion !== undefined) return explicit ?? ((prompt as number) + (completion as number));
  return explicit;
}

function readTools(value: JSONRecord): string[] | undefined {
  const hasSnake = hasOwn(value, 'tools_called');
  const hasCamel = hasOwn(value, 'toolsCalled');
  const snake = hasSnake ? validateTools(value.tools_called, 'tools_called') : undefined;
  const camel = hasCamel ? validateTools(value.toolsCalled, 'toolsCalled') : undefined;
  if (hasSnake) return snake;
  if (hasCamel) return camel;
  return undefined;
}

function readLatency(value: JSONRecord): number | undefined {
  if (!hasOwn(value, 'latency_ms')) return undefined;
  const latency = value.latency_ms;
  if (typeof latency !== 'number' || !Number.isFinite(latency) || latency < 0) {
    throw new Error('invalid latency_ms: expected a non-negative finite number');
  }
  return latency;
}

function validateToken(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`invalid ${label}: expected a non-negative integer`);
  }
  return value;
}

function validateTools(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(tool => typeof tool !== 'string')) {
    throw new Error(`invalid ${label}: expected an array of strings`);
  }
  return value as string[];
}

function isRecord(value: unknown): value is JSONRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: JSONRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
