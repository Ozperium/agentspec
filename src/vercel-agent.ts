import { AgentRunner, AgentOutput, TestSuite } from './runner';

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
  generate: (input: string) => Promise<{
    text?: string;
    output?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    toolCalls?: Array<{ toolName: string }>;
    finishReason?: string;
  }>;
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
    const timeoutMs = this.config.timeoutMs || 60000;

    try {
      const result = await Promise.race([
        this.config.generate(input),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Vercel AI SDK timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      const text = result.text || result.output || '';
      const latencyMs = Date.now() - startTime;

      const tokens = result.usage?.totalTokens
        ?? (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0);

      const toolsCalled: string[] = [];
      if (Array.isArray(result.toolCalls)) {
        for (const tc of result.toolCalls) {
          if (tc.toolName) toolsCalled.push(tc.toolName);
        }
      }

      return {
        text,
        latencyMs,
        tokens: tokens || undefined,
        toolsCalled,
      };
    } catch (e) {
      throw new Error(`Vercel AI SDK error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}