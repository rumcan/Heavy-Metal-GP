// rundot-import:sdk-init:begin
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
try {
  await RundotGameAPI.initializeAsync();
} catch {
  // Boot continues even if SDK init fails.
}
// rundot-import:sdk-init:end

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./powerups.css";
import "./layout.css";
import "./kit.css";
import App from "./App";
import { preloadStorage } from "./game/storage";

await preloadStorage();

// ST-03 scene preview: `npm run dev` → `http://localhost:5173/?story=<sceneId>` (or `?story=list`)
// mounts one dialogue scene full screen so script, portraits, props and choices can be checked without
// racing into them. Dev-only and opt-in, so the bundler drops it from a published build.
let preview = false;
if (import.meta.env.DEV) {
  const sceneId = new URLSearchParams(window.location.search).get('story');
  if (sceneId) {
    const { mountStoryPreview } = await import('./components/story/storyPreview');
    mountStoryPreview(sceneId);
    preview = true;
  }
}

// The preview owns the whole page; the game itself never boots behind it.
if (!preview) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
