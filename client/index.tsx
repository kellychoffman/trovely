import { createClient, SignInWithSpacefast, signOut, storage, useAuth } from "@spacefast/zero/client";
import { useEffect, useState } from "preact/hooks";
import { css } from "./styles";
import { founderPins } from "./founder-pins";
import type app from "../server/index";

const api = createClient<typeof app>();

// Uploads go straight to Spacefast storage, which caps each object at 5 MiB.
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime",
];

type Media = {
  id: string; kind: string; url: string; title: string; sourceUrl: string;
  visibility: string; owner: string; ownerName: string; tags: string[];
};

type Route =
  | { name: "discover"; tag: string; q: string }
  | { name: "media"; id: string }
  | { name: "upload" }
  | { name: "boards" }
  | { name: "board"; id: string }
  | { name: "account" };

// A file picked before navigating to the upload page, so drops anywhere can start an upload.
let queued: File[] = [];

function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const [first = "", second = ""] = path.replace(/^\//, "").split("/");
  const params = new URLSearchParams(query);
  if (first === "m" && second) return { name: "media", id: second };
  if (first === "b" && second) return { name: "board", id: second };
  if (first === "upload") return { name: "upload" };
  if (first === "discover") return { name: "discover", tag: "", q: "" };
  if (first === "boards") return { name: "boards" };
  if (first === "account") return { name: "account" };
  return { name: "discover", tag: params.get("tag") ?? "", q: params.get("q") ?? "" };
}

function useHash(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

function startUpload(files: File[]) {
  if (!files.length) return;
  queued = files;
  location.hash = "#/upload";
}

// ---- shared pieces --------------------------------------------------------

function Tile({ m }: { m: Media }) {
  return (
    <a class="tile" href={`#/m/${m.id}`} title={m.title || m.tags.join(", ")}>
      {m.kind === "video"
        ? <video src={m.url} muted loop autoPlay playsInline preload="metadata" />
        : <img src={m.url} loading="lazy" alt={m.title || m.tags.join(", ") || "inspiration"} />}
    </a>
  );
}

function Grid({ items, after }: { items: Media[]; after?: (m: Media) => any }) {
  return (
    <div class="grid">
      {items.map((m) => (
        <div key={m.id} style={{ position: "relative" }}>
          <Tile m={m} />
          {after?.(m)}
        </div>
      ))}
    </div>
  );
}

function Dropzone({ onFiles, label }: { onFiles: (files: File[]) => void; label: string }) {
  const [over, setOver] = useState(false);
  return (
    <label
      class={over ? "dropzone over" : "dropzone"}
      tabIndex={0}
      onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onFiles([...(e.dataTransfer?.files ?? [])]);
      }}
    >
      {label}
      <input
        type="file" multiple accept="image/*,video/*" hidden
        onChange={(e: any) => onFiles([...e.currentTarget.files])}
      />
    </label>
  );
}

function SignInPrompt({ message }: { message: string }) {
  return (
    <div class="stack">
      <p>{message}</p>
      <SignInWithSpacefast />
    </div>
  );
}

// ---- pages ----------------------------------------------------------------

