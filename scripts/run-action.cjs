const path = require('node:path');
const { spawnSync } = require('node:child_process');

const failOnFailure = process.env.AGENTSPEC_FAIL_ON_FAILURE ?? 'true';
if (!['true', 'false'].includes(failOnFailure)) {
  console.error('AgentSpec: fail-on-failure must be exactly true or false');
  process.exit(1);
}
const format = process.env.AGENTSPEC_FORMAT || 'junit';
if (!['text', 'json', 'junit'].includes(format)) {
  console.error('AgentSpec: format must be text, json, or junit');
  process.exit(1);
}
if (!['true', 'false'].includes(process.env.AGENTSPEC_MOCK || 'false')) {
  console.error('AgentSpec: mock must be true or false');
  process.exit(1);
}
const args = [path.resolve(__dirname, '../dist/cli.js'), 'run', '--dir', process.env.AGENTSPEC_TEST_DIR || 'tests', '--ci'];
if (format !== 'text') args.push(`--${format}`);
if (process.env.AGENTSPEC_AGENT_ENDPOINT) args.push('--endpoint', process.env.AGENTSPEC_AGENT_ENDPOINT);
if (process.env.AGENTSPEC_AGENT_MODULE) args.push('--agent', process.env.AGENTSPEC_AGENT_MODULE);
if (process.env.AGENTSPEC_MOCK === 'true') args.push('--mock');
if (process.env.AGENTSPEC_JUDGE_ENDPOINT) args.push('--judge-endpoint', process.env.AGENTSPEC_JUDGE_ENDPOINT);
if (process.env.AGENTSPEC_JUDGE_MODEL) args.push('--judge-model', process.env.AGENTSPEC_JUDGE_MODEL);
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) console.error(`AgentSpec: ${result.error.message}`);
process.exit(result.status ?? 1);
