import { createRoot } from 'react-dom/client';
import TrackEditor from '../src/components/TrackEditor';
import { CALENDAR } from '../src/game/season';
import { saveDraft, loadDraftSync } from '../src/game/tracks';
import { setItem } from '../src/game/storage';
import { getTemplates, saveTemplate, snapshotTemplate } from '../src/components/editor/templates';
import '../src/index.css';
import '../src/layout.css';
import '../src/kit.css';

setItem('heavy-metal-gp:coach:v2', JSON.stringify({ dismissed: true, step: 0 }));
setItem('heavy-metal-templates', '[]');
saveDraft({ v: 1, name: 'Template regression', seed: 0, theme: 'classic', height: 4000, pieces: [] });
saveTemplate({ name: 'Two walls', sprite: 'rail-wood', ...snapshotTemplate([
  { t: 'wall', x: 300, y: 1500, w: 120, h: 24 },
  { t: 'wall', x: 500, y: 1500, w: 120, h: 24 },
]) });
Object.assign(window, { templateFixture: { readDraft: loadDraftSync, getTemplates } });
createRoot(document.getElementById('root')!).render(<TrackEditor
  seed={0} profile={CALENDAR[0].profile} name="Templates"
  driver={{ id: 0, name: 'You', color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true }}
  onExit={() => {}}
/>);
