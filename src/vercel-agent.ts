import { AgentRunner, AgentOutput, TestSuite } from './runner';

type Awaitable<T> = T | PromiseLike<T>;

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
};

type ToolCall = { toolName: string };

type VercelResult = {
  text?: Awaitable<string>;
  output?: Awaitable<unknown>;
  usage?: Awaitable<TokenUsage | undefined>;
  totalUsage?: Awaitable<TokenUsage | undefined>;
  toolCalls?: Awaitable<ToolCall[]>;
  steps?: Awaitable<Array<{ toolCalls?: Awaitable<ToolCall[]> }>>;
};

/**
 * Vercel AI SDK agent adapter.
 *
 * Usage:
 *   import { VercelAIAgent } from '@ozperium/agentspec';
 *   import { generateText } from 'ai';
 *   import { openai } from '@ai-sdk/openai';
 *
 *   const agent = new VercelAIAgent({
 *     generate: (input) => generateText({
 *       model: openai('gpt-4o'),
 *       prompt: input,
 *     })
 *   });
 *   const { runAll } = require('@ozperium/agentspec');
 *   const result = await runAll('./tests', agent);
 */

export interface VercelAIAgentConfig {
  /** Function that calls generateText (or streamText) with the input and returns the result */
  generate: (input: string) => Awaitable<VercelResult>;
  /** Timeout in ms (default: 60000) */
  timeoutMs?: number;
}

export class VercelAIAgent implements AgentRunner {
  config: VercelAIAgentConfig;

  constructor(config: VercelAIAgentConfig) {
    this.config = config;
  }

  async run(input: string, _suite: TestSuite): Promise<AgentOutput> {
    const startTime = Date.now();
    const timeoutMs = this.config.timeoutMs ?? 60000;

    try {
      const result = await withTimeout(
        Promise.resolve(this.config.generate(input)).then(async rawResult => {
          if (!isRecord(rawResult)) {
            throw new Error('malformed response: expected an object');
          }
          return await normalizeResult(rawResult);
        }),
        timeoutMs,
        `Vercel AI SDK timeout after ${timeoutMs}ms`
      );

      const output: AgentOutput = {
        text: result.text,
        latencyMs: Date.now() - startTime,
      };
      if (result.tokens !== undefined) output.tokens = result.tokens;
      if (result.toolsCalled !== undefined) output.toolsCalled = result.toolsCalled;
      return output;
    } catch (e) {
      throw new Error(`Vercel AI SDK error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function normalizeResult(result: Record<string, unknown>): Promise<{
  text: string;
  tokens?: number;
  toolsCalled?: string[];
}> {
  let text: string | undefined;
  if ('text' in result) {
    const value = await result.text;
    if (typeof value !== 'string') throw new Error('invalid text: expected a string');
    text = value;
  }
  if (text === undefined && 'output' in result) {
    const value = await result.output;
    if (typeof value !== 'string') throw new Error('invalid output: expected a string');
    text ??= value;
  }
  if (text === undefined) {
    throw new Error('malformed response: missing text');
  }

  const usage = 'usage' in result ? await result.usage : undefined;
  const totalUsage = 'totalUsage' in result ? await result.totalUsage : undefined;
  const normalizedUsage = usage === undefined ? undefined : validateUsage(usage, 'usage');
  const normalizedTotalUsage = totalUsage === undefined ? undefined : validateUsage(totalUsage, 'totalUsage');
  const selectedUsage = normalizedTotalUsage ?? normalizedUsage;
  const tokens = selectedUsage === undefined ? undefined : tokenCount(selectedUsage);

  const names: string[] = [];
  let toolsKnown = false;
  if ('toolCalls' in result) {
    addToolCalls(await result.toolCalls, names, 'toolCalls');
    toolsKnown = true;
  }
  if ('steps' in result) {
    const steps = await result.steps;
    if (!Array.isArray(steps)) throw new Error('invalid steps: expected an array');
    for (const step of steps) {
      if (!isRecord(step)) throw new Error('invalid step: expected an object');
      if ('toolCalls' in step) {
        addToolCalls(await step.toolCalls, names, 'step toolCalls');
        toolsKnown = true;
      }
    }
  }

  return {
    text,
    ...(tokens === undefined ? {} : { tokens }),
    ...(toolsKnown ? { toolsCalled: names } : {}),
  };
}

function validateUsage(value: unknown, label: string): TokenUsage {
  if (!isRecord(value)) throw new Error(`invalid ${label}: expected an object`);
  const usage: TokenUsage = {};
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'promptTokens', 'completionTokens'] as const) {
    if (field in value && value[field] !== undefined) {
      if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0 || !Number.isInteger(value[field])) {
        throw new Error(`invalid ${label}.${field}: expected a non-negative integer`);
      }
      usage[field] = value[field];
    }
  }
  return usage;
}

function tokenCount(usage: TokenUsage): number | undefined {
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    return usage.inputTokens + usage.outputTokens;
  }
  if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
    return usage.promptTokens + usage.completionTokens;
  }
  return undefined;
}

function addToolCalls(value: unknown, names: string[], label: string): void {
  if (!Array.isArray(value)) throw new Error(`invalid ${label}: expected an array`);
  for (const toolCall of value) {
    if (!isRecord(toolCall) || typeof toolCall.toolName !== 'string' || toolCall.toolName.length === 0) {
      throw new Error(`invalid ${label}: expected tool calls with string toolName`);
    }
    if (!names.includes(toolCall.toolName)) names.push(toolCall.toolName);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
