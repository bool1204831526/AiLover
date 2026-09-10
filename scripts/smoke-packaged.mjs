import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const executable = resolve('release/win-unpacked/AiLover.exe');

if (!existsSync(executable)) {
  throw new Error(`Packaged executable is missing: ${executable}`);
}

const child = spawn(executable, ['--smoke-test'], {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
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
}, 15_000);

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

console.log('Packaged app completed renderer, preload and IPC startup.');
