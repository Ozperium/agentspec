import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface LLMJudgeConfig {
  endpoint?: string;  // OpenAI-compatible endpoint (default: http://127.0.0.1:11434/v1/chat/completions for Ollama)
  model?: string;      // Model name (default: qwen2.5:7b or similar small local model)
  api_key?: string;    // Optional API key
  timeout_ms?: number; // Request timeout (default: 30000)
  max_tokens?: number; // Completion budget; must be at least 1500
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';
const DEFAULT_MODEL = 'qwen2.5:7b';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_TOKENS = 1500;

type JudgeResult = { passed: boolean; score: number; reasoning: string };

export async function llmJudge(
  input: string,
  output: string,
  criteria: string,
  config?: LLMJudgeConfig
): Promise<JudgeResult> {
  const endpoint = config?.endpoint || DEFAULT_ENDPOINT;
  const model = config?.model || DEFAULT_MODEL;
  const timeout = config?.timeout_ms ?? DEFAULT_TIMEOUT;
  const maxTokens = config?.max_tokens ?? DEFAULT_MAX_TOKENS;
  const apiKey = config?.api_key;

  if (!isPositiveFiniteNumber(timeout) || !isPositiveIntegerAtLeast(maxTokens, DEFAULT_MAX_TOKENS)) {
    return invalidJudge('invalid judge configuration: timeout_ms must be positive and max_tokens must be an integer >= 1500');
  }

  const systemPrompt = `You are a test judge. Evaluate whether the AI agent's response meets the criteria.

Input given to agent: "${input}"
Agent's response: "${output}"
Criteria: "${criteria}"

Respond with ONLY a JSON object:
{"passed": true/false, "score": 0.0-1.0, "reasoning": "brief explanation"}`;

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Evaluate: does the response meet the criteria?` }
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  });

  try {
    const response = await httpRequest(endpoint, body, apiKey, timeout);
    const text = extractJudgeContent(response);
    return parseJudgeResult(text);
  } catch (e) {
    return invalidJudge(`Judge error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function extractJudgeContent(response: unknown): string {
  if (!isRecord(response)) {
    throw new Error('judge response must be an object');
  }
  const choices = response.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new Error('judge response is missing choices[0]');
  }
  const message = choices[0].message;
  if (!isRecord(message) || typeof message.content !== 'string') {
    throw new Error('judge response is missing a string message.content');
  }
  return message.content;
}

function parseJudgeResult(content: string): JudgeResult {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return invalidJudge('Judge response invalid: empty content');
  }

  let jsonText = trimmed;
  const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenced) {
    jsonText = fenced[1].trim();
  } else if (trimmed.includes('```')) {
    return invalidJudge('Judge response invalid: code fences must contain exactly one JSON object and no surrounding text');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return invalidJudge(`Judge response invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!isRecord(parsed)) {
    return invalidJudge('Judge response invalid: verdict must be a JSON object');
  }
  if (typeof parsed.passed !== 'boolean') {
    return invalidJudge('Judge response invalid: passed must be boolean');
  }
  if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score) || parsed.score < 0 || parsed.score > 1) {
    return invalidJudge('Judge response invalid: score must be a finite number between 0 and 1');
  }
  if (typeof parsed.reasoning !== 'string' || parsed.reasoning.trim().length === 0) {
    return invalidJudge('Judge response invalid: reasoning must be a non-empty string');
  }

  return {
    passed: parsed.passed,
    score: parsed.score,
    reasoning: parsed.reasoning.trim(),
  };
}

function invalidJudge(reason: string): JudgeResult {
  return { passed: false, score: 0, reasoning: reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveIntegerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

function httpRequest(url: string, body: string, apiKey: string | undefined, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(new Error(`invalid judge endpoint: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            reject(new Error(`judge endpoint returned HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}
