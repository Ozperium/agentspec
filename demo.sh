#!/bin/bash
# AgentSpec Demo — AI behavior regression detection
# This script simulates: agent works → prompt changes → regression caught with diff report

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  AgentSpec Demo: Catching AI agent behavior regressions      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

DEMO_DIR=$(mktemp -d)
cd "$DEMO_DIR"

# Create test suite
cat > support-agent.yaml << 'EOF'
name: "support agent"
tests:
  - name: "handles expired token"
    input: "my token expired"
    expect:
      contains: "refresh token"
      not_contains: "I don't know"
  - name: "routes billing question"
    input: "I want a refund"
    expect:
      contains_any: ["billing", "refund", "support"]
EOF

echo "📋 Test suite: support-agent.yaml"
echo "   Tests: 2 (token refresh, billing routing)"
echo ""

# Run 1: agent works correctly
echo "━━━ Run 1: Agent v1 (working) ━━━"
cat > run-v1.js << 'JSEOF'
const {runAll, MockAgent} = require('/Users/pawloz/projects/agentspec/dist/runner');
const {saveRun, computeDiffs, formatDiffs} = require('/Users/pawloz/projects/agentspec/dist/diff');

const agent = new MockAgent({
  default: "I'll help you with that.",
  "my token expired": "You need to refresh the token. Go to Settings > Security.",
  "I want a refund": "I'll transfer you to the billing team right away.",
});

runAll('.', agent).then(result => {
  saveRun(result.results);
  const passed = result.results.filter(r => r.passed).length;
  console.log(`  ✓ ${passed}/${result.total} tests passed`);
  console.log("");
  
  // Now run v2 with changed behavior
  console.log("━━━ Run 2: Agent v2 (prompt changed, behavior shifted) ━━━");
  const agent2 = new MockAgent({
    "my token expired": "Your session has expired. Please contact support to renew your credentials.",
    "I want a refund": "I'll transfer you to the billing team right away.",
  });
  
  runAll('.', agent2).then(result2 => {
    const diffs = computeDiffs(result2.results);
    saveRun(result2.results);
    const passed2 = result2.results.filter(r => r.passed).length;
    console.log(`  ✗ ${passed2}/${result2.total} tests passed`);
    console.log("");
    console.log(formatDiffs(diffs));
  });
});
JSEOF

node run-v1.js

echo ""
echo "━━━ What happened? ━━━"
echo "  The agent's prompt was changed. It stopped saying 'refresh token'"
echo "  and started saying 'renew credentials'. The test caught it."
echo "  The diff report shows EXACTLY what changed."
echo ""
echo "  This is the value: you don't just know it broke."
echo "  You know WHAT changed in the agent's behavior."
echo ""
echo "  Try it: npm install -g @ozperium/agentspec"
echo "  Repo: https://github.com/Ozperium/agentspec"
echo ""

# Cleanup
cd /
rm -rf "$DEMO_DIR"