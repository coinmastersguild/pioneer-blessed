#!/usr/bin/env bun
/**
 * scroll-test-single.ts — minimal single-pane scroll proof.
 *
 * One full-screen terminal pane. Pre-filled with 300 ipsum lines so the
 * scrollback is non-empty before you touch a key. Then a slow stream
 * keeps appending more.
 *
 * Run:
 *   bun example/scroll-test-single.ts
 *
 * Test (in this order):
 *   k → scroll UP  by 3 lines    (older content)
 *   j → scroll DOWN by 3 lines    (newer content)
 *   K → page UP
 *   J → page DOWN
 *   wheel up/down over the pane
 *   b → snap to bottom (live tail)
 *   t → snap to top (oldest line)
 *   q → quit
 *
 * Status bar shows: viewportY, baseY, scrollback length, last event.
 */

import blessed from '../dist/blessed.mjs';

const screen = blessed.screen({
  smartCSR: true,
  title: 'scroll-test-single',
  fullUnicode: false,
  mouse: true,
});

const pane = blessed.terminal({
  parent: screen,
  label:
    ' SINGLE PANE — k/j scroll up/down, K/J page, wheel, b bottom, t top, q quit ',
  border: 'line',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%-1',
  noPty: true,
  scrollback: 10000,
  mouse: true,
  cursorBlink: false,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true } },
} as any);

const status = blessed.box({
  parent: screen,
  bottom: 0,
  height: 1,
  width: '100%',
  content: ' booting…',
  style: { fg: 'white', bg: 'blue' },
});

pane.term?.write('\x1b[?25l'); // hide cursor

const stats = { lastEvt: '-', vy: 0, baseY: 0, sblen: 0 };
function refresh() {
  const buf = pane.term?.buffer.active;
  if (buf) {
    stats.vy = buf.viewportY ?? 0;
    stats.baseY = buf.baseY ?? 0;
    stats.sblen = buf.length ?? 0;
  }
  status.setContent(
    ` evt=${stats.lastEvt}  viewportY=${stats.vy}  baseY=${stats.baseY}  bufferLen=${stats.sblen}  · k/j K/J wheel b t q `
  );
  screen.render();
}

// Pre-fill scrollback so scroll-up + scroll-down both have somewhere to go
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
function writeLine(n: number) {
  const line = ipsum[n % ipsum.length];
  const color = COLORS[n % COLORS.length];
  pane.term?.write(
    `${color}[${String(n).padStart(5, '0')}]\x1b[0m  ${line}\r\n`
  );
}

let n = 0;
for (n = 1; n <= 300; n++) writeLine(n);

// Manual scroll keys — independent of mouse
pane.term?.write('\x1b[?25l');
function half() {
  return Math.max(1, (((pane.height as number) || 10) / 2) | 0);
}

screen.key(['k'], () => {
  pane.scroll(-3);
  stats.lastEvt = 'k → scroll(-3)';
  refresh();
});
screen.key(['j'], () => {
  pane.scroll(3);
  stats.lastEvt = 'j → scroll(+3)';
  refresh();
});
screen.key(['K'], () => {
  pane.scroll(-half());
  stats.lastEvt = `K → scroll(-${half()})`;
  refresh();
});
screen.key(['J'], () => {
  pane.scroll(half());
  stats.lastEvt = `J → scroll(+${half()})`;
  refresh();
});
screen.key(['b'], () => {
  pane.scrollToBottom();
  stats.lastEvt = 'b → bottom';
  refresh();
});
screen.key(['t'], () => {
  pane.scrollToTop();
  stats.lastEvt = 't → top';
  refresh();
});

// Wheel
pane.on('wheelup', () => {
  pane.scroll(-3);
  stats.lastEvt = 'wheel-UP';
  refresh();
});
pane.on('wheeldown', () => {
  pane.scroll(3);
  stats.lastEvt = 'wheel-DOWN';
  refresh();
});

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

// Slow tail stream so we can also see live updates
const timer = setInterval(() => {
  n++;
  writeLine(n);
  refresh();
}, 500);
process.on('SIGINT', () => {
  clearInterval(timer);
  screen.destroy();
  process.exit(0);
});

screen.render();
refresh();
