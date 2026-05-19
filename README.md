# anarchy-client (IMPORTANT : THIS IS A VIBE-CODED PROJECT)

Browser frontend for **Project Anarchy** — a real-time multiplayer game played in the browser. Written in TypeScript, rendered with [Three.js](https://threejs.org/), bundled with [Vite](https://vitejs.dev/).

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (with `npm`).
- [Docker](https://www.docker.com/) — only required if you want to run the production-style container.

## Local development

```sh
npm install
npm run dev
```

Then open http://localhost:5173. Vite serves with HMR — edits to `src/main.ts` reload immediately.

## WebSocket endpoint

By default the client connects to `ws://localhost:8080/ws`. Override with one of (highest priority first):

1. `?ws=<full-url>` query param on the page URL.
2. `?server-port=NNNN` query param (synthesises `ws://localhost:NNNN/ws` — used by the player-accounts e2e spec).
3. `VITE_WS_URL` in `.env` (copy `.env.example`, fill it in, rebuild or restart `npm run dev`).

Sharing a build via a Cloudflare quick-tunnel (TLS terminated at the edge, server stays plaintext on `:8080`):

```sh
# Terminal 1 — start the server (sibling repo)
cargo run

# Terminal 2 — open a public tunnel pointed at the server
cloudflared tunnel --url http://localhost:8080
# → https://<name>.trycloudflare.com/

# Terminal 3 — tell the client to connect via wss://
echo 'VITE_WS_URL=wss://<name>.trycloudflare.com/ws' > .env
npm run dev   # or `npm run build && npm run preview`
```

The Vite dev/preview server's `allowedHosts` list already includes `.trycloudflare.com`,
so tunnelled requests reach the bundle without further config.

## Production build

```sh
npm run build
```

Output is emitted to `dist/`. To preview the built bundle locally:

```sh
npm run preview
```

## Docker

The Dockerfile is a two-stage build: Node compiles the TypeScript bundle, then `nginx:alpine` serves the static `dist/`.

```sh
docker build -t anarchy-client .
docker run --rm -p 8080:80 anarchy-client
```

Open http://localhost:8080.
