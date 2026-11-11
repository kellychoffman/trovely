// trovely front end. Plain ES modules, no build step, so it is easy to read and change.

const app = document.getElementById('app');
let me = null;
let queued = []; // files waiting on the upload page

// ---- tiny helpers ----------------------------------------------------------

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, { method = 'GET', json, body } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (body !== undefined) {
    init.body = body; // FormData sets its own content-type
  }
  const res = await fetch(path, init);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function mediaEl(m, { controls = false } = {}) {
  if (m.kind === 'video') {
    return h('video', {
      src: m.url, muted: !controls, loop: !controls, playsinline: true,
      controls, preload: 'metadata',
    });
  }
  return h('img', { src: m.url, loading: 'lazy', alt: m.title || m.tags.join(', ') || 'inspiration' });
}

// Videos in tiles play only while on screen, muted, to keep the grid light.
const videoObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) target.play().catch(() => {});
        else target.pause();
      }
    }, { threshold: 0.25 })
  : null;

function tile(m, extra = null) {
  const el = mediaEl(m);
  if (m.kind === 'video' && videoObserver) {
    queueMicrotask(() => videoObserver.observe(el));
  }
  return h('a', { class: 'tile', href: `#/m/${m.id}`, title: m.title || m.tags.join(', ') }, el, extra);
}

const grid = (items, extraFor) => h('div', { class: 'grid' }, items.map((m) => tile(m, extraFor?.(m))));

function copyButton(text, label = 'copy') {
  const btn = h('button', {
    class: 'ghost',
    onclick: async () => {
      await navigator.clipboard.writeText(text).catch(() => {});
      btn.textContent = 'copied';
      setTimeout(() => (btn.textContent = label), 1200);
    },
  }, label);
  return btn;
}

function needLogin(message) {
  return h('div', { class: 'stack' },
    h('p', null, message),
    h('div', { class: 'row' },
      h('a', { class: 'button', href: '#/login' }, 'log in'),
      h('a', { class: 'button ghost', href: '#/signup' }, 'sign up'),
    ),
  );
}

// ---- account bar and auth -------------------------------------------------

function renderAccount() {
  const el = document.getElementById('account');
  el.replaceChildren();
  if (me) {
    el.append(
      h('a', { href: '#/account' }, `@${me.username}`), ' ',
      h('button', {
        class: 'ghost',
        onclick: async () => {
          await api('/api/logout', { method: 'POST' });
          me = null;
          renderAccount();
          location.hash = '#/';
        },
      }, 'log out'),
    );
  } else {
    el.append(h('a', { href: '#/login' }, 'log in'));
  }
}

function authForm(mode, onDone) {
  const err = h('p', { class: 'error' });
  const user = h('input', { name: 'username', autocomplete: 'username', required: true, placeholder: 'username' });
  const pass = h('input', { name: 'password', type: 'password', required: true, minlength: mode === 'signup' ? 8 : 1, autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: 'password' });
  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const data = await api(mode === 'signup' ? '/api/signup' : '/api/login', {
          method: 'POST', json: { username: user.value, password: pass.value },
        });
        me = data.user;
        renderAccount();
        onDone();
      } catch (ex) {
        err.textContent = ex.message;
      }
    },
  },
    h('label', null, 'username', user),
    h('label', null, 'password', pass),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, mode === 'signup' ? 'sign up' : 'log in')),
    err,
  );
  const switcher = mode === 'signup'
    ? h('p', { class: 'small muted' }, 'Have an account? ', h('a', { href: '#/login' }, 'log in'))
    : h('p', { class: 'small muted' }, 'New here? ', h('a', { href: '#/signup' }, 'sign up'));
  return h('div', null, h('h1', null, mode === 'signup' ? 'sign up' : 'log in'), form, switcher);
}

// ---- pages -----------------------------------------------------------------

