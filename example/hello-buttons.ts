#!/usr/bin/env bun
/**
 * hello-buttons.ts — minimal button playground.
 *
 * Three buttons under a "Hello World" label. Each button updates the
 * label when activated. Both paths are wired:
 *   - mouse click  → 'click' event
 *   - keyboard     → Tab to focus, Enter/Space to press
 *
 * Logs every relevant event to /tmp/buttons-debug.log so we can see
 * what your terminal actually sends (clicks? mouseover? nothing?).
 *
 * Run:
 *   bun example/hello-buttons.ts
 */

import blessed from '../dist/blessed.mjs';
import * as fs from 'fs';

const LOG = '/tmp/buttons-debug.log';
fs.writeFileSync(LOG, `--- session start ${new Date().toISOString()} ---\n`);
const dbg = (l: string) => fs.appendFileSync(LOG, l + '\n');

const screen = blessed.screen({
  smartCSR: true,
  title: 'hello-buttons',
  fullUnicode: false,
  mouse: true,
});
screen.enableMouse(); // pioneer-blessed: explicit, options.mouse not honored

// Greeting text — updated when buttons fire
const label = blessed.box({
  parent: screen,
  top: 2,
  left: 'center',
  width: '80%',
  height: 5,
  border: 'line',
  tags: true,
  align: 'center',
  valign: 'middle',
  content:
    '{bold}Hello, world!{/bold}\n{yellow-fg}{bold}Press TAB to switch · ENTER to select{/bold}{/yellow-fg}',
  style: { border: { fg: 'cyan' }, fg: 'white' },
});

// Helper to make a button with hover styling and click/press logging
function makeBtn(opts: {
  name: string;
  text: string;
  left: string | number;
  bg: string;
}) {
  const btn: any = blessed.button({
    parent: screen,
    name: opts.name,
    content: `  ${opts.text}  `,
    top: 11,
    left: opts.left,
    width: 18,
    height: 5, // taller — more presence
    align: 'center',
    valign: 'middle',
    border: 'line',
    mouse: true,
    keys: true,
    shrink: false,
    style: {
      bg: opts.bg,
      fg: 'black',
      border: { fg: 'gray' }, // dim border by default
      hover: { bg: 'yellow', fg: 'black' },
      focus: { border: { fg: 'yellow' }, bold: true },
    },
  } as any);
  btn._baseBg = opts.bg;
  btn._baseLabel = opts.text;

  btn.on('click', () => {
    dbg(`CLICK ${opts.name}`);
    label.setContent(
      `{bold}{green-fg}✓ clicked: ${opts.name}{/green-fg}{/bold}\n(via mouse click)`
    );
    screen.render();
  });
  btn.on('press', () => {
    dbg(`PRESS ${opts.name} (keyboard or click)`);
  });
  btn.on('mouseover', () => {
    dbg(`HOVER-IN  ${opts.name}`);
  });
  btn.on('mouseout', () => {
    dbg(`HOVER-OUT ${opts.name}`);
  });
  btn.key(['enter', 'space'], () => {
    dbg(`KEY ${opts.name}`);
    label.setContent(
      `{bold}{cyan-fg}✓ pressed: ${opts.name}{/cyan-fg}{/bold}\n(via keyboard)`
    );
    screen.render();
  });
  return btn;
}

const btnA = makeBtn({ name: 'ALPHA', text: 'Alpha', left: '15%', bg: 'blue' });
const btnB = makeBtn({
  name: 'BRAVO',
  text: 'Bravo',
  left: '40%',
  bg: 'green',
});
const btnC = makeBtn({
  name: 'CHARLIE',
  text: 'Charlie',
  left: '65%',
  bg: 'magenta',
});
const buttons = [btnA, btnB, btnC];

// ── Loud focus indicator: floating arrow + pulsing border ──────────
const arrow = blessed.box({
  parent: screen,
  top: 9,
  left: 0,
  width: 18,
  height: 1,
  tags: true,
  style: { fg: 'yellow', bold: true },
  content: '',
});

// Pulse cycles — bright yellow → white → bright yellow → bright cyan
const PULSE_BORDERS = ['yellow', 'white', 'brightyellow', 'cyan'];
const PULSE_ARROWS = [
  '   {bold}{yellow-fg}▼ ▼ ▼ ▼ ▼{/yellow-fg}{/bold}   ',
  '   {bold}{white-fg}▼ ▼ ▼ ▼ ▼{/white-fg}{/bold}   ',
  '   {bold}{yellow-fg}▼▼▼▼▼▼▼▼▼{/yellow-fg}{/bold}   ',
  '   {bold}{white-fg}▼▼▼▼▼▼▼▼▼{/white-fg}{/bold}   ',
];
let pulseFrame = 0;

function paint() {
  const focused =
    screen.focused && buttons.includes(screen.focused as any)
      ? (screen.focused as any)
      : btnA;

  // Reset every button to dim
  for (const b of buttons) {
    b.style.border.fg = 'gray';
    b.style.bold = false;
    b.setContent(`  ${b._baseLabel}  `);
  }

  // Highlight focused: pulsing border + bold label with brackets
  focused.style.border.fg = PULSE_BORDERS[pulseFrame % PULSE_BORDERS.length];
  focused.style.bold = true;
  focused.setContent(`{bold}» ${focused._baseLabel} «{/bold}`);

  // Floating arrow ABOVE the focused button — same horizontal pos
  const left = focused.aleft as number;
  const w = focused.width as number;
  arrow.left = left + Math.max(0, ((w - 18) / 2) | 0);
  arrow.setContent(PULSE_ARROWS[pulseFrame % PULSE_ARROWS.length]);

  pulseFrame++;
  screen.render();
}

setInterval(paint, 220);

// Status / instructions
const status = blessed.box({
  parent: screen,
  bottom: 0,
  height: 3,
  width: '100%',
  border: 'line',
  tags: true,
  content:
    ' {bold}{yellow-fg}TAB{/yellow-fg}{/bold} = switch button   ·   {bold}{yellow-fg}ENTER{/yellow-fg}{/bold} or {bold}{yellow-fg}SPACE{/yellow-fg}{/bold} = press the highlighted button   ·   {bold}q{/bold} = quit\n' +
    ' {gray-fg}(Mouse click also works if your terminal forwards it. Events log to /tmp/buttons-debug.log){/gray-fg}',
  style: { fg: 'white', bg: '#222244', border: { fg: 'gray' } },
});

// Tab cycles focus through the buttons
let focusIdx = 0;
screen.key(['tab'], () => {
  focusIdx = (focusIdx + 1) % buttons.length;
  buttons[focusIdx].focus();
  dbg(`TAB → focus ${(buttons[focusIdx] as any).name}`);
  paint();
});

// Screen-level mouse logger (so we see what the terminal sends, period)
screen.on('mouse', (data: any) => {
  if (data.action !== 'mousemove') {
    // mousemove is too noisy
    dbg(`SCREEN mouse: ${data.action} @ (${data.x},${data.y})`);
  }
});

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

btnA.focus();
screen.render();

// Heartbeat keeps the event loop alive when run from non-TTY contexts.
// (Not strictly needed when run interactively from a real terminal.)
setInterval(() => {}, 30_000);
