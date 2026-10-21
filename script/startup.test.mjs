import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

test('a free port does not abort startup under errexit and pipefail', () => {
  const script = fs.readFileSync(new URL('./build_and_run.sh', import.meta.url), 'utf8');
  const helper = script.match(/^server_pid\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(helper);
  const output = execFileSync('bash', ['-c', `set -euo pipefail\nSERVER_PORT=3004\nlsof() { return 1; }\n${helper}\npid="$(server_pid)"\n[[ -z "$pid" ]]\nprintf 'PASS'`], { encoding: 'utf8' });
  assert.equal(output, 'PASS');
});
