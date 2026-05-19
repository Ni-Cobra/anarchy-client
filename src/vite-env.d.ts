/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional WebSocket URL override read from `.env` (Vite-exposed because of
   * the `VITE_` prefix). Consumed by `main.ts::resolveWsUrl` so an operator
   * can point a built bundle at a Cloudflare tunnel (e.g.
   * `wss://name.trycloudflare.com/ws`) without editing source. */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
