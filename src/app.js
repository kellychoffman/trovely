import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, newToken, sha256 } from './auth.js';
import {
  TYPES, MAX_BYTES, MAX_FILES, sniffType, normalizeTag, normalizeTags,
  normalizeUrl, validUsername, clampInt,
} from './media.js';

const COOKIE = 'trovely_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const now = () => Date.now();
const uid = () => crypto.randomUUID();

export function createApp({ db, dataDir, cookieSecure = false }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const upload = multer({ dest: tmpDir, limits: { fileSize: MAX_BYTES, files: MAX_FILES } });

  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);

  // ---- helpers -----------------------------------------------------------

  function readCookie(req, name) {
    for (const part of (req.get('cookie') || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
  }

  function setCookie(res, value, maxAge) {
    const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (cookieSecure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function startSession(res, userId) {
    const token = newToken();
    run('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)', sha256(token), userId, now());
    setCookie(res, token, SESSION_SECONDS);
  }

  // Accepts either a session cookie (the web app) or a Bearer API token (agents).
  function userFromRequest(req) {
    const auth = req.get('authorization') || '';
    if (auth.startsWith('Bearer ')) {
      return get('SELECT id, username FROM users WHERE api_token_hash = ?', sha256(auth.slice(7).trim())) || null;
    }
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    return get(
      'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      sha256(token),
    ) || null;
  }

  const requireUser = (req, res, next) => (
    req.user ? next() : res.status(401).json({ error: 'Log in, or send your API token as a Bearer header.' })
  );

  const MEDIA_SELECT = 'SELECT m.*, u.username AS owner FROM media m JOIN users u ON u.id = m.owner_id';
  const getMedia = (id) => get(`${MEDIA_SELECT} WHERE m.id = ?`, id);
  const canSeeMedia = (row, user) => row.visibility === 'public' || (user && user.id === row.owner_id);

  function serializeMedia(rows, viewerId) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(',');
    const tagRows = all(`SELECT media_id, tag FROM media_tags WHERE media_id IN (${marks}) ORDER BY tag`, ...ids);
    const tagsById = new Map(ids.map((id) => [id, []]));
    for (const t of tagRows) tagsById.get(t.media_id).push(t.tag);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      mime: r.mime,
      url: `/media/${r.file}`,
      title: r.title,
      source_url: r.source_url,
      visibility: r.visibility,
      tags: tagsById.get(r.id),
      owner: r.owner,
      is_mine: viewerId === r.owner_id,
      created_at: r.created_at,
    }));
  }

  function setTags(mediaId, tags) {
    run('DELETE FROM media_tags WHERE media_id = ?', mediaId);
    for (const tag of tags) run('INSERT OR IGNORE INTO media_tags (media_id, tag) VALUES (?, ?)', mediaId, tag);
  }

  const BOARD_SELECT = `SELECT b.*, u.username AS owner,
      (SELECT COUNT(*) FROM board_items bi JOIN media m ON m.id = bi.media_id
        WHERE bi.board_id = b.id AND (m.visibility = 'public' OR m.owner_id = b.owner_id)) AS item_count
    FROM boards b JOIN users u ON u.id = b.owner_id`;
  const getBoard = (id) => get(`${BOARD_SELECT} WHERE b.id = ?`, id);

  function serializeBoard(b, viewerId) {
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      category: b.category,
      visibility: b.visibility,
      owner: b.owner,
      is_mine: viewerId === b.owner_id,
      item_count: b.item_count,
      created_at: b.created_at,
    };
  }

  const canSeeBoard = (b, user) => b.visibility === 'public' || (user && user.id === b.owner_id);

  function savedBoardFor(userId) {
    const existing = get("SELECT id FROM boards WHERE owner_id = ? AND name = 'Saved'", userId);
    if (existing) return existing.id;
    const id = uid();
    run(
      "INSERT INTO boards (id, owner_id, name, visibility, created_at) VALUES (?, ?, 'Saved', 'private', ?)",
      id, userId, now(),
    );
    return id;
  }

  // ---- app ---------------------------------------------------------------

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    req.user = userFromRequest(req);
    next();
  });

  // Account -----------------------------------------------------------------

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/me', (req, res) => res.json({ user: req.user }));

  app.post('/api/signup', (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!validUsername(username)) {
      return res.status(400).json({ error: 'Usernames are 3 to 32 letters, numbers, dashes or underscores.' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    if (get('SELECT 1 FROM users WHERE username = ?', username)) {
      return res.status(409).json({ error: 'That username is taken.' });
    }
    const id = uid();
    run(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      id, username, hashPassword(password), now(),
    );
    startSession(res, id);
    res.status(201).json({ user: { id, username } });
  });

  app.post('/api/login', (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const row = get('SELECT id, username, password_hash FROM users WHERE username = ?', username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    startSession(res, row.id);
    res.json({ user: { id: row.id, username: row.username } });
  });

  app.post('/api/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    setCookie(res, '', 0);
    res.status(204).end();
  });

  app.post('/api/me/token', requireUser, (req, res) => {
    const token = newToken('tvl_');
    run('UPDATE users SET api_token_hash = ? WHERE id = ?', sha256(token), req.user.id);
    res.json({ token, note: 'Shown once. Generating a new one revokes this one.' });
  });

  // Media -------------------------------------------------------------------

  app.post('/api/media', requireUser, upload.array('files', MAX_FILES), (req, res) => {
    const files = req.files ?? [];
    const discard = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
    if (!files.length) return res.status(400).json({ error: 'Send one or more files in a "files" field.' });

    const body = req.body ?? {};
    const tags = normalizeTags(body.tags);
    const title = String(body.title ?? '').trim().slice(0, 200);
    const sourceUrl = normalizeUrl(body.source_url);
    if (sourceUrl === null) {
      discard();
      return res.status(400).json({ error: 'source_url must be a http or https link.' });
    }
    const visibility = body.visibility === 'private' ? 'private' : 'public';

    const typed = files.map((f) => ({ f, type: sniffType(f.path) }));
    const bad = typed.find((t) => !t.type);
    if (bad) {
      discard();
      return res.status(415).json({
        error: `${bad.f.originalname} is not a supported file. Use JPEG, PNG, GIF, WebP, AVIF, MP4, WebM or MOV.`,
      });
    }

    const ids = [];
    for (const { f, type } of typed) {
      const id = uid();
      const { kind, ext } = TYPES[type];
      const file = `${id}${ext}`;
      fs.renameSync(f.path, path.join(uploadsDir, file));
      run(
        'INSERT INTO media (id, owner_id, kind, mime, file, size, title, source_url, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, req.user.id, kind, type, file, f.size, title, sourceUrl, visibility, now(),
      );
      setTags(id, tags);
      ids.push(id);
    }

    const rows = ids.map((id) => getMedia(id));
    res.status(201).json({ media: serializeMedia(rows, req.user.id) });
  });

  // Discover: public media, newest first. scope=mine returns your own, private included.
  app.get('/api/media', (req, res) => {
    const limit = clampInt(req.query.limit, 60, 1, 100);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const where = [];
    const params = [];

    if (req.query.scope === 'mine') {
      if (!req.user) return res.status(401).json({ error: 'Log in to see your own media.' });
      where.push('m.owner_id = ?');
      params.push(req.user.id);
    } else {
      where.push("m.visibility = 'public'");
    }
    if (req.query.tag) {
      where.push('m.id IN (SELECT media_id FROM media_tags WHERE tag = ?)');
      params.push(normalizeTag(req.query.tag));
    }
    if (req.query.q) {
      const like = `%${String(req.query.q).trim()}%`;
      where.push('(m.title LIKE ? OR m.id IN (SELECT media_id FROM media_tags WHERE tag LIKE ?))');
      params.push(like, like);
    }

    const rows = all(
      `${MEDIA_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.id LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    res.json({ media: serializeMedia(rows, req.user?.id) });
  });

  app.get('/api/tags', (_req, res) => {
    const tags = all(
      `SELECT t.tag, COUNT(*) AS count FROM media_tags t JOIN media m ON m.id = t.media_id
       WHERE m.visibility = 'public' GROUP BY t.tag ORDER BY count DESC, t.tag LIMIT 100`,
    );
    res.json({ tags });
  });

  app.get('/api/media/:id', (req, res) => {
    const row = getMedia(req.params.id);
    if (!row || !canSeeMedia(row, req.user)) return res.status(404).json({ error: 'Not found.' });
    res.json({ media: serializeMedia([row], req.user?.id)[0] });
  });

  app.patch('/api/media/:id', requireUser, (req, res) => {
    const row = getMedia(req.params.id);
    if (!row || !canSeeMedia(row, req.user)) return res.status(404).json({ error: 'Not found.' });
    if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the uploader can edit this.' });

    const body = req.body ?? {};
    const title = 'title' in body ? String(body.title ?? '').trim().slice(0, 200) : row.title;
    const sourceUrl = 'source_url' in body ? normalizeUrl(body.source_url) : row.source_url;
    if (sourceUrl === null) return res.status(400).json({ error: 'source_url must be a http or https link.' });
    const visibility = 'visibility' in body
      ? (body.visibility === 'private' ? 'private' : 'public')
      : row.visibility;

    run('UPDATE media SET title = ?, source_url = ?, visibility = ? WHERE id = ?', title, sourceUrl, visibility, row.id);
    if ('tags' in body) setTags(row.id, normalizeTags(body.tags));
    res.json({ media: serializeMedia([getMedia(row.id)], req.user.id)[0] });
  });

  app.delete('/api/media/:id', requireUser, (req, res) => {
    const row = getMedia(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the uploader can delete this.' });
    run('DELETE FROM media WHERE id = ?', row.id);
    fs.rmSync(path.join(uploadsDir, row.file), { force: true });
    res.status(204).end();
  });

  // Boards ------------------------------------------------------------------

  // scope=public (default) lists shareable boards; scope=mine lists yours.
  app.get('/api/boards', (req, res) => {
    const params = [];
    let where;
    if (req.query.scope === 'mine') {
      if (!req.user) return res.status(401).json({ error: 'Log in to see your boards.' });
      where = 'b.owner_id = ?';
      params.push(req.user.id);
    } else {
      where = "b.visibility = 'public'";
    }
    if (req.query.category) {
      where += ' AND b.category = ?';
      params.push(normalizeTag(req.query.category));
    }
    const rows = all(`${BOARD_SELECT} WHERE ${where} ORDER BY b.created_at DESC LIMIT 200`, ...params);
    res.json({ boards: rows.map((b) => serializeBoard(b, req.user?.id)) });
  });

  app.post('/api/boards', requireUser, (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name || name.length > 100) return res.status(400).json({ error: 'Boards need a name of 1 to 100 characters.' });
    const description = String(req.body?.description ?? '').trim().slice(0, 500);
    const category = normalizeTag(req.body?.category);
    const visibility = req.body?.visibility === 'public' ? 'public' : 'private';
    const id = uid();
    run(
      'INSERT INTO boards (id, owner_id, name, description, category, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, req.user.id, name, description, category, visibility, now(),
    );
    res.status(201).json({ board: serializeBoard(getBoard(id), req.user.id) });
  });

  app.get('/api/boards/:id', (req, res) => {
    const board = getBoard(req.params.id);
    if (!board || !canSeeBoard(board, req.user)) return res.status(404).json({ error: 'Not found.' });
    const viewerId = req.user?.id ?? '';
    const rows = all(
      `${MEDIA_SELECT} JOIN board_items bi ON bi.media_id = m.id
       WHERE bi.board_id = ? AND (m.visibility = 'public' OR m.owner_id = ?)
       ORDER BY bi.added_at DESC`,
      board.id, viewerId,
    );
    res.json({
      board: serializeBoard(board, req.user?.id),
      media: serializeMedia(rows, req.user?.id),
    });
  });

  app.patch('/api/boards/:id', requireUser, (req, res) => {
    const board = getBoard(req.params.id);
    if (!board || !canSeeBoard(board, req.user)) return res.status(404).json({ error: 'Not found.' });
    if (board.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit this board.' });
    const body = req.body ?? {};
    const name = 'name' in body ? String(body.name ?? '').trim() : board.name;
    if (!name || name.length > 100) return res.status(400).json({ error: 'Boards need a name of 1 to 100 characters.' });
    const description = 'description' in body ? String(body.description ?? '').trim().slice(0, 500) : board.description;
    const category = 'category' in body ? normalizeTag(body.category) : board.category;
    const visibility = 'visibility' in body
      ? (body.visibility === 'public' ? 'public' : 'private')
      : board.visibility;
    run(
      'UPDATE boards SET name = ?, description = ?, category = ?, visibility = ? WHERE id = ?',
      name, description, category, visibility, board.id,
    );
    res.json({ board: serializeBoard(getBoard(board.id), req.user.id) });
  });

  app.delete('/api/boards/:id', requireUser, (req, res) => {
    const board = getBoard(req.params.id);
    if (!board) return res.status(404).json({ error: 'Not found.' });
    if (board.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete this board.' });
    run('DELETE FROM boards WHERE id = ?', board.id); // media itself is untouched
    res.status(204).end();
  });

  app.post('/api/boards/:id/items', requireUser, (req, res) => {
    const board = getBoard(req.params.id);
    if (!board || board.owner_id !== req.user.id) return res.status(404).json({ error: 'Not found.' });
    const media = getMedia(String(req.body?.media_id ?? ''));
    if (!media || !canSeeMedia(media, req.user)) return res.status(404).json({ error: 'That media does not exist.' });
    run(
      'INSERT OR IGNORE INTO board_items (board_id, media_id, added_at) VALUES (?, ?, ?)',
      board.id, media.id, now(),
    );
    res.status(201).json({ ok: true });
  });

  app.delete('/api/boards/:id/items/:mediaId', requireUser, (req, res) => {
    const board = getBoard(req.params.id);
    if (!board || board.owner_id !== req.user.id) return res.status(404).json({ error: 'Not found.' });
    run('DELETE FROM board_items WHERE board_id = ? AND media_id = ?', board.id, req.params.mediaId);
    res.status(204).end();
  });

  // Pin = save to a board. Without board_id it lands in your "Saved" board.
  app.post('/api/pins', requireUser, (req, res) => {
    const media = getMedia(String(req.body?.media_id ?? ''));
    if (!media || !canSeeMedia(media, req.user)) return res.status(404).json({ error: 'That media does not exist.' });
    let boardId;
    if (req.body?.board_id) {
      const board = getBoard(String(req.body.board_id));
      if (!board || board.owner_id !== req.user.id) return res.status(404).json({ error: 'That board does not exist.' });
      boardId = board.id;
    } else {
      boardId = savedBoardFor(req.user.id);
    }
    run(
      'INSERT OR IGNORE INTO board_items (board_id, media_id, added_at) VALUES (?, ?, ?)',
      boardId, media.id, now(),
    );
    res.status(201).json({ board_id: boardId, media_id: media.id });
  });

  // Errors and static files ---------------------------------------------------

  app.use('/media', express.static(uploadsDir, {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }));
  app.use(express.static(publicDir));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `Files are capped at ${MAX_BYTES / 1024 / 1024} MB each.` : err.message,
      });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something broke on our end.' });
  });

  return app;
}
