// SinkSub — a browser port of the 1993 Windows game by Anders Wihlborg, built
// from the original game's extracted sprites. You pilot a boat on the surface,
// drop "sinkbombs" onto enemy submarines, and dodge the floatmines they fire up
// at you. Faithful to the original's rules (see original/SINKSUB.HLP).

import { loadSprites, drawNumber, type Sprites } from './sprites';
import { reportReady, reportTitle } from './embed';
import { initAudio, unlockAudio, play, toggleMute } from './audio';

// --- geometry ----------------------------------------------------------------
const BAR_H = 26; // top menu / status strip
const PLAY_W = 640;
const PLAY_H = 450;
const W = PLAY_W; // canvas height is BAR_H + PLAY_H = 476 (set in index.html)
const SURFACE = 100; // water surface, in playfield-y
const FLOOR = 412; // subs/bombs bottom out here
const BOAT_PY = 82; // boat sprite top, in playfield-y
const BOAT_HALF = 52; // half boat width for collisions / bomb spawn
const FONT = "'W95FA', 'MS Sans Serif', Tahoma, sans-serif";
// The original sub bitmaps (103/105) are drawn pointing RIGHT; flip for left.
const SUB_FACES_RIGHT = true;

const py = (y: number) => BAR_H + y; // playfield-y -> canvas-y

// --- entities ----------------------------------------------------------------
interface Sub { x: number; y: number; vx: number; w: number; h: number; variant: number; fire: number; }
interface Bomb { x: number; y: number; vy: number; }
interface Mine { x: number; y: number; vy: number; }
interface Boom { x: number; y: number; t: number; life: number; kind: 'sub' | 'boat' | 'pop'; }
interface Hit { id: string; x: number; y: number; w: number; h: number; }

type Phase = 'ready' | 'playing' | 'dying' | 'over';

