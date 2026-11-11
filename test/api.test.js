import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { normalizeTags, normalizeUrl } from '../src/media.js';

// Smallest bytes that sniff as each type.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);

let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trovely-test-'));
  const db = openDb(path.join(dataDir, 'test.db'));
  const app = createApp({ db, dataDir });
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Tiny cookie-jar client so each "person" keeps their own session.
function client() {
  let cookie = '';
  return async (url, { method = 'GET', json, body, headers = {} } = {}) => {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (cookie) init.headers.cookie = cookie;
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    const res = await fetch(base + url, init);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

function upload(bytes, name, type, fields = {}) {
  const form = new FormData();
  form.append('files', new Blob([bytes], { type }), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

test('signup, login and session cookie', async () => {
  const kelly = client();
  const signup = await kelly('/api/signup', { method: 'POST', json: { username: 'kelly', password: 'correct horse' } });
  assert.equal(signup.status, 201);
  assert.equal((await kelly('/api/me')).data.user.username, 'kelly');

  const bad = await client()('/api/login', { method: 'POST', json: { username: 'kelly', password: 'nope nope' } });
  assert.equal(bad.status, 401);

  const dup = await client()('/api/signup', { method: 'POST', json: { username: 'KELLY', password: 'correct horse' } });
  assert.equal(dup.status, 409);
});

test('upload sniffs real bytes, not the claimed type', async () => {
  const user = client();
  await user('/api/signup', { method: 'POST', json: { username: 'sniffer', password: 'long enough pw' } });

  const fake = await user('/api/media', {
    method: 'POST',
    body: upload(Buffer.from('<html>nope</html>'), 'evil.png', 'image/png'),
  });
  assert.equal(fake.status, 415);

  const ok = await user('/api/media', {
    method: 'POST',
    body: upload(PNG, 'pic.png', 'application/octet-stream', { tags: 'Warm Light, 70s', title: 'Sun' }),
  });
  assert.equal(ok.status, 201);
  const [m] = ok.data.media;
  assert.equal(m.kind, 'image');
  assert.deepEqual(m.tags, ['70s', 'warm-light']);
  assert.match(m.url, /^\/media\/.+\.png$/);
});

test('discover shows public media only; private is owner-only', async () => {
  const owner = client();
  await owner('/api/signup', { method: 'POST', json: { username: 'owner1', password: 'long enough pw' } });
  const pub = await owner('/api/media', { method: 'POST', body: upload(PNG, 'a.png', 'image/png', { tags: 'public-one' }) });
  const priv = await owner('/api/media', {
    method: 'POST',
    body: upload(MP4, 'b.mp4', 'video/mp4', { visibility: 'private', tags: 'secret' }),
  });
  assert.equal(priv.data.media[0].kind, 'video');

  const stranger = client();
  const feed = (await stranger('/api/media')).data.media.map((m) => m.id);
  assert.ok(feed.includes(pub.data.media[0].id));
  assert.ok(!feed.includes(priv.data.media[0].id));
  assert.equal((await stranger(`/api/media/${priv.data.media[0].id}`)).status, 404);

  const mine = (await owner('/api/media?scope=mine')).data.media.map((m) => m.id);
  assert.ok(mine.includes(priv.data.media[0].id));

  const byTag = (await stranger('/api/media?tag=public-one')).data.media;
  assert.equal(byTag.length, 1);
});

test('only the uploader can edit or delete', async () => {
  const a = client();
  await a('/api/signup', { method: 'POST', json: { username: 'alice1', password: 'long enough pw' } });
  const { data } = await a('/api/media', { method: 'POST', body: upload(PNG, 'x.png', 'image/png') });
  const id = data.media[0].id;

  const b = client();
  await b('/api/signup', { method: 'POST', json: { username: 'bobby1', password: 'long enough pw' } });
  assert.equal((await b(`/api/media/${id}`, { method: 'PATCH', json: { title: 'mine now' } })).status, 403);
  assert.equal((await b(`/api/media/${id}`, { method: 'DELETE' })).status, 403);

  const patched = await a(`/api/media/${id}`, { method: 'PATCH', json: { tags: ['Interiors'], source_url: 'https://example.com/x' } });
  assert.deepEqual(patched.data.media.tags, ['interiors']);
  assert.equal(patched.data.media.source_url, 'https://example.com/x');
});

test('boards: group pins, share publicly, hide private items from others', async () => {
  const owner = client();
  await owner('/api/signup', { method: 'POST', json: { username: 'boardy1', password: 'long enough pw' } });
  const pub = (await owner('/api/media', { method: 'POST', body: upload(PNG, 'p.png', 'image/png') })).data.media[0];
  const priv = (await owner('/api/media', {
    method: 'POST',
    body: upload(PNG, 'q.png', 'image/png', { visibility: 'private' }),
  })).data.media[0];

  const board = (await owner('/api/boards', {
    method: 'POST',
    json: { name: 'Moodboard', category: 'Interiors', visibility: 'public' },
  })).data.board;
  assert.equal(board.category, 'interiors');

  assert.equal((await owner(`/api/boards/${board.id}/items`, { method: 'POST', json: { media_id: pub.id } })).status, 201);
  assert.equal((await owner(`/api/boards/${board.id}/items`, { method: 'POST', json: { media_id: priv.id } })).status, 201);

  const viewer = client();
  const shown = (await viewer(`/api/boards/${board.id}`)).data;
  assert.equal(shown.media.length, 1);
  assert.equal(shown.media[0].id, pub.id);
  assert.equal(shown.board.is_mine, false);

  const listed = (await viewer('/api/boards')).data.boards.map((b) => b.id);
  assert.ok(listed.includes(board.id));

  const hidden = await owner('/api/boards', { method: 'POST', json: { name: 'Secret board' } });
  assert.equal(hidden.data.board.visibility, 'private');
  assert.equal((await viewer(`/api/boards/${hidden.data.board.id}`)).status, 404);
});

test('pin without a board lands in Saved; others cannot pin into your boards', async () => {
  const owner = client();
  await owner('/api/signup', { method: 'POST', json: { username: 'pinner1', password: 'long enough pw' } });
  const media = (await owner('/api/media', { method: 'POST', body: upload(PNG, 'z.png', 'image/png') })).data.media[0];

  const pinned = await owner('/api/pins', { method: 'POST', json: { media_id: media.id } });
  assert.equal(pinned.status, 201);
  const mine = (await owner('/api/boards?scope=mine')).data.boards;
  assert.ok(mine.some((b) => b.name === 'Saved' && b.item_count === 1));

  const other = client();
  await other('/api/signup', { method: 'POST', json: { username: 'pinner2', password: 'long enough pw' } });
  const denied = await other('/api/pins', { method: 'POST', json: { media_id: media.id, board_id: pinned.data.board_id } });
  assert.equal(denied.status, 404);
});

test('agents upload with a Bearer API token', async () => {
  const user = client();
  await user('/api/signup', { method: 'POST', json: { username: 'agentic1', password: 'long enough pw' } });
  const { data } = await user('/api/me/token', { method: 'POST' });
  const auth = { authorization: `Bearer ${data.token}` };
  assert.ok(data.token.startsWith('tvl_'));

  const res = await fetch(`${base}/api/media`, {
    method: 'POST',
    headers: auth,
    body: upload(PNG, 'agent.png', 'image/png', { tags: 'from-agent' }),
  });
  assert.equal(res.status, 201);

  const me = await fetch(`${base}/api/me`, { headers: auth }).then((r) => r.json());
  assert.equal(me.user.username, 'agentic1');

  const anon = await fetch(`${base}/api/media`, { method: 'POST', body: upload(PNG, 'n.png', 'image/png') });
  assert.equal(anon.status, 401);
});

test('input helpers', () => {
  assert.deepEqual(normalizeTags('  Mid Century, mid century,,  ??? '), ['mid-century']);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl('https://kelly.blog/x'), 'https://kelly.blog/x');
});
