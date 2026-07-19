import { AgentRunner, AgentOutput, TestSuite } from './runner';

/**
 * LangChain agent adapter.
 * 
 * Usage:
 *   import { LangChainAgent } from '@ozperium/agentspec';
 *   import { AgentExecutor } from 'langchain/agents';
 *   
 *   const executor = new AgentExecutor({ ... });
 *   const agent = new LangChainAgent(executor);
 *   const { runAll } = require('@ozperium/agentspec');
 *   const result = await runAll('./tests', agent);
 * 
 * The adapter calls executor.invoke({ input }) and extracts the output.
 */

export interface LangChainAgentConfig {
  /** The LangChain AgentExecutor or any object with an invoke({input}) method */
  executor: { invoke: (input: { input: string }) => Promise<Record<string, unknown>> };
  /** Field name to extract from the executor response (default: "output") */
  outputField?: string;
  /** Field name for intermediate steps (to extract tool calls) */
  intermediateStepsField?: string;
  /** Timeout in ms (default: 60000) */
  timeoutMs?: number;
}

export class LangChainAgent implements AgentRunner {
  config: LangChainAgentConfig;

  constructor(config: LangChainAgentConfig) {
    this.config = config;
  }

  async run(input: string, suite: TestSuite): Promise<AgentOutput> {
    const startTime = Date.now();
    const outputField = this.config.outputField || 'output';
    const timeoutMs = this.config.timeoutMs || 60000;

    try {
      const result = await Promise.race([
        this.config.executor.invoke({ input }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`LangChain agent timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      const text = String(result[outputField] || '');
      const latencyMs = Date.now() - startTime;

      // Extract tool calls from intermediate steps if available
      const steps = result[this.config.intermediateStepsField || 'intermediateSteps'] as Array<Record<string, unknown>> | undefined;
      const toolsCalled: string[] = [];
      if (Array.isArray(steps)) {
        for (const step of steps) {
          const action = step.action || step.message_log;
          if (action && typeof action === 'object' && 'tool' in action) {
            toolsCalled.push(String((action as Record<string, unknown>).tool));
          }
        }
      }

      return {
        text,
        latencyMs,
        toolsCalled,
      };
    } catch (e) {
      throw new Error(`LangChain agent error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}