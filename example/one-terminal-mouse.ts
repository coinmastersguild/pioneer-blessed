#!/usr/bin/env bun
/**
 * one-terminal-mouse.ts — does mouse work on a SINGLE blessed.terminal?
 *
 * One full-screen terminal pane. Mouse events log to /tmp/one-term.log.
 * Wheel a few times, then q. cat /tmp/one-term.log to see what fired.
 */
import blessed from '../dist/blessed.mjs';
import * as fs from 'fs';

const LOG = '/tmp/one-term.log';
fs.writeFileSync(LOG, `--- session start ${new Date().toISOString()} ---\n`);
const dbg = (l: string) => fs.appendFileSync(LOG, l + '\n');

const screen = blessed.screen({ smartCSR: true, title: 'one-term' });
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

const pane = blessed.terminal({
  parent: screen,
  label: ' ONE PANE — wheel here ',
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
pane.term?.write('\x1b[?25l');

const status = blessed.box({
  parent: screen,
  bottom: 0,
  height: 1,
  width: '100%',
  content: ' wheel over the pane · q quit',
  style: { fg: 'white', bg: '#222244' },
});

// Log EVERY mouse event at screen level (regardless of pane dispatch)
screen.on('mouse', (data: any) => {
  if (data.action === 'mousemove') return; // too noisy
  dbg(`SCREEN ${data.action} @ (${data.x},${data.y})`);
});

// Per-pane wheel
pane.on('wheelup', () => {
  dbg('PANE wheelup');
  pane.scroll(-3);
  screen.render();
});
pane.on('wheeldown', () => {
  dbg('PANE wheeldown');
  pane.scroll(3);
  screen.render();
});

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

// Pre-fill — but wait until after first render+resize so content
// isn't wiped by xterm's resize-on-render.
const COLORS = [
  '\x1b[31m',
  '\x1b[32m',
  '\x1b[33m',
  '\x1b[34m',
  '\x1b[35m',
  '\x1b[36m',
];
function fillSome(start: number, count: number) {
  for (let n = start; n < start + count; n++) {
    pane.term?.write(
      `${COLORS[n % 6]}[${String(n).padStart(5, '0')}]\x1b[0m  Lorem ipsum dolor sit amet ${n}\r\n`
    );
  }
  screen.render();
}

screen.render(); // first render → xterm resizes
setTimeout(() => fillSome(1, 250), 50); // pre-fill after resize settles
let n = 250;
setInterval(() => {
  n++;
  fillSome(n, 1);
}, 400); // slow stream + periodic render
