import { deleteCreative, listCreatives } from '@frontline/agents';
import type { AspectRatio, CreativeKind } from '@frontline/shared';
import { Hono } from 'hono';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { dataDir, type Db } from '../db';

const KINDS: CreativeKind[] = ['image', 'video', 'ugc', 'copy'];

// Higgsfield REST (docs.higgsfield.ai/docs/openapi.json): POST /<model> → { request_id, status_url }, poll until completed.
const HF = 'https://api.higgsfield.ai';
// ponytail: no talking-avatar model in Higgsfield's public API yet, so UGC is a text-to-video with a UGC-style brief.
const MODELS = { image: 'higgsfield-ai/soul/standard', video: 'kling-video/v2.5-turbo/pro/text-to-video', ugc: 'kling-video/v2.5-turbo/pro/text-to-video' };
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
const MEDIA = /^[\w-]+\.(jpg|png|webp|mp4)$/;

/**
 * Renders on Higgsfield and saves the output under `dir` (their output URLs expire), returning its local URL.
 * Throws a readable error on failed / moderated renders, HTTP errors and timeouts.
 */
export async function higgsfieldGenerate(
  creds: { keyId: string; keySecret: string },
  req: { kind: Exclude<CreativeKind, 'copy'>; aspect: AspectRatio; prompt: string },
  dir: string,
  { fetch: f = fetch, signal, pollMs = 3000, timeoutMs = 10 * 60_000 }: { fetch?: typeof fetch; signal?: AbortSignal; pollMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const headers = { Authorization: `Key ${creds.keyId}:${creds.keySecret}`, 'Content-Type': 'application/json' };
  const call = async (url: string, init: RequestInit = {}) => {
    const res = await f(url, { ...init, headers, signal });
    if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as { request_id: string; status_url?: string; status?: string; error?: string | null; images?: { url: string }[]; video?: { url: string } };
  };
  const body = req.kind === 'image' ? { prompt: req.prompt, aspect_ratio: req.aspect } : { prompt: req.prompt, duration: 5 };
  const sub = await call(`${HF}/${MODELS[req.kind]}`, { method: 'POST', body: JSON.stringify(body) });
  const deadline = Date.now() + timeoutMs;
  let url: string | undefined;
  while (!url) {
    const s = await call(sub.status_url ?? `${HF}/requests/${sub.request_id}/status`);
    if (s.status === 'completed') url = s.images?.[0]?.url ?? s.video?.url ?? '';
    else if (s.status === 'failed' || s.status === 'nsfw' || s.status === 'canceled') throw new Error(`Higgsfield render ${s.status}${s.error ? `: ${s.error}` : ''}`);
    else if (Date.now() > deadline) throw new Error(`Higgsfield render still running after ${Math.round(timeoutMs / 60_000)} min (request ${sub.request_id})`);
    else await sleep(pollMs, undefined, { signal });
  }
  if (!url) throw new Error('Higgsfield returned no media');
  const res = await f(url, { signal });
  if (!res.ok) throw new Error(`Downloading the render failed (${res.status})`);
  const ext = TYPES[res.headers.get('content-type')?.split(';')[0] ?? ''] ?? (req.kind === 'image' ? 'jpg' : 'mp4');
  const name = `${sub.request_id.replace(/[^\w-]/g, '')}.${ext}`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await res.arrayBuffer()));
  return `/api/creatives/media/${name}`;
}

export function creativeRoutes(db: Db, mediaDir = () => join(dataDir(), 'creatives')) {
  return new Hono()
    .get('/api/creatives', (c) => {
      const kind = c.req.query('kind') as CreativeKind | undefined;
      if (kind && !KINDS.includes(kind)) return c.json({ error: `kind must be one of ${KINDS.join(', ')}` }, 400);
      const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 100));
      return c.json(listCreatives(db, { storeIds: c.req.query('stores')?.split(',').filter(Boolean), kind, limit }));
    })
    .get('/api/creatives/media/:file', async (c) => {
      const file = c.req.param('file');
      if (!MEDIA.test(file)) return c.json({ error: 'Not found' }, 404);
      const bytes = await readFile(join(mediaDir(), file)).catch(() => undefined);
      if (!bytes) return c.json({ error: 'Not found' }, 404);
      const type = Object.keys(TYPES).find((t) => TYPES[t] === file.split('.').pop())!;
      return c.body(bytes, 200, { 'content-type': type, 'cache-control': 'private, max-age=31536000, immutable' });
    })
    .delete('/api/creatives/:id', (c) => (deleteCreative(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Creative not found' }, 404)));
}
