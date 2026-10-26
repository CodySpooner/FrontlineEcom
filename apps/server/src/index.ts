import { startServer } from './app';
import { dataDir, dbFile, openDb } from './db';
import { seedDemo } from './demo';
import { startDemoEmitter } from './live';
import { seedResearch } from './research';
import { loadKey } from './secrets';
import { startSyncLoop } from './sync';

const db = openDb(dbFile());
seedDemo(db);
seedResearch(db);
startDemoEmitter(db);
startSyncLoop(db, loadKey(dataDir()));

startServer(db, Number(process.env.API_PORT ?? 8787), (port) => console.log(`Frontline API on http://127.0.0.1:${port}`));