function dropzone(onFiles, label = 'Drop photos or videos here, or choose files') {
  const zone = h('label', { class: 'dropzone', tabindex: 0 }, label);
  const input = h('input', {
    type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true,
    onchange: (e) => onFiles([...e.target.files]),
  });
  zone.append(input);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation(); // the window-level drop handler would start a second upload
    zone.classList.remove('over');
    onFiles([...e.dataTransfer.files]);
  });
  return zone;
}

function startUpload(files) {
  if (!files.length) return;
  queued = files;
  location.hash = '#/upload';
}

async function discoverPage(root, params) {
  const tag = params.get('tag') || '';
  const q = params.get('q') || '';
  const query = new URLSearchParams();
  if (tag) query.set('tag', tag);
  if (q) query.set('q', q);
  const [{ media }, { tags }] = await Promise.all([
    api(`/api/media?${query}`),
    api('/api/tags'),
  ]);
  const search = h('form', {
    class: 'row', style: 'margin-top:8px',
    onsubmit: (e) => {
      e.preventDefault();
      const value = e.target.q.value.trim();
      location.hash = value ? `#/?q=${encodeURIComponent(value)}` : '#/';
    },
  }, h('input', { name: 'q', placeholder: 'search titles and tags', value: q }), h('button', { class: 'ghost' }, 'search'));

  root.replaceChildren(
    dropzone(startUpload),
    search,
    h('div', { class: 'chips' },
      h('a', { class: tag ? 'chip' : 'chip on', href: '#/' }, 'all'),
      tags.slice(0, 40).map((t) => h('a', {
        class: t.tag === tag ? 'chip on' : 'chip',
        href: `#/?tag=${encodeURIComponent(t.tag)}`,
      }, `${t.tag} ${t.count}`)),
    ),
    media.length ? grid(media) : h('p', { class: 'muted' }, 'Nothing here yet. Be the first to upload.'),
  );
}

async function mediaPage(root, id) {
  const { media: m } = await api(`/api/media/${id}`);
  const boards = me ? (await api('/api/boards?scope=mine')).boards : [];
  const status = h('p', { class: 'small muted' });

  const pinBoard = h('select', { style: 'max-width:260px' },
    h('option', { value: '' }, 'Saved'),
    boards.filter((b) => b.name !== 'Saved').map((b) => h('option', { value: b.id }, b.name)),
  );
  const pin = me ? h('div', { class: 'stack' },
    h('label', null, 'pin to board', pinBoard),
    h('div', { class: 'row' }, h('button', {
      onclick: async () => {
        status.textContent = '';
        try {
          await api('/api/pins', { method: 'POST', json: { media_id: m.id, board_id: pinBoard.value || undefined } });
          status.textContent = `Pinned to ${pinBoard.selectedOptions[0].textContent}.`;
        } catch (ex) { status.textContent = ex.message; }
      },
    }, 'pin')),
  ) : needLogin('Log in to pin this to a board.');

  const owner = m.is_mine ? ownerControls(m, root) : null;

  root.replaceChildren(
    h('p', null, h('a', { href: '#/' }, '← discover')),
    h('div', { class: 'detail' },
      h('div', { class: 'media' }, mediaEl(m, { controls: true })),
      h('div', { class: 'side' },
        h('div', null,
          h('div', { class: 'small muted' }, `by @${m.owner}`),
          m.title ? h('h1', null, m.title) : null,
          m.visibility === 'private' ? h('p', { class: 'small muted' }, 'Private: only you can see this on Discover.') : null,
        ),
        m.tags.length ? h('div', { class: 'chips' }, m.tags.map((t) => h('a', { class: 'chip', href: `#/?tag=${encodeURIComponent(t)}` }, t))) : null,
        m.source_url ? h('a', { href: m.source_url, rel: 'noopener', target: '_blank' }, 'source ↗') : null,
        pin,
        status,
        owner,
      ),
    ),
  );
}

