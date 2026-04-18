#!/usr/bin/env bun
/**
 * scroll-test.ts — TWO terminal panes, wheel-scroll only, no blink.
 *
 * Run:
 *   bun example/scroll-test.ts
 *
 * Goal: hover the mouse over either pane, scroll wheel — that pane
 * scrolls through its xterm.js scrollback. Both panes equal. q quits.
 */

import blessed from '../dist/blessed.mjs';

const screen = blessed.screen({
  smartCSR: true,
  title: 'scroll-test (two-pane wheel-only)',
  fullUnicode: false,
  mouse: true,
});

// pioneer-blessed's screen ctor doesn't actually honor `mouse: true`
// (no options.mouse handler). Force mouse-tracking ON explicitly.
screen.enableMouse();
screen.program.setMouse({ allMotion: true }, true);

// Side-by-side panes. NO dockBorders — instead a 1-column gutter
// between them so neither pane's border touches the other.
//   left:  cols 0       .. 50%-1     (border + content)
//   gap:   col  50%
//   right: cols 50%+1   .. 100%
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
  content: ' booting…',
  style: { fg: 'white', bg: 'blue' },
});

// Hide xterm cursors
left.term?.write('\x1b[?25l');
right.term?.write('\x1b[?25l');

// Live diagnostic so we can see what blessed is dispatching.
const stats = { hover: '-', lastEvt: '-', leftN: 0, rightN: 0 };
function refresh() {
  status.setContent(
    ` hover=${stats.hover}  evt=${stats.lastEvt}  L=${stats.leftN}  R=${stats.rightN}  ·  wheel over a pane to scroll  ·  q quit `
  );
  screen.render();
}

// Debug log to /tmp/scroll-debug.log — survives TUI teardown so we
// can SEE whether blessed received the events you triggered.
import * as fs from 'fs';
const LOG = '/tmp/scroll-debug.log';
fs.writeFileSync(LOG, `--- session start ${new Date().toISOString()} ---\n`);
const dbg = (line: string) => fs.appendFileSync(LOG, line + '\n');

// Screen-level mouse listener — JUST logs, doesn't render. Tells us
// whether blessed sees ANY mouse events at all in your terminal.
screen.on('mouse', (data: any) => {
  if (data.action === 'wheelup' || data.action === 'wheeldown') {
    dbg(`SCREEN mouse evt: ${data.action} @ (${data.x},${data.y})`);
  }
});

// Screen-level keypress listener — wheel-as-arrow-key terminals send
// these instead of mouse events.
screen.on('keypress', (_ch: string, key: any) => {
  if (!key) return;
  if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) {
    dbg(`SCREEN key evt: ${key.name}`);
  }
});

const labelOf = (p: any) => (p === left ? 'L' : p === right ? 'R' : '?');
for (const p of [left, right]) {
  p.on('mouseover', () => {
    dbg(`${labelOf(p)} mouseover`);
    stats.hover = labelOf(p);
    refresh();
  });
  p.on('mouseout', () => {
    dbg(`${labelOf(p)} mouseout`);
    if (stats.hover === labelOf(p)) stats.hover = '-';
    refresh();
  });
  p.on('wheelup', () => {
    dbg(`${labelOf(p)} wheelup`);
    p.scroll(-3);
    stats.lastEvt = `${labelOf(p)}-up`;
    if (p === left) stats.leftN++;
    else stats.rightN++;
    refresh();
  });
  p.on('wheeldown', () => {
    dbg(`${labelOf(p)} wheeldown`);
    p.scroll(3);
    stats.lastEvt = `${labelOf(p)}-down`;
    if (p === left) stats.leftN++;
    else stats.rightN++;
    refresh();
  });
}

// ── Wheel-as-arrow-keys routing ─────────────────────────
// In terminals that translate wheel→arrow in alt-screen (the iTerm2
// default), blessed never sees mouse events. We route those arrow
// keys to the FOCUSED scrollable pane, falling back to LEFT.
function scrollTarget(): any {
  if (screen.focused === left) return left;
  if (screen.focused === right) return right;
  return left; // default
}
function half(p: any) {
  return Math.max(1, (((p.height as number) || 10) / 2) | 0);
}

screen.on('keypress', (_ch: string, key: any) => {
  if (!key) return;
  let delta = 0;
  switch (key.name) {
    case 'up':
      delta = -3;
      break;
    case 'down':
      delta = 3;
      break;
    case 'pageup':
      delta = -half(scrollTarget());
      break;
    case 'pagedown':
      delta = half(scrollTarget());
      break;
    default:
      return;
  }
  const t = scrollTarget();
  t.scroll(delta);
  stats.lastEvt = `KEY-${key.name} → ${labelOf(t)}.scroll(${delta})`;
  if (t === left) stats.leftN++;
  else stats.rightN++;
  refresh();
});

// Tab to switch focus (and therefore the scroll target) without using mouse
screen.key(['tab'], () => {
  if (screen.focused === right) left.focus();
  else right.focus();
  stats.hover = labelOf(screen.focused);
  refresh();
});
left.focus();

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

// Pre-fill scrollback so scrolling has somewhere to go immediately.
const ipsum = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse.',
  'Cillum dolore eu fugiat nulla pariatur.',
];
const COLORS = [
  '\x1b[31m',
  '\x1b[32m',
  '\x1b[33m',
  '\x1b[34m',
  '\x1b[35m',
  '\x1b[36m',
  '\x1b[91m',
];
function writeLine(p: any, n: number) {
  const line = ipsum[n % ipsum.length];
  const color = COLORS[n % COLORS.length];
  p.term?.write(`${color}[${String(n).padStart(5, '0')}]\x1b[0m  ${line}\r\n`);
}
let n = 0;
for (n = 1; n <= 200; n++) {
  writeLine(left, n);
  writeLine(right, n);
}

// Slow stream so we can see live tail also works
const timer = setInterval(() => {
  n++;
  writeLine(left, n);
  writeLine(right, n);
  refresh();
}, 400);
process.on('SIGINT', () => {
  clearInterval(timer);
  screen.destroy();
  process.exit(0);
});

screen.render();
refresh();
