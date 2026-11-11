# trovely

Share inspiration. Upload photos and videos, tag them, group them into boards, and pin what you like from other people's uploads. Public uploads show up on **Discover**. Boards can be shared by link, like a mood board.

- **Drag and drop** files anywhere on the site, or use the upload page.
- **Let your agent upload.** Make an API token in your account and give it to your agent with the prompt from that page. The agent reads [`/llms.txt`](public/llms.txt) and uploads, tags and pins for you.
- **Boards** group pins, carry a category and a description, and are private until you share them.
- **Visibility.** Uploads are public (on Discover) or private. Private items never show on Discover or public boards.

## Run it

Requires Node 22.13 or newer (uses the built-in `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm test
```

Environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Holds `trovely.db` and uploaded files. Back this up. |
| `COOKIE_SECURE` | unset | Set to `1` behind HTTPS so the session cookie is marked Secure |

## Run it in a container

```bash
docker build -t trovely .
docker run -p 3000:3000 -v trovely-data:/data -e COOKIE_SECURE=1 trovely
```

The image has no build step beyond `npm ci`, so it runs on any host that runs Docker images.

## Layout

```
src/app.js        Express routes (accounts, media, boards, pins)
src/db.js         SQLite schema
src/media.js      file-type sniffing, tag and URL cleanup
src/auth.js       password hashing, session and token helpers
public/           the web app (plain JS, no build step) and llms.txt for agents
test/             API tests (node:test)
```

## Security notes

- File types come from the file's bytes, not its name or the uploader's claimed type. Only images and videos in the allowlist are stored.
- Files are renamed to random IDs. Filenames from uploaders never touch the disk.
- Passwords are hashed with scrypt. Session cookies and API tokens are random; only their SHA-256 is stored.
- "Private" hides an item from Discover and boards. Anyone who has a direct `/media/…` link can still open the file, because those names are unguessable. Treat them as unlisted, not secret.

## Contributing

Issues and pull requests are welcome. Run `npm test` before opening a PR, and keep new API behavior covered in `test/api.test.js`.

## License

MIT. See [LICENSE](LICENSE).
