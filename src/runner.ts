import { TestResult, RunResult, TestSuite } from './types';
export { TestSuite } from './types';
import { evaluateAssertions } from './assertions';
import { loadTestSuite, findTestSuites } from './loader';
import * as path from 'path';

export interface AgentRunner {
  run(input: string, suite: TestSuite): Promise<AgentOutput>;
}

export interface AgentOutput {
  text: string;
  tokens?: number;
  latencyMs?: number;
  toolsCalled?: string[];
}

export async function runSuite(
  suitePath: string,
  agent: AgentRunner
): Promise<TestResult[]> {
  const suite = loadTestSuite(suitePath);
  const results: TestResult[] = [];

  for (const test of suite.tests) {
    const startTime = Date.now();
    try {
      const output = await agent.run(test.input, suite);
      const durationMs = Date.now() - startTime;
      const assertions = evaluateAssertions(output.text, test.expect, {
        tokens: output.tokens,
        latencyMs: durationMs,
        toolsCalled: output.toolsCalled,
      });
      const passed = assertions.every(a => a.passed);
      results.push({
        test: test.name,
        suite: suite.name,
        passed,
        duration_ms: durationMs,
        assertions,
        output: output.text,
      });
    } catch (e) {
      const durationMs = Date.now() - startTime;
      results.push({
        test: test.name,
        suite: suite.name,
        passed: false,
        duration_ms: durationMs,
        assertions: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}

export async function runAll(
  dir: string,
  agent: AgentRunner,
  filter?: string | null
): Promise<RunResult> {
  const suites = findTestSuites(dir);
  const allResults: TestResult[] = [];
  const startTime = Date.now();

  for (const suitePath of suites) {
    let suiteResults = await runSuite(suitePath, agent);
    if (filter) {
      const re = new RegExp(filter);
      suiteResults = suiteResults.filter(r => re.test(r.test) || re.test(r.suite));
    }
    allResults.push(...suiteResults);
  }

  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.length - passed;

  return {
    total: allResults.length,
    passed,
    failed,
    results: allResults,
    duration_ms: Date.now() - startTime,
  };
}

// Built-in mock agent for testing AgentSpec itself
export class MockAgent implements AgentRunner {
  responses: Record<string, string> = {};
  echo: boolean = false;

  constructor(responses?: Record<string, string>, echo?: boolean) {
    this.responses = responses || {
      default: "Hello! I'm a mock agent. I can help with that.",
    };
    this.echo = echo || false;
  }

  async run(input: string, suite: TestSuite): Promise<AgentOutput> {
    await new Promise(resolve => setTimeout(resolve, 10));
    const text = this.echo ? input : (this.responses[input] || this.responses.default);
    return {
      text,
      latencyMs: 10,
      tokens: Math.ceil(text.length / 4),
      toolsCalled: [],
    };
  }
}