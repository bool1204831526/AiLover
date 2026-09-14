import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const executable = process.env.AILOVER_SMOKE_EXECUTABLE
  ? resolve(process.env.AILOVER_SMOKE_EXECUTABLE) : resolve('release/win-unpacked/AiLover.exe');
const smokeUserData = resolve('release/.smoke-user-data');
const startupBudgetMs = Number(process.env.AILOVER_SMOKE_STARTUP_BUDGET_MS ?? 10_000);
const startedAt = performance.now();

if (!Number.isFinite(startupBudgetMs) || startupBudgetMs <= 0) {
  throw new Error('AILOVER_SMOKE_STARTUP_BUDGET_MS must be a positive number.');
}

if (!existsSync(executable)) {
  throw new Error(`Packaged executable is missing: ${executable}`);
}

const child = spawn(executable, ['--smoke-test'], {
  env: {
    ...process.env,
    AILOVER_SMOKE_USER_DATA: smokeUserData,
    ELECTRON_ENABLE_LOGGING: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
}, Math.max(15_000, startupBudgetMs + 5_000));

const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolveExit(code));
});

clearTimeout(timeout);

if (!stdout.includes('AILOVER_SMOKE_READY')) {
  throw new Error(
    `Packaged app did not complete renderer/preload/IPC startup. Exit code: ${String(exitCode)}\n${stderr}`,
  );
}

if (stderr.includes('Uncaught Exception') || stderr.includes('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING')) {
  throw new Error(`Packaged app reported a main-process error:\n${stderr}`);
}

const durationMs = Math.round(performance.now() - startedAt);
if (durationMs > startupBudgetMs) {
  throw new Error(
    `Packaged app startup exceeded the ${startupBudgetMs} ms release budget: ${durationMs} ms`,
  );
}

console.log(`Packaged app completed renderer, preload and IPC startup in ${durationMs} ms.`);
