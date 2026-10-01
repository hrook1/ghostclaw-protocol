# GhostClaw website

This directory contains the existing static website and its public documentation.
The source was imported from the workspace's `independent/editorial-signal/`
directory. The import preserves the existing pages and visual design.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Public landing page |
| `privacy.html` and `terms.html` | Existing privacy and alpha terms |
| `public-docs/` | Editable public documentation in Markdown |
| `scripts/generate-docs.mjs` | Dependency-free public documentation generator |
| `docs/` and `docs.html` | Generated pages and documentation redirect |

Regenerate the public documentation from the repository root:

```sh
npm run site:docs
```

Preview this directory with a static server:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:8080`. The existing access form contacts its configured
hosted provider when submitted. Do not submit real personal information during tests.

The website is a separate deployment from the payment API. The root
`vercel.json` continues to configure the payment service; `.vercelignore`
excludes this website from that deployment. Publishing this source does not
change either live deployment or connect a new form endpoint.

Keep credentials and provider project files outside version control. The public
GhostClaw contact address and existing form endpoint are intentional website configuration.

For implementation details, use the repository's [architecture](../docs/ARCHITECTURE.md).
Public documentation describes the product; code and protocol tests define its behaviour.
