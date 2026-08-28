import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Redirect HOME to a fresh temp dir so the test suite never touches the real
// ~/.pi/tools-cache: test writes would pollute it, and cache eviction would
// wipe the user's live cache entries. Runs before test-file imports, so
// module-level os.homedir() reads (e.g. shared/config.ts) pick up the
// isolated home too.
const testHome = mkdtempSync(join(tmpdir(), 'henyo-pi-web-test-'));
process.env.HOME = testHome;
if (process.platform === 'win32') process.env.USERPROFILE = testHome;
