import { AgentRunner, AgentOutput, TestSuite } from './runner';

/**
 * LangChain agent adapter.
 * 
 * Usage:
 *   import { LangChainAgent } from '@ozperium/agentspec';
 *   import { AgentExecutor } from 'langchain/agents';
 *   
 *   const executor = new AgentExecutor({ ... });
 *   const agent = new LangChainAgent({ executor });
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
    const outputField = this.config.outputField ?? 'output';
    const stepsField = this.config.intermediateStepsField ?? 'intermediateSteps';
    const timeoutMs = this.config.timeoutMs ?? 60000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const operation = Promise.resolve().then(() => this.config.executor.invoke({ input }));
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`LangChain agent timeout after ${timeoutMs}ms`)), timeoutMs);
      });
      const result = await Promise.race([operation, timeout]);

      if (result === null || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('LangChain agent response must be an object');
      }
      if (!Object.prototype.hasOwnProperty.call(result, outputField) || typeof result[outputField] !== 'string') {
        throw new Error(`LangChain agent response field "${outputField}" must be a string`);
      }
      const text = result[outputField];
      const latencyMs = Date.now() - startTime;
      const output: AgentOutput = { text, latencyMs };

      if (Object.prototype.hasOwnProperty.call(result, stepsField)) {
        const rawSteps = result[stepsField];
        if (!Array.isArray(rawSteps)) {
          throw new Error(`LangChain agent ${stepsField} must be an array`);
        }
        const toolsCalled: string[] = [];
        for (const step of rawSteps) {
          if (step === null || typeof step !== 'object' || Array.isArray(step)) {
            throw new Error(`LangChain agent ${stepsField} contains an invalid step`);
          }
          const stepRecord = step as Record<string, unknown>;
          const action = stepRecord.action ?? stepRecord.message_log;
          if (action === null || typeof action !== 'object' || Array.isArray(action)) {
            throw new Error(`LangChain agent ${stepsField} contains an invalid action`);
          }
          const actionRecord = action as Record<string, unknown>;
          if (!Object.prototype.hasOwnProperty.call(actionRecord, 'tool') || typeof actionRecord.tool !== 'string') {
            throw new Error(`LangChain agent ${stepsField} contains an invalid tool`);
          }
          toolsCalled.push(actionRecord.tool);
        }
        output.toolsCalled = toolsCalled;
      }

      return output;
    } catch (e) {
      throw new Error(`LangChain agent error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}