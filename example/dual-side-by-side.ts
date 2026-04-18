#!/usr/bin/env bun
/**
 * dual-side-by-side.ts — two side-by-side terminal panes with
 * independent mouse-wheel scrolling. Built on every lesson from
 * docs/MOUSE-AND-SCROLL.md.
 *
 * Run:
 *   bun example/dual-side-by-side.ts
 *
 * Mouse wheel over LEFT  → scrolls LEFT only.
 * Mouse wheel over RIGHT → scrolls RIGHT only.
 * q quits, Ctrl-C quits.
 */

import blessed from '../dist/blessed.mjs';

const screen = blessed.screen({
  smartCSR: true,
  title: 'dual side-by-side',
  fullUnicode: false,
  // dockBorders merges the seam between adjacent panes so the
  // 1-column overlap (right pane starts at '50%-1') doesn't blink.
  dockBorders: true,
});

// Full mouse-mode set — required so wheel arrives as real mouse
// events with x/y. The bindMouse() fix in pioneer-blessed wakes
// the parser; without it, none of these would dispatch.
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

// LEFT pane — left edge of screen, 50% wide.
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

// RIGHT pane — overlaps LEFT by 1 col so dockBorders absorbs the seam
// cleanly. This pattern matches the multiplex.ts reference example.
const right = blessed.terminal({
  parent: screen,
  label: ' RIGHT ',
  border: 'line',
  top: 0,
  left: '50%-1',
  width: '50%+1',
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
  content: ' wheel over LEFT or RIGHT to scroll independently · q quits ',
  style: { fg: 'white', bg: '#222244' },
});

// Hide xterm cursors in display-only panes.
left.term?.write('\x1b[?25l');
right.term?.write('\x1b[?25l');

// Per-pane wheel handlers. blessed routes wheel events to whichever
// pane the cursor is over (using the lpos hit-test); each pane
// scrolls its own xterm.js scrollback via Terminal.scroll().
left.on('wheelup', () => {
  left.scroll(-3);
  screen.render();
});
left.on('wheeldown', () => {
  left.scroll(3);
  screen.render();
});
right.on('wheelup', () => {
  right.scroll(-3);
  screen.render();
});
right.on('wheeldown', () => {
  right.scroll(3);
  screen.render();
});

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

// Crash-safe cleanup so terminal modes don't leak into the parent shell.
process.on('SIGINT', () => {
  screen.destroy();
  process.exit(0);
});
process.on('SIGTERM', () => {
  screen.destroy();
  process.exit(0);
});
process.on('uncaughtException', e => {
  screen.destroy();
  console.error(e);
  process.exit(1);
});

// First render BEFORE any pane writes — see docs §4.2 (otherwise the
// resize-on-first-render can clobber pre-fill content).
screen.render();

// Pre-fill scrollback after first render settles.
const ipsum = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa.',
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

setTimeout(() => {
  for (let n = 1; n <= 250; n++) {
    writeLine(left, n);
    writeLine(right, n);
  }
  screen.render();
}, 50);

// Slow live tail — proves new content keeps streaming while the user
// scrolls back through history without snapping their viewport.
let n = 250;
setInterval(() => {
  n++;
  writeLine(left, n);
  writeLine(right, n);
  screen.render();
}, 500);
