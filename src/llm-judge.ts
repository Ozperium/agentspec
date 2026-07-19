import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface LLMJudgeConfig {
  endpoint?: string;  // OpenAI-compatible endpoint (default: http://127.0.0.1:11434/v1/chat/completions for Ollama)
  model?: string;      // Model name (default: qwen2.5:7b or similar small local model)
  api_key?: string;    // Optional API key
  timeout_ms?: number; // Request timeout (default: 30000)
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';
const DEFAULT_MODEL = 'qwen2.5:7b';
const DEFAULT_TIMEOUT = 30000;

export async function llmJudge(
  input: string,
  output: string,
  criteria: string,
  config?: LLMJudgeConfig
): Promise<{ passed: boolean; score: number; reasoning: string }> {
  const endpoint = config?.endpoint || DEFAULT_ENDPOINT;
  const model = config?.model || DEFAULT_MODEL;
  const timeout = config?.timeout_ms || DEFAULT_TIMEOUT;
  const apiKey = config?.api_key;

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
    max_tokens: 200,
  });

  try {
    const response = await httpRequest(endpoint, body, apiKey, timeout);
    const text = response.choices?.[0]?.message?.content || '';
    // Parse JSON from response (LLMs sometimes wrap in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { passed: false, score: 0, reasoning: `Judge returned non-JSON: ${text.substring(0, 100)}` };
    }
    const result = JSON.parse(jsonMatch[0]);
    return {
      passed: !!result.passed,
      score: typeof result.score === 'number' ? result.score : (result.passed ? 1.0 : 0.0),
      reasoning: result.reasoning || 'No reasoning provided',
    };
  } catch (e) {
    return {
      passed: false,
      score: 0,
      reasoning: `Judge error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function httpRequest(url: string, body: string, apiKey: string | undefined, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
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