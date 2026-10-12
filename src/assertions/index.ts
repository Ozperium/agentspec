import { TestExpect, AssertionResult } from '../types';
import { llmJudge, LLMJudgeConfig } from '../llm-judge';
import { validateExpect } from '../loader';

// Global LLM judge config (can be set via CLI or env)
let globalLLMJudgeConfig: LLMJudgeConfig | undefined;

export function setLLMJudgeConfig(config: LLMJudgeConfig | undefined) {
  globalLLMJudgeConfig = config;
}

export function getLLMJudgeConfig(): LLMJudgeConfig | undefined {
  return globalLLMJudgeConfig;
}

function evaluateSynchronousAssertions(
  output: string,
  expect: TestExpect,
  metadata?: { tokens?: number; latencyMs?: number; toolsCalled?: string[] }
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Synchronous assertions only — llm_judge handled separately in evaluateAssertionsAsync

  if (expect.contains !== undefined) {
    const passed = output.includes(expect.contains);
    results.push({
      assertion: 'contains',
      passed,
      message: passed ? `Output contains "${expect.contains}"` : `Output does not contain "${expect.contains}"`,
      expected: expect.contains,
      actual: passed ? 'found' : 'not found',
    });
  }

  if (expect.not_contains !== undefined) {
    const passed = !output.includes(expect.not_contains);
    results.push({
      assertion: 'not_contains',
      passed,
      message: passed ? `Output does not contain "${expect.not_contains}"` : `Output contains "${expect.not_contains}"`,
      expected: `not "${expect.not_contains}"`,
      actual: passed ? 'absent' : 'present',
    });
  }

  if (expect.contains_any !== undefined) {
    const found = expect.contains_any.find(s => output.includes(s));
    const passed = !!found;
    results.push({
      assertion: 'contains_any',
      passed,
      message: passed ? `Output contains one of: "${found}"` : `Output contains none of: ${JSON.stringify(expect.contains_any)}`,
      expected: JSON.stringify(expect.contains_any),
      actual: found || 'none matched',
    });
  }

  if (expect.contains_all !== undefined) {
    const missing = expect.contains_all.filter(s => !output.includes(s));
    const passed = missing.length === 0;
    results.push({
      assertion: 'contains_all',
      passed,
      message: passed ? `Output contains all required strings` : `Missing: ${missing.join(', ')}`,
      expected: JSON.stringify(expect.contains_all),
      actual: passed ? 'all found' : `missing: ${missing.join(', ')}`,
    });
  }

  if (expect.regex !== undefined) {
    try {
      const re = new RegExp(expect.regex);
      const passed = re.test(output);
      results.push({
        assertion: 'regex',
        passed,
        message: passed ? `Output matches /${expect.regex}/` : `Output does not match /${expect.regex}/`,
        expected: `/${expect.regex}/`,
        actual: passed ? 'matched' : 'no match',
      });
    } catch (e) {
      results.push({
        assertion: 'regex',
        passed: false,
        message: `Invalid regex: ${expect.regex}`,
        expected: expect.regex,
        actual: 'invalid pattern',
      });
    }
  }

  if (expect.max_latency_ms !== undefined) {
    const latency = metadata?.latencyMs;
    const validThreshold = isFiniteNonNegative(expect.max_latency_ms);
    const validMetadata = isFiniteNonNegative(latency);
    const passed = validThreshold && validMetadata && latency <= expect.max_latency_ms;
    const message = !validThreshold
      ? `Invalid max_latency_ms expectation: ${String(expect.max_latency_ms)}`
      : !validMetadata
        ? `Latency metadata is missing or invalid: ${String(latency)}`
        : passed
          ? `Latency ${latency}ms ≤ ${expect.max_latency_ms}ms`
          : `Latency ${latency}ms > ${expect.max_latency_ms}ms`;
    results.push({
      assertion: 'max_latency_ms',
      passed,
      message,
      expected: `≤ ${expect.max_latency_ms}ms`,
      actual: latency === undefined ? 'missing' : `${String(latency)}ms`,
    });
  }

  if (expect.max_tokens !== undefined) {
    const tokens = metadata?.tokens;
    const validThreshold = isFiniteNonNegative(expect.max_tokens);
    const validMetadata = isFiniteNonNegative(tokens);
    const passed = validThreshold && validMetadata && tokens <= expect.max_tokens;
    const message = !validThreshold
      ? `Invalid max_tokens expectation: ${String(expect.max_tokens)}`
      : !validMetadata
        ? `Token metadata is missing or invalid: ${String(tokens)}`
        : passed
          ? `Tokens ${tokens} ≤ ${expect.max_tokens}`
          : `Tokens ${tokens} > ${expect.max_tokens}`;
    results.push({
      assertion: 'max_tokens',
      passed,
      message,
      expected: `≤ ${expect.max_tokens}`,
      actual: tokens === undefined ? 'missing' : String(tokens),
    });
  }

  if (expect.tool_called !== undefined) {
    const toolsCalled = metadata?.toolsCalled;
    const validMetadata = Array.isArray(toolsCalled) && toolsCalled.every(tool => typeof tool === 'string');
    const passed = validMetadata && toolsCalled.includes(expect.tool_called);
    results.push({
      assertion: 'tool_called',
      passed,
      message: !validMetadata
        ? 'Tool metadata is missing or invalid'
        : passed
          ? `Tool "${expect.tool_called}" was called`
          : `Tool "${expect.tool_called}" was not called. Called: ${toolsCalled.join(', ') || 'none'}`,
      expected: expect.tool_called,
      actual: !validMetadata
        ? 'missing or invalid'
        : passed
          ? 'called'
          : `not called (called: ${toolsCalled.join(', ') || 'none'})`,
    });
  }

  // json_path assertion: extract value from JSON output and compare
  if (expect.json_path !== undefined) {
    try {
      const json = JSON.parse(output);
      const value = extractJsonPath(json, expect.json_path);
      if (expect.json_value !== undefined) {
        const passed = JSON.stringify(value) === JSON.stringify(expect.json_value);
        results.push({
          assertion: 'json_path',
          passed,
          message: passed ? `json_path "${expect.json_path}" equals expected value` : `json_path "${expect.json_path}" mismatch`,
          expected: JSON.stringify(expect.json_value),
          actual: JSON.stringify(value),
        });
      } else {
        const passed = value !== undefined;
        results.push({
          assertion: 'json_path',
          passed,
          message: passed ? `json_path "${expect.json_path}" found` : `json_path "${expect.json_path}" not found`,
          expected: expect.json_path,
          actual: JSON.stringify(value),
        });
      }
    } catch (e) {
      results.push({
        assertion: 'json_path',
        passed: false,
        message: `Output is not valid JSON or path not found: ${e instanceof Error ? e.message : String(e)}`,
        expected: expect.json_path,
        actual: 'parse error',
      });
    }
  }

  // semantically_similar: check if output is semantically similar to expected (using simple word overlap as MVP)
  if (expect.semantically_similar !== undefined) {
    const similarity = wordSimilarity(output, expect.semantically_similar);
    const threshold = expect.min_confidence ?? 0.6;
    const passed = similarity >= threshold;
    results.push({
      assertion: 'semantically_similar',
      passed,
      message: passed ? `Similarity ${similarity.toFixed(2)} ≥ ${threshold}` : `Similarity ${similarity.toFixed(2)} < ${threshold}`,
      expected: `≥ ${threshold} similarity to "${expect.semantically_similar}"`,
      actual: similarity.toFixed(2),
    });
  }

  return results;
}