function ownerControls(m, root) {
  const title = h('input', { value: m.title, placeholder: 'title' });
  const tags = h('input', { value: m.tags.join(', '), placeholder: 'tags, comma separated' });
  const source = h('input', { value: m.source_url, placeholder: 'source link', type: 'url' });
  const vis = h('select', null,
    h('option', { value: 'public', selected: m.visibility === 'public' }, 'public (on Discover)'),
    h('option', { value: 'private', selected: m.visibility === 'private' }, 'private'),
  );
  const msg = h('p', { class: 'small muted' });
  return h('details', { style: 'margin-top:12px' },
    h('summary', null, 'edit'),
    h('form', {
      class: 'stack', style: 'margin-top:8px',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api(`/api/media/${m.id}`, {
            method: 'PATCH',
            json: { title: title.value, tags: tags.value, source_url: source.value, visibility: vis.value },
          });
          msg.textContent = 'Saved.';
        } catch (ex) { msg.textContent = ex.message; }
      },
    },
      h('label', null, 'title', title),
      h('label', null, 'tags', tags),
      h('label', null, 'source link', source),
      h('label', null, 'visibility', vis),
      h('div', { class: 'row' },
        h('button', { type: 'submit' }, 'save'),
        h('button', {
          type: 'button', class: 'danger',
          onclick: async () => {
            if (!confirm('Delete this upload? It will be removed from every board too.')) return;
            await api(`/api/media/${m.id}`, { method: 'DELETE' });
            location.hash = '#/';
          },
        }, 'delete'),
      ),
      msg,
    ),
  );
}

async function boardsPage(root) {
  // Lists the signed-in user's boards and the shareable boards from everyone.
  const [{ boards: publicBoards }, mine] = await Promise.all([
    api('/api/boards'),
    me ? api('/api/boards?scope=mine') : Promise.resolve({ boards: [] }),
  ]);

  const name = h('input', { placeholder: 'board name', required: true });
  const category = h('input', { placeholder: 'category, e.g. interiors' });
  const vis = h('select', null,
    h('option', { value: 'private' }, 'private'),
    h('option', { value: 'public' }, 'public (shareable)'),
  );
  const msg = h('p', { class: 'error' });

  const create = me ? h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const { board } = await api('/api/boards', {
          method: 'POST',
          json: { name: name.value, category: category.value, visibility: vis.value },
        });
        location.hash = `#/b/${board.id}`;
      } catch (ex) { msg.textContent = ex.message; }
    },
  },
    h('h2', null, 'new board'),
    h('label', null, 'name', name),
    h('label', null, 'category', category),
    h('label', null, 'visibility', vis),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'create')),
    msg,
  ) : null;

  const boardItem = (b) => h('li', null,
    h('a', { href: `#/b/${b.id}` }, b.name),
    ` · ${b.item_count} ${b.item_count === 1 ? 'item' : 'items'}`,
    b.category ? ` · ${b.category}` : '',
    b.visibility === 'private' ? h('span', { class: 'muted' }, ' · private') : '',
  );

  root.replaceChildren(
    h('h1', null, 'boards'),
    me ? h('h2', null, 'yours') : null,
    me ? (mine.boards.length
      ? h('ul', { class: 'board-list' }, mine.boards.map(boardItem))
      : h('p', { class: 'muted' }, 'No boards yet.')) : needLogin('Log in to make boards.'),
    h('h2', null, 'shared'),
    publicBoards.length
      ? h('ul', { class: 'board-list' }, publicBoards.map((b) => h('li', null, h('a', { href: `#/b/${b.id}` }, b.name), ` · @${b.owner} · ${b.item_count}`)))
      : h('p', { class: 'muted' }, 'No public boards yet.'),
    create,
  );
}

