// SinkSub — a browser port of the 1993 Windows game by Anders Wihlborg, built
// from the original game's extracted sprites and tuned to the original's own
// constants (recovered by disassembling SINKSUB.EXE): a 50ms / 20-fps tick,
// velocity-based boat control, and the authentic sound→event mapping.

import { loadSprites, type Sprites } from './sprites';
import { reportReady, reportTitle } from './embed';
import { initAudio, unlockAudio, play, toggleMute } from './audio';

// --- geometry ----------------------------------------------------------------
const BAR_H = 26;
const PLAY_W = 640;
const PLAY_H = 450;
const W = PLAY_W; // canvas height = BAR_H + PLAY_H = 476 (index.html)
const SURFACE = 100; // water surface, playfield-y
const FLOOR = 412; // subs/bombs bottom out
const BOAT_PY = 82;
const BOAT_HALF = 52;
const FONT = "'W95FA', 'MS Sans Serif', Tahoma, sans-serif";

// Authentic per-tick speeds (px per 50ms tick) from the disassembly.
const BOAT_VMAX = 3; // boat velocity is ±3 px/tick, set by key presses, persists
const SUB_SPEED = 2; // subs cruise at 2 px/tick
const BOMB_VY = 1; // sinkbombs sink 1 px/tick
const MINE_VY = 2; // floatmines rise 2 px/tick (faster than bombs, per the manual)
const PLANE_VX = 2; // plane crosses at 2 px/tick
const PING_TICKS = 100; // sonar ping every ~5s (100 ticks @ 20fps)

const py = (y: number) => BAR_H + y;

interface Sub { x: number; y: number; vx: number; w: number; h: number; variant: number; fire: number; }
interface Bomb { x: number; y: number; }
interface Mine { x: number; y: number; }
interface Boom { x: number; y: number; t: number; life: number; kind: 'sub' | 'boat'; }
interface Plane { x: number; y: number; frame: number; animT: number; }
interface Bird { x: number; y: number; frame: number; animT: number; speed: number; }
interface Hit { id: string; x: number; y: number; w: number; h: number; }

