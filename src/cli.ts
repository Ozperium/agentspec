#!/usr/bin/env node
import { runAll, runSuite, MockAgent, AgentRunner, AgentOutput, TestSuite } from './runner';
import { findTestSuites } from './loader';
import { formatResults, formatResultsJSON, formatResultsJUnit } from './reporter';
import { saveRun, computeDiffs, formatDiffs } from './diff';
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
    let judgeEndpoint: string | null = null;
    let judgeModel: string | null = null;
    let agentEndpoint: string | null = null;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--dir') dir = args[++i];
      else if (arg === '--ci') ci = true;
      else if (arg === '--json') json = true;
      else if (arg === '--junit') junit = true;
      else if (arg === '--watch') watch = true;
      else if (arg === '--test') testFilter = args[++i];
      else if (arg === '--judge-endpoint') judgeEndpoint = args[++i];
      else if (arg === '--judge-model') judgeModel = args[++i];
      else if (arg === '--endpoint') agentEndpoint = args[++i];
      else if (arg === '--help' || arg === '-h') {
        printHelp();
        return;
      }
    }

    // Use HTTP agent if endpoint specified, otherwise mock
    const isSelfTest = dir === 'tests';
    const agent = agentEndpoint
      ? new (require('./http-agent').HTTPAgent)({ endpoint: agentEndpoint })
      : isSelfTest
        ? new MockAgent({}, true)
        : new MockAgent({
            default: "I'll help you with that. Let me check the system for you.",
            "my token expired, what do I do?": "You need to refresh the token. Go to Settings > Security to get a new refresh token.",
            "I want a refund": "I'll transfer you to the billing team. Let me connect you with our support team.",
            "what can you do?": "I can help with auth, billing, and general support questions.",
            "xyzzy random input 12345": "I'm not sure about that, but I can help you find what you need.",
          });

    // Configure LLM judge if specified (must be before running tests)
    if (judgeEndpoint || judgeModel) {
      const { setLLMJudgeConfig } = await import('./assertions');
      setLLMJudgeConfig({
        endpoint: judgeEndpoint || undefined,
        model: judgeModel || undefined,
      });
    }

    const result = await runAll(dir, agent, testFilter);

    // Compute behavior diffs
    const diffs = computeDiffs(result.results);

    // Save current run for future diffs
    saveRun(result.results);

    if (json) {
      console.log(formatResultsJSON(result));
    } else if (junit) {
      console.log(formatResultsJUnit(result));
    } else {
      console.log(formatResults(result));
      // Show diff report if there are changes
      if (diffs.length > 0) {
        console.log(formatDiffs(diffs));
      }
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
  --dir <path>          Test directory (default: tests)
  --ci                  Exit with code 1 on failure
  --json                Output results as JSON
  --junit               Output JUnit XML
  --watch               Watch for changes and re-run
  --test <pattern>      Run only matching tests
  --judge-endpoint <url>  LLM judge endpoint (OpenAI-compatible, default: Ollama)
  --judge-model <name>    LLM judge model name (default: local small model)
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});