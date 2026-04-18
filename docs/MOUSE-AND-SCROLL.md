# Mouse, Scrolling, and Terminal Widget — Quirks & Working Patterns

Hard-won notes from a long debugging session against pioneer-blessed in
real terminals (iTerm2 / macOS Terminal). Read this BEFORE wiring mouse
or scroll into a new app — most of the tests in `example/` exist
specifically to prove or disprove claims here.

---

## 0. TL;DR — the working incantation

```ts
import blessed from 'neo-neo-blessed';

const screen = blessed.screen({ smartCSR: true });

// Required in this order:
screen.enableMouse(); // sends ?1000h
screen.program.setMouse(
  {
    // extended modes
    normalMouse: true,
    vt200Mouse: true,
    buttonEventMouse: true,
    allMotion: true,
    sgrMouse: true,
    urxvtMouse: true,
  },
  true
);
```

That's it. Mouse motion, click, drag, AND wheel will arrive as proper
mouse events on every widget you bind `mouse: true` on, with x/y
coordinates. The fix that makes this just-work is committed inside
pioneer-blessed (see §1).

---

## 1. The bug that broke everything (now fixed)

**Symptom:** mouse events (especially wheel) silently absent from every
example, even though mouse modes were enabled.

**Cause:** `screen.enableMouse()` and `screen.program.setMouse()`
both send the terminal-mode escape codes that tell the terminal to
EMIT mouse events. Neither of them turns on the **parser** that reads
those bytes back off stdin and turns them into structured `mouse`
events.

The parser lives in `Program.prototype.bindMouse()` (program.ts:667).
It is only triggered automatically when something adds a `'mouse'`
listener directly to the program (program.ts:432). Adding listeners to
the screen does not chain through.

**Fix:** in `lib/widgets/screen.ts`, inside `_listenMouse()`, after
`program.enableMouse()` we now explicitly call `program.bindMouse()`.
Diff:

```diff
   this.program.enableMouse();
   if (this.options.sendFocus) {
     this.program.setMouse({ sendFocus: true }, true);
   }
+  this.program.bindMouse();
```

**Verifying the wiring** — add this at boot to your app and look at
the log:

```ts
const inp = screen.program.input as any;
const prg = screen.program as any;
console.log('_listenedMouse=', (screen as any)._listenedMouse);
console.log('_boundMouse=', prg._boundMouse);
console.log('mouseEnabled=', prg.mouseEnabled);
console.log('input.listenerCount(data)=', inp.listenerCount('data'));
```

After `screen.enableMouse()` the correct state is:

```
_listenedMouse = true
_boundMouse    = true        ← was undefined before the fix
mouseEnabled   = true
input.listenerCount('data') ≥ 2
```

---

## 2. The five mouse modes explained

xterm-style mouse tracking is layered. To get real wheel events
(instead of arrow-key translations) we have to opt into modes the
terminal initially has off:

| Option in `setMouse()` | DEC mode | What it adds                                      |
| ---------------------- | -------- | ------------------------------------------------- |
| `normalMouse`          | `?1000`  | Press / release reports                           |
| `vt200Mouse`           | `?1000`  | Same protocol, alternate name                     |
| `buttonEventMouse`     | `?1002`  | Press + drag (move while button held)             |
| `allMotion`            | `?1003`  | Any-motion tracking (no button needed)            |
| `sgrMouse`             | `?1006`  | Extended SGR coordinate format (no 223-col limit) |
| `urxvtMouse`           | `?1015`  | URXVT extended coords (alternative to SGR)        |
| `sendFocus`            | `?1004`  | Focus-in/out reports                              |

**You almost always want all six set to `true`**. `allMotion: true`
gives hover detection. `sgrMouse: true` gives accurate x/y past column 223. The others are protocol fallbacks.

**Trade-off:** with mouse capture on, the terminal hands ALL mouse
activity to your app — so the user can no longer drag-select text
natively in the window. To allow native selection, toggle mouse off
on demand with `screen.program.disableMouse()`.

---

## 3. Wheel-as-arrow-keys (the iTerm2 default)

Some terminals (iTerm2 has it enabled by default) translate the mouse
wheel into ↑ / ↓ keypresses when in alt-screen mode, **regardless of
which mouse modes you set**. With this enabled you'll see:

```
SCREEN key evt: up
SCREEN key evt: up
```

…instead of `wheelup` mouse events. blessed's `program.setMouse({ ... })`
does NOT override this terminal-side preference.

