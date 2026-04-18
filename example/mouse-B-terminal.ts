#!/usr/bin/env bun
/**
 * mouse-B-terminal.ts — same as mouse-A-box.ts but using blessed.terminal.
 *
 * If A logs events and B doesn't, the bug is in the terminal widget.
 * Run, wheel/click around, q to quit, then `cat /tmp/mouse-B.log`.
 */

import blessed from '../dist/blessed.mjs';
import * as fs from 'fs';

const LOG = '/tmp/mouse-B.log';
fs.writeFileSync(
  LOG,
  `--- B (terminal) start ${new Date().toISOString()} ---\n`
);
const dbg = (l: string) => fs.appendFileSync(LOG, l + '\n');

const screen = blessed.screen({ smartCSR: true, title: 'mouse-B-terminal' });
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

// ─ blessed.TERMINAL (the variable under test) ───────────
const pane = blessed.terminal({
  parent: screen,
  label: ' TERMINAL (test) — wheel here ',
  border: 'line',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%-1',
  noPty: true,
  scrollback: 10000,
  mouse: true,
  cursorBlink: false,
  style: { border: { fg: 'magenta' }, label: { fg: 'magenta', bold: true } },
} as any);

const status = blessed.box({
  parent: screen,
  bottom: 0,
  height: 1,
  width: '100%',
  content: ' wheel/click anywhere · q quit',
  style: { fg: 'white', bg: '#222244' },
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

// Show some content so it's not just an empty pane
const COLORS = [
  '\x1b[31m',
  '\x1b[32m',
  '\x1b[33m',
  '\x1b[34m',
  '\x1b[35m',
  '\x1b[36m',
];
setTimeout(() => {
  for (let n = 1; n <= 100; n++) {
    pane.term?.write(
      `${COLORS[n % 6]}[${String(n).padStart(5, '0')}]\x1b[0m  Lorem ipsum ${n}\r\n`
    );
  }
  screen.render();
}, 100);

setInterval(() => {}, 30_000);
screen.render();
