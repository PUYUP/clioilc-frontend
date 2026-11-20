<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ApiError } from "$lib/api.js";
  import { LockedError, groupBySession, loadActivity, shortProject } from "$lib/activity.js";
  import { isoDate, timeZone, usd } from "$lib/format.js";
  import Login from "$lib/Login.svelte";
  import { session } from "$lib/session.svelte.js";
  import { unlockVault, vault } from "$lib/vault.svelte.js";

  /** @typedef {import("$lib/activity.js").Item} Item */

  const today = isoDate(new Date());
  const date = $derived(page.url.searchParams.get("date") ?? today);

  let data = $state(/** @type {Awaited<ReturnType<typeof loadActivity>> | null} */ (null));
  let loading = $state(false);
  let locked = $state(false);
  let error = $state(/** @type {string | null} */ (null));

  let project = $state("");
  let showThinking = $state(false);
  let query = $state("");
  let passphrase = $state("");
  /** @type {Set<string>} */
  let expanded = $state(new Set());

  $effect(() => {
    if (!session.user) return;
    const controller = new AbortController();
    const key = vault.dataKey;
    loading = true;
    error = null;
    loadActivity(date, key, controller.signal)
      .then((d) => {
        data = d;
        locked = false;
        expanded = new Set();
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        if (e instanceof LockedError) locked = true;
        else error = e instanceof ApiError ? `Failed to load activity (${e.status}).` : "Cannot reach the API.";
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });

  // Type and status filters live in the URL (?type=prompt,tool&status=error),
  // so links such as the calendar's error cells can open a filtered view.
  const TYPES = /** @type {const} */ ([
    { key: "prompt", label: "You" },
    { key: "agent", label: "Agent" },
    { key: "tool", label: "Tool" },
  ]);
  const STATUSES = /** @type {const} */ ([
    { key: "all", label: "All" },
    { key: "ok", label: "Succeeded" },
    { key: "error", label: "Error" },
  ]);
  /** @typedef {typeof TYPES[number]["key"]} TypeKey */

  const types = $derived.by(() => {
    const raw = page.url.searchParams.get("type");
    const picked = (raw ?? "").split(",").filter((t) => TYPES.some((x) => x.key === t));
    return new Set(/** @type {TypeKey[]} */ (picked.length ? picked : TYPES.map((t) => t.key)));
  });
  const status = $derived(
    /** @type {"all" | "ok" | "error"} */ (
      ["ok", "error"].includes(page.url.searchParams.get("status") ?? "") ? page.url.searchParams.get("status") : "all"
    ),
  );

  /** @param {Item} i @returns {TypeKey | null} */
  const typeOf = (i) =>
    i.kind === "prompt" ? "prompt" : i.kind === "text" || i.kind === "thinking" ? "agent" : i.kind === "tool" ? "tool" : null;

  /** @param {Record<string, string | null>} changes */
  function setParams(changes) {
    const url = new URL(page.url);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    goto(url.search || "?", { keepFocus: true, noScroll: true, replaceState: true });
  }

  /** @param {TypeKey} key */
  function toggleType(key) {
    const next = new Set(types);
    if (next.has(key)) {
      if (next.size === 1) return; // keep at least one type
      next.delete(key);
    } else next.add(key);
    setParams({ type: next.size === TYPES.length ? null : [...next].join(",") });
  }

  const visible = $derived.by(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.items.filter((i) => {
      const t = typeOf(i);
      if (t ? !types.has(t) : types.size !== TYPES.length) return false;
      if (status !== "all" && i.status !== status) return false;
      return (
        (showThinking || i.kind !== "thinking") &&
        (!project || i.projectId === project) &&
        (!q || i.text.toLowerCase().includes(q) || (i.tool?.name.toLowerCase().includes(q) ?? false))
      );
    });
  });
  const groups = $derived(data ? groupBySession(visible, data.messages) : []);
  const projectOptions = $derived(
    data
      ? [...new Set(data.items.map((i) => i.projectId).filter((p) => p !== null))].map((id) => ({
          id: /** @type {string} */ (id),
          name: shortProject(data?.projects.get(/** @type {string} */ (id))),
        }))
      : [],
  );
  // Counts per button. Thinking only counts when shown; each filter group
  // counts within the other group's current selection.
  const counts = $derived.by(() => {
    /** @type {Record<string, number>} */
    const c = { prompt: 0, agent: 0, tool: 0, all: 0, ok: 0, error: 0 };
    for (const i of data?.items ?? []) {
      if (i.kind === "thinking" && !showThinking) continue;
      const t = typeOf(i);
      if (t && (status === "all" || i.status === status)) c[t]++;
      if (!t || types.has(t)) {
        c.all++;
        if (i.status) c[i.status]++;
      }
    }
    return c;
  });

  /** @param {number} days */
  function shift(days) {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(y, m - 1, d + days);
    setDate(isoDate(next));
  }
  /** @param {string} value */
  function setDate(value) {
    if (!value) return;
    const url = new URL(page.url);
    url.searchParams.set("date", value);
    goto(url.search, { keepFocus: true, noScroll: true });
  }

  const time = (/** @type {Date} */ d) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
  const dayTitle = $derived(
    new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(`${date}T12:00:00`),
    ),
  );
  const LABEL = { prompt: "You", text: "Agent", thinking: "Thinking", tool: "Tool", unreadable: "Locked" };
  const LONG = 360;

  /** @param {string} id */
  function toggle(id) {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    expanded = next;
  }
