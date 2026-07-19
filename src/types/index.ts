export interface TestExpect {
  contains?: string;
  not_contains?: string;
  contains_any?: string[];
  contains_all?: string[];
  regex?: string;
  tool_called?: string;
  max_latency_ms?: number;
  max_tokens?: number;
  json_path?: string;
  json_value?: unknown;
  llm_judge?: string;
  semantically_similar?: string;
  min_confidence?: number;
  custom?: string;
}

export interface TestCase {
  name: string;
  input: string;
  expect: TestExpect;
  setup?: Record<string, unknown>;
}

export interface TestSuite {
  name: string;
  description?: string;
  agent?: AgentConfig;
  tests: TestCase[];
}

export interface AgentConfig {
  type: string;
  endpoint?: string;
  model?: string;
  system_prompt?: string;
  tools?: string[];
}

export interface AssertionResult {
  assertion: string;
  passed: boolean;
  message: string;
  expected?: string;
  actual?: string;
}

export interface TestResult {
  test: string;
  suite: string;
  passed: boolean;
  duration_ms: number;
  assertions: AssertionResult[];
  output?: string;
  error?: string;
}

export interface RunResult {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
  duration_ms: number;
}