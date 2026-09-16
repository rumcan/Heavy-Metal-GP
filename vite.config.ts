import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { rundotGameLibrariesPlugin, rundotGamePlaygroundPlugin, rundotMultiplayerPlugin } from '@series-inc/rundot-game-sdk/vite';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * DEV ONLY. `rundotMultiplayerPlugin` starts the local room sidecar and injects
 * `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__ = "http://localhost:9001"` into the
 * page. That is right for a browser on the dev machine and wrong for any browser
 * that reaches Vite through a tunnel or a sandbox preview (Arena's live preview,
 * ngrok, a codespace port forward): "localhost" there is the VIEWER's machine,
 * which has no sidecar, so every room call fails.
 *
 * Set `RUNDOT_DEV_ROOM_URL` to the public origin that forwards to port 9001 and
 * this rewrites the injected origin — `https://…` becomes `wss://…/ws` for the
 * socket, which the SDK derives by swapping the scheme. Unset, this plugin does
 * nothing at all. Never affects `vite build`: published games talk to RUN.world's
 * hosted room server, not the sidecar.
 */
function devRoomServerOrigin(): Plugin {
  const publicUrl = process.env.RUNDOT_DEV_ROOM_URL?.replace(/\/+$/, "");
  return {
    name: "hmgp:dev-room-origin",
    apply: "serve",
    transformIndexHtml: {
      // `post` — the sidecar origin is already in the html by the time this runs.
      order: "post",
      handler(html) {
        if (publicUrl) return html.split("http://localhost:9001").join(publicUrl);
        // No explicit override: fall back to the PREVIEW CONVENTION. A sandboxed
        // preview (Arena's, and e2b-style hosts generally) serves each listening
        // port as its own host — `5173-<id>.e2b.app` for this page, `9001-<id>.e2b.app`
        // for the sidecar — and the sidecar already answers cross-origin
        // (`Access-Control-Allow-Origin: *`). So the same host with the sidecar's
        // port label is the origin the VIEWER's browser can actually reach.
        // Runs before any body module, so the SDK reads the rewritten value;
        // anything that is not a port-labelled host is left alone.
        return {
          html,
          tags: [{
            tag: "script",
            attrs: { type: "module" },
            injectTo: "head",
            children: `const label = location.hostname.match(/^([0-9]+)-(.+)$/);
if (label && label[1] !== "9001") window.__RUNDOT_MULTIPLAYER_DEV_SERVER__ = location.protocol + "//9001-" + label[2];`,
          }],
        };
      },
    },
  };
}

/**
 * DEV ONLY. Which rooms file the local room sidecar runs.
 *
 * `rundotMultiplayerPlugin()` resolves `rundot/realtime.config.json` on its own,
 * and that is what `npm run dev` uses — unchanged. The multiplayer Playwright
 * suite (MP-10) needs the room's reconnect grace to be a value the SUITE owns
 * rather than one inherited from the shipped file, so `RUNDOT_DEV_ROOMS_CONFIG`
 * points the sidecar at `rundot/realtime.e2e.config.json` for that run. Serve-only
 * by construction — the plugin never starts a sidecar on `vite build` — so a
 * published game is untouched whatever this variable says.
 */
function devRoomsConfigPath(): string | undefined {
  const configPath = process.env.RUNDOT_DEV_ROOMS_CONFIG?.trim();
  return configPath || undefined;
}

// https://vite.dev/config/
export default defineConfig({
        build: {
            target: 'esnext',
        },
        base: './',
  // `server` covers `vite dev`; `preview` covers `vite preview` of a built app
  // (the sandbox live preview uses the dev server). Vite 7 rejects unknown Host
  // headers on both unless allowedHosts permits them — localhost is always
  // allowed, tunnelled/sandboxed hosts are not.
  server: { host: true, allowedHosts: ['.e2b.app'] },
  preview: { host: true, allowedHosts: ['.e2b.app'] },
  plugins: [
            // rundot-import:vite-plugins:begin
            rundotGameLibrariesPlugin(),
            // DISABLED for local play (MP-01). The playground host signs in
            // against the real backend and points `RundotGameAPI.realtime` at
            // RUN.world's HOSTED room server instead of the local sidecar, so
            // two tabs on `npm run dev` could no longer create/join one room by
            // code. With it off the SDK runs its mock host, realtime talks to
            // the sidecar on :9001, and dev identities are free per-tab
            // `dev-tab-XXXX` profiles — no sign-in, no `pk_` key.
            //
            // `RUNDOT_PLAYGROUND=1 npm run dev` brings it back when you
            // specifically want the hosted path (that needs a signed-in player
            // and, per the SDK docs, one browser profile per player).
            rundotGamePlaygroundPlugin({ target: 'playground', disabled: process.env.RUNDOT_PLAYGROUND !== '1' }),
            // rundot-import:vite-plugins:end
            // The local room sidecar (:9001) that serves `rundot/realtime.config.json`.
            rundotMultiplayerPlugin(devRoomsConfigPath() ? { configPath: devRoomsConfigPath() } : {}),
            devRoomServerOrigin(),
            react(), tailwindcss(), viteSingleFile(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
