<script>
  // Single-series column chart over time. One series, so no legend: the
  // card title names the metric. Hover / arrow keys show a tooltip; the
  // same values are in the table view.
  import { compact, full, hourLabel, dayLabel, longLabel } from "./format.js";

  /** @typedef {(n: number) => string} Formatter */

  /** @typedef {{ t: Date, value: number }} Bucket */
  /** @type {{ buckets: Bucket[], unit: "hour" | "day", label: string, stale?: boolean, formatValue?: Formatter, formatTick?: Formatter, onselect?: (b: Bucket) => void }} */
  let { buckets, unit, label, stale = false, formatValue = full, formatTick = compact, onselect } = $props();

  const HEIGHT = 260;
  const M = { top: 12, right: 8, bottom: 28, left: 52 };
  const BAR_MAX = 24;

  let width = $state(640);
  /** @type {number | null} */
  let active = $state(null);

  const innerW = $derived(Math.max(0, width - M.left - M.right));
  const innerH = HEIGHT - M.top - M.bottom;
  const max = $derived(Math.max(0, ...buckets.map((b) => b.value)));
  const ticks = $derived(niceTicks(max));
  const top = $derived(ticks[ticks.length - 1] || 1);
  const band = $derived(buckets.length ? innerW / buckets.length : 0);
  const barW = $derived(Math.max(1, Math.min(BAR_MAX, band * 0.7 - 2)));
  const y = (/** @type {number} */ v) => innerH - (v / top) * innerH;

  // Show only as many x labels as fit (~64px each). Hours snap to round
  // clock steps (every 1, 2, 3, 6, 12 or 24 h) so labels land on 00.00, 06.00, …
  const maxLabels = $derived(Math.max(1, Math.floor(innerW / 64)));
  const hourStep = $derived([1, 2, 3, 4, 6, 12, 24].find((s) => buckets.length / s <= maxLabels) ?? 24);
  const dayStep = $derived(Math.max(1, Math.ceil(buckets.length / maxLabels)));
  /** @param {Bucket} b @param {number} i */
  const showLabel = (b, i) => (unit === "hour" ? b.t.getHours() % hourStep === 0 : i % dayStep === 0);

  /** @param {number} m */
  function niceTicks(m) {
    if (m <= 0) return [0, 1];
    const raw = m / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw;
    const out = [];
    for (let v = 0; v < m + step; v += step) out.push(v);
    return out;
  }

  /** Column with a 4px rounded top and a square base. @param {number} x @param {number} h */
  function columnPath(x, h) {
    const r = Math.min(4, h, barW / 2);
    const b = innerH;
    const t = b - h;
    return `M${x},${b}V${t + r}Q${x},${t} ${x + r},${t}H${x + barW - r}Q${x + barW},${t} ${x + barW},${t + r}V${b}Z`;
  }

  /** @param {Date} d */
  const tickText = (d) => (unit === "hour" ? (d.getHours() === 0 ? dayLabel(d) : hourLabel(d)) : dayLabel(d));

  /** @param {PointerEvent} e */
  function onMove(e) {
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    const x = e.clientX - el.getBoundingClientRect().left - M.left;
    const i = Math.floor(x / band);
    active = i >= 0 && i < buckets.length ? i : null;
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (!buckets.length) return;
    const last = buckets.length - 1;
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    const step = moves[/** @type {keyof typeof moves} */ (e.key)];
    if (step === undefined) return;
    e.preventDefault();
    const from = active ?? (step > 0 ? -1 : last + 1);
    active = Math.max(0, Math.min(last, from + step));
  }

  const tip = $derived(active === null ? null : buckets[active]);
  // Keep the tooltip inside the chart near the edges.
  const tipLeft = $derived(
    active === null ? 0 : Math.min(width - 90, Math.max(90, M.left + band * (active + 0.5))),
  );
</script>

<div class="chart" class:stale bind:clientWidth={width}>
  <div
    class="plot"
    role="slider"
    aria-roledescription="column chart"
    aria-label={`${label}, ${unit === "hour" ? "per hour" : "per day"}. Use left/right arrows to read values.`}
    aria-valuemin={0}
    aria-valuemax={Math.max(0, buckets.length - 1)}
    aria-valuenow={active ?? 0}
    aria-valuetext={tip ? `${longLabel(tip.t, unit)}: ${formatValue(tip.value)}` : "No column selected"}
    tabindex="0"
    onpointermove={onMove}
    onpointerleave={() => (active = null)}
    onkeydown={(e) => {
      if (e.key === "Enter" && onselect && active !== null) onselect(buckets[active]);
      else onKey(e);
    }}
    onclick={() => onselect && active !== null && onselect(buckets[active])}
    class:clickable={!!onselect}
    onblur={() => (active = null)}
  >
  <svg {width} height={HEIGHT} aria-hidden="true">
    <g transform={`translate(${M.left},${M.top})`}>
      {#each ticks as t (t)}
        <line class="grid" x1="0" x2={innerW} y1={y(t)} y2={y(t)} />
        <text class="tick" x="-8" y={y(t)} dy="0.32em" text-anchor="end">{formatTick(t)}</text>
      {/each}

      {#if active !== null}
        <rect class="hover" x={band * active} y="0" width={band} height={innerH} />
      {/if}

      {#each buckets as b, i (b.t.getTime())}
        {#if b.value > 0}
          <path
            class="bar"
            class:dim={active !== null && active !== i}
            d={columnPath(band * i + (band - barW) / 2, Math.max(1, innerH - y(b.value)))}
          />
        {/if}
        {#if showLabel(b, i)}
          <text class="tick" x={band * (i + 0.5)} y={innerH + 18} text-anchor="middle">{tickText(b.t)}</text>
        {/if}
      {/each}

      <line class="axis" x1="0" x2={innerW} y1={innerH} y2={innerH} />
    </g>
  </svg>
  </div>

  {#if tip}
    <div class="tooltip" style:left={`${tipLeft}px`} role="status">
      <div class="row"><span class="key"></span><strong>{formatValue(tip.value)}</strong></div>
      <div class="muted small">{label}</div>
      <div class="muted small">{longLabel(tip.t, unit)}</div>
      {#if onselect}<div class="muted small">Click to see the activity</div>{/if}
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
    transition: opacity 120ms;
  }
  .chart.stale { opacity: 0.5; }
  svg { display: block; overflow: visible; touch-action: pan-y; }
  .clickable { cursor: pointer; }
  .plot:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
  .grid { stroke: var(--grid); stroke-width: 1; shape-rendering: crispEdges; }
  .axis { stroke: var(--axis); stroke-width: 1; shape-rendering: crispEdges; }
  .tick {
    fill: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .bar { fill: var(--series-1); transition: opacity 80ms; }
  .bar.dim { opacity: 0.55; }
  .hover { fill: var(--ghost); }
  .tooltip {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    pointer-events: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    white-space: nowrap;
    z-index: 2;
  }
  .row { display: flex; align-items: center; gap: 8px; font-size: 15px; }
  .key { width: 12px; height: 2px; background: var(--series-1); border-radius: 1px; }
  .small { font-size: 12px; }
</style>
