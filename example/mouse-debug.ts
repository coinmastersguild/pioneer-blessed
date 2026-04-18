#!/usr/bin/env bun
/**
 * mouse-debug.ts — log EVERYTHING about mouse activity in your terminal.
 *
 * Subscribes at three levels and forces every mouse-tracking mode on.
 *   1. Raw stdin bytes  (`program.input.on('data')`)         → /tmp/mouse-raw.log
 *   2. blessed program  (`program.on('mouse', ...)`)         → /tmp/mouse-debug.log
 *   3. blessed screen   (`screen.on('mouse', ...)`)          → /tmp/mouse-debug.log + on-screen
 *
 * Also enables every known mouse mode (X10, VT200, button-event,
 * all-motion, SGR, URXVT, sendFocus) so we capture whatever your
 * terminal is willing to emit.
 *
 * Run:
 *   bun example/mouse-debug.ts
 *   # then move/click/wheel inside the window
 *   # press q to quit
 *   cat /tmp/mouse-debug.log     # parsed events
 *   xxd  /tmp/mouse-raw.log      # raw bytes (or `cat -v`)
 */

import blessed from '../dist/blessed.mjs';
import * as fs from 'fs';

const RAW = '/tmp/mouse-raw.log';
const DBG = '/tmp/mouse-debug.log';
fs.writeFileSync(RAW, '');
fs.writeFileSync(DBG, `--- session start ${new Date().toISOString()} ---\n`);
const dbg = (l: string) => fs.appendFileSync(DBG, l + '\n');

const screen = blessed.screen({
  smartCSR: true,
  title: 'mouse-debug',
  fullUnicode: false,
});

// Enable EVERY mouse-tracking mode pioneer-blessed knows about.
screen.enableMouse();
screen.program.setMouse(
  {
    normalMouse: true, // ?1000  basic click report
    vt200Mouse: true, // ?1000  alias
    buttonEventMouse: true, // ?1002  click + drag
    allMotion: true, // ?1003  any-motion tracking
    sgrMouse: true, // ?1006  extended SGR coords
    urxvtMouse: true, // ?1015  extended URXVT coords
    sendFocus: true, // ?1004  focus-in/out reports
  },
  true
);

// ── On-screen live readout ──────────────────────────────
const display = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%-3',
  border: 'line',
  tags: true,
  label:
    ' MOUSE DIAGNOSTIC — move / click / wheel anywhere, then check /tmp/mouse-debug.log ',
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true } },
});

const status = blessed.box({
  parent: screen,
  bottom: 0,
  height: 3,
  width: '100%',
  border: 'line',
  tags: true,
  content: ' booting…',
  style: { fg: 'white', bg: '#222244', border: { fg: 'gray' } },
});

const counters = {
  rawBytes: 0,
  programEvts: 0,
  screenEvts: 0,
  byAction: {} as Record<string, number>,
};
function refresh(extra = '') {
  status.setContent(
    ` raw bytes: ${counters.rawBytes}   program evts: ${counters.programEvts}   screen evts: ${counters.screenEvts}` +
      `\n actions: ${
        Object.entries(counters.byAction)
          .map(([a, n]) => `${a}=${n}`)
          .join('  ') || '(none yet)'
      }` +
      `${extra ? '\n ' + extra : ''}`
  );
  screen.render();
}

// ── 1. RAW stdin bytes ───────────────────────────────────
// This is the most unfiltered view — exactly what the terminal sent.
if (screen.program.input && typeof screen.program.input.on === 'function') {
  screen.program.input.on('data', (data: Buffer) => {
    counters.rawBytes += data.length;
    // Write raw bytes (lossy display below — use `xxd /tmp/mouse-raw.log`)
    fs.appendFileSync(RAW, data);
    // Also log a printable form
    const printable = data
      .toString('binary')
      .replace(/\x1b/g, '\\e')
      .replace(
        /[\x00-\x1f\x7f]/g,
        c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
      );
    dbg(`RAW(${data.length}): ${printable}`);
  });
}

// ── 2. Program-level mouse parsed by blessed ─────────────
screen.program.on('mouse', (data: any) => {
  counters.programEvts++;
  counters.byAction[data.action] = (counters.byAction[data.action] || 0) + 1;
  dbg(
    `PROGRAM mouse: action=${data.action}  x=${data.x}  y=${data.y}  button=${data.button ?? '-'}  shift=${data.shift ?? '-'}  ctrl=${data.ctrl ?? '-'}  meta=${data.meta ?? '-'}`
  );
  refresh(`last: ${data.action} @ (${data.x},${data.y})`);
});

// ── 3. Screen-level mouse (after blessed dispatch logic) ─
screen.on('mouse', (data: any) => {
  counters.screenEvts++;
  // Already logged via program — only note differences here
  dbg(`SCREEN  mouse: action=${data.action}  x=${data.x}  y=${data.y}`);
});

// Also catch keypresses — to see if your terminal sends arrow keys
// instead of wheel events
screen.on('keypress', (ch: string, key: any) => {
  if (!key) return;
  if (
    ['up', 'down', 'left', 'right', 'pageup', 'pagedown'].includes(key.name)
  ) {
    counters.byAction[`KEY:${key.name}`] =
      (counters.byAction[`KEY:${key.name}`] || 0) + 1;
    dbg(
      `KEY: ${key.name}  ch=${JSON.stringify(ch)}  shift=${key.shift}  ctrl=${key.ctrl}  meta=${key.meta}`
    );
    refresh(`last key: ${key.name}`);
  }
});

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

screen.render();
refresh();

setInterval(() => {}, 30_000); // keep alive
