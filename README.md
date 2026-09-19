# jev8ball

a minimalist Magic 8-Ball oracle powered by TypeSafe Jev structured decision intelligence on OpenRouter.

## features

- minimal dark brutalist interface with ambient floating particles
- 3D interactive floating icosahedron die inside fluid viewport with mouse parallax
- realistic shake & liquid surfacing animations with procedural audio chimes
- powered by non-autoregressive `typesafe/jev-1.13` decisions API (calibrated `noul` probabilities, structured sentiment, zero hallucination)
- live decision telemetry: calibrated probability, confidence score, token cost, and latency
- query history log with instant clipboard copy
- fast sub-second responses (~300ms) with lightweight token footprint

## usage

```bash
# install dependencies
npm install

# start server
npm start
```

Runs by default on `http://localhost:3000`.

## configuration

Configure your OpenRouter API key in `.env`:
```env
PORT=3000
OPENROUTER_API_KEY=sk-or-v1-...
```

## endpoints

- `GET /api/status` - model status and latency check
- `POST /api/ask` - submit query to Jev decisions pipeline

## license

MIT
