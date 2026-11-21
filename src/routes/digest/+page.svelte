<script>
  // What the agent worked on, day by day: a changelog built from the
  // activity of each day in the range (see $lib/digest.js).
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ApiError } from "$lib/api.js";
  import { LockedError, loadActivity, projectLabeler } from "$lib/activity.js";
  import { commitUrl, shortHash } from "$lib/commits.js";
  import CommitFiles from "$lib/CommitFiles.svelte";
  import { buildDigest, duration } from "$lib/digest.js";
  import { count, isoDate, timeZone, usd } from "$lib/format.js";
  import Login from "$lib/Login.svelte";
  import { session } from "$lib/session.svelte.js";
  import Unlock from "$lib/Unlock.svelte";
  import { vault } from "$lib/vault.svelte.js";

  /** @typedef {import("$lib/digest.js").DayDigest} DayDigest */

  const MAX_DAYS = 14;
  const today = isoDate(new Date());
  const shiftDay = (/** @type {string} */ iso, /** @type {number} */ n) => {
    const [y, m, d] = iso.split("-").map(Number);
    return isoDate(new Date(y, m - 1, d + n));
  };
  const yesterday = shiftDay(today, -1);

  // ?from=&to= (inclusive, local dates); default: today.
  const to = $derived(clampDate(page.url.searchParams.get("to") ?? today));
  const from = $derived.by(() => {
    let f = clampDate(page.url.searchParams.get("from") ?? to);
    if (f > to) f = to;
    if (f < shiftDay(to, -(MAX_DAYS - 1))) f = shiftDay(to, -(MAX_DAYS - 1));
    return f;
  });
  const dates = $derived.by(() => {
    const out = [];
    for (let d = to; d >= from; d = shiftDay(d, -1)) out.push(d);
    return out;
  });

  /** @param {string} s */
  function clampDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && s <= today ? s : today;
  }

  const PRESETS = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "Last 7 days", from: shiftDay(today, -6), to: today },
  ];

  /** @param {string} f @param {string} t */
  function setRange(f, t) {
    const url = new URL(page.url);
    url.searchParams.set("from", f);
    url.searchParams.set("to", t);
    goto(url.search, { keepFocus: true, noScroll: true });
  }

  /** @type {Record<string, { digest?: DayDigest, error?: string, names?: Map<string, string> }>} */
  let days = $state({});
  let locked = $state(false);
  let loading = $state(false);
  let passphrase = $state("");
  let open = $state(/** @type {Set<string>} */ (new Set()));
  let copied = $state(/** @type {string | null} */ (null));
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

  $effect(() => {
    if (!session.user) return;
    const list = dates;
    const key = vault.dataKey;
    const controller = new AbortController();
    loading = true;
    locked = false;
    days = {};
    (async () => {
      // A few days at a time: each is one activity request.
      for (let i = 0; i < list.length; i += 3) {
        await Promise.all(
          list.slice(i, i + 3).map(async (date) => {
            try {
              const day = await loadActivity(date, key, controller.signal);
              days[date] = { digest: buildDigest(day), names: day.projects };
            } catch (e) {
              if (/** @type {any} */ (e).name === "AbortError") return;
              if (e instanceof LockedError) locked = true;
              else days[date] = { error: e instanceof ApiError ? `Failed to load (${e.status}).` : "Cannot reach the API." };
            }
          }),
        );
        if (controller.signal.aborted || locked) break;
      }
      if (!controller.signal.aborted) loading = false;
    })();
    return () => controller.abort();
  });

  const label = $derived(
    projectLabeler(Object.values(days).flatMap((d) => (d.names ? [...d.names.values()] : []))),
  );
  const rangeTotals = $derived.by(() => {
    const t = { costUsd: 0, commits: 0, files: 0, errors: 0, activeMs: 0 };
    for (const d of Object.values(days)) {
      if (!d.digest) continue;
      t.costUsd += d.digest.totals.costUsd;
      t.commits += d.digest.totals.commits;
      t.files += d.digest.totals.files;
      t.errors += d.digest.totals.errors;
      t.activeMs += d.digest.totals.activeMs;
    }
    return t;
  });

  const dayTitle = (/** @type {string} */ iso) =>
    new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
      new Date(`${iso}T12:00:00`),
    );
  const relDay = (/** @type {string} */ iso) => (iso === today ? "Today" : iso === yesterday ? "Yesterday" : null);
  const clock = (/** @type {Date} */ d) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);

  /** @param {string} id */
  function toggle(id) {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    open = next;
  }
  /** @param {string} date @param {string | null} project @param {boolean} [errors] */
  function activityLink(date, project, errors = false) {
    const q = new URLSearchParams({ date });
    if (project) q.set("project", project);
    if (errors) q.set("status", "error");
    return `/activity?${q}`;
  }
  const PROMPTS = 5;
  const FILES = 8;
