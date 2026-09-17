import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SCENES, SCENE_BY_ID } from '../../game/story/outline';
import { chapterTitle } from '../../game/story/engine';
import { emptyFlags } from '../../game/story/types';
import type { ChoiceOption, FlagMap, Scene } from '../../game/story/types';
import StoryScene from './StoryScene';
import '../../story.css';

/**
 * Dev-only scene browser (ST-03): `?story=<sceneId>` mounts one scene full screen so dialogue,
 * portraits, props and choices can be checked without racing into them. `?story=list` shows every
 * scene id. Imported dynamically from `main.tsx` inside `import.meta.env.DEV`, so a published build
 * never contains it.
 */

interface PreviewProps {
  startId: string;
  flags: FlagMap;
  onFlags: (flags: FlagMap) => void;
}

function ScenePreview({ startId, flags, onFlags }: PreviewProps) {
  const scene: Scene | undefined = SCENE_BY_ID[startId];
  const [queue, setQueue] = useState<string[]>([]);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const current = scene ?? SCENE_BY_ID[queue[0] ?? ''];

  const siblings = useMemo(
    () => (current ? SCENES.filter((entry) => entry.chapter === current.chapter && entry.trigger === current.trigger).map((entry) => entry.id) : []),
    [current],
  );

  if (!current) return <SceneList flags={flags} />;

  const done = (choice: ChoiceOption | null) => {
    const next = { ...flags };
    if (choice) next[choice.set] = choice.value !== false;
    for (const flag of current.sets ?? []) next[flag] = true;
    onFlags(next);
    const following = siblings[siblings.indexOf(current.id) + 1];
    setQueue(following ? [following] : []);
  };

  return <div>
    <StoryScene
      key={current.id}
      scene={current}
      flags={flags}
      autoAdvance={autoAdvance}
      onAutoAdvanceChange={setAutoAdvance}
      onDone={done}
      heading={`PREVIEW · ${chapterTitle(current.chapter)} · ${current.trigger.toUpperCase()}${current.ending ? ` · ${current.ending}` : ''}`}
    />
    <div className="story-preview-bar">
      <span>{current.id}</span>
      <span>{current.lines.length} lines{queue.length ? ' · next queued' : ' · last of trigger'}</span>
      <div>
        {siblings.map((id) => <button key={id} type="button" onClick={() => setQueue([id])} aria-current={id === current.id}>
          {id.replace(/^c\d+-/, '')}
        </button>)}
      </div>
      <button type="button" onClick={() => setQueue([])}>Stop</button>
    </div>
  </div>;
}

function SceneList({ flags }: { flags: FlagMap }) {
  const set = Object.entries(flags).filter(([, on]) => on).map(([flag]) => flag);
  return <div className="story-preview-list">
    <h1>Story scene preview</h1>
    <p>Pick a scene, or open <code>?story=&lt;id&gt;</code> directly. Flags set in the preview: {set.length ? set.join(', ') : 'none'}.</p>
    <ol>
      {SCENES.map((scene) => <li key={scene.id}>
        <button type="button" onClick={() => { window.location.search = `?story=${scene.id}`; }}>{scene.id}</button>
        <span>{chapterTitle(scene.chapter)} · {scene.trigger}{scene.outcome ? ` · ${scene.outcome}` : ''}{scene.atSector !== undefined ? ` · sector ${scene.atSector}` : ''}</span>
      </li>)}
    </ol>
  </div>;
}

export function mountStoryPreview(sceneId: string) {
  const host = document.createElement('div');
  host.id = 'story-preview';
  document.body.appendChild(host);
  const root = createRoot(host);
  const start = sceneId === 'list' ? '' : sceneId;

  const render = (flags: FlagMap) => root.render(
    <ScenePreview key={start} startId={start} flags={flags} onFlags={render} />,
  );
  render(emptyFlags());
}
