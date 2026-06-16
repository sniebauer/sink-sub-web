// Loads every extracted sprite PNG up front and exposes them by name. All art is
// extracted from the original SINKSUB.EXE (see tools/extract-assets.py); the
// Windows mask bitmaps were baked into PNG alpha at extraction time.

export const SPRITE_NAMES = [
  'bg',
  'boat',
  'boat_die0', 'boat_die1', 'boat_die2', 'boat_die3',
  'bomb0', 'bomb1', 'bomb2',
  'boom0', 'boom1', 'debris',
  'bird0', 'bird1', 'bird2',
  'mine',
  'sub_l', 'sub_r', 'sub2_l', 'sub2_r', 'sub_dive',
  'plane0', 'plane1', 'plane2',
  'digits',
  'icon_bomb',
  'text_over', 'text_pause', 'text_ready',
] as const;

export type SpriteName = (typeof SPRITE_NAMES)[number];

export type Sprites = Record<SpriteName, HTMLImageElement>;

export async function loadSprites(): Promise<Sprites> {
  const entries = await Promise.all(
    SPRITE_NAMES.map(
      (name) =>
        new Promise<[SpriteName, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([name, img]);
          img.onerror = () => reject(new Error(`failed to load sprite ${name}`));
          img.src = `/sprites/${name}.png`;
        }),
    ),
  );
  return Object.fromEntries(entries) as Sprites;
}

/** The 10 red digit glyphs are packed left-to-right in digits.png. */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  digits: HTMLImageElement,
  value: number,
  x: number,
  y: number,
  align: 'left' | 'right' = 'left',
): number {
  const glyphW = digits.width / 10;
  const glyphH = digits.height;
  const str = Math.max(0, Math.floor(value)).toString();
  const totalW = str.length * glyphW;
  let cx = align === 'right' ? x - totalW : x;
  for (const ch of str) {
    const d = ch.charCodeAt(0) - 48;
    ctx.drawImage(digits, d * glyphW, 0, glyphW, glyphH, cx, y, glyphW, glyphH);
    cx += glyphW;
  }
  return totalW;
}
