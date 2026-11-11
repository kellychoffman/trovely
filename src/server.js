import path from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const port = Number(process.env.PORT) || 3000;

const db = openDb(path.join(dataDir, 'trovely.db'));
const app = createApp({
  db,
  dataDir,
  cookieSecure: process.env.COOKIE_SECURE === '1',
});

app.listen(port, () => {
  console.log(`trovely listening on http://localhost:${port} (data: ${dataDir})`);
});
