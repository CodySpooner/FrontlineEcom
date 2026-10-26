import { startServer } from './app';
import { startScheduler } from './automations';
import { startBackupLoop } from './backups';
import { startCompetitorWatch } from './competitors';
import { startDigestLoop } from './digest';
import { startFxLoop } from './fx';
import { seedCompetitors } from './competitors';
import { dataDir, dbFile, openDb } from './db';
import { seedDemo } from './demo';
import { startDemoEmitter } from './live';
import { seedResearch } from './research';
import { runManager } from './routes/agents';
import { initLog, log } from './log';
import { loadKey } from './secrets';
import { startSyncLoop } from './sync';

initLog(dataDir());
process.on('uncaughtExceptionMonitor', (e) => log('error', 'crash', { error: e.stack ?? String(e) }));
const db = openDb(dbFile());
seedDemo(db);
seedResearch(db);
seedCompetitors(db);
startDemoEmitter(db);
startSyncLoop(db, loadKey(dataDir()));
startBackupLoop(db);
startFxLoop(db);
startDigestLoop(db);
startCompetitorWatch(db);
startScheduler(db, (agentId, task) => runManager(db).start(agentId, task));

startServer(db, Number(process.env.API_PORT ?? 8787), (port) => {
  console.log(`Frontline API on http://127.0.0.1:${port}`);
  log('info', 'started', { port, dataDir: dataDir() });
}, process.env.FRONTLINE_WEB_DIR);
