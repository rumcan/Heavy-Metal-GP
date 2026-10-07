// The Magic Engine overheated: a soft red glow at the left and right edges of the screen while it is locked out (the
// owner: shown, not heard; not too distracting). The hiss plays when the engine key is let go (engine/input.ts).
export default function HeatEdges({ on }: { on: boolean }) {
  return <div className={`heat-edges ${on ? 'on' : ''}`} aria-hidden="true" />;
}
