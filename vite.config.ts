import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { rundotGameLibrariesPlugin } from '@series-inc/rundot-game-sdk/vite';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
        build: {
            target: 'esnext',
        },
        base: './',
  plugins: [
            // rundot-import:vite-plugins:begin
            rundotGameLibrariesPlugin(),
            // Disabled for local dev (requires Google sign-in). Re-enable to test run.world platform features.
            // rundotGamePlaygroundPlugin({ target: 'playground' }),
            // rundot-import:vite-plugins:end
            react(), tailwindcss(), viteSingleFile(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
