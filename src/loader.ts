import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { TestSuite } from './types';

const SUITE_KEYS = new Set(['name', 'description', 'agent', 'tests']);
const TEST_KEYS = new Set(['name', 'input', 'expect', 'setup']);
const EXPECTATION_KEYS = new Set([
  'contains',
  'not_contains',
  'contains_any',
  'contains_all',
  'regex',
  'tool_called',
  'max_latency_ms',
  'max_tokens',
  'json_path',
  'json_value',
  'llm_judge',
  'semantically_similar',
  'min_confidence',
  'custom',
]);

export function loadTestSuite(filePath: string): TestSuite {
  const content = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    throw new Error(`Invalid test suite ${filePath}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateSuite(parsed, filePath);
  return parsed as TestSuite;
}

function validateSuite(value: unknown, filePath: string): asserts value is TestSuite {
  const suite = asRecord(value, `Invalid test suite ${filePath}: suite must be a mapping`);
  rejectUnknownKeys(suite, SUITE_KEYS, `Invalid test suite ${filePath}`);
  requireNonEmptyString(suite.name, `Invalid test suite ${filePath}: name must be a non-empty string`);
  if (suite.description !== undefined && typeof suite.description !== 'string') {
    throw new Error(`Invalid test suite ${filePath}: description must be a string`);
  }
  if (suite.agent !== undefined && !isRecord(suite.agent)) {
    throw new Error(`Invalid test suite ${filePath}: agent must be a mapping`);
  }
  if (!Array.isArray(suite.tests) || suite.tests.length === 0) {
    throw new Error(`Invalid test suite ${filePath}: tests must contain at least one test`);
  }

  suite.tests.forEach((test, index) => validateTest(test, `${filePath} test ${index + 1}`));
}

function validateTest(value: unknown, context: string): void {
  const test = asRecord(value, `Invalid ${context}: test must be a mapping`);
  rejectUnknownKeys(test, TEST_KEYS, `Invalid ${context}`);
  requireNonEmptyString(test.name, `Invalid ${context}: name must be a non-empty string`);
  if (typeof test.input !== 'string') {
    throw new Error(`Invalid ${context}: input must be a string`);
  }
  const expect = asRecord(test.expect, `Invalid ${context}: expect must be a mapping`);
  validateExpect(expect, context);
  if (test.setup !== undefined && !isRecord(test.setup)) {
    throw new Error(`Invalid ${context}: setup must be a mapping`);
  }
}

export function validateExpect(expect: Record<string, unknown>, context: string): void {
  if (Object.keys(expect).length === 0) {
    throw new Error(`Invalid ${context}: expect must contain at least one assertion`);
  }
  for (const key of Object.keys(expect)) {
    if (!EXPECTATION_KEYS.has(key)) {
      throw new Error(`Invalid ${context}: unknown expectation key "${key}"`);
    }
    if (key === 'custom') {
      throw new Error(`Invalid ${context}: unsupported custom assertion; use a supported expectation key`);
    }
  }

  for (const key of ['contains', 'not_contains', 'regex', 'tool_called', 'json_path', 'llm_judge', 'semantically_similar']) {
    if (expect[key] !== undefined) {
      requireNonEmptyString(expect[key], `Invalid ${context}: ${key} must be a non-empty string`);
    }
  }
  for (const key of ['contains_any', 'contains_all']) {
    if (expect[key] !== undefined && (!Array.isArray(expect[key]) || expect[key].length === 0 || expect[key].some(value => typeof value !== 'string' || value.length === 0))) {
      throw new Error(`Invalid ${context}: ${key} must be a non-empty array of non-empty strings`);
    }
  }
  for (const key of ['max_latency_ms', 'max_tokens']) {
    if (expect[key] !== undefined && !isFiniteNonNegative(expect[key])) {
      throw new Error(`Invalid ${context}: ${key} must be a finite non-negative number`);
    }
  }
  if (expect.min_confidence !== undefined && (!isFiniteNonNegative(expect.min_confidence) || expect.min_confidence > 1)) {
    throw new Error(`Invalid ${context}: min_confidence must be a finite number between 0 and 1`);
  }
  if (expect.json_value !== undefined && expect.json_path === undefined) {
    throw new Error(`Invalid ${context}: json_value requires json_path`);
  }
  if (expect.min_confidence !== undefined && expect.semantically_similar === undefined) {
    throw new Error(`Invalid ${context}: min_confidence requires semantically_similar`);
  }
  if (!Object.keys(expect).some(key => key !== 'min_confidence' && key !== 'json_value' && expect[key] !== undefined)) {
    throw new Error(`Invalid ${context}: expect must contain at least one effective assertion`);
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${context}: unknown key "${key}"`);
  }
}

function requireNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function findTestSuites(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestSuites(fullPath));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      files.push(fullPath);
    }
  }
  return files;
}