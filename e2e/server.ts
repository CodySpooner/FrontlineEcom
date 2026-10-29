// Real HTTP/WebSocket app and demo seed, without the production scheduler or connector loops.
globalThis.fetch = async () => { throw new Error('External network is disabled in the E2E server'); };
const { startServer } = await import('../apps/server/src/app');
const { openDb, dbFile } = await import('../apps/server/src/db');
const { seedDemo, seedCreatives } = await import('../apps/server/src/demo');
const { seedCompetitors } = await import('../apps/server/src/competitors');
const { seedResearch } = await import('../apps/server/src/research');
const { importLegacy } = await import('../apps/server/src/product-research/legacy');
const { loadFixtures } = await import('../apps/server/src/product-research/dev-fixtures');
const db = openDb(dbFile());
seedDemo(db);
seedCreatives(db);
seedCompetitors(db);
seedResearch(db);
importLegacy(db);
loadFixtures(db);
const server = startServer(db, 0, (port) => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`E2E server: ${url}`);
  process.send?.(url);
}, process.env.FRONTLINE_WEB_DIR);
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('message', (message) => { if (message === 'stop') stop(); });
process.on('disconnect', stop);