// Shuffle like kelly.blog's /inspiration: a new random order on every visit.
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function Discover() {
  const media = api.useQuery("discover") as Media[] | undefined;
  const founder = api.useQuery("founderStatus") as { isFounder: boolean; count: number; signedIn: boolean; yourId: string | null } | undefined;
  const importPins = api.useMutation("importFounderPins");
  const [order, setOrder] = useState<string[]>([]);
  const [importMsg, setImportMsg] = useState("");
  const ids = (media ?? []).map((m) => m.id).join(",");

  useEffect(() => {
    setOrder(shuffled((media ?? []).map((m) => m.id)));
  }, [ids]);

  const byId = new Map((media ?? []).map((m) => [m.id, m]));
  const items = order.map((id) => byId.get(id)).filter(Boolean) as Media[];

  return (
    <div class="ib">
      <header class="ib-header">
        <a class="ib-home" href="https://kelly.blog/">kelly.blog</a>
        <div class="ib-line">
          <h1 class="ib-title">Inspiration ✶</h1>
          <a class="ib-shuffle" href="#/discover" onClick={(e: any) => {
            e.preventDefault();
            setOrder(shuffled(order));
          }}>Shuffle</a>
        </div>
      </header>

      {founder?.signedIn && !founder.isFounder ? (
        <p class="small muted">Signed in, but not as the founder. Your ID here is {founder.yourId}.</p>
      ) : null}
      {founder?.isFounder && founder.count < founderPins.length ? (
        <div class="stack" style={{ marginBottom: "24px" }}>
          <p class="small muted">Founder: import your kelly.blog pins to this board ({founder.count} of {founderPins.length} imported). They stay on kelly.blog.</p>
          <div class="row">
            <button onClick={async () => {
              setImportMsg("Importing…");
              try {
                const pins = founderPins;
                let added = 0;
                for (let i = 0; i < pins.length; i += 100) {
                  added += await importPins({ items: pins.slice(i, i + 100) }) as number;
                  setImportMsg(`Imported ${Math.min(i + 100, pins.length)} of ${pins.length}…`);
                }
                setImportMsg(`Done: ${added} pins added.`);
              } catch (ex: any) { setImportMsg(ex.message); }
            }}>import founder pins</button>
          </div>
          <p class="small muted">{importMsg}</p>
        </div>
      ) : null}

      {media === undefined
        ? <p class="muted">Loading…</p>
        : items.length
          ? (
            <div class="ib-grid">
              {items.map((m) => (
                <a key={m.id} class="ib-pin" href={`#/m/${m.id}`}>
                  <div class="ib-tile">
                    {m.kind === "video"
                      ? <video src={m.url} muted loop autoPlay playsInline preload="metadata" />
                      : <img src={m.url} loading="lazy" alt="" />}
                  </div>
                </a>
              ))}
            </div>
          )
          : <p class="muted">Nothing on the board yet.</p>}
    </div>
  );
}

