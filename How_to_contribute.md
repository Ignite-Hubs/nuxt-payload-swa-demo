# Contributing

This guide is for **Nuxt developers who are used to running Nuxt as a Node server**, for example on a VM, behind nginx or PM2. Azure Static Web Apps (SWA) may be new to you. You keep writing Nuxt the way you normally do: pages, components, composables, `useFetch`, `public/`. What changes is **when your code runs** and **where server-side logic lives**. This guide covers that shift and then gives recipes for common tasks.

- [1. The mental model: what runs where](#1-the-mental-model-what-runs-where)
- [2. From a VM deployment to SWA: concept mapping](#2-from-a-vm-deployment-to-swa-concept-mapping)
- [3. What works, what doesn't](#3-what-works-what-doesnt)
- [4. Local development](#4-local-development)
- [5. Git and GitHub workflow](#5-git-and-github-workflow)
- [6. Recipes: pages, components, assets and content](#6-recipes-pages-components-assets-and-content)
- [7. Recipes: APIs and integrations (Payload, Azure Storage queues, Supabase, others)](#7-recipes-apis-and-integrations)
- [8. Configuration and secrets](#8-configuration-and-secrets)
- [9. Security headers, routing and caching](#9-security-headers-routing-and-caching)
- [10. Debugging and logs](#10-debugging-and-logs)
- [11. Pull request checklist](#11-pull-request-checklist)

---

## 1. The mental model: what runs where

On a VM, `nuxt build` produces a Node server (`.output/server/index.mjs`). Every request runs your page's `setup()`, server middleware and `server/api` routes **at request time**, on a machine you control.

Here, nothing Nuxt-related runs at request time on a server. There are three stages:

```
 ┌────────────── BUILD TIME (GitHub Actions runner) ──────────────┐
 │ nuxt generate                                                   │
 │  • runs every page's setup() once, server-side, like SSR        │
 │  • useFetch('/api/careers') → hits web/server/api (Nitro), which│
 │    calls Payload directly                                       │
 │  • writes static HTML + _payload.json per page to .output/public│
 └─────────────────────────────────────────────────────────────────┘
                              │  upload
                              ▼
 ┌──────────────── REQUEST TIME (Azure Static Web Apps) ──────────┐
 │  /, /careers, /careers/*   → static files from a global CDN     │
 │  /api/*                    → Azure Functions in api/ (Node 22)  │
 └─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
 ┌──────────────────── IN THE BROWSER ────────────────────────────┐
 │ Vue hydrates the static HTML. Code in onMounted / event handlers│
 │ can call /api/* for live data (see useRevalidate in this repo). │
 └─────────────────────────────────────────────────────────────────┘
```

Three rules follow from this:

1. **Page `setup()` code runs on the CI runner, once per build**, not once per visitor. Anything it fetches is frozen into the HTML until the next build.
2. **`web/server/` is never deployed.** In this repo, `web/server/api/*` exists only so `nuxt dev` and `nuxt generate` have an `/api` to call. In production, `/api/*` is served by the Azure Functions in `api/`. To keep the two identical, both are thin wrappers over the same handlers in `shared/careers/http.ts`.
3. **Anything that must run per request** (live data, writes, secrets, sending to a queue) goes in an **Azure Function** under `api/`, and the browser calls it via `/api/...`.

> Why this design? Static pages are served from a CDN. There is no server to patch, scale or keep alive, pages load fast, and the CMS is not hit on every page view.

---

## 2. From a VM deployment to SWA: concept mapping

| On a VM you would… | Here you… |
|---|---|
| `nuxt build`, then `node .output/server/index.mjs` (PM2 or systemd) | `nuxt generate`. CI uploads `web/.output/public` to SWA. No Node process serves pages. |
| SSH or rsync a release, restart PM2 | **Push to `main`.** [`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml) tests, builds and deploys. |
| Run a staging server | **Open a pull request.** SWA creates a preview environment and posts its URL on the PR. |
| Write `server/api/foo.ts` | Write an **Azure Function** in `api/src/functions/`. Optionally mirror it in `web/server/api/` if pages need it at build time (see [7.2](#72-add-a-new-api-endpoint)). |
| Use `server/middleware` (auth, redirects, headers) | Use [`web/public/staticwebapp.config.json`](web/public/staticwebapp.config.json) for routes, redirects, headers and roles, SWA's built-in auth (`/.auth/*`), or logic in a Function. |
| Configure nginx (headers, gzip, caching, rewrites) | Use `staticwebapp.config.json`. Compression and the CDN are handled by SWA. |
| Read `process.env` / `runtimeConfig` at runtime | **Two separate places.** Build-time values come from **GitHub secrets/variables**. Function runtime values come from **SWA app settings**. See [8](#8-configuration-and-secrets). |
| Set `routeRules` with `isr`, `swr` or `ssr: true` per route | Not available: every page is prerendered. For freshness, rebuild on content change and/or re-fetch in the browser. |
| Run cron jobs on the box | Use a GitHub Actions `schedule:` that rebuilds or calls an API, or a timer-triggered Function in a **separate** Functions app (see [7.4](#74-integrate-azure-storage-queues)). |
| Read logs with `pm2 logs` or journald | Build logs are in **GitHub Actions**. Function logs are in **Application Insights** or the SWA portal. See [10](#10-debugging-and-logs). |
| Roll back with a symlink switch | Revert the commit on `main`, or re-run an earlier successful workflow run. |

---

## 3. What works, what doesn't

**Works exactly as usual**
- `pages/`, `layouts/`, `components/`, `composables/`, `utils/`, auto-imports, TypeScript
- `useFetch`/`useAsyncData` in `setup()`: they run at build time, and the result is embedded in the page
- `useHead`, `useSeoMeta`, `public/` and `assets/` (Vite)
- `$fetch` in `onMounted` or event handlers: runs in the browser against `/api/*`
- Dynamic routes such as `pages/careers/[slug].vue`, as long as every slug is discovered at build time (see [6.4](#64-a-page-driven-by-cms-content))
- `NuxtLink` navigation: it loads the target page's prebuilt `_payload.json`, so there is no server round-trip

**Does not work (or behaves differently) in production**

| Feature | Why | Do this instead |
|---|---|---|
| `server/api`, `server/routes`, `server/middleware`, Nitro plugins at runtime | There is no Nitro server in production | Azure Functions in `api/`. Use `staticwebapp.config.json` for headers, redirects and route protection. |
| `useRequestHeaders`, `useCookie` read on the server, `event.context`, per-user SSR | `setup()` runs on the CI runner without a real visitor | Read cookies in the browser, or in a Function |
| Server-side auth or session gating of pages | Pages are public static files | SWA auth with `allowedRoles` in `staticwebapp.config.json`, and/or check identity in Functions |
| `routeRules` `isr` / `swr` / `cache` | No server to revalidate | Rebuild on change (Payload hook), plus live re-fetch in the browser |
| Changing `NUXT_PUBLIC_*` in Azure takes effect | Public runtime config is **baked into the HTML at build time** | Change the GitHub variable, then rebuild |
| Private `runtimeConfig` used in the browser | Private values exist only during the build | Never ship secrets to the browser; call a Function |
| Long-running requests | Calls to managed Functions are time-limited (about 45 s) | Hand the work to a queue (see [7.4](#74-integrate-azure-storage-queues)) |
| Non-HTTP Function triggers (queue, timer, blob) in `api/` | SWA **managed** Functions support HTTP triggers only | Use a separate Azure Functions app (see [7.4](#74-integrate-azure-storage-queues)) |

**Data you see is from the last build** unless you re-fetch. Nuxt embeds `useFetch` results into each page, and even client-side navigation reads `_payload.json` from the build. This repo's [`useRevalidate`](web/app/composables/useCareers.ts) re-reads `/api/*` after mount, so edits in Payload show up before the next rebuild. Use it for any CMS-backed page.

---

## 4. Local development

Requires **Node 22+** (see `.nvmrc`).

### Everyday: `nuxt dev` (closest to what you're used to)

```bash
cd web
npm install
cp .env.example .env        # local config, gitignored, never committed
npm run mock:payload        # terminal 1: mock Payload CMS on :3001
npm run dev                 # terminal 2: http://localhost:3000
```

`nuxt dev` renders pages at request time, so you get hot reload and instant feedback. `/api/*` is served by `web/server/api/*` (Nitro), using the same handlers as production.

To use the real CMS instead of the mock, set `PAYLOAD_URL` and `PAYLOAD_API_KEY` in `web/.env` and restart `npm run dev`. `.env` is only read at startup.

### Before you open a PR: test the static build

`nuxt dev` does **not** reproduce production behaviour: pages are SSR'd per request there. Always check the real output:

```bash
cd web
npm run generate            # same command CI runs; fails on any prerender error
```

Look in `web/.output/public`: there should be one folder per page or slug.

### Full production emulation (optional): SWA CLI + Functions

Use this when you change Functions, routes, headers or auth.

```bash
# one-off: npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4
cp api/local.settings.example.json api/local.settings.json
cd api && npm install && npm run build && func start          # Functions on :7071
# new terminal, repo root:
swa start web/.output/public --api-devserver-url http://localhost:7071   # http://localhost:4280
```

`swa start` applies `staticwebapp.config.json` (headers, 404 rewrite, roles) and emulates `/.auth/*`, just like production.

### Tests and type checks (CI runs all of these)

```bash
cd api && npm run typecheck && npm test
cd web && npm run typecheck
```

---

## 5. Git and GitHub workflow

1. **Branch from `main`**, e.g. `feature/pathways-page` or `fix/card-summary`.
2. Commit small, focused changes. Never commit `.env`, `api/local.settings.json` or keys.
3. **Open a pull request into `main`.** The workflow then:
   - type-checks and tests `api/`, then bundles it with esbuild
   - type-checks `web/` and runs `nuxt generate` against Payload, using the repo's secrets
   - deploys a **preview environment** and comments its URL on the PR
4. Review using the preview URL. It is a full copy of production: static pages plus Functions.
5. **Merge.** The push to `main` deploys to production. Closing the PR deletes its preview environment.

Other things that trigger a deploy:
- **Payload publish hook.** `repository_dispatch` with type `payload-content-changed` is sent by [`docs/payload/triggerSiteRebuild.ts`](docs/payload/triggerSiteRebuild.ts) when content changes.
- **Manual run.** *Actions → Build and deploy to Azure Static Web Apps → Run workflow*.

Notes:
- PR preview environments are limited in number by the SWA plan. Close stale PRs.
- Preview environments from forks don't receive repository secrets, so their build cannot reach Payload.
- If a build fails, nothing is deployed and the previous version stays live.

---

## 6. Recipes: pages, components, assets and content

### 6.1 Add a static page

Create `web/app/pages/about.vue` as you normally would. It is prerendered automatically **if any prerendered page links to it** (`crawlLinks: true` in `nuxt.config.ts`). For a page that nothing links to, add it explicitly:

```ts
// web/nuxt.config.ts
nitro: { prerender: { routes: ['/', '/careers', '/about'] } }
```

### 6.2 Add a component or composable

Use `web/app/components/` and `web/app/composables/` with auto-imports, exactly as usual. If a component shows **time-dependent or per-user** data, render that part only after mount (`onMounted`, `<ClientOnly>`). Otherwise build-time values get frozen into the HTML and you get hydration mismatches.

### 6.3 Add static assets (images, fonts, files)

| Put it in | Served as | Caching |
|---|---|---|
| `web/public/foo.pdf` | `/foo.pdf`, as is | SWA default |
| `web/app/assets/…`, imported in code/CSS | `/_nuxt/<hash>.ext` | `immutable`, one year (see `staticwebapp.config.json`) |

Images from Payload (`https://…`) are allowed by the CSP (`img-src 'self' data: https:`).

### 6.4 A page driven by CMS content

Follow the pattern already used for careers:

1. **Fetch in `setup()`** with `useFetch('/api/...')`. It runs at build time through the Nitro mirror, so the HTML contains the content (good for SEO and speed).
2. **Re-fetch after mount** with `useRevalidate(...)`, so edits appear before the next rebuild.
3. **For dynamic routes** (`[slug].vue`), make sure every slug is prerendered. The list page only links to the first page of results, so `nuxt.config.ts` uses a `prerender:routes` hook to ask Payload for **all** slugs. Add an equivalent for any new collection.
4. **Fail loudly.** Throw a real 404 for "not found" and a non-404 error for anything else. During `nuxt generate`, the non-404 error aborts the build instead of publishing a broken page (see `pages/careers/[slug].vue`).
5. **Render CMS HTML with `<RichText>`**, never `v-html`. It allow-lists tags and URLs (`shared/careers/rich-text.ts`).

A slug published **after** the last build still works. SWA serves `404.html` (Nuxt's SPA fallback), and the page fetches the data from `/api` in the browser. It becomes a fully prerendered page on the next build.

### 6.5 Add a new Payload collection (example: `pathways`)

1. **Contract.** Add `shared/pathways/types.ts` with the public fields only.
2. **Client and handlers.** Add `shared/pathways/payload-client.ts` and `http.ts`, modelled on `shared/careers/`. Whitelist the fields with `select[...]` and a projection function, so internal CMS fields can never leak.
3. **Production API.** Add Functions in `api/src/functions/` and import them in `api/src/index.ts` (the bundle entry).
4. **Build/dev API.** Add `web/server/api/pathways/*.get.ts` that call the same shared handlers.
5. **Pages.** Add `web/app/pages/pathways/…` and add slug discovery to the `prerender:routes` hook in `nuxt.config.ts`.
6. **Rebuilds.** Add `triggerSiteRebuild` to the collection's `afterChange`/`afterDelete` hooks in Payload.
7. **Tests.** Add tests in `api/test/`, and add seed data plus mock-server support in `tools/mock-payload/` if needed.
8. **Path alias.** Add an alias for `shared/pathways` in `nuxt.config.ts`, like the existing `#careers` alias.

---

## 7. Recipes: APIs and integrations

### 7.1 Where integration code goes

| You need to… | Put it in | Why |
|---|---|---|
| Read content **to build pages** (Payload, any headless CMS, a JSON API) | Shared handler + Nitro mirror (`web/server/api`), called by `useFetch` in `setup()` | Runs on the CI runner during `nuxt generate`; secrets come from GitHub secrets |
| Read **live** data, or **write** anything (forms, enquiries, queues, email) | **Azure Function** in `api/`, called from the browser via `/api/...` | Runs at request time; secrets come from SWA app settings and never reach the browser |
| React to events: queue messages, timers, blob uploads | A **separate Azure Functions app** (not `api/`) | SWA managed Functions are HTTP-only |
| Call a public third-party API directly from the browser | Browser code, **plus a CSP update** | `connect-src 'self'` blocks other origins by default |
| Sign users in and store their data (Supabase) | Browser via supabase-js with RLS; privileged work in a Function | See [7.5](#75-supabase-for-database-and-auth) |

Golden rule: **the browser only ever talks to `/api/*`**. The Functions talk to Payload, Azure Storage and any other service. This keeps keys server-side and avoids CORS problems (same origin). There is one deliberate exception: services built for direct browser access with a **public** key and server-enforced rules, such as Supabase with RLS ([7.5](#75-supabase-for-database-and-auth)).

### 7.2 Add a new API endpoint

Example: `GET /api/featured`.

```ts
// shared/careers/http.ts: transport-agnostic, unit-testable
export async function handleFeatured(env: Env, log = console.error): Promise<ApiResult<Career[]>> { /* … */ }
```

```ts
// api/src/functions/featured.ts: production adapter (Azure Functions v4 model)
import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { handleFeatured } from '../../../shared/careers/http'

app.http('featured', {
  methods: ['GET'],
  authLevel: 'anonymous',          // SWA handles access; use allowedRoles to restrict
  route: 'featured',               // served at /api/featured
  handler: async (_req: HttpRequest, ctx: InvocationContext) => {
    const { status, body, headers } = await handleFeatured(process.env, (m, e) => ctx.error(m, e))
    return { status, jsonBody: body, headers }
  },
})
```

```ts
// api/src/index.ts: register it in the bundle
import './functions/featured'
```

```ts
// web/server/api/featured.get.ts: only if pages fetch it at build time or in `nuxt dev`
import { handleFeatured } from '#careers/http'
export default defineEventHandler(async (event) => {
  const r = await handleFeatured(process.env)
  setResponseStatus(event, r.status); setResponseHeaders(event, r.headers)
  return r.body
})
```

Conventions:
- Validate all input in the shared handler (see `isValidSlug` and `parsePagination`).
- Return `500` for misconfiguration and `502` for upstream failures, and never cache errors.
- Set `Cache-Control` deliberately.
- Write endpoints (`POST`) must also be allowed in `staticwebapp.config.json`. The current `/api/*` route allows `GET` only.

### 7.3 Payload CMS

- **Auth:** use API keys of a read-only service account, sent as `<collection> API-Key <key>`. Don't use user JWTs, because they expire. See `payloadConfigFromEnv` in `shared/careers/payload-client.ts`.
- **Queries:** always send `depth=0` and `select[...]`, and project the response onto your public type.
- **Publish filters:** use a `published` checkbox, configurable with `PAYLOAD_PUBLISHED_FIELD`. If the collection uses drafts, set `PAYLOAD_DRAFTS=true` to filter on `_status`. Querying a field the collection doesn't have returns **HTTP 400**.
- **Rebuild on publish:** see `docs/payload/triggerSiteRebuild.ts` and README → *Deploy* step 6.
- **Debugging:** `curl` the Payload REST API directly to see Payload's own error message (README → *Troubleshooting*).

### 7.4 Integrate Azure Storage queues

There are two directions, and they live in different places.

#### A) Send messages (e.g. "student registered interest in a career")

Use an HTTP Function in `api/` with the `@azure/storage-queue` SDK. This works in SWA managed Functions, because it is just an outbound call.

```bash
cd api && npm install @azure/storage-queue
```

```ts
// api/src/functions/interest.ts
import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { QueueClient } from '@azure/storage-queue'

const queue = () =>
  new QueueClient(process.env.AZURE_STORAGE_CONNECTION_STRING!, process.env.INTEREST_QUEUE_NAME ?? 'career-interest')

app.http('interest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'interest',
  handler: async (req: HttpRequest, ctx: InvocationContext) => {
    const body = (await req.json().catch(() => null)) as { slug?: string } | null
    if (!body?.slug || !/^[a-z0-9-]{1,200}$/.test(body.slug)) return { status: 400, jsonBody: { error: 'Invalid slug' } }
    try {
      // Queue messages must be text; Base64 keeps them compatible with queue-triggered Functions.
      await queue().sendMessage(Buffer.from(JSON.stringify({ slug: body.slug, at: new Date().toISOString() })).toString('base64'))
      return { status: 202, jsonBody: { ok: true } }
    } catch (error) {
      ctx.error('Queue send failed', error)
      return { status: 502, jsonBody: { error: 'Unable to record interest' } }
    }
  },
})
```

Then:
- Import it in `api/src/index.ts`.
- Add a `POST` rule for `/api/interest` in `staticwebapp.config.json`.
- Add `AZURE_STORAGE_CONNECTION_STRING` and `INTEREST_QUEUE_NAME` to **SWA app settings**, and to `api/local.settings.json` for local runs.
- In the browser, call it from an event handler: `await $fetch('/api/interest', { method: 'POST', body: { slug } })`.

Things to know:
- **Managed identity is not available** in SWA managed Functions, so use a connection string or a SAS URL stored in app settings. If policy requires managed identity or Key Vault references, use a bring-your-own Functions app (Standard plan; see below).
- **Local development:** run [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) and set `AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`. Test with `func start` + `swa start` (see [4](#4-local-development)). Don't add queue writes to the Nitro mirror: `nuxt generate` must never send messages.
- Write endpoints are public. Add validation, a size limit, and rate limiting or auth (SWA `allowedRoles`) as appropriate.

#### B) Process messages (queue trigger)

SWA managed Functions **cannot** have queue, timer or blob triggers. Create a **separate Azure Functions app**, e.g. a `worker/` folder or its own repo, with its own deploy workflow (`Azure/functions-action`):

```ts
// worker/src/functions/process-interest.ts (separate Functions app)
import { app, type InvocationContext } from '@azure/functions'

app.storageQueue('process-interest', {
  queueName: 'career-interest',
  connection: 'AZURE_STORAGE_CONNECTION_STRING',
  handler: async (message: unknown, ctx: InvocationContext) => {
    ctx.log('Interest received', message)
    // e.g. update Payload via its REST API, send an email, write to a table…
  },
})
```

This app does **not** need to be linked to the Static Web App, because it never serves `/api`. It talks to the queue, and to Payload if needed. Linking a "bring your own" Functions app to SWA is only needed if you want that app to *serve `/api/*`* instead of `api/`. Linking requires the Standard plan, replaces managed Functions entirely (`api_location` must be empty), and isn't available in PR preview environments.

If processing changes content shown on the site, finish by **triggering a rebuild**, using the same `repository_dispatch` call as `docs/payload/triggerSiteRebuild.ts`, or by updating Payload, which triggers the hook.

### 7.5 Supabase for database and auth

Supabase fits this architecture well, because its client library is designed to run **in the browser**. Security comes from **Row Level Security (RLS)** in Postgres, not from a server you run. Use it for **user data** (accounts, saved careers, progress, preferences). Keep **editorial content** in Payload.

Example used below: signed-in students can **save career paths** to a personal list.

#### Where each piece runs

| Concern | Runs in | Key used |
|---|---|---|
| Sign up / sign in / sign out, session refresh | Browser (`@supabase/supabase-js`) | **Publishable** key (`sb_publishable_…`, formerly the *anon* key). It is public by design. |
| Reading/writing the user's own rows | Browser → Supabase directly, enforced by **RLS** | Publishable key + the user's session |
| Privileged work: bypassing RLS, admin actions, combining with Payload or queues | **Azure Function** in `api/`, after verifying the user's token | **Secret** key (`sb_secret_…`, formerly *service_role*), **SWA app settings only** |
| Public, non-user data needed to *build* pages | Shared handler + Nitro mirror at build time (like Payload) | Publishable key + an RLS policy allowing `anon` to `select` |

How the static setup affects auth:
- **Pages are public files.** Never prerender user-specific data, and don't treat a "signed-in only" page as protected. The *data* is protected by RLS and Functions. The HTML shell is not.
- **SWA's `allowedRoles` knows nothing about Supabase users.** It only understands SWA's own `/.auth` identities, so you can't gate routes in `staticwebapp.config.json` with Supabase sessions.
- **Sessions live in the browser** (`localStorage`, managed by supabase-js). There is no server-side cookie session, so render auth-dependent UI only after mount, inside `<ClientOnly>`.
- **About `@nuxtjs/supabase`:** this module is built around SSR (cookies, `serverSupabaseClient`, redirect middleware). Its server helpers don't exist in this deployment. Prefer plain `@supabase/supabase-js`, as shown below.

#### Step 1: Database table with RLS

Put the SQL in a migration (`supabase/migrations/<timestamp>_saved_careers.sql`, via the Supabase CLI) or run it in the dashboard SQL editor:

```sql
create table public.saved_careers (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  career_slug text not null check (career_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at  timestamptz not null default now(),
  primary key (user_id, career_slug)
);

alter table public.saved_careers enable row level security;

create policy "read own"   on public.saved_careers for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.saved_careers for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own" on public.saved_careers for delete to authenticated using ((select auth.uid()) = user_id);
```

> RLS is the security boundary. A table without RLS, or with a permissive policy, is readable by anyone who has the (public) publishable key. Review policies in every PR that touches the schema.

#### Step 2: Configuration

```ts
// web/nuxt.config.ts: public values, baked into the build (see 8)
runtimeConfig: {
  public: {
    supabaseUrl: '',   // NUXT_PUBLIC_SUPABASE_URL
    supabaseKey: '',   // NUXT_PUBLIC_SUPABASE_KEY (publishable key, never the secret key)
  },
},
```

| Variable | Set in | Notes |
|---|---|---|
| `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_KEY` | `web/.env`, plus **GitHub variables** passed through the workflow `env:` | Public. Changing them requires a rebuild. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | **SWA app settings** and `api/local.settings.json` only | Secret. Never in GitHub variables, `NUXT_PUBLIC_*` or the browser. |

Then allow the browser to reach Supabase in the CSP (`web/public/staticwebapp.config.json`). Use `wss:` only if you use Realtime:

```
connect-src 'self' https://<project-ref>.supabase.co wss://<project-ref>.supabase.co
```

In **Supabase → Authentication → URL Configuration**:
- Set **Site URL** to the production URL.
- Add **Redirect URLs** for:
  - production (`https://<your-domain>/**`)
  - local dev (`http://localhost:3000/**`, plus `http://localhost:4280/**` for `swa start`)
  - PR previews: a glob matching your SWA preview hostnames (`https://<app-name>-*.<region>.azurestaticapps.net/**`)

Without these, magic-link and OAuth sign-ins on previews redirect to the wrong place.

#### Step 3: Browser client (client-only plugin)

```bash
cd web && npm install @supabase/supabase-js
```

```ts
// web/app/plugins/supabase.client.ts
// ".client" = never runs during `nuxt generate`, so no session is ever baked into HTML.
import { createClient, type User } from '@supabase/supabase-js'

export default defineNuxtPlugin(() => {
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  const supabase = createClient(supabaseUrl, supabaseKey) // persists + refreshes the session in the browser

  const user = useState<User | null>('supabase-user', () => null)
  // Fires once with the restored session (INITIAL_SESSION), then on every sign-in/out/refresh.
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })

  return { provide: { supabase } }
})
```

```ts
// web/app/composables/useSupabaseUser.ts
import type { User } from '@supabase/supabase-js'
/** Current Supabase user; always null during prerendering and until the session is restored. */
export const useSupabaseUser = () => useState<User | null>('supabase-user', () => null)
```

`$supabase` only exists in the browser. Use it in event handlers, `onMounted` or watchers, never in top-level `setup()` code that runs during `nuxt generate`.

#### Step 4: Sign-in page

```vue
<!-- web/app/pages/sign-in.vue: prerendered as a static form; all logic runs on click -->
<script setup lang="ts">
const { $supabase } = useNuxtApp()
const email = ref('')
const status = ref<'idle' | 'sending' | 'sent' | 'error'>('idle')

async function sendLink() {
  status.value = 'sending'
  const { error } = await $supabase.auth.signInWithOtp({
    email: email.value,
    options: { emailRedirectTo: `${location.origin}/account` },
  })
  status.value = error ? 'error' : 'sent'
}

// OAuth alternative: $supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${location.origin}/account` } })
</script>

<template>
  <h1>Sign in</h1>
  <form @submit.prevent="sendLink">
    <label>Email <input v-model="email" type="email" required autocomplete="email"></label>
    <button class="button" :disabled="status === 'sending'">Email me a sign-in link</button>
  </form>
  <p v-if="status === 'sent'" class="notice" role="status">Check your inbox for the sign-in link.</p>
  <p v-if="status === 'error'" class="notice notice--error" role="alert">Couldn't send the link. Please try again.</p>
</template>
```

supabase-js picks up the session from the redirect URL automatically when the target page loads. Sign out with `await $supabase.auth.signOut()`.

`<form @submit.prevent>` never submits natively, so the CSP's `form-action 'self'` is not affected. OAuth redirects are full-page navigations, so `connect-src` doesn't apply to them either.

#### Step 5: Use it in a page or component

```vue
<!-- web/app/components/SaveCareerButton.vue: use as <ClientOnly><SaveCareerButton :slug="career.slug" /></ClientOnly> -->
<script setup lang="ts">
const props = defineProps<{ slug: string }>()
const { $supabase } = useNuxtApp()
const user = useSupabaseUser()
const saved = ref(false)
const busy = ref(false)

watch(user, async (u) => {
  if (!u) return (saved.value = false)
  const { data } = await $supabase.from('saved_careers').select('career_slug').eq('career_slug', props.slug).maybeSingle()
  saved.value = !!data
}, { immediate: true })

async function toggle() {
  busy.value = true
  const { error } = saved.value
    ? await $supabase.from('saved_careers').delete().eq('career_slug', props.slug)
    : await $supabase.from('saved_careers').insert({ career_slug: props.slug }) // user_id defaults to auth.uid()
  if (!error) saved.value = !saved.value
  busy.value = false
}
</script>

<template>
  <NuxtLink v-if="!user" to="/sign-in" class="button button--secondary">Sign in to save</NuxtLink>
  <button v-else class="button button--secondary" type="button" :disabled="busy" :aria-pressed="saved" @click="toggle">
    {{ saved ? 'Saved ✓' : 'Save this career' }}
  </button>
</template>
```

For a "My saved careers" page (`/account`), prerender the page **shell** as usual. Fetch the list in a `watch(user, …)` like the one above, and show a loading or sign-in prompt until then. To skip prerendering entirely, use `routeRules: { '/account': { ssr: false } }` instead. SWA would then serve the 404 fallback for that URL, so add `{ "route": "/account", "rewrite": "/200.html" }` to `staticwebapp.config.json`.

#### Step 6: Privileged work in an Azure Function

When the browser can't do something under RLS, send the user's access token to a Function. Examples: writing to a table students can't access, sending a queue message tagged with the user ([7.4](#74-integrate-azure-storage-queues)), or calling Payload with its API key. The Function **verifies the token with Supabase** before using the secret key.

Use a **custom header** for the token. Several reports describe SWA replacing the `Authorization` header with its own token before the request reaches the API. Confirm the header arrives on a PR preview.

```ts
// api/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** Returns the signed-in Supabase user for this request, or null. */
export async function getSupabaseUser(token: string | null | undefined) {
  if (!token) return null
  const { data, error } = await supabaseAdmin().auth.getUser(token) // validates signature + expiry with Supabase
  return error ? null : data.user
}
```

```ts
// in a Function handler (see 7.2 / 7.4 for the full shape)
const user = await getSupabaseUser(req.headers.get('x-supabase-auth'))
if (!user) return { status: 401, jsonBody: { error: 'Sign in required' } }
// …act for user.id: the admin client BYPASSES RLS, so enforce your own checks here
```

```ts
// browser
const { data: { session } } = await $supabase.auth.getSession()
await $fetch('/api/interest', {
  method: 'POST',
  body: { slug },
  headers: { 'x-supabase-auth': session?.access_token ?? '' },
})
```

Install with `cd api && npm install @supabase/supabase-js`. Do **not** mirror authenticated endpoints in `web/server/api`: the build must never act on behalf of users.

#### Local development

- Run a local Supabase stack with the CLI: `npx supabase init`, then `npx supabase start`. It prints a local URL (`http://127.0.0.1:54321`) and keys for `web/.env` and `api/local.settings.json`. Magic-link emails go to the local mail viewer that `supabase start` lists.
- Apply schema changes with `npx supabase db reset` locally. Use `npx supabase db push` (or the dashboard) for the hosted project. Commit `supabase/migrations/`.
- Use a separate Supabase project for development and previews, not production.

#### Production notes

- Configure **custom SMTP** in Supabase. The built-in email sender is heavily rate-limited and not meant for production.
- Pages stay cacheable and anonymous. Personalisation happens after mount, so it never affects the static build.

### 7.6 Other services (email, search, analytics, AI…)

Use the same decision table ([7.1](#71-where-integration-code-goes)):
- Secret key → Function.
- Event-driven → separate Functions app.
- Public browser SDK → add its origin to the CSP (9).

---

## 8. Configuration and secrets

On a VM, one `.env` serves everything. Here **each stage has its own source**:

| Stage | Reads config from | Set it in | Takes effect |
|---|---|---|---|
| `nuxt dev` / local `nuxt generate` | `web/.env` | your machine (gitignored) | restart dev server |
| CI build (`nuxt generate`) | workflow `env:`, from secrets and variables | GitHub → *Settings → Secrets and variables → Actions* | next build |
| Production Functions (`api/`) | `process.env` | Azure portal → Static Web App → *Environment variables* (app settings) | immediately (Functions restart) |
| Local Functions | `api/local.settings.json` | your machine (gitignored) | restart `func start` |
| Browser | `runtimeConfig.public` (`NUXT_PUBLIC_*`) | GitHub variables, baked in at build | **next build only** |

Rules:
- A Payload or Azure value used **both** to build pages and by Functions must be set in **both** GitHub (secret) and SWA app settings, e.g. `PAYLOAD_URL` and `PAYLOAD_API_KEY`.
- Values only Functions use, such as `AZURE_STORAGE_CONNECTION_STRING`, go **only** in SWA app settings.
- **Never** put a secret in `runtimeConfig.public` or a `NUXT_PUBLIC_*` variable: it ends up in the HTML.
- When you add a variable, also add it to `web/.env.example` and/or `api/local.settings.example.json` (with no real values), the workflow `env:` block if the build needs it, and README → *Configuration*.
- Use read-only credentials wherever possible, and scope storage SAS tokens to the single queue.

---

## 9. Security headers, routing and caching

All request-time web configuration lives in [`web/public/staticwebapp.config.json`](web/public/staticwebapp.config.json), which is copied into the build output. It is the equivalent of your nginx config.

- **CSP** (`globalHeaders`): `connect-src 'self'` means the browser can only call this site, including `/api/*`. Calling another origin from the browser requires adding it here. The same goes for scripts (`script-src`) and fonts (`font-src`), e.g. Google Fonts or analytics.
- **API methods and roles:** `/api/*` currently allows `GET` for `anonymous` only. Add rules for `POST` endpoints, or for role-protected routes (`allowedRoles: ["authenticated"]`).
- **404s:** unknown paths are rewritten to Nuxt's `404.html` SPA shell. That is how newly published slugs work before a rebuild.
- **Caching:** `/_nuxt/*` is immutable for one year (hashed filenames). Functions set their own `Cache-Control`.
- **Redirects:** use `routes` entries with `redirect` and `statusCode`. Don't use Nuxt server middleware.

Test changes with `swa start` locally (4) and on the PR preview.

---

## 10. Debugging and logs

| Problem | Where to look |
|---|---|
| Build failed or a page is missing | GitHub → *Actions* → the run → *Web - generate static site*. The `[careers] prerendering N career page(s)` line shows slug discovery. |
| `/api/*` errors in production | Azure portal → Static Web App → *Application Insights* (enable it), or the Functions logs. Handlers log via `context.error`. |
| `Payload returned HTTP 400/401/403` | README → *Troubleshooting* |
| Page shows old content | Expected until the next build. Check that the publish hook fired (repo *Actions* → `repository_dispatch` runs) and that the page uses `useRevalidate`. |
| Works in `nuxt dev`, broken in production | You probably relied on runtime SSR, cookies, `server/` code or `NUXT_PUBLIC_*` changes. Re-read [3](#3-what-works-what-doesnt) and test with `npm run generate` plus `swa start`. |
| Hydration mismatch warnings | Time- or user-dependent output rendered during prerender. Move it to `onMounted` or `<ClientOnly>`. |
| Browser console shows a CSP violation | Add the origin to `staticwebapp.config.json` (9). |

---

## 11. Pull request checklist

- [ ] `cd api && npm run typecheck && npm test` passes
- [ ] `cd web && npm run typecheck && npm run generate` passes, and the expected pages are in `web/.output/public`
- [ ] New API logic lives in `shared/` with tests. The Function **and** (if needed at build time) the Nitro mirror both call it.
- [ ] New Functions are imported in `api/src/index.ts`. Non-`GET` routes are allowed in `staticwebapp.config.json`.
- [ ] No secrets in code, `NUXT_PUBLIC_*`, `.env.example` or `local.settings.example.json`
- [ ] New config documented: README *Configuration*, example env files, workflow `env:`
- [ ] New external origins added to the CSP
- [ ] CMS HTML is rendered via `<RichText>` (no `v-html`). CMS responses are projected to public fields only.
- [ ] Time- or user-specific UI renders after mount
- [ ] Supabase: every new table has RLS enabled with reviewed policies; migrations are committed; the secret key is used only in Functions after verifying the user's token
- [ ] Reviewed on the PR preview URL

Further reading: [API support in Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/apis-functions) · [Bring your own Functions](https://learn.microsoft.com/azure/static-web-apps/functions-bring-your-own) · [SWA configuration](https://learn.microsoft.com/azure/static-web-apps/configuration) · [Nuxt prerendering](https://nuxt.com/docs/getting-started/prerendering) · [Supabase Auth](https://supabase.com/docs/guides/auth) · [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
