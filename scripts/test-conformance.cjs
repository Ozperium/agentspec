const { runAll, MockAgent } = require('../dist/runner');

async function main() {
  const result = await runAll('conformance', new MockAgent({}, true));
  if (result.total !== 6 || result.failed !== 6) {
    throw new Error(`expected 6 failures, got ${result.failed}/${result.total}`);
  }

  console.log('Conformance checks passed: 6 expected failures');
}

main().catch((error) => {
  console.error(`Conformance checks failed: ${error.message}`);
  process.exit(1);
});
