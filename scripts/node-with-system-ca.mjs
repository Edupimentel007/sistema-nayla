import { spawn } from 'node:child_process';

// Keep TLS verification enabled while allowing Node to trust certificates
// installed in the operating system, as browsers on this computer do.
const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, NODE_USE_SYSTEM_CA: process.env.NODE_USE_SYSTEM_CA ?? '1' },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}

child.on('error', () => {
  console.error('Não foi possível iniciar o processo da Nayla.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