type Phase = 'ready' | 'playing' | 'dying' | 'over';

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
  score = 0;
  lives = 3;
  level = 1;
  nextLife = 25000;
  bombsMax = 3;
  // boat: velocity in px/tick, persists until a key nudges it (no friction)
  boatX = W / 2;
  boatVel = 0;
  // world
  subs: Sub[] = [];
  bombs: Bomb[] = [];
  mines: Mine[] = [];
  booms: Boom[] = [];
  plane: Plane | null = null;
  birds: Bird[] = [];
  planeTimer = 240;
  birdTimer = 30;
  pingT = 0;
  // phase / ui
  phase: Phase = 'ready';
  phaseT = 0;
  paused = false;
  muted = false;
  openMenu: string | null = null;
  overlay: 'controls' | 'about' | null = null;
  menuHits: Hit[] = [];
  itemHits: Hit[] = [];
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
    this.birds = [];
    this.plane = null;
    this.startLevel();
  }

  startLevel() {
    this.bombsMax = 2 + this.level;
    this.bombs = [];
    this.mines = [];
    this.booms = [];
    this.boatX = W / 2;
    this.boatVel = 0;
    this.pingT = 0;
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
      this.subs.push({
        x: Math.random() * (W - 64),
        y: 150 + Math.random() * (FLOOR - 175),
        vx: dir * SUB_SPEED,
        w: 64, h: 20,
        variant: Math.random() < 0.5 ? 0 : 1,
        fire: 30 + Math.random() * 90,
      });
    }
  }

  // --- input -------------------------------------------------------------
  dropBomb(side: -1 | 1) {
    if (this.phase !== 'playing' || this.paused) return;
    if (this.bombs.length >= this.bombsMax) return;
    this.bombs.push({ x: this.boatX + side * (BOAT_HALF - 6), y: SURFACE - 2 });
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
      case 'Space': case 'ArrowDown': this.dropBomb(this.boatVel >= 0 ? 1 : -1); break;
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

  pointer(cx: number, cy: number): boolean {
    if (this.overlay) { this.overlay = null; return true; }
    if (this.openMenu) {
      for (const h of this.itemHits) if (inHit(h, cx, cy)) { this.menuAction(h.id); return true; }
      for (const h of this.menuHits) if (inHit(h, cx, cy)) { this.openMenu = h.id; return true; }
      this.openMenu = null;
      return true;
    }
    if (cy < BAR_H) {
      for (const h of this.menuHits) if (inHit(h, cx, cy)) { this.openMenu = h.id; return true; }
      return true;
    }
    return false;
  }

  // --- update (one 50ms tick) -------------------------------------------
  update() {
    if (this.paused || this.overlay) return;
    this.phaseT++;
    for (const b of this.booms) b.t++;
    this.booms = this.booms.filter((b) => b.t < b.life);

    // sky ambiance runs in every phase
    this.updatePlane();
    this.updateBirds();

    if (this.phase === 'ready') {
      if (this.phaseT > 28) { this.phase = 'playing'; this.phaseT = 0; }
      this.moveSubs();
      return;
    }
    if (this.phase === 'over') { this.moveSubs(); return; }
    if (this.phase === 'dying') {
      this.moveSubs();
      if (this.phaseT > 22) {
        if (this.lives <= 0) { this.phase = 'over'; this.phaseT = 0; reportTitle('Game Over'); play('gameOver'); }
        else this.startLevelKeepStats();
      }
      return;
    }

    // playing
    if (++this.pingT >= PING_TICKS) { this.pingT = 0; play('ping'); }
    this.moveBoat();
    this.moveSubs();
    this.moveBombs();
    this.moveMines();
    if (this.subs.length === 0) { play('levelClear'); this.level++; this.startLevel(); }
  }

  // After losing a life: same level again (the original restarts the level).
  startLevelKeepStats() {
    this.startLevel();
  }

  moveBoat() {
    // Each held tick nudges velocity ±1 toward ±VMAX; it persists when released,
    // so you brake by pressing the opposite key (faithful to the original).
    if (this.left && !this.right) this.boatVel = Math.max(-BOAT_VMAX, this.boatVel - 1);
    else if (this.right && !this.left) this.boatVel = Math.min(BOAT_VMAX, this.boatVel + 1);
    this.boatX += this.boatVel;
    if (this.boatX < BOAT_HALF) { this.boatX = BOAT_HALF; this.boatVel = 0; }
    if (this.boatX > W - BOAT_HALF) { this.boatX = W - BOAT_HALF; this.boatVel = 0; }
  }

  moveSubs() {
    for (const sub of this.subs) {
      sub.x += sub.vx;
      if (sub.x < 0) { sub.x = 0; sub.vx = SUB_SPEED; }
      if (sub.x > W - sub.w) { sub.x = W - sub.w; sub.vx = -SUB_SPEED; }
      if (this.phase === 'playing') {
        sub.fire--;
        if (sub.fire <= 0 && this.mines.length < 3 + this.level) {
          this.mines.push({ x: sub.x + sub.w / 2, y: sub.y });
          sub.fire = 50 + Math.random() * Math.max(40, 140 - this.level * 8);
        }
      }
    }
  }

  moveBombs() {
    const next: Bomb[] = [];
    for (const b of this.bombs) {
      b.y += BOMB_VY;
      let hit = false;
      for (let i = 0; i < this.subs.length; i++) {
        const sub = this.subs[i];
        if (b.x > sub.x && b.x < sub.x + sub.w && b.y > sub.y && b.y < sub.y + sub.h) {
          this.destroySub(i); hit = true; break;
        }
      }
      if (hit) continue;
      if (b.y >= FLOOR) { this.booms.push({ x: b.x - 30, y: FLOOR - 10, t: 0, life: 8, kind: 'sub' }); continue; }
      next.push(b);
    }
    this.bombs = next;
  }

  moveMines() {
    const next: Mine[] = [];
    for (const m of this.mines) {
      m.y -= MINE_VY;
      if (m.y <= SURFACE) {
        if (this.phase === 'playing' && m.x > this.boatX - BOAT_HALF && m.x < this.boatX + BOAT_HALF) this.killBoat();
        continue; // reached the surface — hit the boat or just pops; never enters the sky
      }
      next.push(m);
    }
    this.mines = next;
  }

  destroySub(i: number) {
    const sub = this.subs[i];
    const depthFrac = (sub.y - 150) / (FLOOR - 175);
    let pts = 100 + (0.65 * depthFrac + 0.35) * 2900;
    pts = Math.max(100, Math.min(3000, Math.round(pts / 100) * 100));
    this.score += pts;
    play('explosion');
    if (this.score >= this.nextLife) { this.lives++; this.nextLife += 25000; play('extraLife'); }
    this.booms.push({ x: sub.x, y: sub.y - 4, t: 0, life: 8, kind: 'sub' });
    this.subs.splice(i, 1);
  }

  killBoat() {
    this.lives--;
    this.phase = 'dying';
    this.phaseT = 0;
    this.booms.push({ x: this.boatX - 55, y: BOAT_PY, t: 0, life: 22, kind: 'boat' });
    play('explosion');
  }

  // --- sky: plane + birds ------------------------------------------------
  updatePlane() {
    if (this.plane) {
      const p = this.plane;
      p.x -= PLANE_VX;
      if (++p.animT >= 4) { p.animT = 0; p.frame = (p.frame + 1) % 3; }
      if (p.x < -70) this.plane = null;
    } else if (--this.planeTimer <= 0) {
      this.planeTimer = 260 + Math.floor(Math.random() * 260); // ~13–26s between flybys
      this.plane = { x: W + 4, y: 6 + Math.random() * 48, frame: 0, animT: 0 };
    }
  }

  updateBirds() {
    for (const b of this.birds) {
      b.x += b.speed;
      if (++b.animT >= 5) { b.animT = 0; b.frame = (b.frame + 1) % 3; }
    }
    this.birds = this.birds.filter((b) => b.x < W + 8);
    if (--this.birdTimer <= 0 && this.birds.length < 3) {
      this.birdTimer = 40 + Math.floor(Math.random() * 70);
      this.birds.push({ x: -8, y: 8 + Math.random() * 70, frame: 0, animT: 0, speed: 0.6 + Math.random() * 0.9 });
    }
  }

  // --- render ------------------------------------------------------------
  draw() {
    const c = this.ctx, s = this.s;
    c.imageSmoothingEnabled = false;
    c.drawImage(s.bg, 0, py(0), PLAY_W, PLAY_H);

    // sky
    for (const b of this.birds) {
      const f = [s.bird0, s.bird1, s.bird2][b.frame];
      c.drawImage(f, Math.round(b.x), py(Math.round(b.y)));
    }
    if (this.plane) this.drawPlane(this.plane);

    for (const sub of this.subs) this.drawSub(sub);
    for (const m of this.mines) c.drawImage(s.mine, Math.round(m.x) - 2, py(Math.round(m.y)));
    for (const b of this.bombs) {
      const fr = [s.bomb0, s.bomb1, s.bomb2][Math.floor(b.y / 5) % 3];
      c.drawImage(fr, Math.round(b.x) - 2, py(Math.round(b.y)));
    }
    if (this.phase !== 'dying') c.drawImage(s.boat, Math.round(this.boatX) - 55, py(BOAT_PY));
    for (const b of this.booms) {
      if (b.kind === 'boat') {
        const f = [s.boat_die0, s.boat_die1, s.boat_die2, s.boat_die3][Math.min(3, Math.floor(b.t / 5))];
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

  drawPlane(p: Plane) {
    const c = this.ctx;
    const img = [this.s.plane0, this.s.plane1, this.s.plane2][p.frame];
    // The bitmap already faces left — the direction it flies — so no flip (the
    // original blits it as-is; BitBlt can't mirror).
    c.drawImage(img, Math.round(p.x), py(Math.round(p.y)));
  }

  drawSub(sub: Sub) {
    const c = this.ctx, s = this.s;
    const right = sub.vx > 0;
    const img = sub.variant
      ? (right ? s.sub2_r : s.sub2_l)
      : (right ? s.sub_l : s.sub_r);
    c.drawImage(img, Math.round(sub.x), py(Math.round(sub.y)));
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
    const midY = BAR_H / 2;
    let x = 138;
    const icon = (img: HTMLImageElement, h: number) => {
      const w = (img.width / img.height) * h;
      c.drawImage(img, x, Math.round(midY - h / 2), w, h); x += w + 4;
    };
    const num = (v: number) => {
      c.fillStyle = '#d00000'; c.font = `bold 15px ${FONT}`;
      const t = String(v); c.fillText(t, x, midY + 1); x += c.measureText(t).width + 12;
    };
    const lbl = (t: string) => {
      c.fillStyle = '#000'; c.font = `14px ${FONT}`;
      c.fillText(t, x, midY + 1); x += c.measureText(t).width + 5;
    };
    icon(s.boat, 13); num(this.lives);
    icon(s.sub_l, 13); num(this.subs.length);
    icon(s.icon_bomb, 12); num(this.bombsMax - this.bombs.length);
    lbl('Level'); num(this.level);
    lbl('Score'); num(this.score);
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
      ? ['CONTROLS', '', '← / →   steer (it keeps gliding;', '          press the other way to brake)',
         'Z or ,   drop sinkbomb left', 'X or .   drop sinkbomb right', 'P pause   N new game   M mute', '', 'Click to close']
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
  initAudio().catch(() => { /* best-effort */ });

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    unlockAudio();
    game.keydown(e.code);
  });
  window.addEventListener('keyup', (e) => game.keyup(e.code));

  const touch = window.matchMedia('(pointer: coarse)').matches;
  const toCanvas = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)] as const;
  };
  const startIfIdle = () => {
    if (game.phase === 'over') { game.startGame(); return true; }
    if (game.phase === 'ready') { game.phase = 'playing'; game.phaseT = 0; }
    return false;
  };
  const steer = (cx: number, down: boolean) => {
    const leftSide = cx < W / 2;
    if (down) { if (startIfIdle()) return; game.dropBomb(leftSide ? -1 : 1); }
    game.left = down && leftSide;
    game.right = down && !leftSide;
  };
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    const [cx, cy] = toCanvas(e);
    if (game.pointer(cx, cy)) return;
    if (touch) return;
    canvas.setPointerCapture(e.pointerId);
    steer(cx, true);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touch || !(e.pressure > 0 || e.buttons)) return;
    if (game.openMenu || game.overlay) return;
    const [cx, cy] = toCanvas(e);
    if (cy >= BAR_H) steer(cx, true);
  });
  canvas.addEventListener('pointerup', () => { game.left = false; game.right = false; });

  const hold = (id: string, on: () => void, off: () => void) => {
    const el = document.getElementById(id)!;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); on(); });
    el.addEventListener('pointerup', (e) => { e.preventDefault(); off(); });
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  };
  hold('btn-left', () => { game.left = true; }, () => { game.left = false; });
  hold('btn-right', () => { game.right = true; }, () => { game.right = false; });
  const fire = (id: string, side: -1 | 1) => {
    document.getElementById(id)!.addEventListener('pointerdown', (e) => {
      e.preventDefault(); unlockAudio();
      if (startIfIdle()) return;
      game.dropBomb(side);
    });
  };
  fire('btn-bl', -1);
  fire('btn-br', 1);

  // Simulate at the original 50ms / 20-fps tick; render every animation frame.
  let acc = 0, last = performance.now();
  const STEP = 1000 / 20;
  function frame(now: number) {
    acc += Math.min(now - last, 200); last = now;
    while (acc >= STEP) { game.update(); acc -= STEP; }
    game.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
