import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { TestSuite } from './types';

export function loadTestSuite(filePath: string): TestSuite {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parse(content) as TestSuite;
  if (!parsed.name || !parsed.tests) {
    throw new Error(`Invalid test suite: missing name or tests in ${filePath}`);
  }
  return parsed;
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