**With the full mode set (§0)** most terminals stop translating and
send actual mouse events. iTerm2 is the noisy exception — if a user
reports "no wheel events", the workaround is one of:

1. **Recommend** they disable the iTerm2 setting:
   _Settings → Profiles → Terminal → uncheck "Scroll wheel sends arrow
   keys when in alternate screen mode"_
2. Live with arrow-key translation: route up/down at the screen level
   to the focused scrollable pane. Loses per-pane-by-position routing
   (you can't tell which pane the wheel is over without mouse data).

Use `example/mouse-debug.ts` to see what your terminal actually sends.

---

## 4. The xterm.js terminal widget — gotchas

`blessed.terminal` wraps `@xterm/headless` and (optionally) `node-pty`.
Several quirks:

### 4.1 `noPty: true` mode (custom to pioneer-blessed)

Standard `blessed.terminal` always spawns a shell. We added a
`noPty: true` option (in `lib/widgets/terminal.ts`) that skips the
PTY spawn entirely — the widget becomes a display-only xterm.js buffer
you write to with `pane.term.write(ansiString)`. Use this for log
panes that show streaming content but don't need an interactive shell.

```ts
const log = blessed.terminal({
  parent: screen,
  noPty: true,
  scrollback: 10000,
  width: '50%',
  height: '100%-1',
  mouse: true,
});

log.term.write('hello\r\n'); // displays in pane
```

### 4.2 First-render resize wipes content

The widget defers resizing the xterm engine until the first render
(see `bootstrap()` in `terminal.ts`). If you write content BEFORE
first render, the resize can clobber it. Defer pre-fills:

```ts
screen.render(); // first render
setTimeout(() => fillContent(pane), 50); // then content
```

### 4.3 Bootstrap reads `this.width` before parent attach

Workaround already in pioneer-blessed: `bootstrap()` wraps the width
read in try/catch so terminals nested inside an unattached parent
(common pattern: build a parent box, then create children, then
`screen.append(parent)`) don't crash.

### 4.4 Cursor visibility

The terminal widget doesn't auto-hide its xterm cursor. For a log
pane:

```ts
pane.term.write('\x1b[?25l'); // hide cursor
```

### 4.5 Scrolling

`Terminal.scroll(offset)` calls `term.scrollLines(offset)` on xterm.js.
Wheel events are NOT auto-wired (terminal doesn't extend
ScrollableBox). Wire manually:

```ts
pane.on('wheelup', () => {
  pane.scroll(-3);
  screen.render();
});
pane.on('wheeldown', () => {
  pane.scroll(3);
  screen.render();
});
```

xterm.js does NOT auto-snap the viewport to the bottom on writes in
noPty mode (the auto-scroll lives in the PTY-data branch). Once the
user scrolls up, new writes append silently into scrollback below the
visible area. That's usually the desired behaviour.

### 4.6 The terminal widget breaks selection in the host terminal

With mouse modes on, the OS terminal can no longer drag-select text
in your TUI window. If the user wants to copy something, two options:

- **Toggle mouse off** with a keybind. `screen.program.disableMouse()`
  re-enables native selection; `screen.program.enableMouse()` restores
  in-app routing.
- **In-app drag-to-select** that reads from the xterm buffer and pipes
  to `pbcopy`. See `example/dual-scroll-clipboard.ts` for the pattern
  using `buffer.getLine(r).translateToString(true, c0, c1)`.

---

## 5. Layout pitfalls (multiple terminal widgets)

### 5.1 `width: '50%'` + `left: '50%'` for adjacent panes

The boundary math (Math.floor) plus border drawing makes the two panes
fight for the seam column. Symptoms: blinking border, broken
hit-testing on the second pane.

**Use `right: 0` or `dockBorders: true` + 1-col overlap:**

```ts
// Option A — let blessed compute right pane from edge
const left  = blessed.terminal({ ..., left: 0,    width: '50%' });
const right = blessed.terminal({ ..., right: 0,   width: '50%' });

// Option B — match multiplex example with dockBorders
const screen = blessed.screen({ ..., dockBorders: true });
const left  = blessed.terminal({ ..., left: 0,        width: '50%' });
const right = blessed.terminal({ ..., left: '50%-1',  width: '50%+1' });
```

### 5.2 Hit-testing requires `lpos`

blessed dispatches mouse events by iterating `screen.clickable`
(highest-index first) and matching `data.x/y` against `el.lpos`.
`lpos` is set after the FIRST render. If you bind a wheel handler
and immediately wheel before any render has happened, the dispatch
loop sees `lpos=null` and skips the widget.

**Always call `screen.render()` once at the end of setup.**

### 5.3 Per-pane wheel handler vs global

If your terminal supports real mouse events (per §3), bind handlers
PER PANE — blessed routes by position automatically:

```ts
left.on('wheelup', () => left.scroll(-3));
right.on('wheelup', () => right.scroll(-3));
```

If your terminal sends wheel-as-arrows, you can't route by position.
Default to scrolling the focused pane:

```ts
screen.on('keypress', (_ch, key) => {
  if (key?.name === 'up' || key?.name === 'down') {
    const tgt =
      screen.focused === scrollablePane ? screen.focused : defaultPane;
    tgt.scroll(key.name === 'up' ? -3 : 3);
    screen.render();
  }
});
```

---

## 6. Event-loop & cleanup quirks

### 6.1 setInterval keeps the loop alive

In a non-TTY context (CI, agent shells), the event loop will exit if
nothing is pending. blessed's stdin listener should hold it open, but
if you see your example flash and immediately exit (EXIT=0 in <1s),
add a heartbeat:

```ts
setInterval(() => {}, 30_000);
```

### 6.2 stdin needs a 'data' listener to flow

Node readable streams in paused mode don't actually flow even after
`stream.resume()` if no `'data'` listener is attached. blessed's
internal listener (set up in `program.listen()`, called in the
program ctor) provides this — but only if `program.listen()` ran.

The fix in §1 ensures `bindMouse()` runs which in turn ensures the
program 'data' → 'mouse' parsing chain is wired.

### 6.3 Crashes leak mouse modes into the parent shell

If your app exits without calling `screen.destroy()` (e.g. via
SIGKILL), the terminal stays in alt-screen + mouse-tracking mode and
your shell becomes weird. Recovery:

```bash
reset
# or just the mouse modes:
printf '\e[?1000l\e[?1002l\e[?1003l\e[?1006l\e[?1015l'
```

For your apps, register an exit handler:

```ts
process.on('exit', () => screen.destroy());
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
```

---

## 7. Diagnostic recipes

These examples in `example/` are kept for future debugging:

| File                       | What it isolates                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `mouse-debug.ts`           | Logs every byte/event from the mouse subsystem. Use to discover what your terminal actually sends. |
| `mouse-A-box.ts`           | Control: mouse on a `blessed.box`. Should always work after the §1 fix.                            |
| `mouse-B-terminal.ts`      | Same setup but `blessed.terminal`. Tells you if the bug is widget-specific.                        |
| `one-terminal-mouse.ts`    | One terminal pane, full screen, wheel + click logging.                                             |
| `two-scroll.ts`            | Two side-by-side terminal panes, per-pane wheel scroll.                                            |
| `scroll-test-single.ts`    | Single pane with manual k/j scroll, useful for proving `scroll()` works in isolation.              |
| `dual-scroll-clipboard.ts` | Two panes + drag-to-select + clipboard via `pbcopy`.                                               |
| `hello-buttons.ts`         | Three buttons with click + Tab/Enter activation, hover styling.                                    |

If a new app misbehaves, run the closest example first to isolate
whether the bug is in your code or in the underlying widget.

---

## 8. What changed inside pioneer-blessed

Three patches to support the patterns above. All are documented
inline in source comments.

| File                                     | Change                                                                                                                   | Why                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `lib/widgets/screen.ts` (`_listenMouse`) | Added `this.program.bindMouse()`                                                                                         | §1 — wakes the parser when `enableMouse()` is called |
| `lib/widgets/terminal.ts` (`bootstrap`)  | `noPty: true` skips spawning a PTY; `try/catch` around `this.width` for unattached parents; honours `options.scrollback` | §4.1, §4.3 — display-only terminal panes             |
| `lib/types/widgets.d.ts`                 | Added `noPty?: boolean` and `scrollback?: number` to `TerminalOptions`                                                   | Type support for the above                           |

These changes are committed in this fork; rebuild with `bun run build`
after editing.

---

## 9. Distribution — pioneer-blessed must be published

`pioneer-blessed` (npm name `neo-neo-blessed`) is currently consumed
via `workspace:*` from the local workspace. Apps that take it as a
git submodule (e.g. `projects/pioneer-cli`) cannot use that link
when checked out elsewhere.

**Workflow**: iterate locally with `workspace:*`, but before merging
any cross-repo feature that depends on these patches, publish a new
version of `neo-neo-blessed` and pin the dependent app to that exact
version.
