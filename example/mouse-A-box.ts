#!/usr/bin/env bun
/**
 * mouse-A-box.ts — control test: mouse with blessed.box only.
 *
 * Identical to mouse-B-terminal.ts except this uses blessed.box.
 * Run, wheel/click around, q to quit, then `cat /tmp/mouse-A.log`.
 */

import blessed from '../dist/blessed.mjs';
import * as fs from 'fs';

const LOG = '/tmp/mouse-A.log';
fs.writeFileSync(LOG, `--- A (box) start ${new Date().toISOString()} ---\n`);
const dbg = (l: string) => fs.appendFileSync(LOG, l + '\n');

const screen = blessed.screen({ smartCSR: true, title: 'mouse-A-box' });
screen.enableMouse();
screen.program.setMouse(
  {
    normalMouse: true,
    vt200Mouse: true,
    buttonEventMouse: true,
    allMotion: true,
    sgrMouse: true,
    urxvtMouse: true,
  },
  true
);

// ─ blessed.BOX (the control) ────────────────────────────
const pane = blessed.box({
  parent: screen,
  label: ' BOX (control) — wheel here ',
  border: 'line',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%-1',
  tags: true,
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  content: 'wheel & click in this pane. log → /tmp/mouse-A.log',
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true } },
});

const status = blessed.box({
  parent: screen,
  bottom: 0,
  height: 1,
  width: '100%',
  content: ' wheel/click anywhere · q quit',
  style: { fg: 'white', bg: '#222244' },
});

// State check — these should be true after enableMouse + adding 'mouse' listener
dbg(
  `STATE: screen._listenedMouse=${(screen as any)._listenedMouse}  program._boundMouse=${(screen.program as any)._boundMouse}  program.mouseEnabled=${screen.program.mouseEnabled}`
);

// CRITICAL: this listener triggers `bindMouse()` in blessed.program.
// Without this, screen.enableMouse() sends the codes but the parser
// never wakes up — that was the bug behind every failing test.
screen.program.on('mouse', (data: any) => {
  if (data.action === 'mousemove') return; // skip motion noise
  dbg(`PROGRAM ${data.action} @ (${data.x},${data.y})  button=${data.button}`);
});

// Re-check after program-level listener
dbg(
  `STATE2: screen._listenedMouse=${(screen as any)._listenedMouse}  program._boundMouse=${(screen.program as any)._boundMouse}`
);

// Inspect listener wiring
const inp = screen.program.input as any;
const prg = screen.program as any;
dbg(`WIRING: input===process.stdin? ${inp === process.stdin}`);
dbg(
  `WIRING: input.listenerCount('data')=${inp.listenerCount?.('data') ?? 'n/a'}`
);
dbg(
  `WIRING: program.listenerCount('data')=${prg.listenerCount?.('data') ?? 'n/a'}`
);
dbg(
  `WIRING: program.listenerCount('mouse')=${prg.listenerCount?.('mouse') ?? 'n/a'}`
);
dbg(
  `WIRING: input.isPaused()=${inp.isPaused?.() ?? 'n/a'}  isRaw=${inp.isRaw}`
);

// Hook the program 'data' event to verify it actually re-emits
screen.program.on('data', (buf: Buffer) => {
  dbg(
    `PROGRAM-DATA ${buf.length}b: ${buf.toString('binary').replace(/\x1b/g, '\\e')}`
  );
});

// stdin raw bytes
screen.program.input.on('data', (buf: Buffer) => {
  dbg(
    `STDIN ${buf.length}b: ${buf.toString('binary').replace(/\x1b/g, '\\e')}`
  );
});

screen.on('mouse', (data: any) => {
  if (data.action === 'mousemove') return;
  dbg(`SCREEN ${data.action} @ (${data.x},${data.y})`);
});
pane.on('wheelup', () => dbg('PANE wheelup'));
pane.on('wheeldown', () => dbg('PANE wheeldown'));
pane.on('click', (d: any) => dbg(`PANE click @ (${d.x},${d.y})`));

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

setInterval(() => {}, 30_000);
screen.render();
