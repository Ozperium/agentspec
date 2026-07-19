import * as fs from 'fs';
import * as path from 'path';
import { TestResult, RunResult } from './types';
import { StoredRun, DiffEntry } from './types/diff';

const STORE_DIR = '.agentspec';

export function ensureStoreDir(): string {
  const dir = path.join(process.cwd(), STORE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveRun(results: TestResult[]): void {
  const dir = ensureStoreDir();
  const timestamp = new Date().toISOString();
  for (const result of results) {
    const file = path.join(dir, `${sanitize(result.suite)}__${sanitize(result.test)}.json`);
    const stored: StoredRun = {
      test: result.test,
      suite: result.suite,
      passed: result.passed,
      output: result.output || '',
      timestamp,
    };
    fs.writeFileSync(file, JSON.stringify(stored, null, 2));
  }
}

export function loadPreviousRun(suite: string, test: string): StoredRun | null {
  const dir = ensureStoreDir();
  const file = path.join(dir, `${sanitize(suite)}__${sanitize(test)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as StoredRun;
  } catch {
    return null;
  }
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

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}