<script>
  // GitHub-style calendar: one column per week (Monday first), one row per
  // weekday, two stacked grids (successes, errors). Each grid is its own
  // one-hue ordinal ramp: 0 = empty, then 4 quartile steps of that grid's
  // non-zero days. Hover, arrow keys (← → week, ↑ ↓ day) and click.
  import { count, full, longLabel } from "./format.js";

  /** @typedef {import("./usage.js").Day} Day */
  /** @type {{ days: Day[], onselect?: (d: Day, series: "ok" | "err") => void, stale?: boolean }} */
  let { days, onselect, stale = false } = $props();

  const GAP = 2;
  const LEFT = 30;
  const TOP = 16;
  const DOW = ["Mon", "", "Wed", "", "Fri", "", ""];

  let width = $state(800);
  /** @type {number | null} */
  let active = $state(null);
  /** @type {0 | 1} */
  let activeRow = $state(0);

  // days[0] is a Monday; index -> (week, weekday).
  const weeks = $derived(Math.ceil(days.length / 7));
  const cell = $derived(Math.max(8, Math.min(14, Math.floor((width - LEFT) / weeks) - GAP)));
  const step = $derived(cell + GAP);
  const gridH = $derived(TOP + 7 * step);
  const svgW = $derived(LEFT + weeks * step);

  const SERIES = /** @type {const} */ ([
    { key: "ok", label: "Succeeded", ramp: "a", value: (/** @type {Day} */ d) => d.ok },
    { key: "err", label: "Failed", ramp: "b", value: (/** @type {Day} */ d) => d.toolErrors + d.msgErrors },
  ]);

  /** Quartile cut points of the non-zero values. @param {number[]} values */
  function cuts(values) {
    const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
    if (!nz.length) return [1, 1, 1];
    const q = (/** @type {number} */ p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))];
    return [q(0.25), q(0.5), q(0.75)];
  }
  /** @param {number} v @param {number[]} c */
  const level = (v, c) => (v <= 0 ? 0 : v <= c[0] ? 1 : v <= c[1] ? 2 : v <= c[2] ? 3 : 4);

  const stats = $derived(
    SERIES.map((s) => {
      const values = days.map(s.value);
      const c = cuts(values);
      const max = Math.max(0, ...values);
      // Legend ranges per level, without empty or duplicate steps.
      const bounds = [0, ...c, max];
      /** @type {{ level: number, text: string }[]} */
      const legend = [];
      for (let i = 1; i <= 4; i++) {
        const lo = bounds[i - 1] + 1;
        const hi = bounds[i];
        if (hi >= lo && max > 0) legend.push({ level: i, text: lo === hi ? `${lo}` : i === 4 ? `${lo}+` : `${lo}–${hi}` });
      }
      return { ...s, c, total: values.reduce((a, b) => a + b, 0), legend };
    }),
  );

  const months = $derived.by(() => {
    /** @type {{ x: number, text: string }[]} */
    const out = [];
    let last = -1;
    for (let w = 0; w < weeks; w++) {
      const d = days[w * 7];
      if (d && d.t.getMonth() !== last) {
        last = d.t.getMonth();
        if (w < weeks - 2) out.push({ x: LEFT + w * step, text: d.t.toLocaleDateString("en-US", { month: "short" }) });
      }
    }
    // Drop a first label that would collide with the next one.
    if (out.length > 1 && out[1].x - out[0].x < 28) out.shift();
    return out;
  });

  /** @param {PointerEvent} e @param {0 | 1} row */
  function onMove(e, row) {
    const el = /** @type {SVGSVGElement} */ (e.currentTarget);
    const r = el.getBoundingClientRect();
    const w = Math.floor((e.clientX - r.left - LEFT) / step);
    const d = Math.floor((e.clientY - r.top - TOP) / step);
    const i = w * 7 + d;
    if (w >= 0 && d >= 0 && d < 7 && i < days.length) {
      active = i;
      activeRow = row;
    } else active = null;
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (!days.length) return;
    if (e.key === "Enter" && active !== null && onselect) return onselect(days[active], activeRow ? "err" : "ok");
    const moves = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
    const m = moves[/** @type {keyof typeof moves} */ (e.key)];
    if (m === undefined) return;
    e.preventDefault();
    const from = active ?? days.length - 1;
    active = Math.max(0, Math.min(days.length - 1, from + m));
  }

  const tip = $derived(active === null ? null : days[active]);

  // On narrow screens the grids scroll; start at the latest week and keep
  // both grids aligned.
  /** @type {HTMLDivElement[]} */
  let scrollers = $state([]);
  $effect(() => {
    void days.length;
    void width;
    for (const el of scrollers) if (el) el.scrollLeft = el.scrollWidth;
  });
  /** @param {Event} e */
  function syncScroll(e) {
    const src = /** @type {HTMLDivElement} */ (e.currentTarget);
    for (const el of scrollers) if (el && el !== src && el.scrollLeft !== src.scrollLeft) el.scrollLeft = src.scrollLeft;
  }

  /** @type {HTMLDivElement | undefined} */
  let root = $state();
  let tipPos = $state({ x: 0, y: 0 });
  // Place the tooltip above the active cell, measured from the DOM.
  $effect(() => {
    if (active === null || !root) return;
    const cellEl = root.querySelector(`rect[data-i="${active}"][data-row="${activeRow}"]`);
    if (!cellEl) return;
    const c = cellEl.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    tipPos = { x: c.left - r.left + c.width / 2, y: c.top - r.top };
  });
  const describe = (/** @type {Day} */ d) =>
    `${longLabel(d.t, "day")}: ${full(d.ok)} succeeded, ${count(d.toolErrors + d.msgErrors, "error")}`;
