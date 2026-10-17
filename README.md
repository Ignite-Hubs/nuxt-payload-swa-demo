# Ignite Hubs Careers Hubs : Sample Nuxt-Azure SWA 

A sample careers hub built as as Azure Staic Web App using Nuxt and Azure Functions. 
Each career path is a document in the **Careers** collection of **Payload CMS**. Pages are prerendered by **Nuxt 4** in GitHub Actions and served from **Azure Static Web Apps (SWA)**. A small read-only **Azure Functions** API keeps pages up to date between builds.

```
Payload CMS ──(publish hook)──▶ GitHub Actions ──▶ Azure Static Web Apps
 careers collection              discover slugs       /            static HTML
                                 prerender pages      /careers/*   static HTML (+ live re-check)
                                 test + deploy        /api/*       Azure Functions ──▶ Payload
```

## Site Structure

| Page | Content |
|---|---|
| `/` | Hero for students and the first six career paths |
| `/careers` | Every published career path, A–Z by title. Each card shows the role and a short summary (with "Load more" past 50) |
| `/careers/{slug}` | The full description of one career path |

## Payload CMS requirements

The app reads a `careers` collection with these fields:

| Field | Type | Used for |
|---|---|---|
| `title` | text | Role name; list sort order |
| `slug` | text, unique, lowercase-hyphenated | Page URL `/careers/{slug}` |
| `content` | HTML string (textarea), plain text or Lexical rich text | Detail page; the first `<p>` is the card summary and meta description |
| `published` | checkbox | Only ticked career paths are shown |

Other fields are ignored. They are never requested from Payload or passed to the browser. A matching collection definition is in [docs/payload/Careers.ts](docs/payload/Careers.ts).

**HTML content is rendered safely**, without `v-html`. [shared/careers/rich-text.ts](shared/careers/rich-text.ts) parses it against an allow-list. It keeps headings, paragraphs, lists, quotes, links (`http`, `https`, `mailto`, `tel` and relative URLs only) and bold, italic and similar formatting. It drops `<script>`, `<style>`, images and all other attributes. Unknown tags such as `<div>` or `<span>` are removed, but their text is kept.

## Run locally

Requires Node 22+.

```bash
cd web
npm install
cp .env.example .env
```

**Against the mock CMS.** Start it on port 3001 in one terminal (seed data: [tools/mock-payload/careers.json](tools/mock-payload/careers.json), with 7 published career paths and 1 unpublished):

```bash
npm run mock:payload
```