// menu definitions: top-level label -> items (label + action id)
const MENUS: { id: string; label: string; items: { label: string; action: string }[] }[] = [
  { id: 'game', label: 'Game', items: [
    { label: 'New Game', action: 'new' },
    { label: 'Pause', action: 'pause' },
    { label: 'Sound', action: 'mute' },
  ] },
  { id: 'help', label: 'Help', items: [
    { label: 'Controls', action: 'controls' },
    { label: 'About', action: 'about' },
  ] },
];

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
  // phase / ui
  phase: Phase = 'ready';
  phaseT = 0;
  paused = false;
  muted = false;
  openMenu: string | null = null;
  overlay: 'controls' | 'about' | null = null;
  menuHits: Hit[] = [];
  itemHits: Hit[] = [];
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
    this.paused = false;
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
    play('levelStart');
  }

  spawnSubs() {
    const n = Math.min(2 + this.level, 8);
    this.subs = [];
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const speed = 0.7 + Math.random() * (0.6 + this.level * 0.18);
      this.subs.push({
        x: Math.random() * (W - 64),
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
    if (this.phase !== 'playing' || this.paused) return;
    if (this.bombs.length >= this.bombsMax) return;
    this.bombs.push({ x: this.boatX + side * (BOAT_HALF - 6), y: SURFACE - 2, vy: 1.1 });
    play('bomb');
  }

  menuAction(action: string) {
    this.openMenu = null;
    switch (action) {
      case 'new': this.startGame(); break;
      case 'pause': if (this.phase === 'playing') this.paused = !this.paused; break;
      case 'controls': this.overlay = 'controls'; break;
      case 'about': this.overlay = 'about'; break;
      case 'mute': this.muted = toggleMute(); break;
    }
  }

  keydown(code: string) {
    if (this.overlay) { if (['Enter', 'Escape', 'Space'].includes(code)) this.overlay = null; return; }
    if (code === 'Escape') { this.openMenu = null; return; }
    switch (code) {
      case 'ArrowLeft': case 'KeyA': this.left = true; break;
      case 'ArrowRight': case 'KeyD': this.right = true; break;
      case 'KeyZ': case 'Comma': case 'Numpad1': this.dropBomb(-1); break;
      case 'KeyX': case 'Period': case 'Numpad3': this.dropBomb(1); break;
      case 'Space': case 'ArrowDown': this.dropBomb(this.boatVX >= 0 ? 1 : -1); break;
      case 'KeyP': if (this.phase === 'playing') this.paused = !this.paused; break;
      case 'KeyM': this.muted = toggleMute(); break;
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

  /** A click/tap at canvas coords. Returns true if the UI consumed it. */
  pointer(cx: number, cy: number): boolean {
    if (this.overlay) { this.overlay = null; return true; }
    // open dropdown? check items, then labels, else close.
    if (this.openMenu) {
      for (const h of this.itemHits) if (inHit(h, cx, cy)) { this.menuAction(h.id); return true; }
      for (const h of this.menuHits) if (inHit(h, cx, cy)) { this.openMenu = h.id; return true; }
      this.openMenu = null;
      return true;
    }
    if (cy < BAR_H) {
      for (const h of this.menuHits) if (inHit(h, cx, cy)) { this.openMenu = h.id; return true; }
      return true; // clicking the bar (not a label) does nothing, but isn't gameplay
    }
    return false;
  }

  // --- update ------------------------------------------------------------
  update() {
    if (this.paused || this.overlay) return;
    this.phaseT++;
    for (const b of this.booms) b.t++;
    this.booms = this.booms.filter((b) => b.t < b.life);

    if (this.phase === 'ready') {
      if (this.phaseT > 75) { this.phase = 'playing'; this.phaseT = 0; }
      this.moveSubs();
      return;
    }
    if (this.phase === 'over') { this.moveSubs(); return; }
    if (this.phase === 'dying') {
      this.moveSubs();
      if (this.phaseT > 60) {
        if (this.lives <= 0) { this.phase = 'over'; this.phaseT = 0; reportTitle('Game Over'); play('gameOver'); }
        else this.startLevel();
      }
      return;
    }

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
      // turn around at the screen edges (don't wrap)
      if (sub.x < 0) { sub.x = 0; sub.vx = Math.abs(sub.vx); }
      if (sub.x > W - sub.w) { sub.x = W - sub.w; sub.vx = -Math.abs(sub.vx); }
      if (this.phase === 'playing') {
        sub.fire--;
        if (sub.fire <= 0 && this.mines.length < 4 + this.level) {
          this.mines.push({ x: sub.x + sub.w / 2, y: sub.y, vy: -1.7 - Math.random() * 0.5 });
          sub.fire = 120 + Math.random() * Math.max(80, 260 - this.level * 14);
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
          this.destroySub(i); hit = true; break;
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
      // A floatmine rises only as far as the surface, where it either hits the
      // boat or pops — it never flies up into the sky.
      if (m.y <= SURFACE) {
        if (this.phase === 'playing' && m.x > this.boatX - BOAT_HALF && m.x < this.boatX + BOAT_HALF) {
          this.killBoat();
        } else {
          this.booms.push({ x: m.x - 2, y: SURFACE - 4, t: 0, life: 12, kind: 'pop' });
        }
        continue;
      }
      next.push(m);
    }
    this.mines = next;
  }

  destroySub(i: number) {
    const sub = this.subs[i];
    const depthFrac = (sub.y - 150) / (FLOOR - 175);
    const speedFrac = Math.min(1, Math.abs(sub.vx) / (1.3 + this.level * 0.18));
    let pts = 100 + (0.6 * depthFrac + 0.4 * speedFrac) * 2900;
    pts = Math.max(100, Math.min(3000, Math.round(pts / 100) * 100));
    this.score += pts;
    play('subBoom');
    if (this.score >= this.nextLife) { this.lives++; this.nextLife += 25000; play('extraLife'); }
    this.booms.push({ x: sub.x, y: sub.y - 4, t: 0, life: 20, kind: 'sub' });
    this.subs.splice(i, 1);
  }

  killBoat() {
    this.lives--;
    this.phase = 'dying';
    this.phaseT = 0;
    this.booms.push({ x: this.boatX - 55, y: BOAT_PY, t: 0, life: 60, kind: 'boat' });
    play('boatBoom');
  }

  // --- render ------------------------------------------------------------
  draw() {
    const c = this.ctx, s = this.s;
    c.imageSmoothingEnabled = false;
    c.drawImage(s.bg, 0, py(0), PLAY_W, PLAY_H);

    for (const sub of this.subs) this.drawSub(sub);
    for (const m of this.mines) c.drawImage(s.mine, Math.round(m.x) - 2, py(Math.round(m.y)));
    for (const b of this.bombs) {
      const fr = [s.bomb0, s.bomb1, s.bomb2][Math.floor(b.y / 6) % 3];
      c.drawImage(fr, Math.round(b.x) - 2, py(Math.round(b.y)));
    }
    if (this.phase !== 'dying') c.drawImage(s.boat, Math.round(this.boatX) - 55, py(BOAT_PY));
    for (const b of this.booms) {
      if (b.kind === 'boat') {
        const f = [s.boat_die0, s.boat_die1, s.boat_die2, s.boat_die3][Math.min(3, Math.floor(b.t / 15))];
        c.drawImage(f, Math.round(b.x), py(b.y));
      } else if (b.kind === 'pop') {
        const f = [s.bubble0, s.bubble1, s.bubble2][Math.min(2, Math.floor(b.t / 4))];
        c.drawImage(f, Math.round(b.x), py(b.y));
      } else {
        c.drawImage(b.t < b.life / 2 ? s.boom0 : s.boom1, Math.round(b.x), py(b.y));
      }
    }

    if (this.phase === 'ready') this.centerText(s.text_ready);
    if (this.phase === 'over') this.centerText(s.text_over);
    if (this.paused) this.centerText(s.text_pause);

    this.drawBar();
    if (this.openMenu) this.drawDropdown();
    if (this.overlay) this.drawOverlay();
  }

  drawSub(sub: Sub) {
    const c = this.ctx, s = this.s;
    const img = sub.variant ? s.sub2_l : s.sub_l;
    const facingRight = sub.vx > 0;
    const x = Math.round(sub.x), y = py(Math.round(sub.y));
    if (facingRight === SUB_FACES_RIGHT) {
      c.drawImage(img, x, y);
    } else {
      c.save();
      c.translate(x + sub.w, y);
      c.scale(-1, 1);
      c.drawImage(img, 0, 0);
      c.restore();
    }
  }

  centerText(img: HTMLImageElement) {
    const scale = 2;
    this.ctx.drawImage(img, (W - img.width * scale) / 2, py(150), img.width * scale, img.height * scale);
  }

  drawBar() {
    const c = this.ctx, s = this.s;
    c.fillStyle = '#c0c0c0'; c.fillRect(0, 0, W, BAR_H);
    c.fillStyle = '#808080'; c.fillRect(0, BAR_H - 1, W, 1);
    c.textBaseline = 'middle';
    c.font = `14px ${FONT}`;
    // menu labels (with measured hit rects)
    this.menuHits = [];
    let mx = 8;
    for (const m of MENUS) {
      const w = c.measureText(m.label).width;
      if (this.openMenu === m.id) { c.fillStyle = '#000080'; c.fillRect(mx - 4, 2, w + 8, BAR_H - 4); c.fillStyle = '#fff'; }
      else c.fillStyle = '#000';
      c.fillText(m.label, mx, BAR_H / 2 + 1);
      this.menuHits.push({ id: m.id, x: mx - 4, y: 0, w: w + 8, h: BAR_H });
      mx += w + 18;
    }
    // right-aligned status: lives, subs, bombs, level, score
    const midY = BAR_H / 2;
    const dy = Math.round(midY - s.digits.height / 2);
    let x = 150;
    const icon = (img: HTMLImageElement, h: number) => {
      const w = (img.width / img.height) * h;
      c.drawImage(img, x, Math.round(midY - h / 2), w, h); x += w + 3;
    };
    c.fillStyle = '#000';
    icon(s.boat, 12); x += drawNumber(c, s.digits, this.lives, x, dy) + 8;
    icon(s.sub_r, 12); x += drawNumber(c, s.digits, this.subs.length, x, dy) + 8;
    icon(s.icon_bomb, 12); x += drawNumber(c, s.digits, this.bombsMax - this.bombs.length, x, dy) + 14;
    c.fillText('Level', x, midY + 1); x += 38; x += drawNumber(c, s.digits, this.level, x, dy) + 14;
    c.fillText('Score', x, midY + 1); x += 40; drawNumber(c, s.digits, this.score, x, dy);
  }

  drawDropdown() {
    const c = this.ctx;
    const menu = MENUS.find((m) => m.id === this.openMenu)!;
    const anchor = this.menuHits.find((h) => h.id === menu.id)!;
    c.font = `13px ${FONT}`;
    const itemH = 18, padX = 18;
    const w = Math.max(90, ...menu.items.map((it) => c.measureText(it.label).width + padX * 2));
    const x = anchor.x, y0 = BAR_H;
    const h = menu.items.length * itemH + 4;
    // raised gray box
    c.fillStyle = '#c0c0c0'; c.fillRect(x, y0, w, h);
    c.fillStyle = '#fff'; c.fillRect(x, y0, w, 1); c.fillRect(x, y0, 1, h);
    c.fillStyle = '#000'; c.fillRect(x + w - 1, y0, 1, h); c.fillRect(x, y0 + h - 1, w, 1);
    this.itemHits = [];
    c.textBaseline = 'middle';
    menu.items.forEach((it, i) => {
      const iy = y0 + 2 + i * itemH;
      let label = it.label;
      if (it.action === 'pause') label = this.paused ? 'Resume' : 'Pause';
      if (it.action === 'mute') label = this.muted ? 'Sound: Off' : 'Sound: On';
      c.fillStyle = '#000';
      c.fillText(label, x + padX, iy + itemH / 2);
      this.itemHits.push({ id: it.action, x, y: iy, w, h: itemH });
    });
  }

  drawOverlay() {
    const c = this.ctx;
    const lines = this.overlay === 'controls'
      ? ['CONTROLS', '', '← / →   move  (opposite key brakes)', 'Z or ,   drop sinkbomb left',
         'X or .   drop sinkbomb right', 'Space    drop on your heading', 'P pause   N new game   M mute', '', 'Click to close']
      : ['SinkSub for Windows', 'Anders Wihlborg, 1993', '', 'Sink the hostile subs and dodge',
         'the floatmines they fire at you.', '', 'Browser port — Old Games', '', 'Click to close'];
    const bw = 380, bh = 196, bx = (W - bw) / 2, by = py(120);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, BAR_H, W, PLAY_H);
    c.fillStyle = '#c0c0c0'; c.fillRect(bx, by, bw, bh);
    c.fillStyle = '#fff'; c.fillRect(bx, by, bw, 2); c.fillRect(bx, by, 2, bh);
    c.fillStyle = '#000'; c.fillRect(bx + bw - 2, by, 2, bh); c.fillRect(bx, by + bh - 2, bw, 2);
    c.fillStyle = '#000080'; c.fillRect(bx + 3, by + 3, bw - 6, 20);
    c.fillStyle = '#fff'; c.font = `bold 13px ${FONT}`; c.textBaseline = 'middle';
    c.fillText(this.overlay === 'controls' ? 'Controls' : 'About SinkSub', bx + 8, by + 13);
    c.fillStyle = '#000'; c.font = `13px ${FONT}`; c.textBaseline = 'alphabetic';
    lines.forEach((ln, i) => c.fillText(ln, bx + 20, by + 48 + i * 18));
  }
}

function inHit(h: Hit, x: number, y: number): boolean {
  return x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;
}

// --- bootstrap ---------------------------------------------------------------
async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  try { await (document as any).fonts.load(`14px W95FA`); } catch { /* ignore */ }
  const sprites = await loadSprites();
  const game = new Game(ctx, sprites);
  reportReady();
  initAudio().catch(() => { /* audio is best-effort */ });

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    unlockAudio();
    game.keydown(e.code);
  });
  window.addEventListener('keyup', (e) => game.keyup(e.code));

  const toCanvas = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)] as const;
  };
  const steer = (cx: number, down: boolean) => {
    const leftSide = cx < W / 2;
    if (down) {
      if (game.phase === 'over') { game.startGame(); return; }
      if (game.phase === 'ready') { game.phase = 'playing'; game.phaseT = 0; }
      game.dropBomb(leftSide ? -1 : 1);
    }
    game.left = down && leftSide;
    game.right = down && !leftSide;
  };
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    const [cx, cy] = toCanvas(e);
    if (game.pointer(cx, cy)) return; // UI consumed it
    canvas.setPointerCapture(e.pointerId);
    steer(cx, true);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!(e.pressure > 0 || e.buttons)) return;
    if (game.openMenu || game.overlay) return;
    const [cx, cy] = toCanvas(e);
    if (cy >= BAR_H) steer(cx, true);
  });
  canvas.addEventListener('pointerup', () => { game.left = false; game.right = false; });

  let acc = 0, last = performance.now();
  const STEP = 1000 / 60;
  function frame(now: number) {
    acc += Math.min(now - last, 100); last = now;
    while (acc >= STEP) { game.update(); acc -= STEP; }
    game.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
