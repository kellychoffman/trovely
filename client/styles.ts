// Generated from styles.css. Injected as a <style> tag because the Zero client has no stylesheet bundling.
export const css = `/* Are.na-leaning: square tiles, uncropped media, no captions, no rounded corners. */
:root {
  --bg: #fff;
  --fg: #111;
  --muted: #777;
  --line: #e6e6e6;
  --chip: #f2f2f2;
  --accent: #111;
  --danger: #b00020;
  --gap: 8px;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #111;
    --fg: #f2f2f2;
    --muted: #999;
    --line: #2a2a2a;
    --chip: #1d1d1d;
    --accent: #f2f2f2;
  }
}
:root[data-theme="dark"] {
  --bg: #111;
  --fg: #f2f2f2;
  --muted: #999;
  --line: #2a2a2a;
  --chip: #1d1d1d;
  --accent: #f2f2f2;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: inherit; }
main { padding: 16px; max-width: 1400px; margin: 0 auto; }
h1 { font-size: 22px; font-weight: 600; margin: 8px 0 4px; }
h2 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
.muted { color: var(--muted); }
.error { color: var(--danger); }
.small { font-size: 13px; }

.top {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px 16px; padding: 12px 16px;
  border-bottom: 1px solid var(--line); position: sticky; top: 0;
  background: var(--bg); z-index: 2;
}
.top nav { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
.top nav a { text-decoration: none; }
.wordmark { font-weight: 700; letter-spacing: -0.02em; text-decoration: none; font-size: 18px; }

button, .button {
  font: inherit; cursor: pointer; border: 1px solid var(--fg);
  background: var(--fg); color: var(--bg); padding: 6px 12px;
  text-decoration: none; display: inline-block;
}
button.ghost, .button.ghost { background: transparent; color: var(--fg); }
button.danger { border-color: var(--danger); background: var(--danger); color: #fff; }
button:disabled { opacity: .5; cursor: default; }

input, select, textarea {
  font: inherit; color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); padding: 7px 9px; width: 100%; max-width: 420px;
}
label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
.stack { display: grid; gap: 12px; max-width: 460px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

.dropzone {
  display: block; border: 1px dashed var(--muted); padding: 28px 16px;
  text-align: center; cursor: pointer; margin: 8px 0 16px;
}
.dropzone.over { border-color: var(--fg); background: var(--chip); }
.link { text-decoration: underline; }

.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 16px; }
.chip { background: var(--chip); padding: 3px 9px; text-decoration: none; font-size: 13px; }
.chip.on { background: var(--fg); color: var(--bg); }

.grid {
  display: grid; gap: var(--gap);
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}
.tile {
  position: relative; aspect-ratio: 1 / 1; background: var(--chip);
  display: block; overflow: hidden;
}
.tile img, .tile video {
  width: 100%; height: 100%; object-fit: contain; display: block;
}
.tile .remove {
  position: absolute; top: 6px; right: 6px; font-size: 12px; padding: 2px 6px;
}

.board-list { display: grid; gap: 6px; padding: 0; list-style: none; }
.board-list li { border-bottom: 1px solid var(--line); padding: 8px 0; }

.detail { display: grid; gap: 16px; grid-template-columns: minmax(0, 2fr) minmax(220px, 1fr); align-items: start; }
.detail .media { background: var(--chip); }
.detail .media img, .detail .media video { width: 100%; max-height: 80vh; object-fit: contain; display: block; }
.detail .side { display: grid; gap: 12px; }
.file-list { padding-left: 18px; margin: 4px 0; }

@media (max-width: 720px) {
  main { padding: 12px; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
  .detail { grid-template-columns: 1fr; }
}
`;