function MediaPage({ id }: { id: string }) {
  const data = api.useQuery("media", { id }) as Media | null | undefined;
  const auth = useAuth();
  const isSignedIn = auth.isSignedIn;
  const boards = api.useQuery("myBoards") as ({ id: string; name: string } & Record<string, unknown>)[] | undefined;
  const pin = api.useMutation("pin");
  const updateMedia = api.useMutation("updateMedia");
  const deleteMedia = api.useMutation("deleteMedia");
  const [boardId, setBoardId] = useState("");
  const [status, setStatus] = useState("");

  if (data === undefined) return <p class="muted">Loading…</p>;
  if (data === null) return <p>That upload is private or gone. <a href="#/">Back to discover.</a></p>;

  const mine = auth.userId === data.owner;
  return (
    <>
      <p><a href="#/">← discover</a></p>
      <div class="detail">
        <div class="media">
          {data.kind === "video"
            ? <video src={data.url} controls playsInline preload="metadata" />
            : <img src={data.url} alt={data.title || "inspiration"} />}
        </div>
        <div class="side">
          <div>
            <div class="small muted">by {data.ownerName || "someone"}</div>
            {data.title ? <h1>{data.title}</h1> : null}
            {data.visibility === "private" ? <p class="small muted">Private: not listed on Discover.</p> : null}
          </div>
          {data.tags.length ? (
            <div class="chips">
              {data.tags.map((t) => <a key={t} class="chip" href={`#/?tag=${encodeURIComponent(t)}`}>{t}</a>)}
            </div>
          ) : null}
          {data.sourceUrl ? <a href={data.sourceUrl} rel="noopener noreferrer" target="_blank">source ↗</a> : null}

          {isSignedIn ? (
            <div class="stack">
              <label>pin to board
                <select value={boardId} onChange={(e: any) => setBoardId(e.currentTarget.value)}>
                  <option value="">Saved</option>
                  {(boards ?? []).filter((b) => b.name !== "Saved").map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
              <div class="row">
                <button onClick={async () => {
                  setStatus("");
                  try {
                    await pin({ mediaId: data.id, boardId: boardId || undefined });
                    setStatus("Pinned.");
                  } catch (ex: any) { setStatus(ex.message); }
                }}>pin</button>
              </div>
            </div>
          ) : <SignInPrompt message="Log in to pin this to a board." />}
          <p class="small muted">{status}</p>

          {mine ? <OwnerEdit media={data} onSave={updateMedia} onDelete={deleteMedia} /> : null}
        </div>
      </div>
    </>
  );
}

function OwnerEdit({ media, onSave, onDelete }: { media: Media; onSave: any; onDelete: any }) {
  const [title, setTitle] = useState(media.title);
  const [tags, setTags] = useState(media.tags.join(", "));
  const [source, setSource] = useState(media.sourceUrl);
  const [visibility, setVisibility] = useState(media.visibility);
  const [msg, setMsg] = useState("");
  return (
    <details style={{ marginTop: "12px" }}>
      <summary>edit</summary>
      <form class="stack" style={{ marginTop: "8px" }} onSubmit={async (e: any) => {
        e.preventDefault();
        try {
          await onSave({
            id: media.id, title, sourceUrl: source, visibility,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          });
          setMsg("Saved.");
        } catch (ex: any) { setMsg(ex.message); }
      }}>
        <label>title<input value={title} onInput={(e: any) => setTitle(e.currentTarget.value)} /></label>
        <label>tags<input value={tags} onInput={(e: any) => setTags(e.currentTarget.value)} /></label>
        <label>source link<input type="url" value={source} onInput={(e: any) => setSource(e.currentTarget.value)} /></label>
        <label>visibility
          <select value={visibility} onChange={(e: any) => setVisibility(e.currentTarget.value)}>
            <option value="public">public (on Discover)</option>
            <option value="private">private</option>
          </select>
        </label>
        <div class="row">
          <button type="submit">save</button>
          <button type="button" class="danger" onClick={async () => {
            if (!confirm("Delete this upload? It will be removed from every board too.")) return;
            try {
              const storageId = await onDelete({ id: media.id });
              if (storageId) await storage.delete(storageId);
              location.hash = "#/";
            } catch (ex: any) { setMsg(ex.message); }
          }}>delete</button>
        </div>
        <p class="small muted">{msg}</p>
      </form>
    </details>
  );
}

function Upload() {
  const { isSignedIn } = useAuth();
  const addMedia = api.useMutation("addMedia");
  const [files, setFiles] = useState<File[]>(queued);
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!isSignedIn) return <SignInPrompt message="Log in to upload. Your files are kept while you sign in." />;

  const pick = (picked: File[]) => { queued = picked; setFiles(picked); };

  async function submit(e: any) {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    const created: string[] = [];
    try {
      for (const file of files) {
        if (!ALLOWED.includes(file.type)) throw new Error(`${file.name} is not a supported type. Use JPEG, PNG, GIF, WebP, AVIF, MP4, WebM or MOV.`);
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 5 MB, the limit for uploads.`);
        setMsg(`Uploading ${file.name}…`);
        const obj = await storage.upload(file, { public: true });
        await addMedia({
          storageId: obj.id, url: obj.url, kind: file.type.startsWith("video/") ? "video" : "image",
          mime: file.type, title, sourceUrl: source, visibility,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        });
        created.push(file.name);
      }
      queued = [];
      location.hash = "#/";
    } catch (ex: any) {
      setMsg(`${ex.message}${created.length ? ` (${created.length} uploaded before this one)` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>upload</h1>
      <p class="muted small">JPEG, PNG, GIF, WebP, AVIF, MP4, WebM or MOV. Up to 5 MB each.</p>
      <form class="stack" onSubmit={submit}>
        <Dropzone onFiles={pick} label={files.length ? `${files.length} file${files.length === 1 ? "" : "s"} ready. Drop more or choose again.` : "Drop photos or videos here, or choose files"} />
        <label>tags<input value={tags} placeholder="warm, interiors, 70s" onInput={(e: any) => setTags(e.currentTarget.value)} /></label>
        <label>title<input value={title} placeholder="optional" onInput={(e: any) => setTitle(e.currentTarget.value)} /></label>
        <label>source link<input type="url" value={source} placeholder="optional" onInput={(e: any) => setSource(e.currentTarget.value)} /></label>
        <label>visibility
          <select value={visibility} onChange={(e: any) => setVisibility(e.currentTarget.value)}>
            <option value="public">public: on Discover</option>
            <option value="private">private: just for me</option>
          </select>
        </label>
        <div class="row">
          <button type="submit" disabled={busy || files.length === 0}>{busy ? "uploading…" : `upload ${files.length || ""}`.trim()}</button>
          <button type="button" class="ghost" onClick={() => pick([])}>clear</button>
        </div>
        <p class="small error">{msg}</p>
      </form>
    </>
  );
}

function Boards() {
  const { isSignedIn } = useAuth();
  const mine = api.useQuery("myBoards") as any[] | undefined;
  const shared = api.useQuery("publicBoards") as any[] | undefined;
  const createBoard = api.useMutation("createBoard");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [msg, setMsg] = useState("");

  const row = (b: any) => (
    <li key={b.id}>
      <a href={`#/b/${b.id}`}>{b.name}</a> · {b.itemCount} {b.itemCount === 1 ? "item" : "items"}
      {b.category ? ` · ${b.category}` : ""}
      {b.visibility === "private" ? <span class="muted"> · private</span> : null}
    </li>
  );

  return (
    <>
      <h1>boards</h1>
      {isSignedIn ? (
        <>
          <h2>yours</h2>
          {mine === undefined ? null : mine.length ? <ul class="board-list">{mine.map(row)}</ul> : <p class="muted">No boards yet.</p>}
        </>
      ) : <SignInPrompt message="Log in to make boards." />}
      <h2>shared</h2>
      {shared === undefined ? null : shared.length
        ? <ul class="board-list">{shared.map((b) => <li key={b.id}><a href={`#/b/${b.id}`}>{b.name}</a> · {b.itemCount}</li>)}</ul>
        : <p class="muted">No public boards yet.</p>}
      {isSignedIn ? (
        <form class="stack" style={{ marginTop: "24px" }} onSubmit={async (e: any) => {
          e.preventDefault();
          try {
            const id = await createBoard({ name, category, visibility });
            location.hash = `#/b/${id}`;
          } catch (ex: any) { setMsg(ex.message); }
        }}>
          <h2>new board</h2>
          <label>name<input value={name} required onInput={(e: any) => setName(e.currentTarget.value)} /></label>
          <label>category<input value={category} placeholder="e.g. interiors" onInput={(e: any) => setCategory(e.currentTarget.value)} /></label>
          <label>visibility
            <select value={visibility} onChange={(e: any) => setVisibility(e.currentTarget.value)}>
              <option value="private">private</option>
              <option value="public">public (shareable)</option>
            </select>
          </label>
          <div class="row"><button type="submit">create</button></div>
          <p class="error small">{msg}</p>
        </form>
      ) : null}
    </>
  );
}

function BoardPage({ id }: { id: string }) {
  const data = api.useQuery("board", { id }) as any;
  const { isSignedIn } = useAuth();
  const updateBoard = api.useMutation("updateBoard");
  const deleteBoard = api.useMutation("deleteBoard");
  const removeFromBoard = api.useMutation("removeFromBoard");
  const [msg, setMsg] = useState("");

  if (data === undefined) return <p class="muted">Loading…</p>;
  if (data === null) return <p>That board is private or gone. <a href="#/boards">Back to boards.</a></p>;

  const { board, media } = data as { board: any; media: Media[] };
  const shareUrl = `${location.origin}/#/b/${board.id}`;

  return (
    <>
      <p class="small muted">{board.isMine ? "your board" : `by ${board.ownerName || "someone"}`}</p>
      <h1>{board.name}</h1>
      {board.category ? <p class="small muted">category: {board.category}</p> : null}
      {board.description ? <p>{board.description}</p> : null}
      <p class="small">
        {board.visibility === "public"
          ? <><span class="muted">{shareUrl}</span> <button class="ghost" onClick={() => navigator.clipboard?.writeText(shareUrl)}>copy link</button></>
          : <span class="muted">private: only you can see this board</span>}
      </p>

      {board.isMine ? (
        <details style={{ marginTop: "12px" }}>
          <summary>edit board</summary>
          <form class="stack" style={{ marginTop: "8px" }} onSubmit={async (e: any) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await updateBoard({
                id: board.id,
                name: String(f.get("name")),
                description: String(f.get("description")),
                category: String(f.get("category")),
                visibility: String(f.get("visibility")),
              });
              setMsg("Saved.");
            } catch (ex: any) { setMsg(ex.message); }
          }}>
            <label>name<input name="name" defaultValue={board.name} /></label>
            <label>category<input name="category" defaultValue={board.category} /></label>
            <label>description<input name="description" defaultValue={board.description} /></label>
            <label>visibility
              <select name="visibility" defaultValue={board.visibility}>
                <option value="private">private</option>
                <option value="public">public (shareable)</option>
              </select>
            </label>
            <div class="row">
              <button type="submit">save</button>
              <button type="button" class="danger" onClick={async () => {
                if (!confirm("Delete this board? The uploads stay on Discover.")) return;
                await deleteBoard({ id: board.id });
                location.hash = "#/boards";
              }}>delete board</button>
            </div>
            <p class="small muted">{msg}</p>
          </form>
        </details>
      ) : null}

      <div style={{ height: "16px" }} />
      {media.length
        ? <Grid items={media} after={board.isMine ? (m: Media) => (
            <button class="remove danger" title="Remove from this board" onClick={(e: any) => {
              e.preventDefault();
              removeFromBoard({ boardId: board.id, mediaId: m.id });
            }}>×</button>
          ) : undefined} />
        : <p class="muted">{board.isMine ? "Empty. Pin something from Discover." : "Nothing on this board yet."}</p>}
    </>
  );
}

function Account() {
  const auth = useAuth();
  if (!auth.isSignedIn) return <SignInPrompt message="Sign in to manage your account." />;
  return (
    <div class="stack">
      <h1>{auth.displayName}</h1>
      <button onClick={() => void signOut()}>log out</button>
    </div>
  );
}

function App() {
  const route = useHash();
  const auth = useAuth();

  let page: any;
  switch (route.name) {
    case "media": page = <MediaPage id={route.id} />; break;
    case "upload": page = <Upload />; break;
    case "boards": page = <Boards />; break;
    case "board": page = <BoardPage id={route.id} />; break;
    case "account": page = <Account />; break;
    default: page = <Discover />;
  }

  return (
    <>
      <style>{css}</style>
      <header class="top">
        <a class="wordmark" href="#/">trovely</a>
        <nav>
          <a href="#/">discover</a>
          <a href="#/boards">boards</a>
          <a href="#/upload">upload</a>
          {auth.isSignedIn
            ? <a href="#/account">@{auth.displayName}</a>
            : <SignInWithSpacefast />}
        </nav>
      </header>
      <main>{page}</main>
    </>
  );
}

// Drop files anywhere to start an upload.
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  startUpload([...e.dataTransfer.files]);
});

export default App;
