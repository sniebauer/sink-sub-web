// Sound effects, extracted from SINKSUB.EXE's audio resources (8-bit PCM /
// embedded WAVs — see tools/extract-assets.py). Played through the Web Audio API
// so explosions can overlap. The context is unlocked on the first user gesture
// (browsers block audio before that).
//
// EVENT -> resource-number mapping is a best guess from the waveforms; tweak the
// SOUNDS table if any are mismatched. `cap` trims a long clip (e.g. the bomb
// whistle) so rapid events don't smear together.

// EVENT -> resource mapping recovered from SINKSUB.EXE itself (each event calls
// playWave(<id>) at 0x4bdb): 162 bomb-drop, 163 sonar ping, 164 explosion,
// 165 get-ready, 166 game-over, 167 level-cleared, 169 extra-life.
export type SoundName = 'bomb' | 'explosion' | 'levelStart' | 'levelClear' | 'extraLife' | 'gameOver' | 'ping' | 'planeHit';

const SOUNDS: Record<SoundName, { res: number; gain: number; cap?: number }> = {
  bomb: { res: 162, gain: 0.5, cap: 0.6 },
  explosion: { res: 164, gain: 0.85 },
  levelStart: { res: 165, gain: 0.7 },
  levelClear: { res: 167, gain: 0.75 },
  extraLife: { res: 169, gain: 0.85 },
  gameOver: { res: 166, gain: 0.75 },
  ping: { res: 163, gain: 0.22 },
  planeHit: { res: 170, gain: 0.7 },
};

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let muted = false;

export async function initAudio(): Promise<void> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();
  await Promise.all(
    (Object.keys(SOUNDS) as SoundName[]).map(async (name) => {
      const res = await fetch(`/sounds/snd${SOUNDS[name].res}.wav`);
      const buf = await ctx!.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, buf);
    }),
  );
}

/** Resume the context after the first gesture (and toggle mute). */
export function unlockAudio(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

export function play(name: SoundName): void {
  if (!ctx || muted) return;
  const buf = buffers.get(name);
  if (!buf) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = SOUNDS[name].gain;
  src.connect(g).connect(ctx.destination);
  const cap = SOUNDS[name].cap;
  src.start();
  if (cap) src.stop(ctx.currentTime + cap);
}
