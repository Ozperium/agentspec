import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { TestResult } from './types';
import { StoredRun, DiffEntry } from './types/diff';

const STORE_DIR = '.agentspec';

export function ensureStoreDir(): string {
  const dir = path.join(process.cwd(), STORE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export class BaselineError extends Error {
  constructor(message: string) {
    super(`Baseline error: ${message}`);
    this.name = 'BaselineError';
  }
}

export function saveRun(results: TestResult[]): void {
  if (!Array.isArray(results) || results.length === 0) {
    throw new BaselineError('Only a non-empty, fully passing run can update the baseline');
  }
  const identities = new Set<string>();
  const timestamp = new Date().toISOString();
  const stored: StoredRun[] = [];
  for (const result of results) {
    const candidate = isRecord(result) ? result : null;
    if (!candidate || candidate.passed !== true) {
      throw new BaselineError('Only a non-empty, fully passing run can update the baseline');
    }
    if (hasOwn(candidate, 'timestamp') && !isValidTimestamp(candidate.timestamp)) {
      throw new BaselineError('invalid result timestamp');
    }
    const identity = JSON.stringify([candidate.suite, candidate.test]);
    if (identities.has(identity)) throw new BaselineError(`Duplicate baseline test: ${candidate.suite} > ${candidate.test}`);
    identities.add(identity);
    const row = validateStoredRun({ ...candidate, timestamp }, `result ${identity}`);
    stored.push(row);
  }
  const file = path.join(ensureStoreDir(), 'baseline.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, timestamp, results: stored }, null, 2), { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function loadBaseline(): StoredRun[] {
  const file = path.join(process.cwd(), STORE_DIR, 'baseline.json');
  if (!fs.existsSync(file)) return [];
  try {
    const baseline: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!isRecord(baseline) || baseline.version !== 1 || !hasOwn(baseline, 'timestamp') || !isValidTimestamp(baseline.timestamp)) {
      throw new BaselineError('invalid baseline version or timestamp');
    }
    if (!Array.isArray(baseline.results) || baseline.results.length === 0) {
      throw new BaselineError('invalid baseline results');
    }
    const identities = new Set<string>();
    const rows = baseline.results.map((value, index) => {
      const result = validateStoredRun(value, `result ${index}`);
      const identity = JSON.stringify([result.suite, result.test]);
      if (identities.has(identity)) throw new BaselineError('duplicate test identity');
      identities.add(identity);
      return result;
    });
    return rows;
  } catch (error) {
    if (error instanceof BaselineError) {
      throw new BaselineError(`Cannot read accepted baseline ${file}: ${error.message.replace(/^Baseline error: /, '')}`);
    }
    throw new BaselineError(`Cannot read accepted baseline ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateStoredRun(value: unknown, label: string): StoredRun {
  if (!isRecord(value)) throw new BaselineError(`${label} must be an object`);
  if (typeof value.suite !== 'string' || value.suite.trim() === '') throw new BaselineError(`${label} has an invalid suite identifier`);
  if (typeof value.test !== 'string' || value.test.trim() === '') throw new BaselineError(`${label} has an invalid test identifier`);
  if (value.passed !== true) throw new BaselineError(`${label} must be passing`);
  if (typeof value.output !== 'string') throw new BaselineError(`${label} has an invalid output`);
  if (!hasOwn(value, 'timestamp') || !isValidTimestamp(value.timestamp)) throw new BaselineError(`${label} has an invalid timestamp`);
  if (hasOwn(value, 'wake') && typeof value.wake !== 'string') throw new BaselineError(`${label} has an invalid wake value`);
  return value as unknown as StoredRun;
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function loadPreviousRun(suite: string, test: string): StoredRun | null {
  return loadBaseline().find(result => result.suite === suite && result.test === test) ?? null;
}

export function computeDiffs(currentResults: TestResult[]): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  for (const result of currentResults) {
    const previous = loadPreviousRun(result.suite, result.test);
    if (!previous) {
      // New test, no diff
      continue;
    }

    if (previous.output === result.output && previous.passed === result.passed) {
      // No change
      continue;
    }

    let status: DiffEntry['status'];
    if (!previous.passed && result.passed) {
      status = 'improvement';
    } else if (previous.passed && !result.passed) {
      status = 'regression';
    } else {
      status = 'changed';
    }

    const summary = generateDiffSummary(previous.output, result.output || '', status);

    diffs.push({
      test: result.test,
      suite: result.suite,
      status,
      old_output: previous.output,
      new_output: result.output || '',
      old_passed: previous.passed,
      new_passed: result.passed,
      summary,
    });
  }
  return diffs;
}

export function formatDiffs(diffs: DiffEntry[]): string {
  if (diffs.length === 0) {
    return '  No behavior changes detected.';
  }

  const lines: string[] = [''];
  lines.push('  AgentSpec — Behavior Diff Report');
  lines.push('  ' + '═'.repeat(50));

  for (const diff of diffs) {
    const icon = diff.status === 'regression' ? '⚠️' : diff.status === 'improvement' ? '✨' : '📝';
    const statusLabel = diff.status.toUpperCase();
    lines.push(`  ${icon} ${statusLabel} ${diff.suite} > ${diff.test}`);
    lines.push(`  ${'─'.repeat(50)}`);
    lines.push(`  ${diff.summary}`);
    lines.push('');
  }

  const regressions = diffs.filter(d => d.status === 'regression').length;
  const improvements = diffs.filter(d => d.status === 'improvement').length;
  const changed = diffs.filter(d => d.status === 'changed').length;

  lines.push('  ' + '═'.repeat(50));
  lines.push(`  ${regressions} regression(s), ${improvements} improvement(s), ${changed} changed`);
  lines.push('');

  return lines.join('\n');
}

function generateDiffSummary(oldOutput: string, newOutput: string, status: string): string {
  const oldWords = oldOutput.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const newWords = newOutput.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);

  const removed = oldWords.filter(w => !newSet.has(w));
  const added = newWords.filter(w => !oldSet.has(w));

  const lines: string[] = [];

  if (status === 'regression') {
    lines.push('  ⚠  Behavior REGRESSED — test was passing, now failing');
  } else if (status === 'improvement') {
    lines.push('  ✨  Behavior IMPROVED — test was failing, now passing');
  } else {
    lines.push('  📝  Behavior CHANGED — output differs but pass/fail status unchanged');
  }

  if (added.length > 0) {
    lines.push(`  + added: ${added.slice(0, 10).join(', ')}${added.length > 10 ? '...' : ''}`);
  }
  if (removed.length > 0) {
    lines.push(`  - removed: ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? '...' : ''}`);
  }

  if (added.length === 0 && removed.length === 0) {
    lines.push('  (pass/fail status changed but output text is identical — likely a metadata assertion)');
  }

  return lines.join('\n');
}
