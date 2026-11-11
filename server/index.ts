import { capsule, id, mutation, query, string, table, userId } from "@spacefast/zero/server";

// Visibility and kinds are plain strings so the schema stays small and readable.
const PUBLIC = "public";
const PRIVATE = "private";
const KINDS = ["image", "video"];

// Storage objects are capped at 5 MiB on Spacefast. Enforced again in the client.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function normalizeTags(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

// "" for empty, the URL for http(s), null when invalid.
function cleanUrl(value: string | undefined): string | null {
  const s = (value ?? "").trim();
  if (!s) return "";
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 2000) : null;
}

function cleanVisibility(value: string | undefined): string {
  return value === PRIVATE ? PRIVATE : PUBLIC;
}

export default capsule({
  name: "trovely",

  schema: {
    media: table({
      owner: userId(),
      ownerName: string().default(""),
      kind: string(),
      mime: string(),
      storageId: string(),
      url: string(),
      title: string().default(""),
      sourceUrl: string().default(""),
      visibility: string().default("public"),
    })
      .index("by_owner", ["owner"])
      .index("by_visibility", ["visibility"]),

    mediaTags: table({
      media: id("media"),
      tag: string(),
    })
      .index("by_media", ["media"])
      .index("by_tag", ["tag"]),

    boards: table({
      owner: userId(),
      name: string(),
      description: string().default(""),
      category: string().default(""),
      visibility: string().default("private"),
    })
      .index("by_owner", ["owner"])
      .index("by_visibility", ["visibility"]),

    boardItems: table({
      board: id("boards"),
      media: id("media"),
    })
      .index("by_board", ["board"])
      .index("by_media", ["media"]),
  },

  // Guests can browse. Writing needs a signed-in account.
  queries: {
    // /discover is the founder's board: public pins owned by FOUNDER_USER_ID.
    discover: query(async (ctx) => {
      const founder = ctx.env.FOUNDER_USER_ID;
      if (!founder) return [];
      const rows = await ctx.db.media.withIndex("by_owner", (r) => r.eq("owner", founder)).collect();
      return withTags(ctx, rows.filter((m) => m.visibility === PUBLIC));
    }),

    // Tells the founder's browser whether to offer the one-time import.
    founderStatus: query(async (ctx) => {
      const founder = ctx.env.FOUNDER_USER_ID;
      const isFounder = Boolean(founder) && ctx.auth.userId === founder;
      const mine = founder ? await ctx.db.media.withIndex("by_owner", (r) => r.eq("owner", founder)).collect() : [];
      const siteSources = mine.filter((m) => /kelly\.blog/.test(m.sourceUrl)).length;
      return { isFounder, count: mine.length, siteSources };
    }),

    tagCounts: query(async (ctx) => {
      const rows = await ctx.db.media.withIndex("by_visibility", (r) => r.eq("visibility", PUBLIC)).take(300);
      const counts = new Map<string, number>();
      for (const m of rows) {
        for (const tag of await tagsFor(ctx, m.id)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .slice(0, 60);
    }),

    media: query(async (ctx, args: { id: string }) => {
      const m = await ctx.db.media.get(args.id);
      if (!m) return null;
      const viewer = ctx.auth.userId;
      if (m.visibility !== PUBLIC && m.owner !== viewer) return null;
      return (await withTags(ctx, [m]))[0];
    }),

    myMedia: query(async (ctx) => {
      const { userId } = ctx.auth.requireIdentity();
      const rows = await ctx.db.media.withIndex("by_owner", (r) => r.eq("owner", userId)).collect();
      rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return withTags(ctx, rows);
    }),

    publicBoards: query(async (ctx) => {
      const rows = await ctx.db.boards.withIndex("by_visibility", (r) => r.eq("visibility", PUBLIC)).take(200);
      return withCounts(ctx, rows);
    }),

    myBoards: query(async (ctx) => {
      const { userId } = ctx.auth.requireIdentity();
      const rows = await ctx.db.boards.withIndex("by_owner", (r) => r.eq("owner", userId)).collect();
      return withCounts(ctx, rows);
    }),

    board: query(async (ctx, args: { id: string }) => {
      const board = await ctx.db.boards.get(args.id);
      if (!board) return null;
      const viewer = ctx.auth.userId;
      if (board.visibility !== PUBLIC && board.owner !== viewer) return null;
      const links = await ctx.db.boardItems.withIndex("by_board", (r) => r.eq("board", board.id)).collect();
      const media = [];
      for (const link of links) {
        const m = await ctx.db.media.get(link.media);
        if (m && (m.visibility === PUBLIC || m.owner === viewer)) media.push(m);
      }
      media.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return {
        board: { ...board, isMine: board.owner === viewer, itemCount: media.length },
        media: await withTags(ctx, media),
      };
    }),
  },

  mutations: {
    // One-time import of the founder's pins. Files stay on kelly.blog, so storageId is empty.
    importFounderPins: mutation(async (ctx, args: {
      items: { url: string; kind: string; mime: string; sourceUrl?: string }[];
    }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const founder = ctx.env.FOUNDER_USER_ID;
      if (!founder || userId !== founder) throw new Error("Only the founder can import these.");
      const existing = await ctx.db.media.withIndex("by_owner", (r) => r.eq("owner", userId)).collect();
      const seen = new Set(existing.map((m) => m.url));
      let added = 0;
      for (const item of args.items.slice(0, 100)) {
        if (!KINDS.includes(item.kind) || !/^https:\/\/kelly\.blog\//.test(item.url)) continue;
        if (seen.has(item.url)) continue;
        const sourceUrl = cleanUrl(item.sourceUrl) ?? "";
        await ctx.db.media.insert({
          owner: userId,
          ownerName: "kelly",
          kind: item.kind,
          mime: item.mime,
          storageId: "",
          url: item.url,
          title: "",
          sourceUrl,
          visibility: PUBLIC,
        });
        seen.add(item.url);
        added += 1;
      }
      ctx.invalidate();
      return added;
    }),

    // One-time fix: point founder pins at their original source instead of kelly.blog.
    updateFounderSources: mutation(async (ctx, args: { items: { url: string; sourceUrl: string }[] }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const founder = ctx.env.FOUNDER_USER_ID;
      if (!founder || userId !== founder) throw new Error("Only the founder can change these.");
      const mine = await ctx.db.media.withIndex("by_owner", (r) => r.eq("owner", userId)).collect();
      const byUrl = new Map(mine.map((m) => [m.url, m]));
      let updated = 0;
      for (const item of args.items.slice(0, 100)) {
        const row = byUrl.get(item.url);
        const sourceUrl = cleanUrl(item.sourceUrl);
        if (!row || sourceUrl === null) continue;
        await ctx.db.media.update(row.id, { sourceUrl });
        updated += 1;
      }
      ctx.invalidate();
      return updated;
    }),

    addMedia: mutation(async (ctx, args: {
      storageId: string; url: string; kind: string; mime: string;
      title?: string; sourceUrl?: string; visibility?: string; tags?: string[];
    }) => {
      const { userId, displayName } = ctx.auth.requireSignedIn();
      if (!KINDS.includes(args.kind)) throw new Error("Only images and videos can be uploaded.");
      const sourceUrl = cleanUrl(args.sourceUrl);
      if (sourceUrl === null) throw new Error("The source link must start with http:// or https://.");
      const row = await ctx.db.media.insert({
        owner: userId,
        ownerName: displayName ?? "",
        kind: args.kind,
        mime: args.mime,
        storageId: args.storageId,
        url: args.url,
        title: (args.title ?? "").trim().slice(0, 200),
        sourceUrl,
        visibility: cleanVisibility(args.visibility),
      });
      await setTags(ctx, row.id, normalizeTags(args.tags ?? []));
      ctx.invalidate();
      return row.id;
    }),

    updateMedia: mutation(async (ctx, args: {
      id: string; title?: string; sourceUrl?: string; visibility?: string; tags?: string[];
    }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const m = await ctx.db.media.get(args.id);
      if (!m) throw new Error("That upload no longer exists.");
      if (m.owner !== userId) throw new Error("Only the uploader can edit this.");
      const patch: Record<string, string> = {};
      if (args.title !== undefined) patch.title = args.title.trim().slice(0, 200);
      if (args.sourceUrl !== undefined) {
        const url = cleanUrl(args.sourceUrl);
        if (url === null) throw new Error("The source link must start with http:// or https://.");
        patch.sourceUrl = url;
      }
      if (args.visibility !== undefined) patch.visibility = cleanVisibility(args.visibility);
      await ctx.db.media.update(m.id, patch);
      if (args.tags !== undefined) await setTags(ctx, m.id, normalizeTags(args.tags));
      ctx.invalidate();
    }),

    // Returns the storage ID so the client can delete the file after this succeeds.
    deleteMedia: mutation(async (ctx, args: { id: string }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const m = await ctx.db.media.get(args.id);
      if (!m) return null;
      if (m.owner !== userId) throw new Error("Only the uploader can delete this.");
      for (const t of await ctx.db.mediaTags.withIndex("by_media", (r) => r.eq("media", m.id)).collect()) {
        await ctx.db.mediaTags.delete(t.id);
      }
      for (const link of await ctx.db.boardItems.withIndex("by_media", (r) => r.eq("media", m.id)).collect()) {
        await ctx.db.boardItems.delete(link.id);
      }
      await ctx.db.media.delete(m.id);
      ctx.invalidate();
      return m.storageId;
    }),

    createBoard: mutation(async (ctx, args: { name: string; description?: string; category?: string; visibility?: string }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const name = (args.name ?? "").trim();
      if (!name || name.length > 100) throw new Error("Boards need a name of 1 to 100 characters.");
      const row = await ctx.db.boards.insert({
        owner: userId,
        name,
        description: (args.description ?? "").trim().slice(0, 500),
        category: normalizeTag(args.category ?? ""),
        visibility: args.visibility === PUBLIC ? PUBLIC : PRIVATE,
      });
      ctx.invalidate();
      return row.id;
    }),

    updateBoard: mutation(async (ctx, args: { id: string; name?: string; description?: string; category?: string; visibility?: string }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const b = await ctx.db.boards.get(args.id);
      if (!b) throw new Error("That board no longer exists.");
      if (b.owner !== userId) throw new Error("Only the owner can edit this board.");
      const patch: Record<string, string> = {};
      if (args.name !== undefined) {
        const name = args.name.trim();
        if (!name || name.length > 100) throw new Error("Boards need a name of 1 to 100 characters.");
        patch.name = name;
      }
      if (args.description !== undefined) patch.description = args.description.trim().slice(0, 500);
      if (args.category !== undefined) patch.category = normalizeTag(args.category);
      if (args.visibility !== undefined) patch.visibility = args.visibility === PUBLIC ? PUBLIC : PRIVATE;
      await ctx.db.boards.update(b.id, patch);
      ctx.invalidate();
    }),

    deleteBoard: mutation(async (ctx, args: { id: string }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const b = await ctx.db.boards.get(args.id);
      if (!b) return;
      if (b.owner !== userId) throw new Error("Only the owner can delete this board.");
      for (const link of await ctx.db.boardItems.withIndex("by_board", (r) => r.eq("board", b.id)).collect()) {
        await ctx.db.boardItems.delete(link.id);
      }
      await ctx.db.boards.delete(b.id);
      ctx.invalidate();
    }),

    addToBoard: mutation(async (ctx, args: { boardId: string; mediaId: string }) => {
      await addLink(ctx, args.boardId, args.mediaId);
    }),

    removeFromBoard: mutation(async (ctx, args: { boardId: string; mediaId: string }) => {
      const { userId } = ctx.auth.requireSignedIn();
      const b = await ctx.db.boards.get(args.boardId);
      if (!b || b.owner !== userId) throw new Error("Only the owner can change this board.");
      for (const link of await ctx.db.boardItems.withIndex("by_board", (r) => r.eq("board", b.id)).collect()) {
        if (link.media === args.mediaId) await ctx.db.boardItems.delete(link.id);
      }
      ctx.invalidate();
    }),

    // Pin = save to a board. Without a boardId it lands in your "Saved" board.
    pin: mutation(async (ctx, args: { mediaId: string; boardId?: string }) => {
      const { userId } = ctx.auth.requireSignedIn();
      let boardId = args.boardId;
      if (!boardId) {
        const mine = await ctx.db.boards.withIndex("by_owner", (r) => r.eq("owner", userId)).collect();
        const saved = mine.find((b) => b.name === "Saved");
        boardId = saved
          ? saved.id
          : (await ctx.db.boards.insert({ owner: userId, name: "Saved", visibility: PRIVATE })).id;
      }
      await addLink(ctx, boardId, args.mediaId);
      return boardId;
    }),
  },
});

// ---- helpers (typed loosely so they work with the runtime's context) -------

type Ctx = any;

async function tagsFor(ctx: Ctx, mediaId: string): Promise<string[]> {
  const rows = await ctx.db.mediaTags.withIndex("by_media", (r: Ctx) => r.eq("media", mediaId)).collect();
  return rows.map((r: { tag: string }) => r.tag).sort();
}

async function withTags(ctx: Ctx, rows: Ctx[]) {
  const out = [];
  for (const m of rows) out.push({ ...m, tags: await tagsFor(ctx, m.id) });
  return out;
}

async function withCounts(ctx: Ctx, rows: Ctx[]) {
  const out = [];
  for (const b of rows) {
    const links = await ctx.db.boardItems.withIndex("by_board", (r: Ctx) => r.eq("board", b.id)).collect();
    out.push({ ...b, itemCount: links.length });
  }
  return out;
}

async function setTags(ctx: Ctx, mediaId: string, tags: string[]) {
  for (const t of await ctx.db.mediaTags.withIndex("by_media", (r: Ctx) => r.eq("media", mediaId)).collect()) {
    await ctx.db.mediaTags.delete(t.id);
  }
  for (const tag of tags) await ctx.db.mediaTags.insert({ media: mediaId, tag });
}

async function addLink(ctx: Ctx, boardId: string, mediaId: string) {
  const { userId } = ctx.auth.requireSignedIn();
  const b = await ctx.db.boards.get(boardId);
  if (!b || b.owner !== userId) throw new Error("That board does not exist.");
  const m = await ctx.db.media.get(mediaId);
  if (!m || (m.visibility !== PUBLIC && m.owner !== userId)) throw new Error("That upload does not exist.");
  const existing = await ctx.db.boardItems.withIndex("by_board", (r: Ctx) => r.eq("board", boardId)).collect();
  if (existing.some((l: { media: string }) => l.media === mediaId)) return;
  await ctx.db.boardItems.insert({ board: boardId, media: mediaId });
  ctx.invalidate();
}
