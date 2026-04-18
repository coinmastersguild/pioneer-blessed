#!/usr/bin/env bun
/**
 * dual-scroll-clipboard.ts — two independent scroll panes + clipboard.
 *
 * Two terminal panes (TOP / BOTTOM), each with its own xterm.js scrollback.
 * Mouse wheel over a pane scrolls THAT pane only. Drag inside a pane
 * highlights a rectangular text selection. Releasing the mouse copies
 * the selected text to the system clipboard (macOS pbcopy). Two button
 * rows let you copy the entire visible window of either pane.
 *
 * Run:
 *   bun example/dual-scroll-clipboard.ts
 *
 * Controls:
 *   wheel over a pane    → scroll that pane
 *   click + drag in pane → select rectangle of text
 *   release mouse        → copy selection to clipboard
 *   click [Copy TOP]     → copy TOP pane viewport
 *   click [Copy BOTTOM]  → copy BOTTOM pane viewport
 *   Tab                  → switch which pane is keyboard-focused
 *   q / Ctrl-C           → quit
 */

import blessed from '../dist/blessed.mjs';
import { spawnSync } from 'child_process';
import * as fs from 'fs';

const LOG = '/tmp/dual-scroll.log';
fs.writeFileSync(LOG, `--- session start ${new Date().toISOString()} ---\n`);
const dbg = (l: string) => fs.appendFileSync(LOG, l + '\n');

const screen = blessed.screen({
  smartCSR: true,
  title: 'dual-scroll-clipboard',
  fullUnicode: false,
});

// Full mouse-mode set so wheel arrives as proper mouse events with x/y
// (mouse-debug.ts confirmed this is required in this terminal).
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

// ── Layout: two stacked terminal panes + button row + status ──
function makePane(label: string, top: string | number, color: string) {
  return blessed.terminal({
    parent: screen,
    label: ` ${label} `,
    border: 'line',
    top,
    left: 0,
    width: '100%',
    height: '45%-1',
    noPty: true,
    scrollback: 10000,
    mouse: true,
    cursorBlink: false,
    style: { border: { fg: color }, label: { fg: color, bold: true } },
  } as any);
}

const top = makePane('TOP    — wheel to scroll, drag to select', 0, 'cyan');
const bottom = makePane(
  'BOTTOM — wheel to scroll, drag to select',
  '45%-1',
  'magenta'
);

// Hide xterm cursors in display panes
top.term?.write('\x1b[?25l');
bottom.term?.write('\x1b[?25l');

// Buttons row (3 rows tall)
const btnRow = blessed.box({
  parent: screen,
  top: '90%-1',
  left: 0,
  width: '100%',
  height: 3,
  style: { bg: 'black' },
});

function makeBtn(label: string, leftPct: string, color: string) {
  const b: any = blessed.button({
    parent: btnRow,
    content: label,
    top: 0,
    left: leftPct,
    width: 22,
    height: 3,
    align: 'center',
    valign: 'middle',
    border: 'line',
    tags: true,
    mouse: true,
    keys: true,
    shrink: false,
    style: {
      bg: color,
      fg: 'black',
      bold: true,
      border: { fg: 'white' },
      hover: { bg: 'yellow', fg: 'black' },
      focus: { border: { fg: 'yellow' } },
    },
  });
  return b;
}

const btnCopyTop = makeBtn('{bold}Copy TOP{/bold}', '5%', 'cyan');
const btnCopyBot = makeBtn('{bold}Copy BOTTOM{/bold}', '30%', 'magenta');
const btnClear = makeBtn('{bold}Clear selection{/bold}', '55%', 'gray');
const btnQuit = makeBtn('{bold}Quit (q){/bold}', '80%', 'red');

const status = blessed.box({
  parent: screen,
  bottom: 0,
  height: 1,
  width: '100%',
  tags: true,
  content: ' booting…',
  style: { fg: 'white', bg: '#222244' },
});