export function evaluateAssertions(
  output: string,
  expect: TestExpect,
  metadata?: { tokens?: number; latencyMs?: number; toolsCalled?: string[] }
): AssertionResult[] {
  validateExpect(expect as Record<string, unknown>, 'expectations');
  const results = evaluateSynchronousAssertions(output, expect, metadata);
  if (expect.llm_judge !== undefined) {
    results.push({ assertion: 'llm_judge', passed: false, message: 'Use evaluateAssertionsAsync for llm_judge' });
  }
  return results;
}

// Async version that supports llm_judge assertion
export async function evaluateAssertionsAsync(
  output: string,
  expect: TestExpect,
  input: string,
  metadata?: { tokens?: number; latencyMs?: number; toolsCalled?: string[] }
): Promise<AssertionResult[]> {
  validateExpect(expect as Record<string, unknown>, 'expectations');
  const results = evaluateSynchronousAssertions(output, expect, metadata);

  if (expect.llm_judge !== undefined) {
    try {
      const judgeResult = await llmJudge(input, output, expect.llm_judge, globalLLMJudgeConfig);
      results.push({
        assertion: 'llm_judge',
        passed: judgeResult.passed,
        message: judgeResult.passed
          ? `LLM judge passed (score: ${judgeResult.score.toFixed(2)}): ${judgeResult.reasoning}`
          : `LLM judge failed (score: ${judgeResult.score.toFixed(2)}): ${judgeResult.reasoning}`,
        expected: expect.llm_judge,
        actual: `score: ${judgeResult.score.toFixed(2)}`,
      });
    } catch (e) {
      results.push({
        assertion: 'llm_judge',
        passed: false,
        message: `LLM judge error: ${e instanceof Error ? e.message : String(e)}`,
        expected: expect.llm_judge,
        actual: 'error',
      });
    }
  }

  return results;
}

function extractJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of Array.from(wordsA)) {
    if (wordsB.has(w)) intersection++;
  }
  return (2 * intersection) / (wordsA.size + wordsB.size);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}