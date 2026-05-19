import { defineConfig } from "vite";

// Hosts the dev/preview servers are willing to answer Host: headers for.
// `localhost` covers normal local dev; `.trycloudflare.com` (leading dot =
// any subdomain) allows the per-spin quick-tunnel names cloudflared hands
// out so an operator can run `cloudflared tunnel --url http://localhost:5173`
// (or 8080 for the server) and share the build via `https://<name>.trycloudflare.com/`
// without Vite rejecting the request. Anything else still needs an explicit
// entry — this is *not* `allowedHosts: true` (which disables the check entirely).
const ALLOWED_HOSTS = ["localhost", "127.0.0.1", ".trycloudflare.com"];

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ALLOWED_HOSTS,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: ALLOWED_HOSTS,
  },
});
