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

jev8ball connects to OpenRouter to query the `typesafe/jev-1.13` decision oracle.

1. Obtain an API key from [OpenRouter](https://openrouter.ai/keys).
2. Configure your key via environment variables:

```bash
# Local development: copy example env and set your key
cp .env.example .env
# Edit .env and set:
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

```bash
# Or export directly in shell
export OPENROUTER_API_KEY="sk-or-v1-your-key-here"
```

For Cloudflare Pages / Workers deployment:
- **Cloudflare Pages**: Add `OPENROUTER_API_KEY` under **Settings > Environment Variables** in the Pages dashboard.
- **Cloudflare Workers**: Store it as an encrypted secret using Wrangler:
```bash
npx wrangler secret put OPENROUTER_API_KEY
```

> If no key is set or the default placeholder `your-openrouter-api-key` is left unchanged, jev8ball gracefully falls back to an offline deterministic oracle mode.

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
