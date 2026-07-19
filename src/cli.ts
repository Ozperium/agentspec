#!/usr/bin/env node
import { runAll, runSuite, MockAgent, AgentRunner, AgentOutput, TestSuite } from './runner';
import { findTestSuites } from './loader';
import { formatResults, formatResultsJSON, formatResultsJUnit } from './reporter';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'run') {
    let dir = 'tests';
    let ci = false;
    let json = false;
    let junit = false;
    let watch = false;
    let testFilter: string | null = null;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--dir') dir = args[++i];
      else if (arg === '--ci') ci = true;
      else if (arg === '--json') json = true;
      else if (arg === '--junit') junit = true;
      else if (arg === '--watch') watch = true;
      else if (arg === '--test') testFilter = args[++i];
      else if (arg === '--help' || arg === '-h') {
        printHelp();
        return;
      }
    }

    // Use echo mock for self-tests, response mock for examples
    const isSelfTest = dir === 'tests';
    const agent = isSelfTest
      ? new MockAgent({}, true) // echo mode — returns input as output
      : new MockAgent({
          default: "I'll help you with that. Let me check the system for you.",
          "my token expired, what do I do?": "You need to refresh the token. Go to Settings > Security to get a new refresh token.",
          "I want a refund": "I'll transfer you to the billing team. Let me connect you with our support team.",
          "what can you do?": "I can help with auth, billing, and general support questions.",
          "xyzzy random input 12345": "I'm not sure about that, but I can help you find what you need.",
        });

    const result = await runAll(dir, agent, testFilter);

    if (json) {
      console.log(formatResultsJSON(result));
    } else if (junit) {
      console.log(formatResultsJUnit(result));
    } else {
      console.log(formatResults(result));
    }

    if (ci) {
      process.exit(result.failed > 0 ? 1 : 0);
    }
  } else if (command === 'init') {
    console.log('Creating agentspec.yaml...');
    const { writeFileSync } = await import('fs');
    writeFileSync(
      path.join(process.cwd(), 'agentspec.yaml'),
      `name: "my-agent-tests"
description: "Tests for my AI agent"
tests:
  - name: "handles greeting"
    input: "hello"
    expect:
      contains: "help"
`
    );
    console.log('Created agentspec.yaml');
  } else if (command === 'list') {
    let dir = 'tests';
    if (args[1] === '--dir') dir = args[2];
    const suites = findTestSuites(dir);
    if (suites.length === 0) {
      console.log('No test suites found in', dir);
      return;
    }
    console.log(`Found ${suites.length} test suite(s):`);
    for (const s of suites) {
      console.log(`  ${s}`);
    }
  } else if (command === 'version' || command === '--version' || command === '-v') {
    console.log('agentspec v0.1.0');
  } else {
    printHelp();
  }
}

function printHelp() {
  console.log(`
AgentSpec — Testing framework for AI agents

Usage:
  agentspec run [options]     Run tests
  agentspec init              Create agentspec.yaml
  agentspec list              List test suites
  agentspec version           Show version

Options for run:
  --dir <path>      Test directory (default: tests)
  --ci              Exit with code 1 on failure
  --json            Output results as JSON
  --junit           Output JUnit XML
  --watch           Watch for changes and re-run
  --test <pattern>  Run only matching tests
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});