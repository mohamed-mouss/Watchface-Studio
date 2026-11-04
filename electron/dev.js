const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('vite');

const root = path.join(__dirname, '..');

async function start() {
  const server = await createServer({
    configFile: path.join(root, 'vite.config.js'),
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  });
  await server.listen();

  const electronBinary = require('electron');
  const child = spawn(electronBinary, [root], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
    stdio: 'inherit',
  });

  let shutdownPromise;
  const stop = () => {
    if (!shutdownPromise) {
      if (child.exitCode === null && !child.killed) child.kill();
      shutdownPromise = server.close();
    }
    return shutdownPromise;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', async (code) => {
    await stop();
    process.exitCode = code ?? 0;
  });
  child.on('error', async (error) => {
    console.error(error);
    await stop();
    process.exitCode = 1;
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
