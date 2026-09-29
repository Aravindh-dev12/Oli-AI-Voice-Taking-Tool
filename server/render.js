import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);
const dbPath = path.resolve(__dirname, '..', process.env.DB_PATH || 'data/oli.db');
const configPath = path.resolve(__dirname, '..', process.env.CONFIG_PATH || 'data/config.json');
const runtime = createServer({ dbPath, configPath });
const httpServer = runtime.app.listen(port, '0.0.0.0', () => {
  console.log(`Oli web runtime listening on port ${port}`);
});

function shutdown() {
  httpServer.close(() => {
    runtime.close();
    process.exit(0);
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

export { httpServer };

