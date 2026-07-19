import { RunResult, TestResult } from './types';

export function formatResults(result: RunResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('  AgentSpec — Test Results');
  lines.push('  ' + '─'.repeat(50));

  for (const test of result.results) {
    const status = test.passed ? '✓' : '✗';
    const statusColor = test.passed ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';
    lines.push(`  ${statusColor}${status}${resetColor} ${test.suite} > ${test.test} (${test.duration_ms}ms)`);

    if (!test.passed) {
      if (test.error) {
        lines.push(`      Error: ${test.error}`);
      }
      for (const a of test.assertions) {
        if (!a.passed) {
          lines.push(`      ${a.assertion}: ${a.message}`);
          if (a.expected && a.actual) {
            lines.push(`        expected: ${a.expected}`);
            lines.push(`        actual:   ${a.actual}`);
          }
        }
      }
    }
  }

  lines.push('  ' + '─'.repeat(50));
  const totalColor = result.failed > 0 ? '\x1b[31m' : '\x1b[32m';
  const resetColor2 = '\x1b[0m';
  lines.push(`  ${totalColor}${result.passed} passed${resetColor2}, ${result.failed} failed (${result.total} total)`);
  lines.push(`  Duration: ${result.duration_ms}ms`);
  lines.push('');

  return lines.join('\n');
}

export function formatResultsJSON(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatResultsJUnit(result: RunResult): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<testsuites tests="${result.total}" failures="${result.failed}" time="${result.duration_ms / 1000}">`);

  const bySuite = new Map<string, TestResult[]>();
  for (const test of result.results) {
    if (!bySuite.has(test.suite)) bySuite.set(test.suite, []);
    bySuite.get(test.suite)!.push(test);
  }

  const suiteEntries = Array.from(bySuite.entries());
  for (const [suiteName, tests] of suiteEntries) {
    const suiteFailures = tests.filter(t => !t.passed).length;
    const suiteTime = tests.reduce((sum, t) => sum + t.duration_ms, 0) / 1000;
    lines.push(`  <testsuite name="${escapeXml(suiteName)}" tests="${tests.length}" failures="${suiteFailures}" time="${suiteTime}">`);
    for (const test of tests) {
      lines.push(`    <testcase name="${escapeXml(test.test)}" classname="${escapeXml(suiteName)}" time="${test.duration_ms / 1000}"${test.passed ? ' />' : '>'}`);
      if (!test.passed) {
        const failureMsg = test.error || test.assertions.filter(a => !a.passed).map(a => a.message).join('; ');
        lines.push(`      <failure message="${escapeXml(failureMsg)}">${escapeXml(failureMsg)}</failure>`);
        lines.push(`    </testcase>`);
      }
    }
    lines.push(`  </testsuite>`);
  }

  lines.push('</testsuites>');
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}