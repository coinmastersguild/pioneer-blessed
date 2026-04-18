#!/usr/bin/env bun
/**
 * two-scroll.ts — bare minimum: two SIDE-BY-SIDE panes, wheel scroll each.
 *
 * Run:
 *   bun example/two-scroll.ts
 *
 * Mouse wheel over LEFT  → scrolls LEFT only.
 * Mouse wheel over RIGHT → scrolls RIGHT only.
 * q quits.
 *
 * Logs every wheel event + dispatch result to /tmp/two-scroll.log
 */

import blessed from '../dist/blessed.mjs';
import * as fs from 'fs';

const LOG = '/tmp/two-scroll.log';
fs.writeFileSync(LOG, `--- session start ${new Date().toISOString()} ---\n`);
const dbg = (l: string) => fs.appendFileSync(LOG, l + '\n');

const screen = blessed.screen({
  smartCSR: true,
  title: 'two-scroll (side-by-side)',
  fullUnicode: false,
});

// Full mouse modes — required so wheel comes as proper mouse events
// with x/y instead of being translated to arrow keys.
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

// Two side-by-side panes.
const left = blessed.terminal({
  parent: screen,
  label: ' LEFT ',
  border: 'line',
  top: 0,
  left: 0,
  width: '50%',
  height: '100%-1',
  noPty: true,
  scrollback: 10000,
  mouse: true,
  cursorBlink: false,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true } },
} as any);

const right = blessed.terminal({
  parent: screen,
  label: ' RIGHT ',
  border: 'line',
  top: 0,
  right: 0,
  width: '50%',
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
  tags: true,
  content: ' booting…',
  style: { fg: 'white', bg: '#222244' },
});

// Hide cursor in display panes
left.term?.write('\x1b[?25l');
right.term?.write('\x1b[?25l');

// Live counters
const counts = { L: 0, R: 0, screenWheel: 0 };
function setStatus(extra = '') {
  status.setContent(
    ` L=${counts.L} R=${counts.R} screen-wheel=${counts.screenWheel} ${extra ? '· ' + extra : ''} · q quit `
  );
  screen.render();
}

// Per-pane wheel
left.on('wheelup', () => {
  counts.L++;
  left.scroll(-3);
  dbg(`L wheelup → scroll(-3)`);
  setStatus('L↑');
});
left.on('wheeldown', () => {
  counts.L++;
  left.scroll(3);
  dbg(`L wheeldown → scroll(+3)`);
  setStatus('L↓');
});
right.on('wheelup', () => {
  counts.R++;
  right.scroll(-3);
  dbg(`R wheelup → scroll(-3)`);
  setStatus('R↑');
});
right.on('wheeldown', () => {
  counts.R++;
  right.scroll(3);
  dbg(`R wheeldown → scroll(+3)`);
  setStatus('R↓');
});

// Screen-level wheel logger — tells us whether blessed got the event
// at all, and what x/y it had, even if dispatch missed the pane.
screen.on('mouse', (data: any) => {
  if (data.action === 'wheelup' || data.action === 'wheeldown') {
    counts.screenWheel++;
    const lpL = (left.lpos as any) || {};
    const lpR = (right.lpos as any) || {};
    dbg(
      `SCREEN ${data.action} @ (${data.x},${data.y})  ` +
        `LEFT.lpos=(${lpL.xi}..${lpL.xl}, ${lpL.yi}..${lpL.yl})  ` +
        `RIGHT.lpos=(${lpR.xi}..${lpR.xl}, ${lpR.yi}..${lpR.yl})`
    );
  }
});

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

// Pre-fill scrollback
const ipsum = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse.',
];
const COLORS = [
  '\x1b[31m',
  '\x1b[32m',
  '\x1b[33m',
  '\x1b[34m',
  '\x1b[35m',
  '\x1b[36m',
];
function writeLine(p: any, n: number) {
  const line = ipsum[n % ipsum.length];
  const color = COLORS[n % COLORS.length];
  p.term?.write(`${color}[${String(n).padStart(5, '0')}]\x1b[0m  ${line}\r\n`);
}
let n = 0;
for (n = 1; n <= 250; n++) {
  writeLine(left, n);
  writeLine(right, n);
}

const timer = setInterval(() => {
  n++;
  writeLine(left, n);
  writeLine(right, n);
  screen.render();
}, 500);
process.on('SIGINT', () => {
  clearInterval(timer);
  screen.destroy();
  process.exit(0);
});

screen.render();
setStatus();
