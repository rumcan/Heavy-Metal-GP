import { useEffect, useState } from 'react';

/** The RUN Bits mark, when the platform can give it (null in a browser without RUN). */
export function useBitsIcon(): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import('@series-inc/rundot-game-sdk/api')
      .then((m) => (m.default as unknown as { iap?: { getCurrencyIcon?: (o?: object) => Promise<{ base64Data: string }> } }).iap?.getCurrencyIcon?.({ size: 'sm' }))
      .then((icon) => { if (live && icon?.base64Data) setSrc(`data:image/png;base64,${icon.base64Data}`); })
      .catch(() => { /* no platform: the word Bits does */ });
    return () => { live = false; };
  }, []);
  return src;
}