</script>

{#snippet commitLine(/** @type {import("$lib/digest.js").CommitLine} */ c)}
  {@const url = c.commit ? commitUrl(c.commit) : null}
  <li>
    <time>{clock(c.ts)}</time>
    {#if c.commit}<button class="hash" title="Copy {c.commit.hash}" onclick={() => copyHash(/** @type {string} */ (c.commit?.hash))}><code>{shortHash(c.commit.hash)}</code><span class="copied" aria-live="polite">{copied === c.commit.hash ? "copied" : ""}</span></button>{/if}
    <span class="msg">{c.message}</span>
    {#if c.commit?.insertions != null}<span class="stat"><span class="add">+{c.commit.insertions}</span> <span class="del">−{c.commit.deletions}</span></span>{/if}
    {#if url}<a class="ext" href={url} target="_blank" rel="noopener noreferrer">open ↗</a>{/if}
    {#if c.commit}<CommitFiles commit={c.commit} />{/if}
  </li>
{/snippet}

{#if !session.user}
  <Login next={page.url.pathname + page.url.search} />
{:else}
  <div class="head">
    <div>
      <h1>Digest</h1>
      <p class="muted small">What your agents worked on, project by project · {timeZone}</p>
    </div>
    <div class="range">
      <div class="seg" role="group" aria-label="Range">
        {#each PRESETS as p (p.label)}
          <button aria-pressed={from === p.from && to === p.to} onclick={() => setRange(p.from, p.to)}>{p.label}</button>
        {/each}
      </div>
      <div class="dates">
        <input type="date" value={from} max={to} aria-label="From" onchange={(e) => setRange(e.currentTarget.value || from, to)} />
        <span class="muted">–</span>
        <input type="date" value={to} max={today} aria-label="To" onchange={(e) => setRange(from, e.currentTarget.value || to)} />
      </div>
    </div>
  </div>

  {#if dates.length > 1}
    <p class="muted small summary">
      {dates.length} days · {usd(rangeTotals.costUsd)} · ≈ {duration(rangeTotals.activeMs)} active ·
      {count(rangeTotals.commits, "commit")} · {count(rangeTotals.files, "file")} changed ·
      {count(rangeTotals.errors, "error")}{#if loading} · loading…{/if}
    </p>
  {/if}

  {#if locked}
    <Unlock title="Private data is end-to-end encrypted" />
  {:else}
    {#each dates as date (date)}
      {@const d = days[date]}
      <section class="day">
        <header>
          <h2>
            {#if relDay(date)}<span class="rel">{relDay(date)}</span>{/if}
            {dayTitle(date)}
          </h2>
          {#if d?.digest && d.digest.projects.length}
            {@const t = d.digest.totals}
            <p class="muted small">
              {usd(t.costUsd)} · {count(t.sessions, "session")} · ≈ {duration(t.activeMs)} active ·
              {count(t.commits, "commit")} · {count(t.files, "file")} changed · {count(t.errors, "error")}
            </p>
          {/if}
        </header>

        {#if !d}
          <p class="muted small">Loading…</p>
        {:else if d.error}
          <p class="error small">{d.error}</p>
        {:else if d.digest && d.digest.projects.length === 0}
          <p class="muted small">No agent activity.</p>
        {:else if d.digest}
          <div class="projects">
            {#each d.digest.projects as p (p.projectId ?? "none")}
              {@const id = `${date}:${p.projectId}`}
              <article class="card project">
                <div class="ptop">
                  <h3 title={p.name ?? ""}>{p.projectId ? label(p.name) : "Continued from another day"}</h3>
                  <a class="open" href={activityLink(date, p.projectId)}>Open in Activity →</a>
                </div>
                <p class="muted small meta">
                  {clock(p.first)}–{clock(p.last)} · {count(p.sessions, "session")} · ≈ {duration(p.activeMs)} active ·
                  {usd(p.costUsd)}
                </p>

                {#if p.turns.length}
                  <h4>
                    You asked
                    {#if p.pushed}<span class="badge"><span aria-hidden="true">↑</span> pushed</span>{/if}
                  </h4>
                  <ul class="prompts">
                    {#each open.has(`${id}:prompts`) ? p.turns : p.turns.slice(0, PROMPTS) as t, k (k)}
                      <li class="turn">
                        <div class="q">
                          <span class="node" aria-hidden="true"></span>
                          <time datetime={t.ts.toISOString()}>{clock(t.ts)}</time>
                          <span class="msg">{t.text}</span>
                        </div>
                        {#if t.commits.length}
                          <ul class="tree commits">
                            {#each t.commits as c, j (j)}{@render commitLine(c)}{/each}
                          </ul>
                        {:else if t.committedLater || t.edited || t.commands || t.failed}
                          <ul class="tree">
                            {#if t.committedLater}
                              <li class="outcome">
                                {count(t.edited, "file")} changed · committed at {clock(t.committedLater.ts)}{#if t.committedLater.commit}{" · "}<code
                                  >{shortHash(t.committedLater.commit.hash)}</code
                                  >{/if}{#if t.uncommitted}{" · "}{t.uncommitted} still not committed{/if}
                              </li>
                            {:else if t.edited}
                              <li class="outcome warn">
                                ✎ {count(t.edited, "file")} changed{#if t.uncommitted != null}, {t.uncommitted ? "not committed" : "committed"}{/if}
                              </li>
                            {:else}
                              <li class="outcome">
                                {count(t.commands, "command")}{#if t.failed}{" · "}<span class="err">{t.failed} failed</span>{/if}
                              </li>
                            {/if}
                          </ul>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  {#if p.turns.length > PROMPTS}
                    <button class="more" onclick={() => toggle(`${id}:prompts`)}>
                      {open.has(`${id}:prompts`) ? "Show less" : `+${p.turns.length - PROMPTS} more`}
                    </button>
                  {/if}
                {/if}

                {#if p.earlierCommits.length}
                  <h4>Commits from earlier prompts</h4>
                  <ul class="commits">
                    {#each p.earlierCommits as c, k (k)}{@render commitLine(c)}{/each}
                  </ul>
                {/if}

                {#if p.uncommitted?.length}
                  <h4>{relDay(date) === "Today" ? "Not committed yet" : "Not committed that day"} <span class="n">{p.uncommitted.length}</span></h4>
                  <ul class="files">
                    {#each open.has(`${id}:files`) ? p.uncommitted : p.uncommitted.slice(0, FILES) as f (f.path)}
                      <li><code title={f.path}>{f.path}</code>{#if f.edits > 1}<span class="n">×{f.edits}</span>{/if}</li>
                    {/each}
                  </ul>
                  {#if p.uncommitted.length > FILES}
                    <button class="more" onclick={() => toggle(`${id}:files`)}>
                      {open.has(`${id}:files`) ? "Show less" : `+${p.uncommitted.length - FILES} more`}
                    </button>
                  {/if}
                {/if}

                {#if p.toolErrors || p.messageErrors}
                  <h4>Problems</h4>
                  <p class="problems">
                    <span class="err" aria-hidden="true">✕</span>
                    {#if p.toolErrors}
                      {count(p.toolErrors, "failed tool call")}
                      ({p.failingTools.slice(0, 3).map((t) => `${t.name} ${t.count}`).join(", ")}{p.failingTools.length > 3 ? ", …" : ""})
                    {/if}
                    {#if p.toolErrors && p.messageErrors}·{/if}
                    {#if p.messageErrors}{count(p.messageErrors, "failed message")}{/if}
                    <a href={activityLink(date, p.projectId, true)}>See errors →</a>
                  </p>
                {/if}

                {#if !p.turns.length && !p.commits.length && !p.uncommitted?.length && !p.toolErrors && !p.messageErrors}
                  <p class="muted small">{count(p.commands, "command")} run, no file changes.</p>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {/if}
{/if}

<style>
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
  h1 { font-size: 20px; margin: 0; }
  .small { font-size: 13px; margin: 2px 0 0; }
  .range { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
  .seg button { border: 0; background: none; padding: 6px 12px; color: var(--text-secondary); }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button:hover { background: var(--ghost); }
  .seg button[aria-pressed="true"] { color: var(--text-primary); font-weight: 600; background: var(--ghost); }
  .dates { display: flex; align-items: center; gap: 6px; flex: 1 1 260px; max-width: 100%; }
  .dates input { flex: 1 1 0; }
  input[type="date"] {
    font: inherit; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text-primary); min-width: 0;
  }
  .summary { margin: 0 0 8px; }
  .day { margin-top: 24px; }
  .day header { margin-bottom: 10px; }
  .day h2 { font-size: 17px; margin: 0; display: flex; align-items: baseline; gap: 8px; }
  .rel { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }
  .projects { display: grid; gap: 12px; }
  .project { padding: 16px 20px; min-width: 0; }
  .ptop { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h3 { font-size: 16px; margin: 0; overflow-wrap: anywhere; }
  .open { font-size: 13px; color: var(--accent); text-decoration: none; white-space: nowrap; }
  .open:hover { text-decoration: underline; }
  .meta { margin-bottom: 4px; }
  h4 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin: 14px 0 6px; display: flex; align-items: center; gap: 8px; }
  ul { margin: 0; padding-left: 18px; font-size: 14px; }
  li { margin: 2px 0; overflow-wrap: anywhere; }
  .prompts { list-style: none; padding-left: 0; }
  /* Turns as a folder tree: the prompt is the parent, its commits (or what
     the turn did) the children, joined by ├─ / └─ lines. */
  .prompts { display: grid; gap: 10px; }
  .prompts > li { color: var(--text-primary); }
  .prompts .q { display: flex; gap: 8px; align-items: baseline; }
  .node { flex: none; width: 8px; height: 8px; border-radius: 2px; border: 1.5px solid var(--text-muted); transform: translateY(-1px); }
  .tree { list-style: none; margin: 2px 0 0 3px; padding: 0; font-size: 13px; }
  .tree > li { position: relative; padding: 3px 0 3px 22px; margin: 0; }
  .tree > li::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; border-left: 1px solid var(--border); }
  .tree > li:last-child::before { bottom: auto; height: calc(3px + 0.8em); }
  .tree > li::after { content: ""; position: absolute; left: 0; top: calc(3px + 0.8em); width: 14px; border-top: 1px solid var(--border); }
  .outcome { font-size: 12.5px; color: var(--text-secondary); }
  .outcome code { font-size: 12px; }
  .outcome.warn { color: var(--text-primary); }
  .outcome .err { color: var(--critical); }
  .prompts time { color: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; flex: none; }
  .prompts .msg { min-width: 0; overflow-wrap: anywhere; }
  .commits { list-style: none; padding-left: 0; }
  .commits time { color: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .commits li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
  .commits .msg { flex: 1 1 12em; min-width: 0; overflow-wrap: anywhere; }
  .hash { border: 1px solid var(--grid); background: var(--ghost); border-radius: 6px; padding: 0 6px; font-size: 12px; cursor: copy; }
  .hash code { background: none; padding: 0; }
  .copied { margin-left: 4px; color: var(--good); font-size: 11px; }
  .copied:empty { display: none; }
  .stat { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-secondary); white-space: nowrap; }
  .add { color: var(--good); }
  .del { color: var(--critical); }
  .ext { font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; }
  .files { list-style: none; padding-left: 0; display: grid; gap: 2px; }
  .files code { font-size: 12.5px; background: var(--ghost); border-radius: 4px; padding: 1px 5px; }
  .n { font-size: 12px; font-weight: 400; color: var(--text-muted); margin-left: 6px; font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none; }
  .badge { font-size: 11px; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; }
  .more { border: 0; background: none; padding: 4px 0 0; color: var(--accent); font-size: 13px; }
  .problems { font-size: 14px; margin: 0; }
  .problems a { color: var(--accent); margin-left: 6px; text-decoration: none; white-space: nowrap; }
  .err { color: var(--critical); margin-right: 4px; }
  @media (max-width: 560px) {
    .project { padding: 14px 16px; }
    /* Let the range controls take the row and shrink with it. */
    .range { width: 100%; min-width: 0; }
    .dates { flex: 1 1 100%; min-width: 0; }
    .dates input { width: 100%; }
  }
</style>