// ── Clipboard helper ────────────────────────────────────
function copyToClipboard(text: string): boolean {
  // macOS first, then Linux fallbacks
  const candidates = [
    ['pbcopy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['wl-copy', []],
  ] as const;
  for (const [cmd, args] of candidates) {
    try {
      const r = spawnSync(cmd, args, { input: text });
      if (r.status === 0) return true;
    } catch (_) {
      /* try next */
    }
  }
  return false;
}

// ── Per-pane wheel scroll (no hover routing — use raw x/y) ──
let last = { evt: '-', copied: 0 };
function setStatus(extra = '') {
  status.setContent(
    ` ${extra || last.evt}   ·   ${last.copied} chars copied   ·   wheel/drag in pane · click button · q quit `
  );
  screen.render();
}

for (const p of [top, bottom]) {
  p.on('wheelup', () => {
    p.scroll(-3);
    last.evt = `wheel↑ on ${p === top ? 'TOP' : 'BOTTOM'}`;
    setStatus();
  });
  p.on('wheeldown', () => {
    p.scroll(3);
    last.evt = `wheel↓ on ${p === top ? 'TOP' : 'BOTTOM'}`;
    setStatus();
  });
}

// ── Drag-to-select inside a pane ────────────────────────
// xterm.js stores all rendered cells; we read them from buffer.active.
// Selection is a rectangular region in pane-local coordinates.
type Sel = {
  pane: any;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  active: boolean;
};
const sel: Sel = { pane: null, x0: 0, y0: 0, x1: 0, y1: 0, active: false };

function paneAt(x: number, y: number): any | null {
  for (const p of [top, bottom]) {
    const pos = p.lpos;
    if (!pos) continue;
    if (x >= pos.xi && x < pos.xl && y >= pos.yi && y < pos.yl) return p;
  }
  return null;
}

// Convert screen coords → pane-local cell coords inside the xterm buffer.
function toBufferCoord(
  p: any,
  x: number,
  y: number
): { col: number; row: number } {
  const pos = p.lpos;
  const col = Math.max(0, x - pos.xi - p.ileft);
  const localRow = Math.max(0, y - pos.yi - p.itop);
  const buf = p.term.buffer.active;
  const viewportY = buf.viewportY ?? 0;
  return { col, row: localRow + viewportY };
}

function extractRect(
  p: any,
  c0: number,
  r0: number,
  c1: number,
  r1: number
): string {
  const minR = Math.min(r0, r1),
    maxR = Math.max(r0, r1);
  const minC = Math.min(c0, c1),
    maxC = Math.max(c0, c1);
  const buf = p.term.buffer.active;
  const out: string[] = [];
  for (let r = minR; r <= maxR; r++) {
    const line = buf.getLine(r);
    if (!line) continue;
    const text = line.translateToString(true, minC, maxC + 1);
    out.push(text);
  }
  return out.join('\n');
}

screen.on('mouse', (data: any) => {
  if (data.action === 'mousedown' && data.button === 'left') {
    const p = paneAt(data.x, data.y);
    if (p) {
      const { col, row } = toBufferCoord(p, data.x, data.y);
      sel.pane = p;
      sel.x0 = col;
      sel.y0 = row;
      sel.x1 = col;
      sel.y1 = row;
      sel.active = true;
      last.evt = `select start on ${p === top ? 'TOP' : 'BOTTOM'} @ buf(${col},${row})`;
      setStatus();
    }
  } else if (data.action === 'mousemove' && sel.active && sel.pane) {
    // Update endpoint while dragging
    const { col, row } = toBufferCoord(sel.pane, data.x, data.y);
    sel.x1 = col;
    sel.y1 = row;
  } else if (data.action === 'mouseup' && sel.active && sel.pane) {
    const { col, row } = toBufferCoord(sel.pane, data.x, data.y);
    sel.x1 = col;
    sel.y1 = row;
    const text = extractRect(sel.pane, sel.x0, sel.y0, sel.x1, sel.y1);
    sel.active = false;
    if (text.trim().length > 0) {
      const ok = copyToClipboard(text);
      last.copied = text.length;
      last.evt = ok
        ? `✓ copied ${text.length} chars to clipboard`
        : `✗ clipboard failed (no pbcopy/xclip/wl-copy)`;
      dbg(`COPIED (${ok}): ${JSON.stringify(text)}`);
      setStatus();
    }
  }
});

// ── Button handlers — copy entire viewport of a pane ────
function copyPaneViewport(p: any, paneLabel: string) {
  const buf = p.term.buffer.active;
  const rows = (p.height as number) - p.iheight;
  const viewportY = buf.viewportY ?? 0;
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const line = buf.getLine(viewportY + i);
    if (!line) continue;
    out.push(line.translateToString(true));
  }
  const text = out.join('\n');
  const ok = copyToClipboard(text);
  last.copied = text.length;
  last.evt = ok
    ? `✓ copied ${paneLabel} viewport (${text.length} chars)`
    : `✗ clipboard failed`;
  dbg(`COPY-VIEWPORT ${paneLabel} (${ok}): ${text.length} chars`);
  setStatus();
}

btnCopyTop.on('press', () => copyPaneViewport(top, 'TOP'));
btnCopyBot.on('press', () => copyPaneViewport(bottom, 'BOTTOM'));
btnClear.on('press', () => {
  sel.active = false;
  sel.pane = null;
  last.evt = 'selection cleared';
  setStatus();
});
btnQuit.on('press', () => {
  screen.destroy();
  process.exit(0);
});

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});
screen.key(['tab'], () => {
  if (screen.focused === btnCopyTop) btnCopyBot.focus();
  else if (screen.focused === btnCopyBot) btnClear.focus();
  else if (screen.focused === btnClear) btnQuit.focus();
  else btnCopyTop.focus();
  screen.render();
});

// ── Pre-fill panes with streaming ipsum ────────────────
const ipsum = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis.',
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
  writeLine(top, n);
  writeLine(bottom, n);
}

const timer = setInterval(() => {
  n++;
  writeLine(top, n);
  writeLine(bottom, n);
  screen.render();
}, 500);
process.on('SIGINT', () => {
  clearInterval(timer);
  screen.destroy();
  process.exit(0);
});

btnCopyTop.focus();
screen.render();
setStatus();
