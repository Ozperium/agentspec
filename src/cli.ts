#!/usr/bin/env node
import { runAll, MockAgent, AgentRunner } from './runner';
import { findTestSuites } from './loader';
import { formatResults, formatResultsJUnit } from './reporter';
import { saveRun, computeDiffs, formatDiffs } from './diff';
import * as path from 'path';
import * as fs from 'fs';

async function runWithWatch(
  dir: string,
  agent: AgentRunner,
  testFilter: string | null,
): Promise<void> {
  // First run
  await runTests(dir, agent, testFilter);

  console.log('\n🔍 Watching for changes in %s… (press Ctrl+C to stop)\n', dir);

  const testDir = path.resolve(dir);
  let running = false;
  let pending = false;
  const rerun = async () => {
    pending = true;
    if (running) return;
    running = true;
    while (pending) {
      pending = false;
      try {
        await runTests(dir, agent, testFilter);
      } catch (error) {
        console.error(`Watch run failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    running = false;
  };

  fs.watch(testDir, (eventType, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
      console.log(`\n💥 Change detected: ${filename} — re-running tests…\n`);
      void rerun();
    }
  });
}

async function runTests(
  dir: string,
  agent: AgentRunner,
  testFilter: string | null,
): Promise<void> {
  const result = await runAll(dir, agent, testFilter);

  const diffs = computeDiffs(result.results);

  console.log(formatResults(result));
  if (diffs.length > 0) {
    console.log(formatDiffs(diffs));
  }
}

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
    let agentModule: string | null = null;
    let mock = false;
    let updateBaseline = false;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      const value = () => {
        const next = args[++i];
        if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`);
        return next;
      };
      if (arg === '--dir') dir = value();
      else if (arg === '--ci') ci = true;
      else if (arg === '--json') json = true;
      else if (arg === '--junit') junit = true;
      else if (arg === '--watch') watch = true;
      else if (arg === '--test') testFilter = value();
      else if (arg === '--judge-endpoint') judgeEndpoint = value();
      else if (arg === '--judge-model') judgeModel = value();
      else if (arg === '--endpoint') agentEndpoint = value();
      else if (arg === '--agent') agentModule = value();
      else if (arg === '--mock') mock = true;
      else if (arg === '--update-baseline') updateBaseline = true;
      else if (arg === '--help' || arg === '-h') {
        if (args.length !== i + 1) throw new Error(`Unexpected argument after ${arg}`);
        printCommandHelp('run');
        return;
      } else {
        throw new Error(`Unknown option: ${arg}`);
      }
    }

    if (json && junit) throw new Error('--json and --junit are mutually exclusive');
    if (updateBaseline && (testFilter || watch)) throw new Error('--update-baseline requires a complete single run; omit --test and --watch');
    if (!agentEndpoint && !agentModule && !mock) {
      throw new Error('Choose a real agent with --endpoint <url> or --agent <module.cjs>, or explicitly use --mock for demo tests');
    }
    if ([agentEndpoint, agentModule, mock].filter(Boolean).length !== 1) {
      throw new Error('Choose exactly one of --endpoint, --agent, or --mock');
    }
    let agent: AgentRunner;
    if (agentEndpoint) {
      const token = process.env.AGENTSPEC_AGENT_TOKEN;
      agent = new (require('./http-agent').HTTPAgent)({
        endpoint: agentEndpoint,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } else if (agentModule) {
      const loaded = require(path.resolve(agentModule));
      agent = loaded.agent ?? loaded.default ?? loaded;
      if (!agent || typeof agent.run !== 'function') throw new Error('--agent module must export an AgentRunner with run(input, suite)');
    } else {
      console.error('AgentSpec: DEMO MOCK mode — this does not evaluate your real agent');
      agent = new MockAgent({}, true);
    }

    // Configure LLM judge if specified (must be before running tests)
    if (judgeEndpoint || judgeModel) {
      const { setLLMJudgeConfig } = await import('./assertions');
      setLLMJudgeConfig({
        endpoint: judgeEndpoint || undefined,
        model: judgeModel || undefined,
      });
    }

    if (watch) {
      // Watch mode: run once then watch for file changes
      if (ci || json || junit) {
        console.error(
          '--ci, --json, and --junit are not supported with --watch',
        );
        process.exit(1);
      }
      await runWithWatch(dir, agent, testFilter);
    } else {
      // Single-run mode (original behavior)
      const result = await runAll(dir, agent, testFilter);

      // Compute behavior diffs
      const diffs = computeDiffs(result.results);

      // Acceptance is explicit and requires the entire run to pass.
      if (updateBaseline && result.failed === 0) saveRun(result.results);

      if (json) {
        console.log(JSON.stringify({ ...result, diffs }, null, 2));
      } else if (junit) {
        console.log(formatResultsJUnit(result));
      } else {
        console.log(formatResults(result));
        // Show diff report if there are changes
        if (diffs.length > 0) {
          console.log(formatDiffs(diffs));
        }
      }

      process.exitCode = result.failed > 0 ? 1 : 0;
    }
  } else if (command === 'init') {
    if (args.length === 2 && (args[1] === '--help' || args[1] === '-h')) {
      printCommandHelp('init');
      return;
    }
    if (args.length !== 1) throw new Error('init does not accept positional arguments or options');
    console.log('Creating tests/getting-started.yaml...');
    const { writeFileSync } = await import('fs');
    const testDir = path.join(process.cwd(), 'tests');
    const suitePath = path.join(testDir, 'getting-started.yaml');
    if (fs.existsSync(suitePath)) throw new Error('tests/getting-started.yaml already exists; refusing to overwrite your tests');
    fs.mkdirSync(testDir, { recursive: true });
    writeFileSync(
      path.join(testDir, 'getting-started.yaml'),
      `name: "my-agent-tests"
description: "Tests for my AI agent"
tests:
  - name: "handles greeting"
    input: "hello"
    expect:
      contains: "hello"
`
    );
    console.log('Created tests/getting-started.yaml. Try: agentspec run --mock');
  } else if (command === 'list') {
    if (args.length === 2 && (args[1] === '--help' || args[1] === '-h')) {
      printCommandHelp('list');
      return;
    }
    let dir = 'tests';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--dir') {
        const next = args[i + 1];
        if (!next || next.startsWith('--')) throw new Error('--dir requires a value');
        dir = next;
        i++;
      } else {
        throw new Error(`Unknown option or positional argument: ${args[i]}`);
      }
    }
    const suites = findTestSuites(dir);
    if (suites.length === 0) {
      console.log('No test suites found in', dir);
      return;
    }
    console.log(`Found ${suites.length} test suite(s):`);
    for (const s of suites) {
      console.log(`  ${s}`);
    }
  } else if (command === 'version') {
    if (args.length === 2 && (args[1] === '--help' || args[1] === '-h')) {
      printCommandHelp('version');
      return;
    }
    if (args.length !== 1) throw new Error('version does not accept positional arguments or options');
    const { version } = require('../package.json');
    console.log(`agentspec v${version}`);
  } else if (command === '--version' || command === '-v') {
    if (args.length !== 1) throw new Error(`${command} does not accept arguments`);
    const { version } = require('../package.json');
    console.log(`agentspec v${version}`);
  } else if (command === undefined) {
    printHelp();
  } else if (command === '--help' || command === '-h') {
    if (args.length !== 1) throw new Error(`${command} does not accept arguments`);
    printHelp();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

function printCommandHelp(command: 'run' | 'init' | 'list' | 'version'): void {
  if (command === 'run') {
    printHelp();
  } else if (command === 'init') {
    console.log('Usage: agentspec init');
    console.log('Create tests/getting-started.yaml.');
  } else if (command === 'list') {
    console.log('Usage: agentspec list [--dir <path>]');
    console.log('List test suites without changing files.');
  } else {
    console.log('Usage: agentspec version');
    console.log('Show the installed AgentSpec version.');
  }
}

function printHelp() {
  console.log(`
AgentSpec — Testing framework for AI agents

Usage:
  agentspec run [options]     Run tests
  agentspec init              Create tests/getting-started.yaml
  agentspec list              List test suites
  agentspec version           Show version

Options for run:
  --dir <path>          Test directory (default: tests)
  --endpoint <url>     Run against your HTTP agent
  --agent <module.cjs> Load your exported AgentRunner
  --mock               Explicit demo-only echo agent
  --update-baseline    Accept a fully passing run as the new baseline
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