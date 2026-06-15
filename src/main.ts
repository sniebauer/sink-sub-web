// SinkSub — a browser port of the 1993 Windows game by Anders Wihlborg, built
// from the original game's extracted sprites. You pilot a boat on the surface,
// drop "sinkbombs" onto enemy submarines, and dodge the floatmines they fire up
// at you. Faithful to the original's rules (see original/SINKSUB.HLP).

import { loadSprites, drawNumber, type Sprites } from './sprites';
import { reportReady, reportTitle } from './embed';

// --- geometry ----------------------------------------------------------------
const BAR_H = 26; // top menu / status strip
const PLAY_W = 640;
const PLAY_H = 450;
const W = PLAY_W; // canvas height is BAR_H + PLAY_H = 476 (set in index.html)
const SURFACE = 100; // water surface, in playfield-y
const FLOOR = 412; // subs/bombs bottom out here
const BOAT_PY = 82; // boat sprite top, in playfield-y
const BOAT_HALF = 52; // half boat width for collisions / bomb spawn

const py = (y: number) => BAR_H + y; // playfield-y -> canvas-y

// --- entities ----------------------------------------------------------------
interface Sub { x: number; y: number; vx: number; w: number; h: number; variant: number; fire: number; }
interface Bomb { x: number; y: number; vy: number; }
interface Mine { x: number; y: number; vy: number; }
interface Boom { x: number; y: number; t: number; life: number; kind: 'sub' | 'boat'; }

type Phase = 'ready' | 'playing' | 'dying' | 'over';

class Game {
  ctx: CanvasRenderingContext2D;
  s: Sprites;
  // status
  score = 0;
  lives = 3;
  level = 1;
  nextLife = 25000;
  bombsMax = 3;
  // boat
  boatX = W / 2;
  boatVX = 0;
  // world
  subs: Sub[] = [];
  bombs: Bomb[] = [];
  mines: Mine[] = [];
  booms: Boom[] = [];
  // phase
  phase: Phase = 'ready';
  phaseT = 0;
  // input
  left = false;
  right = false;

  constructor(ctx: CanvasRenderingContext2D, s: Sprites) {
    this.ctx = ctx;
    this.s = s;
    this.startGame();
  }

