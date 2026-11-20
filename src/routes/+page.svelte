<script>
  import { goto } from "$app/navigation";
  import { ApiError } from "$lib/api.js";
  import CalendarHeatmap from "$lib/CalendarHeatmap.svelte";
  import ColumnChart from "$lib/ColumnChart.svelte";
  import Login from "$lib/Login.svelte";
  import { compact, count, full, isoDate, longLabel, timeZone, usd, usdCompact } from "$lib/format.js";
  import { loadProjectNames, projectLabeler } from "$lib/activity.js";
  import RankedBars from "$lib/RankedBars.svelte";
  import { current, scope } from "$lib/scope.svelte.js";
  import { session } from "$lib/session.svelte.js";
  import { vault } from "$lib/vault.svelte.js";
  import { METRICS, RANGES, loadBreakdown, loadCalendar, loadSeries, totals } from "$lib/usage.js";

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

  // Where the selected metric goes, per project and per model, over the
  // same window as the chart.
  let byProject = $state(/** @type {Awaited<ReturnType<typeof loadBreakdown>> | null} */ (null));
  let byModel = $state(/** @type {Awaited<ReturnType<typeof loadBreakdown>> | null} */ (null));
  let byMember = $state(/** @type {Awaited<ReturnType<typeof loadBreakdown>> | null} */ (null));
  let names = $state(/** @type {Map<string, string>} */ (new Map()));
  let namesLocked = $state(false);
  let breakdownLoading = $state(false);

  $effect(() => {
    if (!session.user) return;
    const controller = new AbortController();
    const r = range;
    const u = unit === "hour" && !hourAllowed ? "day" : unit;
    breakdownLoading = true;
    const team = !!scope.workspace;
    Promise.all([
      loadBreakdown("project", r, u, controller.signal),
      loadBreakdown("model", r, u, controller.signal),
      team ? loadBreakdown("member", r, u, controller.signal) : Promise.resolve(null),
    ])
      .then(([p, m, mb]) => {
        byProject = p;
        byModel = m;
        byMember = mb;
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) breakdownLoading = false;
      });
    return () => controller.abort();
  });

  $effect(() => {
    if (!session.user) return;
    const controller = new AbortController();
    loadProjectNames(vault.dataKey, controller.signal)
      .then((res) => {
        names = res.names;
        namesLocked = res.locked;
      })
      .catch(() => {});
    return () => controller.abort();
  });

  const labelProject = $derived(projectLabeler(names.values()));
  const projectRows = $derived(
    (byProject ?? []).map((r) => {
      const name = names.get(r.key);
      return {
        key: r.key,
        label: name ? labelProject(name) : `project ${r.key.slice(0, 8)}`,
        title: name ?? r.key,
        value: r[metric],
      };
    }),
  );
  const modelRows = $derived((byModel ?? []).map((r) => ({ key: r.key, label: r.key, value: r[metric] })));
  const memberRows = $derived((byMember ?? []).map((r) => ({ key: r.key, label: `@${r.key}`, value: r[metric] })));
  const team = $derived(current());
  const metricFormat = $derived(metricDef.format === "usd" ? usd : full);
  const sum = $derived(points ? totals(points) : null);
  const buckets = $derived((points ?? []).map((p) => ({ t: p.t, value: p[metric] })));

  let calendar = $state(/** @type {import("$lib/usage.js").Day[] | null} */ (null));
  let calendarError = $state(false);
  $effect(() => {
    if (!session.user) return;
    const controller = new AbortController();
    loadCalendar(controller.signal)
      .then((d) => (calendar = d))
      .catch((e) => {
        if (e.name !== "AbortError") calendarError = true;
      });
    return () => controller.abort();
  });

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
        error = e instanceof ApiError ? `Failed to load data (${e.status}).` : "Cannot reach the API.";
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
  {#if team}
    <p class="team-banner">
      Team usage of <a href={`/workspaces/${team.slug}`}><strong>{team.name}</strong></a>: folders members linked with
      <code>clioilc link</code>. Switch to Personal in the header for your own data.
    </p>
  {/if}
  <section class="card cal">
    <div class="head">
      <div>
        <h2>Tool calls: succeeded &amp; failed</h2>
        <p class="muted small">Per day, last 12 months. Click a day to see its activity.</p>
      </div>
    </div>
    {#if calendar}
      <CalendarHeatmap
        days={calendar}
        onselect={(d, series) => goto(`/activity?date=${isoDate(d.t)}${series === "err" ? "&status=error" : ""}`)}
      />
    {:else if calendarError}
      <p class="error">Failed to load the calendar.</p>
    {:else}
      <p class="muted small">Loading…</p>
    {/if}
  </section>

  <div class="filters" role="toolbar" aria-label="Filter">
    <div class="seg" role="group" aria-label="Time range">
      {#each RANGES as r (r.key)}
        <button aria-pressed={rangeKey === r.key} onclick={() => pickRange(r)}>{r.label}</button>
      {/each}
    </div>
    <div class="seg" role="group" aria-label="Time unit">
      <button aria-pressed={unit === "hour"} disabled={!hourAllowed} onclick={() => (unit = "hour")}>Hourly</button>
      <button aria-pressed={unit === "day"} onclick={() => (unit = "day")}>Daily</button>
    </div>
    <label class="select">
      <span class="sr">Metric</span>
      <select bind:value={metric}>
        {#each METRICS as m (m.key)}<option value={m.key}>{m.label}</option>{/each}
      </select>
    </label>
    <span class="muted tz">Time zone: {timeZone}</span>
  </div>

  {#if error}
    <div class="card"><p class="error" role="alert">{error}</p></div>
  {:else if sum}
    <section class="tiles" class:stale={loading}>
      <div class="card tile"><div class="label">Cost (API equivalent)</div><div class="value">{usd(sum.cost_usd)}</div>
        <div class="muted small">
          {#if sum.unpriced > 0}+ {count(sum.unpriced, "message")} without a price{:else}Claude API prices, not your bill{/if}
        </div></div>
      <div class="card tile"><div class="label">Messages</div><div class="value">{compact(sum.messages)}</div>
        <div class="muted small">{count(sum.errors, "error")}</div></div>
      <div class="card tile"><div class="label">Output tokens</div><div class="value">{compact(sum.output_tokens)}</div></div>
      <div class="card tile"><div class="label">Cache read tokens</div><div class="value">{compact(sum.cache_read_tokens)}</div></div>
      <div class="card tile"><div class="label">Tool calls</div><div class="value">{compact(sum.tools)}</div>
        <div class="muted small">{count(sum.tool_errors, "error")}</div></div>
    </section>

    <section class="card">
      <div class="head">
        <div>
          <h2>{metricLabel}</h2>
          <p class="muted small">{unit === "hour" ? "Hourly" : "Daily"}, last {range.label}</p>
        </div>
        <button class="btn" aria-pressed={showTable} onclick={() => (showTable = !showTable)}>
          {showTable ? "Chart" : "Table"}
        </button>
      </div>

      {#if sum.messages === 0 && !loading}
        <div class="empty">
          <p>No data in this range yet.</p>
          <p class="muted small">Send data from your laptop with <code>clioilc login</code>, then <code>clioilc sync</code>
            (or <code>clioilc watch --sync</code>).</p>
        </div>
      {:else if showTable}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th>{#each METRICS as m (m.key)}<th class="num">{m.label}</th>{/each}<th class="num">Tool calls succeeded</th><th class="num">Errors (tool + message)</th></tr></thead>
            <tbody>
              {#each [...(points ?? [])].reverse() as p (p.t.getTime())}
                <tr>
                  <td>{longLabel(p.t, unit)}</td>
                  {#each METRICS as m (m.key)}<td class="num">{fmt(m, p[m.key])}</td>{/each}
                  <td class="num">{full(p.tool_ok)}</td>
                  <td class="num">{full(p.tool_errors + p.errors)}</td>
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
          onselect={(b) => goto(`/activity?date=${isoDate(b.t)}`)}
        />
      {/if}
    </section>

    <section class="split">
      <div class="card">
        <h2>{metricLabel} by project</h2>
        <p class="muted small sub">Last {range.label}</p>
        {#if byProject}
          <RankedBars rows={projectRows} format={metricFormat} stale={breakdownLoading} />
          {#if namesLocked}
            <p class="muted small note">Project names are end-to-end encrypted. Unlock them on the <a href="/activity">Activity</a> page.</p>
          {/if}
        {:else}
          <p class="muted small">Loading…</p>
        {/if}
      </div>
      {#if team}
        <div class="card">
          <h2>{metricLabel} by member</h2>
          <p class="muted small sub">Last {range.label}</p>
          {#if byMember}
            <RankedBars rows={memberRows} format={metricFormat} stale={breakdownLoading} />
          {:else}
            <p class="muted small">Loading…</p>
          {/if}
        </div>
      {/if}
      <div class="card">
        <h2>{metricLabel} by model</h2>
        <p class="muted small sub">Last {range.label}</p>
        {#if byModel}
          <RankedBars rows={modelRows} format={metricFormat} stale={breakdownLoading} />
        {:else}
          <p class="muted small">Loading…</p>
        {/if}
      </div>
    </section>
  {:else}
    <p class="muted">Loading data…</p>
  {/if}
{/if}

<style>
  .cal { margin-bottom: 16px; }
  .split { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
  .split > .card { min-width: 0; }
  .team-banner { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; background: var(--series-1-wash); color: var(--text-secondary); font-size: 13px; }
  .split h2 { margin-bottom: 2px; }
  .sub { margin-bottom: 14px !important; }
  .note { margin-top: 12px !important; }
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
