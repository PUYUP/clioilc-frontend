<script>
  import { ApiError } from "$lib/api.js";
  import ColumnChart from "$lib/ColumnChart.svelte";
  import Login from "$lib/Login.svelte";
  import { compact, full, longLabel, timeZone, usd, usdCompact } from "$lib/format.js";
  import { session } from "$lib/session.svelte.js";
  import { METRICS, RANGES, loadSeries, totals } from "$lib/usage.js";

  /** @typedef {import("$lib/usage.js").Point} Point */

  let rangeKey = $state(/** @type {typeof RANGES[number]["key"]} */ ("7d"));
  /** @type {"hour" | "day"} */
  let unit = $state("day");
  let metric = $state(/** @type {typeof METRICS[number]["key"]} */ ("cost_usd"));
  let showTable = $state(false);

  let points = $state(/** @type {Point[] | null} */ (null));
  let loading = $state(false);
  let error = $state(/** @type {string | null} */ (null));

  const range = $derived(RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]);
  // Hourly is only offered up to 7 days (168 columns).
  const hourAllowed = $derived(("hours" in range ? range.hours : range.days * 24) <= 24 * 7);
  const metricDef = $derived(METRICS.find((m) => m.key === metric) ?? METRICS[0]);
  const metricLabel = $derived(metricDef.label);
  /** @param {typeof METRICS[number]} m @param {number} v */
  const fmt = (m, v) => (m.format === "usd" ? usd(v) : full(v));
  const sum = $derived(points ? totals(points) : null);
  const buckets = $derived((points ?? []).map((p) => ({ t: p.t, value: p[metric] })));

  /** @param {typeof RANGES[number]} r */
  function pickRange(r) {
    rangeKey = r.key;
    unit = r.unit;
  }

  $effect(() => {
    if (!session.user) return;
    const controller = new AbortController();
    const r = range;
    const u = unit === "hour" && !hourAllowed ? "day" : unit;
    loading = true;
    error = null;
    loadSeries(r, u, controller.signal)
      .then((p) => (points = p))
      .catch((e) => {
        if (e.name === "AbortError") return;
        error = e instanceof ApiError ? `Gagal memuat data (${e.status}).` : "Tidak bisa menghubungi API.";
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });
</script>

{#if !session.user}
  <Login />
{:else}
  <div class="filters" role="toolbar" aria-label="Filter">
    <div class="seg" role="group" aria-label="Rentang waktu">
      {#each RANGES as r (r.key)}
        <button aria-pressed={rangeKey === r.key} onclick={() => pickRange(r)}>{r.label}</button>
      {/each}
    </div>
    <div class="seg" role="group" aria-label="Satuan waktu">
      <button aria-pressed={unit === "hour"} disabled={!hourAllowed} onclick={() => (unit = "hour")}>Per jam</button>
      <button aria-pressed={unit === "day"} onclick={() => (unit = "day")}>Per hari</button>
    </div>
    <label class="select">
      <span class="sr">Metrik</span>
      <select bind:value={metric}>
        {#each METRICS as m (m.key)}<option value={m.key}>{m.label}</option>{/each}
      </select>
    </label>
    <span class="muted tz">Zona waktu: {timeZone}</span>
  </div>

  {#if error}
    <div class="card"><p class="error" role="alert">{error}</p></div>
  {:else if sum}
    <section class="tiles" class:stale={loading}>
      <div class="card tile"><div class="label">Biaya (setara API)</div><div class="value">{usd(sum.cost_usd)}</div>
        <div class="muted small">
          {#if sum.unpriced > 0}+ {full(sum.unpriced)} pesan tanpa harga{:else}harga API Claude, bukan tagihan{/if}
        </div></div>
      <div class="card tile"><div class="label">Pesan</div><div class="value">{compact(sum.messages)}</div>
        <div class="muted small">{full(sum.errors)} error</div></div>
      <div class="card tile"><div class="label">Token output</div><div class="value">{compact(sum.output_tokens)}</div></div>
      <div class="card tile"><div class="label">Token cache read</div><div class="value">{compact(sum.cache_read_tokens)}</div></div>
      <div class="card tile"><div class="label">Panggilan tool</div><div class="value">{compact(sum.tools)}</div>
        <div class="muted small">{full(sum.tool_errors)} error</div></div>
    </section>

    <section class="card">
      <div class="head">
        <div>
          <h2>{metricLabel}</h2>
          <p class="muted small">{unit === "hour" ? "Per jam" : "Per hari"}, {range.label} terakhir</p>
        </div>
        <button class="btn" aria-pressed={showTable} onclick={() => (showTable = !showTable)}>
          {showTable ? "Grafik" : "Tabel"}
        </button>
      </div>

      {#if sum.messages === 0 && !loading}
        <div class="empty">
          <p>Belum ada data di rentang ini.</p>
          <p class="muted small">Kirim data dari laptop dengan <code>clioilc login</code> lalu <code>clioilc sync</code>
            (atau <code>clioilc watch --sync</code>).</p>
        </div>
      {:else if showTable}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Waktu</th>{#each METRICS as m (m.key)}<th class="num">{m.label}</th>{/each}</tr></thead>
            <tbody>
              {#each [...(points ?? [])].reverse() as p (p.t.getTime())}
                <tr>
                  <td>{longLabel(p.t, unit)}</td>
                  {#each METRICS as m (m.key)}<td class="num">{fmt(m, p[m.key])}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <ColumnChart
          {buckets}
          {unit}
          label={metricLabel}
          stale={loading}
          formatValue={metricDef.format === "usd" ? usd : full}
          formatTick={metricDef.format === "usd" ? usdCompact : compact}
        />
      {/if}
    </section>
  {:else}
    <p class="muted">Memuat data…</p>
  {/if}
{/if}

<style>
  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
  .seg button { border: 0; background: none; padding: 6px 12px; color: var(--text-secondary); }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button:hover:not(:disabled) { background: var(--ghost); }
  .seg button[aria-pressed="true"] { color: var(--text-primary); font-weight: 600; background: var(--ghost); }
  .seg button:disabled { opacity: 0.4; cursor: default; }
  select {
    font: inherit;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
  }
  .tz { margin-left: auto; font-size: 12px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 12px; transition: opacity 120ms; }
  .tiles.stale { opacity: 0.5; }
  .tile { padding: 16px; }
  .label { color: var(--text-secondary); font-size: 13px; }
  .value { font-size: 26px; font-weight: 600; line-height: 1.25; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
  h2 { font-size: 16px; margin: 0; }
  .small { font-size: 12px; margin: 0; }
  .empty { padding: 48px 0; text-align: center; }
  .empty p { margin: 0 0 6px; }
  .table-wrap { overflow-x: auto; max-height: 420px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid var(--grid); text-align: left; white-space: nowrap; }
  th { position: sticky; top: 0; background: var(--surface); color: var(--text-secondary); font-weight: 500; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