async function boardPage(root, id) {
  const { board, media } = await api(`/api/boards/${id}`);
  const shareUrl = `${location.origin}/#/b/${board.id}`;

  const editName = h('input', { value: board.name });
  const editCategory = h('input', { value: board.category, placeholder: 'category' });
  const editDesc = h('input', { value: board.description, placeholder: 'description' });
  const editVis = h('select', null,
    h('option', { value: 'private', selected: board.visibility === 'private' }, 'private'),
    h('option', { value: 'public', selected: board.visibility === 'public' }, 'public (shareable)'),
  );
  const msg = h('p', { class: 'small muted' });

  const ownerPanel = board.is_mine ? h('details', { style: 'margin-top:12px' },
    h('summary', null, 'edit board'),
    h('form', {
      class: 'stack', style: 'margin-top:8px',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api(`/api/boards/${board.id}`, {
            method: 'PATCH',
            json: { name: editName.value, category: editCategory.value, description: editDesc.value, visibility: editVis.value },
          });
          msg.textContent = 'Saved.';
        } catch (ex) { msg.textContent = ex.message; }
      },
    },
      h('label', null, 'name', editName),
      h('label', null, 'category', editCategory),
      h('label', null, 'description', editDesc),
      h('label', null, 'visibility', editVis),
      h('div', { class: 'row' },
        h('button', { type: 'submit' }, 'save'),
        h('button', {
          type: 'button', class: 'danger',
          onclick: async () => {
            if (!confirm('Delete this board? The pins stay on Discover.')) return;
            await api(`/api/boards/${board.id}`, { method: 'DELETE' });
            location.hash = '#/boards';
          },
        }, 'delete board'),
      ),
      msg,
    ),
  ) : null;

  const removeFor = board.is_mine
    ? (m) => h('button', {
      class: 'remove danger',
      title: 'Remove from this board',
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await api(`/api/boards/${board.id}/items/${m.id}`, { method: 'DELETE' });
        boardPage(root, id);
      },
    }, '×')
    : null;

  root.replaceChildren(
    h('p', { class: 'small muted' }, board.is_mine ? 'your board' : `by @${board.owner}`),
    h('h1', null, board.name),
    board.category ? h('p', { class: 'small muted' }, `category: ${board.category}`) : null,
    board.description ? h('p', null, board.description) : null,
    h('div', { class: 'row small' },
      board.visibility === 'public'
        ? [h('span', { class: 'muted' }, shareUrl), copyButton(shareUrl, 'copy link')]
        : h('span', { class: 'muted' }, 'private: only you can see this board'),
    ),
    ownerPanel,
    h('div', { style: 'height:16px' }),
    media.length
      ? grid(media, removeFor)
      : h('p', { class: 'muted' }, board.is_mine ? 'Empty. Pin something from Discover.' : 'Nothing on this board yet.'),
  );
}

async function accountPage(root) {
  if (!me) return root.replaceChildren(needLogin('Log in to manage your account.'));
  const out = h('div', null);
  const siteUrl = location.origin;
  const agentText = `Read ${siteUrl}/llms.txt, then upload my inspiration files to trovely with this API token: <paste token>`;

  root.replaceChildren(
    h('h1', null, `@${me.username}`),
    h('h2', null, 'let your agent upload for you'),
    h('p', null, 'Make an API token, then give it to your agent. The agent can upload, tag and pin on your behalf.'),
    h('div', { class: 'row' },
      h('button', {
        onclick: async () => {
          const { token } = await api('/api/me/token', { method: 'POST' });
          out.replaceChildren(
            h('p', { class: 'small' }, 'Copy this now. It is shown once.'),
            h('pre', { style: 'white-space:pre-wrap;word-break:break-all;background:var(--chip);padding:10px' }, token),
            h('div', { class: 'row' }, copyButton(token, 'copy token')),
          );
        },
      }, 'make API token'),
    ),
    out,
    h('h2', null, 'prompt for your agent'),
    h('pre', { style: 'white-space:pre-wrap;background:var(--chip);padding:10px' }, agentText),
    copyButton(agentText, 'copy prompt'),
    h('p', { class: 'small muted' }, 'Making a new token revokes the old one.'),
  );
}

