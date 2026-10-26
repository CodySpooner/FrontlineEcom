import { startServer } from './app';
import { startScheduler } from './automations';
import { seedCompetitors } from './competitors';
import { dataDir, dbFile, openDb } from './db';
import { seedDemo } from './demo';
import { startDemoEmitter } from './live';
import { seedResearch } from './research';
import { runManager } from './routes/agents';
import { loadKey } from './secrets';
import { startSyncLoop } from './sync';

const db = openDb(dbFile());
seedDemo(db);
seedResearch(db);
seedCompetitors(db);
startDemoEmitter(db);
startSyncLoop(db, loadKey(dataDir()));
startScheduler(db, (agentId, task) => runManager(db).start(agentId, task));

startServer(db, Number(process.env.API_PORT ?? 8787), (port) => console.log(`Frontline API on http://127.0.0.1:${port}`), process.env.FRONTLINE_WEB_DIR);
