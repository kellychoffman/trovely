# trovely

Share inspiration. Upload photos and videos, tag them, group them into boards, and pin what you like from other people's uploads. Public uploads show up on **Discover**. Boards can be shared by link, like a mood board.

Trovely runs on [Spacefast Zero](https://spacefast.com/docs/zero-runtime/): a server capsule (`server/index.ts`) with MySQL tables and queries, plus a browser app (`client/index.tsx`). Files live in Spacefast object storage.

## Features

- **Discover:** public uploads, newest first, filterable by tag and search.
- **Upload:** drag and drop anywhere on the site, or use the upload page. Public or private.
- **Boards:** group pins, add a category and description, and make them shareable by link. Private by default.
- **Pins:** save anyone's public upload to a board. Without a board it lands in "Saved".
- **Accounts:** Spacefast sign-in. Browsing needs no account; uploading, pinning and boards do.

## Project layout

```
sf.jsonc            Spacefast project config (runtime: zero)
server/index.ts     schema, queries, mutations
client/index.tsx    the web app
```

## Run it locally

```bash
npm install
npm run check        # type-check
npx spacefast dev --state-backend sqlite   # local Zero dev server
```

The local dev server cannot make a signed-in identity, so uploads, pins and boards only work after the Space is published and you sign in on it.

## Publish

```bash
npm install -g spacefast
sf login
sf publish .
```

Publishing needs a Spacefast account. The first publish creates a Space and prints its live URL. Enable **Users** in the Space dashboard so sign-in works.

## Limits to know about

- **5 MB per upload.** Spacefast storage objects are capped at 5 MiB, so larger photos and most videos are refused. This is the main gap for video. Raising it would need a different storage host.
- **Private means unlisted.** Private uploads stay off Discover and out of public boards. Their storage links are still public, so anyone with the link can open the file.
- **No agent upload yet.** The earlier Express version had a bearer-token API for agents. That path is not ported yet. Agents can still use the web app once signed in.
- **Dev identity is a guest.** Local `sf auth as` sets a guest, which cannot write. Test writes on a published Space.

## History

The original Express and SQLite version, with the bearer-token agent API, is in the git history before this commit.

## Contributing

Issues and pull requests are welcome. Run `npm run check` before opening a PR.

## License

MIT. See [LICENSE](LICENSE).