function uploadPage(root) {
  if (!me) {
    root.replaceChildren(h('h1', null, 'upload'), authForm('login', () => render()));
    return;
  }
  const files = queued;
  const msg = h('p', { class: 'small error' });
  const tags = h('input', { name: 'tags', placeholder: 'tags, comma separated (e.g. warm, interiors, 70s)' });
  const title = h('input', { name: 'title', placeholder: 'title (optional)' });
  const source = h('input', { name: 'source_url', type: 'url', placeholder: 'where it came from (optional)' });
  const vis = h('select', { name: 'visibility' },
    h('option', { value: 'public' }, 'public: on Discover'),
    h('option', { value: 'private' }, 'private: just for me'),
  );
  const submit = h('button', { type: 'submit', disabled: files.length === 0 }, `upload ${files.length || ''}`.trim());

  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!queued.length) return;
      const body = new FormData();
      for (const f of queued) body.append('files', f);
      body.append('tags', tags.value);
      body.append('title', title.value);
      body.append('source_url', source.value);
      body.append('visibility', vis.value);
      submit.disabled = true;
      msg.textContent = 'Uploading…';
      try {
        const { media } = await api('/api/media', { method: 'POST', body });
        queued = [];
        location.hash = media.length === 1 ? `#/m/${media[0].id}` : '#/';
      } catch (ex) {
        msg.textContent = ex.message;
        submit.disabled = false;
      }
    },
  },
    dropzone((picked) => { queued = picked; render(); }, files.length
      ? `${files.length} file${files.length === 1 ? '' : 's'} ready. Drop more or choose again.`
      : 'Drop photos or videos here, or choose files'),
    h('label', null, 'tags', tags),
    h('label', null, 'title', title),
    h('label', null, 'source link', source),
    h('label', null, 'visibility', vis),
    h('div', { class: 'row' }, submit, h('button', {
      type: 'button', class: 'ghost',
      onclick: () => { queued = []; render(); },
    }, 'clear')),
    msg,
  );

  root.replaceChildren(
    h('h1', null, 'upload'),
    h('p', { class: 'muted small' }, 'JPEG, PNG, GIF, WebP, AVIF, MP4, WebM or MOV. Up to 20 files, 100 MB each. Or give an agent your API token from ', h('a', { href: '#/account' }, 'account'), '.'),
    form,
  );
}

// ---- router ----------------------------------------------------------------

function route() {
  const [path = '', query = ''] = location.hash.slice(1).split('?');
  const parts = path.replace(/^\//, '').split('/');
  const params = new URLSearchParams(query);
  const [first, second] = parts;
  if (!first) return (root) => discoverPage(root, params);
  if (first === 'm' && second) return (root) => mediaPage(root, second);
  if (first === 'b' && second) return (root) => boardPage(root, second);
  if (first === 'boards') return boardsPage;
  if (first === 'upload') return uploadPage;
  if (first === 'account') return accountPage;
  if (first === 'login') return (root) => root.replaceChildren(authForm('login', () => { location.hash = queued.length ? '#/upload' : '#/'; }));
  if (first === 'signup') return (root) => root.replaceChildren(authForm('signup', () => { location.hash = queued.length ? '#/upload' : '#/'; }));
  return (root) => root.replaceChildren(h('p', null, 'Not found. ', h('a', { href: '#/' }, 'Back to discover.')));
}

let renderId = 0;
async function render() {
  const id = ++renderId;
  const view = route();
  const root = document.createElement('div');
  app.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    await view(root);
  } catch (ex) {
    root.replaceChildren(h('p', { class: 'error' }, ex.message));
  }
  if (id === renderId) app.replaceChildren(...root.childNodes);
}

// Drop files anywhere on the site to start an upload.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    if (type === 'drop') startUpload([...e.dataTransfer.files]);
  });
}

window.addEventListener('hashchange', render);

(async () => {
  try {
    ({ user: me } = await api('/api/me'));
  } catch {
    me = null;
  }
  renderAccount();
  render();
})();