</script>

{#if !session.user}
  <Login next={page.url.pathname + page.url.search} />
{:else}
  <div class="head">
    <div>
      <h1>Activity</h1>
      <p class="muted small">{dayTitle} · {timeZone}</p>
    </div>
    <div class="nav">
      <button class="btn" onclick={() => shift(-1)} aria-label="Previous day">←</button>
      <input type="date" value={date} max={today} onchange={(e) => setDate(e.currentTarget.value)} aria-label="Date" />
      <button class="btn" onclick={() => shift(1)} disabled={date >= today} aria-label="Next day">→</button>
      {#if date !== today}<button class="btn" onclick={() => setDate(today)}>Today</button>{/if}
    </div>
  </div>

  {#if locked}
    <div class="card unlock">
      <h2>Private data is end-to-end encrypted</h2>
      <p class="muted">Enter the passphrase you chose during <code>clioilc login</code>. The key stays in this tab only.</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          unlockVault(passphrase).then(() => (passphrase = ""));
        }}
      >
        <input type="password" bind:value={passphrase} autocomplete="current-password" placeholder="Passphrase" aria-label="Passphrase" />
        <button class="btn primary" disabled={vault.busy || !passphrase}>{vault.busy ? "Unlocking…" : "Unlock"}</button>
      </form>
      {#if vault.error}<p class="error" role="alert">{vault.error}</p>{/if}
    </div>
  {:else if error}
    <div class="card"><p class="error" role="alert">{error}</p></div>
  {:else if data}
    <div class="filters">
      <select bind:value={project} aria-label="Project">
        <option value="">All projects</option>
        {#each projectOptions as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <input type="search" bind:value={query} placeholder="Search text or tool…" aria-label="Search" />
      <label class="check"><input type="checkbox" bind:checked={showThinking} /> Show thinking</label>
    </div>
    <div class="filters">
      <div class="seg" role="group" aria-label="Type">
        {#each TYPES as t (t.key)}
          <button aria-pressed={types.has(t.key)} onclick={() => toggleType(t.key)}>
            {t.label} <span class="n">{counts[t.key]}</span>
          </button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Status">
        {#each STATUSES as st (st.key)}
          <button
            aria-pressed={status === st.key}
            onclick={() => setParams({ status: st.key === "all" ? null : st.key })}
            class:errbtn={st.key === "error"}
          >
            {#if st.key === "ok"}<span aria-hidden="true" class="ic ok">✓</span>{:else if st.key === "error"}<span aria-hidden="true" class="ic err">✕</span>{/if}
            {st.label} <span class="n">{counts[st.key]}</span>
          </button>
        {/each}
      </div>
      {#if status !== "all"}
        <span class="muted small">Prompts have no status, so they are hidden.</span>
      {/if}
    </div>

    <div class:stale={loading}>
      {#if groups.length === 0}
        <div class="card empty">
          {#if data.items.length === 0}
            <p>No activity recorded on this day.</p>
          {:else}
            <p>Nothing matches the filters.</p>
          {/if}
        </div>
      {/if}

      {#each groups as g (g.key)}
        <section class="card group">
          <header>
            <strong title={data.projects.get(g.projectId ?? "") ?? ""}>
              {g.projectId === null ? "Continued from another day" : shortProject(data.projects.get(g.projectId))}
            </strong>
            <span class="muted small">
              {[`session ${g.sessionId?.slice(0, 8) ?? "–"}`, `${g.items.length} ${g.items.length === 1 ? "entry" : "entries"}`, g.costUsd > 0 ? usd(g.costUsd) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </header>
          <ol>
            {#each g.items as item (item.id)}
              <li class="item {item.kind}">
                <time datetime={item.ts.toISOString()}>{time(item.ts)}</time>
                <span class="tag">{LABEL[item.kind]}{#if item.isSubagent}<span class="sub">subagent</span>{/if}</span>
                <div class="body">
                  {#if item.kind === "tool" && item.tool}
                    <div class="toolline">
                      <code class="toolname">{item.tool.name}</code>
                      {#if item.tool.status === "ok"}
                        <span class="status ok"><span aria-hidden="true">✓</span> ok</span>
                      {:else if item.tool.status === "error"}
                        <span class="status err"><span aria-hidden="true">✕</span> error</span>
                      {:else}
                        <span class="status pending"><span aria-hidden="true">…</span> pending</span>
                      {/if}
                    </div>
                    {#if item.text}
                      {@const longCmd = item.text.length > 240}
                      <code class="summary-text" class:clamped3={longCmd && !expanded.has(item.id)}>{item.text}</code>
                      {#if longCmd}
                        <button class="more" onclick={() => toggle(item.id)}>{expanded.has(item.id) ? "Show less" : "Show more"}</button>
                      {/if}
                    {/if}
                    {#if item.tool.error}<pre class="errtext">{item.tool.error}</pre>{/if}
                  {:else if item.kind === "unreadable"}
                    <span class="muted">This entry cannot be opened (corrupt, or the key does not match).</span>
                  {:else}
                    {@const long = item.text.length > LONG}
                    <p class="text" class:clamped={long && !expanded.has(item.id)}>{item.text}</p>
                    {#if long}
                      <button class="more" onclick={() => toggle(item.id)}>
                        {expanded.has(item.id) ? "Show less" : "Show more"}
                      </button>
                    {/if}
                    {#if item.status === "error"}
                      <div class="status err"><span aria-hidden="true">✕</span> message failed: {item.errorKind}</div>
                    {/if}
                    {#if item.kind === "text" && item.model}
                      <div class="meta muted">{[item.model, item.costUsd != null ? usd(item.costUsd) : null].filter(Boolean).join(" · ")}</div>
                    {/if}
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
        </section>
      {/each}
    </div>
  {:else}
    <p class="muted">Loading activity…</p>
  {/if}
{/if}

<style>
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  .small { font-size: 12px; margin: 0; }
  .nav { display: flex; gap: 6px; align-items: center; }
  input[type="date"], input[type="search"], input[type="password"], select {
    font: inherit;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
    min-width: 0;
  }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .filters input[type="search"] { flex: 1 1 200px; }
  .filters select { max-width: 100%; }
  .check { display: inline-flex; gap: 6px; align-items: center; font-size: 14px; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
  .seg button { border: 0; background: none; padding: 6px 12px; color: var(--text-secondary); display: inline-flex; gap: 6px; align-items: center; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button:hover { background: var(--ghost); }
  .seg button[aria-pressed="true"] { color: var(--text-primary); font-weight: 600; background: var(--ghost); }
  .n { font-size: 12px; font-weight: 400; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .ic { font-size: 12px; }
  .ic.ok { color: var(--good); }
  .ic.err { color: var(--critical); }
  .stale { opacity: 0.5; transition: opacity 120ms; }
  .unlock form { display: flex; gap: 8px; margin-top: 12px; }
  .unlock input { flex: 1; }
  .empty { text-align: center; padding: 40px 20px; }
  .group { padding: 0; margin-bottom: 12px; overflow: hidden; }
  .group header {
    display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline;
    padding: 12px 16px; border-bottom: 1px solid var(--grid);
  }
  .group header strong { overflow-wrap: anywhere; }
  ol { list-style: none; margin: 0; padding: 4px 0; }
  .item {
    display: grid;
    grid-template-columns: 68px 84px minmax(0, 1fr);
    gap: 10px;
    padding: 8px 16px;
    align-items: start;
  }
  .item + .item { border-top: 1px solid var(--grid); }
  time { color: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; padding-top: 2px; }
  .tag { font-size: 12px; color: var(--text-secondary); padding-top: 2px; display: flex; flex-direction: column; }
  .prompt .tag { color: var(--text-primary); font-weight: 600; }
  .sub { font-size: 11px; color: var(--text-muted); }
  .prompt { background: var(--ghost); }
  .thinking .text { color: var(--text-secondary); font-style: italic; }
  .text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
  .clamped { display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .more { border: 0; background: none; padding: 2px 0; color: var(--accent); font-size: 13px; }
  .meta { font-size: 12px; margin-top: 2px; }
  .toolline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .toolname { font-weight: 600; }
  .summary-text { display: block; font-size: 12.5px; color: var(--text-secondary); overflow-wrap: anywhere; margin-top: 2px; }
  /* After .summary-text, so the clamp's display wins. */
  .summary-text.clamped3 { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .status { font-size: 12px; display: inline-flex; gap: 4px; align-items: center; color: var(--text-secondary); }
  .status.ok span { color: var(--good); }
  .status.err { color: var(--critical); font-weight: 600; }
  .errtext {
    margin: 6px 0 0; padding: 8px 10px; border-radius: 6px;
    background: var(--ghost); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere;
    max-height: 160px; overflow: auto;
  }
  @media (max-width: 560px) {
    .item { grid-template-columns: 56px minmax(0, 1fr); }
    .item .body { grid-column: 1 / -1; }
  }
</style>
