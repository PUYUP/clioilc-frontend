<script>
  // Ranked horizontal bars for one measure (one series: no legend, the
  // card title names it). Top rows, the rest folded into "Other". Values
  // and shares are printed, so nothing depends on hovering.
  import { full } from "./format.js";

  /** @typedef {{ key: string, label: string, title?: string, value: number }} Row */
  /** @type {{ rows: Row[], format: (n: number) => string, top?: number, stale?: boolean, empty?: string }} */
  let { rows, format, top = 8, stale = false, empty = "No data in this range." } = $props();

  const sorted = $derived([...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value));
  const shown = $derived.by(() => {
    if (sorted.length <= top + 1) return sorted;
    const rest = sorted.slice(top);
    return [
      ...sorted.slice(0, top),
      { key: "__other", label: `Other (${full(rest.length)})`, value: rest.reduce((a, r) => a + r.value, 0) },
    ];
  });
  const total = $derived(sorted.reduce((a, r) => a + r.value, 0));
  const max = $derived(Math.max(0, ...shown.map((r) => r.value)));
  const pct = (/** @type {number} */ v) => (total > 0 ? (v / total) * 100 : 0);
</script>

{#if shown.length === 0}
  <p class="muted small">{empty}</p>
{:else}
  <ol class="bars" class:stale>
    {#each shown as r (r.key)}
      <li class:other={r.key === "__other"}>
        <div class="line">
          <span class="label" title={r.title ?? r.label}>{r.label}</span>
          <span class="value">{format(r.value)} <span class="share">{pct(r.value) < 1 ? "<1" : Math.round(pct(r.value))}%</span></span>
        </div>
        <div class="track" aria-hidden="true">
          <div class="fill" style:width={`${max > 0 ? Math.max(0.5, (r.value / max) * 100) : 0}%`}></div>
        </div>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; transition: opacity 120ms; }
  /* Grid items default to min-width: auto; let long labels ellipsize instead. */
  .bars > li { min-width: 0; }
  .bars.stale { opacity: 0.5; }
  .line { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; margin-bottom: 4px; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
  .other .label { color: var(--text-secondary); }
  .value { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--text-primary); }
  .share { color: var(--text-muted); font-size: 12px; margin-left: 4px; }
  .track { height: 10px; }
  /* 4px rounded data end, square at the baseline (left). */
  .fill { height: 100%; background: var(--series-1); border-radius: 0 4px 4px 0; min-width: 2px; }
  .other .fill { background: var(--text-muted); }
  .small { font-size: 13px; margin: 0; }
</style>