  startGame() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.nextLife = 25000;
    this.startLevel();
  }

  startLevel() {
    this.bombsMax = 2 + this.level;
    this.bombs = [];
    this.mines = [];
    this.booms = [];
    this.boatX = W / 2;
    this.boatVX = 0;
    this.spawnSubs();
    this.phase = 'ready';
    this.phaseT = 0;
    reportTitle(`Level ${this.level}`);
  }

  spawnSubs() {
    const n = Math.min(2 + this.level, 8);
    this.subs = [];
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const speed = 0.7 + Math.random() * (0.6 + this.level * 0.18);
      this.subs.push({
        x: Math.random() * W,
        y: 150 + Math.random() * (FLOOR - 175),
        vx: dir * speed,
        w: 64,
        h: 20,
        variant: Math.random() < 0.5 ? 0 : 1,
        fire: 60 + Math.random() * 180,
      });
    }
  }

  // --- input -------------------------------------------------------------
  dropBomb(side: -1 | 1) {
    if (this.phase !== 'playing') return;
    if (this.bombs.length >= this.bombsMax) return;
    this.bombs.push({ x: this.boatX + side * (BOAT_HALF - 6), y: SURFACE - 2, vy: 1.1 });
  }

  keydown(code: string) {
    switch (code) {
      case 'ArrowLeft': case 'KeyA': this.left = true; break;
      case 'ArrowRight': case 'KeyD': this.right = true; break;
      case 'KeyZ': case 'Comma': case 'Numpad1': this.dropBomb(-1); break;
      case 'KeyX': case 'Period': case 'Numpad3': this.dropBomb(1); break;
      case 'Space': case 'ArrowDown': this.dropBomb(this.boatVX >= 0 ? 1 : -1); break;
      case 'Enter': case 'KeyN':
        if (this.phase === 'over') this.startGame();
        else if (this.phase === 'ready') { this.phase = 'playing'; this.phaseT = 0; }
        break;
    }
  }
  keyup(code: string) {
    if (code === 'ArrowLeft' || code === 'KeyA') this.left = false;
    if (code === 'ArrowRight' || code === 'KeyD') this.right = false;
  }

  // --- update ------------------------------------------------------------
  update() {
    this.phaseT++;
    for (const b of this.booms) b.t++;
    this.booms = this.booms.filter((b) => b.t < b.life);

    if (this.phase === 'ready') {
      // brief "GET READY!" then auto-start
      if (this.phaseT > 75) { this.phase = 'playing'; this.phaseT = 0; }
      this.moveSubs();
      return;
    }
    if (this.phase === 'over') { this.moveSubs(); return; }
    if (this.phase === 'dying') {
      this.moveSubs();
      if (this.phaseT > 60) {
        if (this.lives <= 0) { this.phase = 'over'; this.phaseT = 0; reportTitle('Game Over'); }
        else this.startLevel();
      }
      return;
    }

    // playing
    this.moveBoat();
    this.moveSubs();
    this.moveBombs();
    this.moveMines();
    if (this.subs.length === 0) { this.level++; this.startLevel(); }
  }

  moveBoat() {
    const accel = 0.32, max = 5;
    if (this.left && !this.right) this.boatVX -= accel;
    else if (this.right && !this.left) this.boatVX += accel;
    else this.boatVX *= 0.92;
    this.boatVX = Math.max(-max, Math.min(max, this.boatVX));
    this.boatX += this.boatVX;
    if (this.boatX < BOAT_HALF) { this.boatX = BOAT_HALF; this.boatVX = 0; }
    if (this.boatX > W - BOAT_HALF) { this.boatX = W - BOAT_HALF; this.boatVX = 0; }
  }

  moveSubs() {
    for (const sub of this.subs) {
      sub.x += sub.vx;
      if (sub.x < -sub.w) sub.x = W;
      if (sub.x > W) sub.x = -sub.w;
      if (this.phase === 'playing') {
        sub.fire--;
        if (sub.fire <= 0 && this.mines.length < 4 + this.level) {
          this.mines.push({ x: sub.x + sub.w / 2, y: sub.y, vy: -1.7 - Math.random() * 0.5 });
          sub.fire = 120 + Math.random() * (260 - this.level * 14);
        }
      }
    }
  }

  moveBombs() {
    const next: Bomb[] = [];
    for (const b of this.bombs) {
      b.y += b.vy;
      b.vy = Math.min(b.vy + 0.012, 2.4);
      let hit = false;
      for (let i = 0; i < this.subs.length; i++) {
        const sub = this.subs[i];
        if (b.x > sub.x && b.x < sub.x + sub.w && b.y > sub.y && b.y < sub.y + sub.h) {
          this.destroySub(i);
          hit = true;
          break;
        }
      }
      if (hit) continue;
      if (b.y >= FLOOR) { this.booms.push({ x: b.x - 30, y: FLOOR - 10, t: 0, life: 16, kind: 'sub' }); continue; }
      next.push(b);
    }
    this.bombs = next;
  }

  moveMines() {
    const next: Mine[] = [];
    for (const m of this.mines) {
      m.y += m.vy;
      // hit the boat?
      if (this.phase === 'playing' && m.y <= SURFACE + 6 && m.y > SURFACE - 18 &&
          m.x > this.boatX - BOAT_HALF && m.x < this.boatX + BOAT_HALF) {
        this.killBoat();
        continue;
      }
      if (m.y < -10) continue;
      next.push(m);
    }
    this.mines = next;
  }

  destroySub(i: number) {
    const sub = this.subs[i];
    // Points scale with depth and speed (100..3000), per the original.
    const depthFrac = (sub.y - 150) / (FLOOR - 175);
    const speedFrac = Math.min(1, Math.abs(sub.vx) / (1.3 + this.level * 0.18));
    let pts = 100 + (0.6 * depthFrac + 0.4 * speedFrac) * 2900;
    pts = Math.max(100, Math.min(3000, Math.round(pts / 100) * 100));
    this.score += pts;
    if (this.score >= this.nextLife) { this.lives++; this.nextLife += 25000; }
    this.booms.push({ x: sub.x, y: sub.y - 4, t: 0, life: 20, kind: 'sub' });
    this.subs.splice(i, 1);
  }

  killBoat() {
    this.lives--;
    this.phase = 'dying';
    this.phaseT = 0;
    this.booms.push({ x: this.boatX - 55, y: BOAT_PY, t: 0, life: 60, kind: 'boat' });
  }

  // --- render ------------------------------------------------------------
  draw() {
    const c = this.ctx, s = this.s;
    c.imageSmoothingEnabled = false;
    // playfield background
    c.drawImage(s.bg, 0, py(0), PLAY_W, PLAY_H);

    // subs
    for (const sub of this.subs) {
      const img = sub.vx < 0 ? (sub.variant ? s.sub2_l : s.sub_l) : (sub.variant ? s.sub2_r : s.sub_r);
      c.drawImage(img, Math.round(sub.x), py(Math.round(sub.y)));
    }
    // mines (rising)
    for (const m of this.mines) c.drawImage(s.mine, Math.round(m.x) - 2, py(Math.round(m.y)));
    // bombs (sinking) — animate the 3 frames
    for (const b of this.bombs) {
      const fr = [s.bomb0, s.bomb1, s.bomb2][Math.floor(b.y / 6) % 3];
      c.drawImage(fr, Math.round(b.x) - 2, py(Math.round(b.y)));
    }
    // boat (hidden mid-death)
    if (this.phase !== 'dying') c.drawImage(s.boat, Math.round(this.boatX) - 55, py(BOAT_PY));
    // explosions
    for (const b of this.booms) {
      if (b.kind === 'boat') {
        const frames = [s.boat_die0, s.boat_die1, s.boat_die2, s.boat_die3];
        const f = frames[Math.min(frames.length - 1, Math.floor(b.t / 15))];
        c.drawImage(f, Math.round(b.x), py(b.y));
      } else {
        const f = b.t < b.life / 2 ? s.boom0 : s.boom1;
        c.drawImage(f, Math.round(b.x), py(b.y));
      }
    }

    // overlays
    c.save();
    c.imageSmoothingEnabled = false;
    if (this.phase === 'ready') this.centerText(s.text_ready);
    if (this.phase === 'over') this.centerText(s.text_over);
    c.restore();

    this.drawBar();
  }

  centerText(img: HTMLImageElement) {
    const scale = 2;
    const w = img.width * scale, h = img.height * scale;
    this.ctx.drawImage(img, (W - w) / 2, py(150) , w, h);
  }

  drawBar() {
    const c = this.ctx, s = this.s;
    // gray menu/status strip
    c.fillStyle = '#c0c0c0';
    c.fillRect(0, 0, W, BAR_H);
    c.fillStyle = '#808080';
    c.fillRect(0, BAR_H - 1, W, 1);
    // menu labels
    c.fillStyle = '#000';
    c.font = '14px Tahoma, "MS Sans Serif", sans-serif';
    c.textBaseline = 'middle';
    c.fillText('Game', 8, BAR_H / 2);
    c.fillText('Help', 52, BAR_H / 2);

    // right-aligned status: lives, subs, bombs, level, score
    const midY = BAR_H / 2;
    const digitsH = s.digits.height;
    const dy = Math.round(midY - digitsH / 2);
    let x = 150;
    const gap = 8;
    const iconScaled = (img: HTMLImageElement, h: number) => {
      const w = (img.width / img.height) * h;
      c.drawImage(img, x, Math.round(midY - h / 2), w, h);
      x += w + 3;
    };
    // lives (boat icon)
    iconScaled(s.boat, 12);
    x += drawNumber(c, s.digits, this.lives, x, dy) + gap;
    // subs remaining (sub icon)
    iconScaled(s.sub_r, 12);
    x += drawNumber(c, s.digits, this.subs.length, x, dy) + gap;
    // bombs available
    const avail = this.bombsMax - this.bombs.length;
    iconScaled(s.icon_bomb, 12);
    x += drawNumber(c, s.digits, avail, x, dy) + gap + 6;
    // level
    c.fillText('Level', x, midY); x += 38;
    x += drawNumber(c, s.digits, this.level, x, dy) + gap + 6;
    // score
    c.fillText('Score', x, midY); x += 40;
    drawNumber(c, s.digits, this.score, x, dy);
  }
}

