import { startServer } from './app';
import { announceRestoreClosed } from './approvals';
import { startScheduler } from './automations';
import { startBackupLoop } from './backups';
import { startDigestLoop } from './digest';
import { startFxLoop } from './fx';
import { seedCompetitors, startCompetitorWatch } from './competitors';
import { dataDir, dbFile, openDb } from './db';
import { seedCreatives, seedDemo } from './demo';
import { startDemoEmitter } from './live';
import { seedResearch } from './research';
import { autoDeps, scheduledResearch } from './kb/autonomy';
import { startKbPerformanceLoop } from './kb/performance';
import { startKbPromotionLoop } from './kb/promote';
import { runManager } from './routes/agents';
import { startOutcomeLoop } from './routes/agents-outcomes';
import { initLog, log } from './log';
import { loadKey } from './secrets';
import { startSyncLoop } from './sync';

initLog(dataDir());
process.on('uncaughtExceptionMonitor', (e) => log('error', 'crash', { error: e.stack ?? String(e) }));
// A background job's failed promise (a sync, a watch, an automation) is logged, not fatal: exiting would also end every
// agent run in progress. Thrown exceptions still exit (logged above), and the desktop app starts the API again.
process.on('unhandledRejection', (e) => log('error', 'unhandled rejection', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) }));
const db = openDb(dbFile());
seedDemo(db);
seedCreatives(db);
seedResearch(db);
seedCompetitors(db);
startDemoEmitter(db);
const key = loadKey(dataDir());
startSyncLoop(db, key);
startBackupLoop(db);
startFxLoop(db);
startDigestLoop(db);
startCompetitorWatch(db, key);
startScheduler(db, (agentId, task) => runManager(db).start(agentId, task), { research: (ruleId, reason) => scheduledResearch(db, ruleId, reason, autoDeps(db)) });
startOutcomeLoop(db);
startKbPromotionLoop(db, (agentId, task) => runManager(db).start(agentId, task));
startKbPerformanceLoop(db);

startServer(db, Number(process.env.API_PORT ?? 8787), (port) => {
  console.log(`Frontline API on http://127.0.0.1:${port}`);
  log('info', 'started', { port, dataDir: dataDir() });
  announceRestoreClosed(db);
}, process.env.FRONTLINE_WEB_DIR);
