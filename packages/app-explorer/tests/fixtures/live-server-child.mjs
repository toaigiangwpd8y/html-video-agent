import path from 'node:path';
import { createServer } from '../../server.mjs';

const [dataDir, requestedPort = '0'] = process.argv.slice(2);
const server = createServer({ dataDir, staticDir: path.resolve('public') });
server.once('error', (error) => {
  process.stderr.write(JSON.stringify({
    type: 'STARTUP_ERROR', code: error.code || 'UNKNOWN',
    address: error.address || '127.0.0.1', port: error.port ?? Number(requestedPort),
  }) + '\n');
  process.exitCode = 1;
});
server.listen(Number(requestedPort), '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({ type: 'READY', host: '127.0.0.1', port: address.port }) + '\n');
});