// --- bootstrap ---------------------------------------------------------------
async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const sprites = await loadSprites();
  const game = new Game(ctx, sprites);
  reportReady();

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    game.keydown(e.code);
  });
  window.addEventListener('keyup', (e) => game.keyup(e.code));

  // Touch / pointer: tapping a side steers that way and drops a bomb on that side.
  const steerFromPointer = (e: PointerEvent, down: boolean) => {
    const rect = canvas.getBoundingClientRect();
    const leftSide = e.clientX - rect.left < rect.width / 2;
    if (down) {
      if (game.phase === 'over') { game.startGame(); return; }
      if (game.phase === 'ready') { game.phase = 'playing'; game.phaseT = 0; }
      game.dropBomb(leftSide ? -1 : 1);
    }
    game.left = down && leftSide;
    game.right = down && !leftSide;
  };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); steerFromPointer(e, true); });
  canvas.addEventListener('pointermove', (e) => { if (e.pressure > 0 || e.buttons) steerFromPointer(e, true); });
  canvas.addEventListener('pointerup', () => { game.left = false; game.right = false; });

  let acc = 0, last = performance.now();
  const STEP = 1000 / 60;
  function frame(now: number) {
    acc += Math.min(now - last, 100);
    last = now;
    while (acc >= STEP) { game.update(); acc -= STEP; }
    game.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
