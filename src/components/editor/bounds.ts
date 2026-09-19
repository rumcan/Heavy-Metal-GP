import type { Piece } from '../../game/trackdef';
import type Matter from 'matter-js';

type Bounds = { min: { x: number, y: number }, max: { x: number, y: number } };

/**
 * Returns the visual bounding box of a piece, matching the sprite size plus 15px padding.
 * Falls back to the physics body bounds if no specific sprite size is defined.
 */
export function visualBoundsForPiece(piece: Piece, bodies: Matter.Body[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  // First get the standard body bounds
  for (const b of bodies) {
    if (!b.bounds) continue;
    minX = Math.min(minX, b.bounds.min.x);
    minY = Math.min(minY, b.bounds.min.y);
    maxX = Math.max(maxX, b.bounds.max.x);
    maxY = Math.max(maxY, b.bounds.max.y);
  }

  // If no bodies, return 0 bounds
  if (minX === Infinity) {
    const fallbackX = (piece as any).x ?? ((piece as any).a?.[0]) ?? 0;
    const fallbackY = (piece as any).y ?? ((piece as any).a?.[1]) ?? 0;
    return { 
      min: { x: fallbackX - 20, y: fallbackY - 20 }, 
      max: { x: fallbackX + 20, y: fallbackY + 20 } 
    };
  }

  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;
  
  // Try to use the piece's explicit coordinates as center if possible
  if ('x' in piece && 'y' in piece) {
    cx = piece.x;
    cy = piece.y;
  }

  let w = maxX - minX;
  let h = maxY - minY;
  let hasSprite = false;

  // Override width/height based on render.ts sprite dimensions
  switch (piece.t) {
    case 'peg': // bumper-spiked: 30, 26
      w = 30; h = 26; hasSprite = true; break;
    case 'ppeg': // bumper-crown: r*2.9, r*2.35
      w = piece.r * 2.9; h = piece.r * 2.35; hasSprite = true; break;
    case 'itembox': // crate: 34, 30
      w = 34; h = 30; hasSprite = true; break;
    case 'cannon': // cannon: 40, 24
      hasSprite = false; break; 
    case 'catapult': // catapult: len + 22, 26
      hasSprite = false; break;
    case 'flipper': // flipper: len, 16
      hasSprite = false; break;
    case 'sling': // sling: 60, 68
      w = 60; h = 68; hasSprite = true; break;
    case 'wind': // wind: 28, 20
      w = 28; h = 20; hasSprite = true; break;
    case 'magnet': // magnet: 48, 45
      w = 48; h = 45; hasSprite = true; break;
    case 'geyser': // geyser: 34, 44
      w = 34; h = 44; hasSprite = true; break;
    case 'turnstile': // turnstile: r*2 + 16
      w = piece.r * 2 + 16; h = piece.r * 2 + 16; hasSprite = true; break;
    case 'targets': // target-pin: 19, 25 (multiple targets though, so body bounds are better)
      hasSprite = false; break;
    case 'vortex': // vortex: r*2.35
      w = piece.r * 2.35; h = piece.r * 2.35; hasSprite = true; break;
    case 'platform': // platform: w + 10, (w+10)*0.43
      w = piece.w + 10; h = (piece.w + 10) * 0.43; hasSprite = true; break;
    case 'scoop': // scoop: 40, 24
      w = 40; h = 24; hasSprite = true; break;
    case 'crusher': // crusher-house: 44, 36 (but it moves, body bounds union is better)
      hasSprite = false; break;
    case 'wheel': // wheel sprite is r*2 + something, but bodies usually cover it.
      w = piece.r * 2; h = piece.r * 2; hasSprite = true; break;
  }

  // If it's a fixed size sprite that is centered at cx, cy, we reconstruct the box
  if (hasSprite) {
    minX = cx - w / 2;
    maxX = cx + w / 2;
    minY = cy - h / 2;
    maxY = cy + h / 2;
  }

  // Add 15px padding
  const padding = 15;
  return {
    min: { x: minX - padding, y: minY - padding },
    max: { x: maxX + padding, y: maxY + padding }
  };
}
