<script>
  // Engineering work journal (backend docs/journal.md): work items built by
  // the tracker, anchored to git. "Items" answers "where was I?"; "This
  // week" answers "what got done, what waits, what keeps failing?".
  // About the work, never about people: no idle time or hours per person.
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { projectLabeler } from "$lib/activity.js";
  import { ApiError } from "$lib/api.js";
  import { commitUrl, shortHash } from "$lib/commits.js";
  import { duration } from "$lib/digest.js";
  import { ago, count, isoDate, timeZone, usd } from "$lib/format.js";
  import { LockedError, STATUS_LABEL, STATUSES, loadCosts, loadJournal, repeatedErrors, span, statusOf, weekSummary } from "$lib/journal.js";
  import Login from "$lib/Login.svelte";
  import { current } from "$lib/scope.svelte.js";
  import { session } from "$lib/session.svelte.js";
  import { wsLabel } from "$lib/team.svelte.js";
  import Unlock from "$lib/Unlock.svelte";
  import { vault } from "$lib/vault.svelte.js";

  /** @typedef {import("$lib/journal.js").WorkItem} WorkItem @typedef {import("$lib/journal.js").Status} Status */

  const RANGES = [7, 14, 30];
  const days = $derived(RANGES.includes(Number(page.url.searchParams.get("days"))) ? Number(page.url.searchParams.get("days")) : 14);
  const view = $derived(page.url.searchParams.get("view") === "week" ? "week" : "items");
  const statusFilter = $derived(/** @type {Status | null} */ (STATUSES.find((s) => s === page.url.searchParams.get("status")) ?? null));
  const project = $derived(page.url.searchParams.get("project"));

  /** @param {Record<string, string | null>} changes */
  function setParams(changes) {
    const url = new URL(page.url);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    goto(url.search || "?", { keepFocus: true, noScroll: true, replaceState: true });
  }

  let data = $state(/** @type {{ items: WorkItem[], projects: Map<string, string>, team: boolean, notes: string[] } | null} */ (null));
  /** @type {Map<string, number | null>} */
  let costs = $state(new Map());
  let loading = $state(false);
  let locked = $state(false);
  let error = $state(/** @type {string | null} */ (null));
  let open = $state(/** @type {Set<string>} */ (new Set()));
  let copied = $state(/** @type {string | null} */ (null));
  const now = new Date();

  $effect(() => {
    if (!session.user) return;
    const since = isoDate(new Date(Date.now() - (days - 1) * 86400e3));
    const key = vault.dataKey;
    const controller = new AbortController();
    loading = true;
    error = null;
    loadJournal(since, key, controller.signal)
      .then(async (d) => {
        data = d;
        locked = false;
        costs = new Map();
        try {
          costs = await loadCosts(d.items, controller.signal);
        } catch {
          /* costs are a nice-to-have */
        }
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        if (e instanceof LockedError) locked = true;
        else error = e instanceof ApiError ? `Failed to load the journal (${e.status}).` : "Cannot reach the API.";
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });

  const label = $derived(projectLabeler(data ? [...data.projects.values()] : []));
  const projectName = (/** @type {string | null} */ id) => (id && data?.projects.get(id) ? label(data.projects.get(id)) : "Unknown project");

  const inProject = $derived((data?.items ?? []).filter((w) => !project || w.projectId === project));
  /** @type {Record<string, number>} */
  const counts = $derived.by(() => {
    /** @type {Record<string, number>} */
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const w of inProject) c[statusOf(w, now)]++;
    return c;
  });
  const shown = $derived(inProject.filter((w) => !statusFilter || statusOf(w, now) === statusFilter));
  /** Items grouped by project, projects by their latest item. */
  const groups = $derived.by(() => {
    /** @type {Map<string, WorkItem[]>} */
    const by = new Map();
    for (const w of shown) {
      const k = w.projectId ?? "";
      if (!by.has(k)) by.set(k, []);
      /** @type {WorkItem[]} */ (by.get(k)).push(w);
    }
    return [...by.entries()];
  });
  const projectOptions = $derived(
    [...new Set((data?.items ?? []).map((w) => w.projectId).filter(Boolean))].map((id) => ({ id: /** @type {string} */ (id), name: projectName(id) })),
  );
  const week = $derived(weekSummary(inProject, now));
  const weekLists = $derived([
    { title: "Done", list: week.by.done },
    { title: "Committed, not pushed", list: week.by.committed },
    { title: "In progress", list: week.by.active },
    { title: "Pending", list: week.by.pending },
  ]);

  /** @param {string} id */
  function toggle(id) {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    open = next;
  }
  /** @param {string} hash */
  async function copyHash(hash) {
    try {
      await navigator.clipboard.writeText(hash);
      copied = hash;
      setTimeout(() => {
        if (copied === hash) copied = null;
      }, 1500);
    } catch {
      copied = null;
    }
  }
  /** @param {WorkItem} w */
  const activityLink = (w) => {
    const q = new URLSearchParams({ date: isoDate(w.lastActivity) });
    if (w.projectId) q.set("project", w.projectId);
    return `/activity?${q}`;
  };
  const dateLabel = (/** @type {Date} */ d) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(d);
  const prLabel = (/** @type {string} */ url) => {
    const m = url.match(/\/([^/]+)\/(?:pull|-\/merge_requests|pull-requests)\/(\d+)$/);
    return m ? `${m[1]} #${m[2]}` : url;
  };
  const FILES = 6;
  const ITEMS = 8;
</script>

{#snippet badge(/** @type {Status} */ s)}
  <span class="status s-{s}">
    <span aria-hidden="true">{s === "done" ? "✓" : s === "committed" ? "●" : s === "active" ? "▶" : s === "pending" ? "⏸" : s === "discarded" ? "↺" : "–"}</span>
    {STATUS_LABEL[s]}
  </span>
{/snippet}

{#snippet itemCard(/** @type {WorkItem} */ w)}
  {@const s = statusOf(w, now)}
  {@const cost = costs.get(w.id)}
  {@const repeated = repeatedErrors(w)}
  <article class="card item">
    <div class="top">
      {@render badge(s)}
      {#if w.branch}<span class="branch">⎇ {w.branch}</span>{/if}
      {#if w.user}<span class="who">@{w.user}</span>{/if}
    </div>
    <h3>{w.title ?? "Untitled work"}</h3>
    <p class="muted small meta">
      {s === "pending" ? `pending since ${dateLabel(w.lastActivity)}` : `last activity ${ago(w.lastActivity, now)}`}
      · started {dateLabel(w.started)} · {count(w.prompts, "prompt")} · ≈ {duration(w.activeMs)} active{#if typeof cost === "number"}{" · "}{usd(cost)}{/if}
    </p>
    {#each w.pauses as p, k (k)}
      <p class="muted small pause">Paused {span(p.to.getTime() - p.from.getTime())} ({dateLabel(p.from)} → {dateLabel(p.to)})</p>
    {/each}

    {#if w.commits.length || w.prs.length}
      <ul class="commits" aria-label="Commits">
        {#each w.prs as url (url)}
          <li><span class="pr">PR</span><a href={url} target="_blank" rel="noopener noreferrer">{prLabel(url)} ↗</a></li>
        {/each}
        {#each open.has(`${w.id}:c`) ? w.commits : w.commits.slice(0, 5) as c (c.hash)}
          {@const url = commitUrl(c)}
          <li>
            <button class="hash" title="Copy {c.hash}" onclick={() => copyHash(c.hash)}><code>{shortHash(c.hash)}</code><span class="copied" aria-live="polite">{copied === c.hash ? "copied" : ""}</span></button>
            <span class="subject">{c.subject}</span>
            <span class="right">
              {#if c.insertions != null}<span class="stat"><span class="add">+{c.insertions}</span> <span class="del">−{c.deletions}</span></span>{/if}
              {#if url}<a class="open" href={url} target="_blank" rel="noopener noreferrer">open ↗</a>{/if}
            </span>
          </li>
        {/each}
      </ul>
      {#if w.commits.length > 5}
        <button class="more" onclick={() => toggle(`${w.id}:c`)}>{open.has(`${w.id}:c`) ? "Show less" : `+${w.commits.length - 5} more commits`}</button>
      {/if}
    {/if}

    {#if w.files.length}
      <button class="more files-toggle" aria-expanded={open.has(`${w.id}:f`)} onclick={() => toggle(`${w.id}:f`)}>
        {count(w.files.length, "file")} changed {open.has(`${w.id}:f`) ? "▴" : "▾"}
      </button>
      {#if open.has(`${w.id}:f`)}
        <ul class="files">
          {#each w.files.slice(0, open.has(`${w.id}:fa`) ? undefined : FILES) as f (f.path)}
            <li><code title={f.path}>{f.path}</code>{#if f.edits > 1}<span class="n">×{f.edits}</span>{/if}</li>
          {/each}
        </ul>
        {#if w.files.length > FILES && !open.has(`${w.id}:fa`)}
          <button class="more" onclick={() => toggle(`${w.id}:fa`)}>+{w.files.length - FILES} more</button>
        {/if}
      {/if}
    {/if}

    {#if repeated.length}
      <ul class="problems" aria-label="Repeated errors">
        {#each repeated as e (e.fingerprint)}
          <li><span class="err" aria-hidden="true">✕</span> {e.count}× {e.tool}{#if e.sample}: <span class="sample">{e.sample}</span>{/if}</li>
        {/each}
      </ul>
    {/if}
    <a class="link" href={activityLink(w)}>Open in Activity →</a>
  </article>
{/snippet}

{#if !session.user}
  <Login next={page.url.pathname + page.url.search} />
{:else}
  <div class="head">
    <div>
      <h1>Journal</h1>
      <p class="muted small">
        {#if data?.team}Work in <strong>{current() ? wsLabel(/** @type {any} */ (current())) : "this workspace"}</strong>{:else}Your agents' work{/if},
        item by item, anchored to git{#if loading}{" · loading…"}{/if}
      </p>
    </div>
    <div class="controls">
      <div class="seg" role="group" aria-label="View">
        <button aria-pressed={view === "items"} onclick={() => setParams({ view: null })}>Items</button>
        <button aria-pressed={view === "week"} onclick={() => setParams({ view: "week" })}>This week</button>
      </div>
      {#if view === "items"}
        <div class="seg" role="group" aria-label="Range">
          {#each RANGES as r (r)}
            <button aria-pressed={days === r} onclick={() => setParams({ days: r === 14 ? null : String(r) })}>{r} days</button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#each data?.notes ?? [] as n (n)}<p class="muted small">{n}</p>{/each}

  {#if locked}
    <Unlock title="The journal is end-to-end encrypted" />
  {:else if error}
    <div class="card"><p class="error">{error}</p></div>
  {:else if data}
    <div class="filters">
      {#if projectOptions.length > 1}
        <select aria-label="Project" value={project ?? ""} onchange={(e) => setParams({ project: e.currentTarget.value || null })}>
          <option value="">All projects</option>
          {#each projectOptions as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      {/if}
      {#if view === "items"}
        <div class="seg" role="group" aria-label="Status">
          <button aria-pressed={!statusFilter} onclick={() => setParams({ status: null })}>All <span class="n">{inProject.length}</span></button>
          {#each STATUSES.filter((s) => counts[s] > 0 || statusFilter === s) as s (s)}
            <button aria-pressed={statusFilter === s} onclick={() => setParams({ status: s })}>{STATUS_LABEL[s]} <span class="n">{counts[s]}</span></button>
          {/each}
        </div>
      {/if}
    </div>

    {#if view === "week"}
      <section class="tiles" aria-label="This week">
        <div class="card tile"><span class="big">{week.by.done.length}</span><span class="muted small">done</span></div>
        <div class="card tile"><span class="big">{week.by.committed.length}</span><span class="muted small">committed, not pushed</span></div>
        <div class="card tile"><span class="big">{week.by.active.length}</span><span class="muted small">in progress</span></div>
        <div class="card tile"><span class="big">{week.by.pending.length}</span><span class="muted small">pending</span></div>
        <div class="card tile"><span class="big">{week.commits}</span><span class="muted small">{week.commits === 1 ? "commit" : "commits"} · {count(week.prs.length, "PR")}</span></div>
      </section>
      {#if week.problems.length}
        <section class="card block">
          <h2>Recurring problems</h2>
          <ul class="problems">
            {#each week.problems as p (p.fingerprint)}
              <li><span class="err" aria-hidden="true">✕</span> {p.count}× {p.tool} in {count(p.items, "item")}{#if p.sample}: <span class="sample">{p.sample}</span>{/if}</li>
            {/each}
          </ul>
        </section>
      {/if}
      {#each weekLists as { title, list } (title)}
        {#if list.length}
          <section class="block">
            <h2>{title} <span class="n">{list.length}</span></h2>
            <ul class="week">
              {#each open.has(`w:${title}`) ? list : list.slice(0, ITEMS) as w (w.id)}
                <li>
                  <span class="wtitle">{w.title ?? "Untitled work"}</span>
                  <span class="muted small">{[projectName(w.projectId), w.branch ? `⎇ ${w.branch}` : null, w.user ? `@${w.user}` : null, w.commits.length ? count(w.commits.length, "commit") : null, ...w.prs.map(prLabel)].filter(Boolean).join(" · ")}</span>
                </li>
              {/each}
            </ul>
            {#if list.length > ITEMS}
              <button class="more" onclick={() => toggle(`w:${title}`)}>{open.has(`w:${title}`) ? "Show less" : `+${list.length - ITEMS} more`}</button>
            {/if}
          </section>
        {/if}
      {/each}
      {#if !week.items}<div class="card"><p class="muted">No work in the last 7 days.</p></div>{/if}
    {:else if !shown.length}
      <div class="card">
        <p class="muted">
          {#if data.items.length}
            Nothing matches these filters.
          {:else if data.team}
            No work items from folders linked to <strong>{current() ? wsLabel(/** @type {any} */ (current())) : "this workspace"}</strong> yet.
            Link a folder with <code>clioilc link</code>, or switch to <strong>Personal</strong> in the scope menu to see your own work.
          {:else}
            No work items yet. They appear after the next sync of a tracker that has the journal (<code>clioilc usage import</code> fills in earlier history).
          {/if}
        </p>
      </div>
    {:else}
      {#each groups as [pid, list] (pid)}
        <section class="group">
          <h2 title={data.projects.get(pid) ?? ""}>{projectName(pid || null)} <span class="n">{list.length}</span></h2>
          <div class="items">
            {#each list as w (w.id)}{@render itemCard(w)}{/each}
          </div>
        </section>
      {/each}
    {/if}
  {:else}
    <div class="card"><p class="muted">Loading…</p></div>
  {/if}
{/if}

<style>
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
  h1 { font-size: 20px; margin: 0; }
  .small { font-size: 13px; margin: 2px 0 0; }
  .controls, .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .filters { margin-bottom: 12px; }
  .filters select {
    font: inherit; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text-primary); max-width: 100%; min-width: 0;
  }
  .seg { display: inline-flex; max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .seg button { border: 0; background: none; padding: 6px 12px; color: var(--text-secondary); white-space: nowrap; flex: none; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button:hover { background: var(--ghost); }
  .seg button[aria-pressed="true"] { color: var(--text-primary); font-weight: 600; background: var(--ghost); }
  @media (max-width: 420px) {
    .seg button { padding: 6px 8px; }
  }
  .n { font-size: 12px; font-weight: 400; color: var(--text-muted); margin-left: 4px; font-variant-numeric: tabular-nums; }
  .group { margin-top: 20px; }
  .group h2, .block h2 { font-size: 15px; margin: 0 0 8px; overflow-wrap: anywhere; }
  .items { display: grid; gap: 10px; }
  .item { padding: 14px 18px; min-width: 0; }
  .top { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
  .status { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; font-weight: 600; border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; color: var(--text-secondary); }
  .s-done { color: var(--good); border-color: currentColor; }
  .s-active { color: var(--accent); border-color: currentColor; }
  .s-committed { color: var(--text-primary); }
  .s-pending { color: var(--text-primary); border-style: dashed; }
  .s-abandoned, .s-discarded { color: var(--text-muted); }
  .branch, .who { font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
  h3 { font-size: 15px; margin: 6px 0 2px; overflow-wrap: anywhere; }
  .meta { margin: 0; }
  .pause { margin: 2px 0 0; }
  .commits { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
  .commits li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; min-width: 0; }
  .hash { border: 1px solid var(--grid); background: var(--ghost); border-radius: 6px; padding: 0 6px; font-size: 12px; cursor: copy; }
  .hash code { background: none; padding: 0; }
  .copied { margin-left: 4px; color: var(--good); font-size: 11px; }
  .copied:empty { display: none; }
  .subject { flex: 1 1 12em; min-width: 0; overflow-wrap: anywhere; }
  .right { display: inline-flex; gap: 8px; align-items: baseline; white-space: nowrap; margin-left: auto; }
  .stat { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .add { color: var(--good); }
  .del { color: var(--critical); }
  .pr { font-size: 11px; font-weight: 600; border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; color: var(--text-secondary); }
  .commits a, .link { color: var(--accent); text-decoration: none; font-size: 13px; }
  .commits a:hover, .link:hover { text-decoration: underline; }
  .open { white-space: nowrap; }
  .more { border: 0; background: none; padding: 4px 0 0; color: var(--accent); font-size: 13px; }
  .files-toggle { display: block; margin-top: 6px; }
  .files { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 2px; font-size: 13px; }
  .files li { overflow-wrap: anywhere; }
  .files code { font-size: 12px; background: var(--ghost); border-radius: 4px; padding: 1px 5px; }
  .problems { list-style: none; margin: 8px 0 0; padding: 0; font-size: 13px; display: grid; gap: 2px; }
  .problems li { overflow-wrap: anywhere; }
  .err { color: var(--critical); margin-right: 2px; }
  .sample { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--text-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .link { display: inline-block; margin-top: 8px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 12px; }
  .tile { padding: 12px 14px; display: grid; gap: 2px; }
  .big { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .block { margin-bottom: 12px; }
  .card.block { padding: 14px 18px; }
  .week { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .week li { display: grid; gap: 1px; min-width: 0; }
  .wtitle { font-size: 14px; overflow-wrap: anywhere; }
  @media (max-width: 560px) {
    .item { padding: 12px 14px; }
  }
</style>
