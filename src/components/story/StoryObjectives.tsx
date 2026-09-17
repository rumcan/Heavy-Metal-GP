import type { ObjectiveChip } from './StoryRace';
import '../../story.css';

export interface StoryObjectivesProps {
  objectives: readonly ObjectiveChip[];
  title?: string;
}

/**
 * Chapter objective chips in the race HUD (ST-03, fed by the story prop). Bonus objectives are marked
 * with a star; nothing here can pause or fail the race — they only steer the script.
 */
export default function StoryObjectives({ objectives, title = 'CHAPTER OBJECTIVES' }: StoryObjectivesProps) {
  if (!objectives.length) return null;
  return <aside className="story-objectives" aria-label={title}>
    <div className="story-obj-head">{title}</div>
    {objectives.map((objective) => <div
      key={objective.id}
      className={`story-obj ${objective.met ? 'is-met' : 'is-live'} ${objective.bonus ? 'is-bonus' : ''}`}
    >
      <span aria-hidden="true">{objective.met ? '✓' : objective.bonus ? '★' : '◎'}</span>
      {objective.label}
      {objective.target > 1 && <b>{Math.min(objective.progress, objective.target)}/{objective.target}</b>}
    </div>)}
  </aside>;
}
