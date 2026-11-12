// Runs every *.test.js in this folder and fails if any of them fails.
//   cd n8n/workflows/tests && npm ci && npm test
// luxon is what n8n's Code nodes use for dates; it comes from package.json
// here, so no test is skipped for lack of it.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  require.resolve('luxon');
} catch (e) {
  console.error('luxon is not installed: run "npm ci" in n8n/workflows/tests first.');
  process.exit(1);
}

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const skipped = /\(skipped/.test(out);
  if (r.status !== 0 || skipped) {
    failed += 1;
    console.log(`FAIL ${f}${skipped ? ' (a test was skipped)' : ''}`);
    console.log(out.split('\n').filter((l) => /not ok|Error|assert|skipped|expected|actual/i.test(l)).slice(0, 25).join('\n'));
  } else {
    console.log(`ok   ${f}`);
  }
}
console.log(`\n${files.length - failed} of ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
