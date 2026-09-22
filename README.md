# jev8ball

a minimalist Magic 8-Ball oracle powered by TypeSafe Jev structured decision intelligence on OpenRouter.

## features

- software-rendered 3D oracle vessel: a hexagonal metal frame with a liquid chamber and a floating hexagonal die, drawn with Canvas 2D + painter's-algorithm depth sorting (no WebGL, so it renders on machines with no GL drivers)
- shake-and-settle roll animation with liquid slosh, per-face lighting, rim glow and a cast shadow
- the verdict is inked onto the die face as it surfaces, tinted by the decision's sentiment
- ambient particle field and procedural WebAudio chimes, both toggleable
- live decision telemetry: calibrated P(favorable), confidence score, latency, cost and the raw JSON payload
- browser-local query log with instant clipboard copy
- keyboard shortcuts (`/` to focus, `enter` to ask, `r` to roll), reduced-motion support, and an offline fallback that is labelled as such instead of faking telemetry
- powered by non-autoregressive `typesafe/jev-1.13` decisions API (calibrated `noul` probabilities, structured sentiment, zero hallucination)

## usage

```bash
# install dependencies
npm install

# start server
npm start
```

Runs by default on `http://localhost:3000`.

## configuration

The repo intentionally bundles an OpenRouter key (`REPO_API_KEY` in `server.js`, `worker.mjs` and
`functions/api/ask.js`) so a fresh clone or a deploy works with nothing configured. Export
`OPENROUTER_API_KEY` to override it — `GET /api/status` reports which key is live via `keySource`.

```env
PORT=3000
OPENROUTER_API_KEY=sk-or-v1-...
```

Delete the `REPO_API_KEY` constants to require a configured key instead. For Cloudflare, store the
override as a secret rather than a plain variable:

```bash
wrangler secret put OPENROUTER_API_KEY
```

> The bundled key is readable by anyone who can read this repository, so treat it as public and
> rotate or remove it before the repo is shared.

## endpoints

- `GET /api/status` — model, engine, and whether a key is configured (`keySource`: `env` | `repo`)
- `POST /api/ask` — `{ "question": "..." }` returns the verdict, sentiment, calibrated `noul`, confidence, latency, cost and the raw decision payload

## deploy

Three interchangeable targets share the same decision logic:

- **local** — `server.js` (Express) serves both the API and `public/`
- **Cloudflare Worker** — `worker.mjs` answers `/api/*` and hands everything else to the `ASSETS` binding (`npx wrangler deploy`)
- **Cloudflare Pages** — `functions/api/*.js` provides the same endpoints alongside the static `public/` directory

## structure

```
public/js/math3d.js     pure matrix/vector helpers (matrices are column-major)
public/js/meshes.js     hexagonal vessel + die meshes
public/js/ball3d.js     software 3D renderer and roll/reveal state machine
public/js/particles.js  ambient particle field
public/js/audio.js      procedural WebAudio chimes
public/js/app.js        DOM wiring, telemetry, query log
```

## tests

```bash
npm test
```

Covers the 3D geometry (matrices, projection, meshes, verdict lettering) and the decision
endpoints (key resolution, input validation, hazy-verdict correction, offline fallbacks). The
renderer modules are pure ES modules, so they run under Node with no browser.

## license

MIT
