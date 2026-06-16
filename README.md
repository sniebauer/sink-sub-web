# SinkSub — browser port

A faithful browser port of **SinkSub for Windows** (Anders Wihlborg, 1993),
rebuilt from the original game's own artwork. You pilot a boat on the surface,
drop *sinkbombs* onto enemy submarines, and dodge the *floatmines* they fire up
at you.

This is **not an emulator**. The game logic is reimplemented in TypeScript on an
HTML canvas; only the *art* comes from the original — every sprite is extracted
straight out of the 1993 16-bit Windows executable.

Built to be embedded by the [Old Games desktop](https://oldgames-desktop.pages.dev)
shell via an `<iframe>`, and playable standalone.

## How to play

- **← / →** — move the boat left / right (press the opposite key to brake)
- **Z / ,** — drop a sinkbomb off the **left** side
- **X / .** — drop a sinkbomb off the **right** side
- **Space / ↓** — drop on the side you're heading
- **Enter / N** — start / restart
- **P** — pause · **M** — mute (Game menu has these too)

Only a limited number of sinkbombs can be in the water at once; they reload as
they explode. Sinking a sub scores 100–3000 by its depth and speed; every 25,000
points earns an extra life. On touch screens, tap a side to steer and bomb it.

## Develop

```sh
npm install
npm run dev      # http://localhost:5180
npm run build    # typecheck + production build to dist/
```

## Assets

All sprites in `public/sprites/` and sound effects in `public/sounds/` are
extracted from `original/SINKSUB.EXE` (a Windows 3.x NE binary; graphics are
BITMAP resources with mask+color transparency, sounds are 8-bit PCM / WAV
resources). Regenerate them with:

```sh
brew install icoutils
pip install pillow
python3 tools/extract-assets.py
```

The original shareware files are kept in `original/` for provenance and
reproducibility. SinkSub was distributed as shareware; all rights to the
original game and its artwork remain with its author.

## Deploy

Deployed as its own **Cloudflare Pages** project connected to this repo
(push `main` → auto build & deploy). Build command `npm run build`, output
`dist`, Node `20` (`.nvmrc`).