</script>

<div class="heat" class:stale bind:clientWidth={width} bind:this={root}>
  <div
    class="focus"
    role="slider"
    aria-roledescription="calendar"
    aria-label="Successful and failed tool calls per day. Use arrows to move between days, Enter to open the activity."
    aria-valuemin={0}
    aria-valuemax={Math.max(0, days.length - 1)}
    aria-valuenow={active ?? days.length - 1}
    aria-valuetext={tip ? describe(tip) : "No day selected"}
    tabindex="0"
    onkeydown={onKey}
    onblur={() => (active = null)}
    onpointerleave={() => (active = null)}
    onclick={() => onselect && tip && onselect(tip, activeRow ? "err" : "ok")}
    class:clickable={!!onselect}
  >
    {#each stats as s, row (s.key)}
      <div class="block">
        <div class="title">
          <span><strong>{s.label}</strong> <span class="muted">{full(s.total)} in {weeks} weeks</span></span>
          {#if s.legend.length}
            <span class="legend muted" aria-hidden="true">
              Less
              {#each s.legend as l (l.level)}
                <span class="lg"><span class="sw" style:background={`var(--heat-${s.ramp}${l.level})`}></span>{l.text}</span>
              {/each}
              More
            </span>
          {/if}
        </div>
        <div class="scroll" bind:this={scrollers[row]} onscroll={syncScroll}>
          <svg width={svgW} height={gridH} aria-hidden="true" onpointermove={(e) => onMove(e, /** @type {0|1} */ (row))}>
            {#each months as m (m.x)}
              <text class="lbl" x={m.x} y="10">{m.text}</text>
            {/each}
            {#each DOW as d, i (i)}
              {#if d}<text class="lbl" x="0" y={TOP + i * step + cell - 2}>{d}</text>{/if}
            {/each}
            {#each days as d, i (d.t.getTime())}
              {@const lv = level(s.value(d), s.c)}
              <rect
                x={LEFT + Math.floor(i / 7) * step}
                y={TOP + (i % 7) * step}
                width={cell}
                height={cell}
                rx="2"
                fill={lv ? `var(--heat-${s.ramp}${lv})` : "var(--heat-empty)"}
                class:on={active === i}
                data-i={i}
                data-row={row}
              />
            {/each}
          </svg>
        </div>
      </div>
    {/each}
  </div>

  {#if tip}
    <div class="tooltip" role="status" style:left={`${Math.min(width - 120, Math.max(120, tipPos.x))}px`} style:top={`${tipPos.y}px`}>
      <div class="muted small">{longLabel(tip.t, "day")}</div>
      <div class="row"><span class="key a"></span><strong>{full(tip.ok)}</strong> <span class="muted">{tip.ok === 1 ? "tool call" : "tool calls"} succeeded</span></div>
      <div class="row">
        <span class="key b"></span><strong>{full(tip.toolErrors + tip.msgErrors)}</strong>
        <span class="muted">{tip.toolErrors + tip.msgErrors === 1 ? "error" : "errors"} ({full(tip.toolErrors)} tool, {count(tip.msgErrors, "message")})</span>
      </div>
      {#if onselect}<div class="muted small">{activeRow ? "Click to see the errors" : "Click to see the activity"}</div>{/if}
    </div>
  {/if}
</div>

<style>
  .heat { position: relative; transition: opacity 120ms; }
  .heat.stale { opacity: 0.5; }
  .focus { outline: none; border-radius: 6px; }
  .focus:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
  .clickable { cursor: pointer; }
  .block + .block { margin-top: 12px; }
  .title { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; font-size: 13px; margin-bottom: 4px; }
  .legend { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; flex-wrap: wrap; }
  .lg { display: inline-flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; }
  .sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .scroll { overflow-x: auto; }
  svg { display: block; }
  .lbl { fill: var(--text-muted); font-size: 10px; }
  rect.on { stroke: var(--text-primary); stroke-width: 1.5; }
  .tooltip {
    position: absolute;
    transform: translate(-50%, calc(-100% - 6px));
    pointer-events: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    white-space: nowrap;
    z-index: 2;
    font-size: 13px;
  }
  .row { display: flex; align-items: center; gap: 6px; }
  .key { width: 12px; height: 2px; border-radius: 1px; }
  .key.a { background: var(--heat-a3); }
  .key.b { background: var(--heat-b2); }
  .small { font-size: 12px; }
</style>