Then start the site in another terminal (http://localhost:3000):

```bash
npm run dev
```

**Against a real Payload instance.** In `web/.env`, set `PAYLOAD_URL` and `PAYLOAD_API_KEY`, then restart `npm run dev`; `.env` is only read at startup. `web/.env` is gitignored, so keep credentials there and never in `.env.example`.

**Static build.** To build exactly as CI does, run `npm run generate`. The output goes to `web/.output/public`, with one prerendered page per published career path.

**Tests and type checks:**

```bash
cd api && npm install && npm run typecheck && npm test
cd web && npm run typecheck
```

To run the real Functions locally, first copy `api/local.settings.example.json` to `api/local.settings.json`. Then run `npm run build && func start` in `api/`. Finally, run `swa start web/.output/public --api-devserver-url http://localhost:7071` with the [SWA CLI](https://azure.github.io/static-web-apps-cli/).

## Configuration

The same variable names are used in `web/.env`, `api/local.settings.json`, GitHub Actions and SWA app settings.

| Variable | Where | Purpose |
|---|---|---|
| `PAYLOAD_URL` | GitHub secret, SWA app setting, `.env` | Base URL of Payload, e.g. `https://cms.example.com` (**required**) |
| `PAYLOAD_API_KEY` | GitHub secret, SWA app setting, `.env` | API key of a read-only Payload service account (optional if careers are publicly readable) |
| `PAYLOAD_API_KEY_COLLECTION` | GitHub variable, SWA app setting | Auth collection that owns the key (default `users`) |
| `PAYLOAD_CAREERS_COLLECTION` | GitHub variable, SWA app setting | Collection slug (default `careers`) |
| `PAYLOAD_PUBLISHED_FIELD` | GitHub variable, SWA app setting | Checkbox that marks a career path as public (default `published`); set it empty to show every document |
| `PAYLOAD_DRAFTS` | GitHub variable, SWA app setting | `true` also filters on `_status = published`. **Only** use this for collections with drafts enabled (default `false`) |
| `PAYLOAD_TIMEOUT_MS` | SWA app setting, `.env` | Payload request timeout (default `8000`) |
| `NUXT_PUBLIC_SITE_NAME` / `SITE_NAME` | `.env` / GitHub variable | Site name (default `Ignite Hubs Careers Hubs`) |
| `NUXT_PUBLIC_SITE_URL` / `SITE_URL` | `.env` / GitHub variable | Canonical base URL, e.g. `https://careers.example.com` (optional) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | GitHub secret | SWA deployment token |

## API

| Endpoint | Returns |
|---|---|
| `GET /api/careers?limit=12&page=1` | Published career paths, A–Z by title (`limit` max 50) |
| `GET /api/careers/{slug}` | One published career path, or `404` |

Each career is returned as `{ id, title, slug, content }`. In production these endpoints are served by Azure Functions. During `nuxt dev` and `nuxt generate`, identical Nitro routes in `web/server/api/` serve them instead. Both are thin wrappers over [shared/careers/http.ts](shared/careers/http.ts).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Payload returned HTTP 400`; Payload says *"The following path cannot be queried: _status"* | `PAYLOAD_DRAFTS=true`, but the collection has no drafts. Set `PAYLOAD_DRAFTS=false` and restart. |
| 400 that mentions `published` | The collection has no `published` checkbox. Set `PAYLOAD_PUBLISHED_FIELD` to your checkbox's name, or leave it empty to disable the filter. |
| Cards show no summary | `content` has no `<p>` paragraph. Add a short intro paragraph near the top. |
| `HTTP 401/403` | Wrong `PAYLOAD_API_KEY`, or `PAYLOAD_API_KEY_COLLECTION` doesn't match the auth collection that owns the key. |
| `.env` changes have no effect | Restart `npm run dev`. |
| Build fails in CI with `PAYLOAD_URL secret is not set` | Add the `PAYLOAD_URL` secret (see Deploy step 3). |

To see Payload's own error message, request the collection directly:

```bash
curl -g -H "Authorization: users API-Key $PAYLOAD_API_KEY" "$PAYLOAD_URL/api/careers?limit=1&where[published][equals]=true"
```

## Repository layout

```
├── shared/careers/          Code shared by web and api (single source of truth)
│   ├── types.ts             Career / PaginatedCareers contract
│   ├── payload-client.ts    Payload REST client (config, publish filter, projection)
│   ├── http.ts              Transport-agnostic API handlers (validation, status codes, caching)
│   └── rich-text.ts         HTML/Lexical/plain-text → safe node tree; excerpts; URL allow-list
├── web/                     Nuxt 4 site (nuxt generate → web/.output/public)
│   ├── app/                 pages, components, composables, layout
│   ├── server/api/careers/  Local copy of the API for `nuxt dev` and prerendering (not deployed)
│   └── public/              favicon, robots.txt, staticwebapp.config.json
├── api/                     Azure Functions (Node 22, v4 programming model)
│   ├── src/functions/       careers.ts, career-by-slug.ts (thin adapters)
│   └── test/                Vitest tests for the shared module
├── tools/mock-payload/      Zero-dependency mock Payload server + seed data
├── docs/payload/            Reference Payload collection + rebuild hook
└── .github/workflows/azure-static-web-apps.yml
```

## Deploy to Azure

1. **Push the repo to GitHub** on a `main` branch:
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main
   ```
2. **Create the Static Web App** in the Azure portal. *Free* is enough for the demo; choose *Standard* if you need a custom-domain SLA or bring-your-own Functions. Set **Deployment source** to *Other*: the repo already has its workflow, so don't let Azure generate another one. Then copy the **deployment token** (Overview → *Manage deployment token*).
3. **GitHub → Settings → Secrets and variables → Actions**
   - Secrets: `AZURE_STATIC_WEB_APPS_API_TOKEN`, `PAYLOAD_URL`, `PAYLOAD_API_KEY` (optional).
   - Variables (optional): `SITE_NAME`, `SITE_URL`, `PAYLOAD_PUBLISHED_FIELD`, `PAYLOAD_DRAFTS`, `PAYLOAD_CAREERS_COLLECTION`, `PAYLOAD_API_KEY_COLLECTION`.
4. **Azure portal → your Static Web App → Settings → Environment variables:** add `PAYLOAD_URL` and `PAYLOAD_API_KEY`, plus any optional settings you changed. The Functions read these at runtime.
5. **Run the workflow.** Push to `main`, or use *Actions → Build and deploy → Run workflow*. Each pull request gets its own preview environment.
6. **(Recommended) Rebuild automatically on publish.** Add `docs/payload/triggerSiteRebuild.ts` to the careers collection in Payload. Then set `GITHUB_REPOSITORY` and `GITHUB_DISPATCH_TOKEN` in Payload's environment. The token is a fine-grained PAT with *Contents: read and write* on this repo.

## How content freshness works

| Change in Payload | Visible on the site |
|---|---|
| Career path published | Reachable at once at `/careers/{slug}`, rendered in the browser from the API. Prerendered, listed and indexed after the rebuild that the publish hook triggers. |
| Career path edited | Updated on page load by a live re-check, and in the static HTML after the rebuild. |
| Career path unpublished | A "no longer listed" notice appears on page load. Removed from the site after the rebuild. |

Without the publish hook, changes reach the static HTML on the next push or manual workflow run. The live re-check still keeps the detail pages current in the meantime.


