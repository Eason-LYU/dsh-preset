/**
 * dsh-delete-session — host half.
 *
 * The Web GUI ships archive but no delete. This plugin registers one HTTP
 * bridge route that removes a session for good:
 *
 *   1. refuse when the session is open in this process (the `sessions` service
 *      still holds it) — deleting the session you are looking at cannot end well;
 *   2. delete the session's storage directory under `$DSH_HOME/sessions/<ws>/<id>`;
 *   3. detach the id from the workspace record through the registry's own
 *      write path, so the sidebar row disappears live and `workspace.json`
 *      stays consistent with what the host holds in memory;
 *   4. drop the id from the archive / pin sets (both are idempotent removals);
 *   5. drop that session's projection-cache row (0.2.0) — the transcript is
 *      gone, so its cached title / first prompt / cost snapshot must go too.
 *
 * A second route (`/gc`) reconciles the derived metadata that earlier deletes
 * left behind: projection-cache rows and archived ids whose session no longer
 * exists anywhere. It defaults to a dry run and always backs up before it
 * unlinks anything.
 *
 * Nothing here touches app.asar: it is an ordinary Cordis plugin.
 */
import { copyFile, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROUTE_PREFIX = '/api/dsh-delete-session';
const MAX_BODY_BYTES = 16 * 1024;
const SESSION_ID = /^session-[0-9a-fA-F-]{8,}$/;
/** Cache rows also exist for child sessions stored under a bare uuid. */
const CACHE_ROW_ID = /^(?:session-)?[0-9a-fA-F][0-9a-fA-F-]{7,}$/;
const REQUEST_HEADER = 'x-dsh-delete-session';
/** Never sweep a record this young: a live or just-created session may have
 *  no directory yet, and a restart or a slow checkpoint must not be mistaken
 *  for a deletion. */
const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Loopback is the only trust boundary the platform webserver offers: it has
 * no auth of its own, and this endpoint accepts text/plain bodies, so a
 * cross-origin page would not even need a CORS preflight to reach it. Two
 * independent guards therefore apply to every route here:
 *   1. a custom header, which a cross-origin browser fetch cannot add without
 *      a preflight (the webserver answers no OPTIONS, so such a fetch dies);
 *   2. same-origin / Sec-Fetch-Site checks for callers that do look like a
 *      browser, so a forged Origin from another page is rejected outright.
 * Non-browser callers (curl, tests) simply send the header and no Origin.
 */
function authorize(req, res) {
  const headers = req.headers ?? {};
  if (headers[REQUEST_HEADER] !== '1') {
    writeJson(res, 403, {
      ok: false,
      code: 'forbidden',
      message: `缺少请求头 ${REQUEST_HEADER}: 1`,
    });
    return false;
  }
  const origin = headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (originHost === undefined || originHost !== headers.host) {
      writeJson(res, 403, { ok: false, code: 'bad-origin', message: '只允许同源请求。' });
      return false;
    }
  }
  const fetchSite = headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none' && fetchSite !== '') {
    writeJson(res, 403, { ok: false, code: 'bad-fetch-site', message: '拒绝跨站请求。' });
    return false;
  }
  return true;
}

/** @param {import('node:http').ServerResponse} res */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(payload);
}

/** @param {import('node:http').IncomingMessage} req */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

/** dsh home: honour DSH_HOME, else `~/.dsh`. */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
}

/** The directory that holds one folder per workspace, each holding session folders. */
function sessionsRoot() {
  return join(dshHome(), 'sessions');
}

/** Per-record layout of the persisted projection cache. */
function cacheRoot() {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions');
}

function backupRoot() {
  // The host runs unsandboxed and backs up under its own home; an offline run
  // (a sandboxed agent shell) cannot write there, so the tool points this at a
  // directory inside the workspace instead.
  const override = process.env.DSH_DELETE_SESSION_BACKUP;
  if (typeof override === 'string' && override.trim() !== '') return override.trim();
  return join(dshHome(), 'backups', 'delete-session-gc');
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Every stored directory for one session id. The workspace folder name is a
 * path encoding this plugin does not need to reproduce, so the whole tree is
 * scanned one level deep instead.
 */
async function sessionDirs(sessionId) {
  const root = sessionsRoot();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name, sessionId);
    try {
      if ((await stat(candidate)).isDirectory()) found.push(candidate);
    } catch {
      /* not in this workspace folder */
    }
  }
  return found;
}

/** Every session id that has a storage directory, in one pass. */
async function storedOnDisk() {
  const ids = new Set();
  let entries;
  try {
    entries = await readdir(sessionsRoot(), { withFileTypes: true });
  } catch {
    return ids;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let inner;
    try {
      inner = await readdir(join(sessionsRoot(), entry.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of inner) if (child.isDirectory()) ids.add(child.name);
  }
  return ids;
}

/** Ids the sessions service still holds in memory (live = not deletable). */
function liveSessionIds(ctx) {
  const sessions = ctx.get('sessions');
  const ids = new Set();
  if (typeof sessions?.list === 'function') {
    for (const session of sessions.list()) {
      const id = session?.id ?? session?.header?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

/**
 * Ids the persistence backend still indexes. This is the authority when it is
 * available: a session stored by a non-directory backend has no folder here,
 * so "no folder on disk" alone must never be read as "deleted".
 * @returns {Promise<Set<string> | null>} null when the service is unavailable.
 */
async function storedIndex(ctx) {
  const persistence = ctx.get('sessionPersistence');
  if (typeof persistence?.list !== 'function') return null;
  try {
    const snapshots = await persistence.list();
    const ids = new Set();
    for (const snapshot of snapshots) {
      const id = snapshot?.header?.id ?? snapshot?.id;
      if (typeof id === 'string') ids.add(id);
    }
    return ids;
  } catch {
    return null;
  }
}

/** Title of one cache row, for the confirmation list only. */
function rowTitle(record) {
  const rows = record?.record?.rows;
  const title = rows?.title?.val;
  return typeof title === 'string' ? title.slice(0, 80) : null;
}

/**
 * Cache rows whose session no longer exists anywhere: not live, not indexed by
 * the persistence backend, and (as a cross-check) with no storage directory.
 * The age floor keeps a brand-new session whose first checkpoint landed before
 * its directory out of the sweep.
 */
async function findOrphans(ctx, minAgeMs) {
  let entries;
  try {
    entries = await readdir(cacheRoot(), { withFileTypes: true });
  } catch {
    return { rows: [], scanned: 0, reason: 'no-cache-directory' };
  }
  const live = liveSessionIds(ctx);
  const stored = await storedIndex(ctx);
  const onDisk = await storedOnDisk();
  const cutoff = Date.now() - minAgeMs;
  const rows = [];
  let scanned = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -'.json'.length);
    if (!CACHE_ROW_ID.test(id)) continue;
    scanned += 1;
    if (live.has(id)) continue;
    if (stored !== null ? stored.has(id) : false) continue;
    if (stored === null && onDisk.has(id)) continue;
    const file = join(cacheRoot(), entry.name);
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }
    if (info.mtimeMs > cutoff) continue;
    rows.push({ id, file, bytes: info.size, mtimeMs: info.mtimeMs, title: null });
  }
  for (const row of rows) {
    try {
      row.title = rowTitle(JSON.parse(await readFile(row.file, 'utf8')));
    } catch {
      row.title = null;
    }
  }
  return { rows, scanned, persistenceIndex: stored !== null };
}

/** Copy every candidate out of the way before anything is unlinked. */
async function backupRows(rows, manifest) {
  const dir = join(backupRoot(), stamp());
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, at: new Date().toISOString(), rows: rows.map((row) => row.id) }, null, 2)}\n`,
    'utf8',
  );
  for (const row of rows) {
    try {
      await copyFile(row.file, join(dir, `${row.id}.json`));
    } catch {
      /* a row that cannot be copied is reported by the caller's failure list */
    }
  }
  return dir;
}

/**
 * Reconcile the derived metadata that earlier deletes left behind.
 * @param {any} ctx the plugin context.
 * @param {boolean} apply false = report only (the default).
 * @param {number} minAgeMs age floor for a row to count as dead.
 */
async function collectGarbage(ctx, apply, minAgeMs) {
  const found = await findOrphans(ctx, minAgeMs);
  const registry = ctx.get('workspaceRegistry');
  const archived = Array.isArray(registry?.archivedSessionIds) ? [...registry.archivedSessionIds] : [];
  const live = liveSessionIds(ctx);
  const stored = await storedIndex(ctx);
  const onDisk = await storedOnDisk();
  const gone = (id) => !live.has(id) && (stored === null ? !onDisk.has(id) : !stored.has(id));
  const staleArchived = archived.filter((id) => typeof id === 'string' && gone(id));
  const bytes = found.rows.reduce((sum, row) => sum + row.bytes, 0);

  const report = {
    scanned: found.scanned,
    persistenceIndex: found.persistenceIndex,
    minAgeMs,
    apply,
    orphanRows: found.rows.length,
    orphanBytes: bytes,
    sample: found.rows.slice(0, 40).map((row) => ({ id: row.id, bytes: row.bytes, title: row.title })),
    staleArchivedIds: staleArchived,
  };

  if (apply !== true) return { ok: true, value: { ...report, dryRun: true } };

  const backupDir = found.rows.length > 0
    ? await backupRows(found.rows, { kind: 'projcache', staleArchived })
    : null;

  const removed = [];
  const failures = [];
  for (const row of found.rows) {
    try {
      await unlink(row.file);
      removed.push(row.id);
    } catch (error) {
      failures.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const unarchived = [];
  for (const id of staleArchived) {
    try {
      await registry?.unarchiveSession?.(id);
      unarchived.push(id);
    } catch (error) {
      failures.push(`unarchive ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: failures.length === 0,
    value: {
      ...report,
      dryRun: false,
      backupDir,
      removed: removed.length,
      unarchived: unarchived.length,
      failures,
    },
    code: failures.length === 0 ? undefined : 'partial',
    message: failures.length === 0 ? undefined : `未完全清理：${failures.join('; ')}`,
  };
}

/** Drop one session's cache row; a missing row is not an error. */
async function dropCacheRow(sessionId) {
  if (!CACHE_ROW_ID.test(sessionId)) return false;
  const file = join(cacheRoot(), `${sessionId}.json`);
  try {
    const info = await stat(file);
    const dir = join(backupRoot(), stamp());
    await mkdir(dir, { recursive: true });
    await copyFile(file, join(dir, `${sessionId}.json`));
    await unlink(file);
    return { id: sessionId, bytes: info.size, backupDir: dir };
  } catch {
    return false;
  }
}

/**
 * Delete one session.
 * @param {any} ctx the plugin context.
 * @param {string} sessionId the session to remove.
 * @param {boolean} isCurrent whether the page reports this as the session it shows.
 * @param {boolean} allowLive second confirmation for a session still held by the host.
 */
async function deleteSession(ctx, sessionId, isCurrent, dryRun, allowLive) {
  const registry = ctx.get('workspaceRegistry');
  const sessions = ctx.get('sessions');

  // The session the page is looking at stays refused outright. Any other live
  // session additionally needs an explicit second confirmation: the client's
  // `current` flag is a heuristic, so a bare request must never be enough to
  // remove something the sessions service still holds. Deleting a live
  // session can also be undone by a later autosave; the caller is warned.
  const live = sessions?.get?.(sessionId);
  const isLive = live !== undefined && live !== null;
  if (isCurrent === true && isLive) {
    return {
      ok: false,
      code: 'session-current',
      message: '这是你正在查看的会话，请先切换到其他会话再删除。',
    };
  }
  if (isLive && allowLive !== true) {
    return {
      ok: false,
      code: 'session-live',
      message: '该会话仍驻留在本进程内存中。删除后可能被自动保存重新写回；确认要继续，请带 allowLive 重发。',
    };
  }

  let owner;
  if (registry?.list) {
    for (const workspace of registry.list()) {
      if (workspace.sessionIds.includes(sessionId)) {
        owner = workspace;
        break;
      }
    }
  }

  const dirs = await sessionDirs(sessionId);
  if (dirs.length === 0 && owner === undefined) {
    return { ok: false, code: 'session-unknown', message: '找不到该会话的记录，可能已经被删除。' };
  }

  if (dryRun === true) {
    return {
      ok: true,
      value: {
        sessionId,
        dryRun: true,
        owner: owner?.title ?? null,
        wouldRemove: dirs,
        wouldDropCacheRow: join(cacheRoot(), `${sessionId}.json`),
      },
    };
  }

  const removed = [];
  const failures = [];
  for (const dir of dirs) {
    try {
      await rm(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch (error) {
      failures.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (owner !== undefined) {
    try {
      await owner.detachSession(sessionId);
    } catch (error) {
      failures.push(`detach: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await registry?.unarchiveSession?.(sessionId);
  } catch {
    /* an id that is not archived needs no write */
  }
  try {
    await registry?.unpinSession?.(sessionId);
  } catch {
    /* an id that is not pinned needs no write */
  }

  // The log is gone now, so the cached projection (title, first prompt, cost)
  // must not outlive it. A failure here is reported, never fatal: the session
  // itself is already gone and `/gc` sweeps whatever is left.
  const cacheRow = await dropCacheRow(sessionId);

  if (failures.length > 0) {
    return { ok: false, code: 'partial', message: `删除未完全成功：${failures.join('; ')}` };
  }
  return { ok: true, value: { sessionId, removed, wasLive: isLive, cacheRowDropped: cacheRow !== false } };
}

/**
 * Internals exported for the offline report tool (`tools/gc-report.mjs`) and
 * the test harness. Nothing here is part of the plugin contract; DSH only ever
 * calls `apply`.
 */
export { cacheRoot, collectGarbage, findOrphans, sessionsRoot, storedOnDisk };

export function apply(ctx) {
  const logger = ctx.logger?.('delete-session') ?? console;

  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const disposers = [
        sctx.webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}/delete`,
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              writeJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'POST only' });
              return;
            }
            if (!authorize(req, res)) return;
            const body = await readJsonBody(req);
            const sessionId = body?.sessionId;
            if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
              writeJson(res, 400, { ok: false, code: 'bad-session-id', message: 'sessionId 无效' });
              return;
            }
            try {
              writeJson(res, 200, await deleteSession(sctx, sessionId, body?.current === true, body?.dryRun === true, body?.allowLive === true));
            } catch (error) {
              logger.warn?.(`delete failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
              writeJson(res, 500, {
                ok: false,
                code: 'delete-failed',
                message: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
        sctx.webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}/gc`,
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              writeJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'POST only' });
              return;
            }
            if (!authorize(req, res)) return;
            const body = await readJsonBody(req);
            const minAge = Number(body?.minAgeMs);
            const minAgeMs = Number.isFinite(minAge) && minAge >= 0 ? minAge : DEFAULT_MIN_AGE_MS;
            // Never default to applying: an accidental POST must stay read-only.
            const applyNow = body?.apply === true;
            try {
              writeJson(res, 200, await collectGarbage(sctx, applyNow, minAgeMs));
            } catch (error) {
              logger.warn?.(`gc failed: ${error instanceof Error ? error.message : String(error)}`);
              writeJson(res, 500, {
                ok: false,
                code: 'gc-failed',
                message: error instanceof Error ? error.message : String(error),
              });
            }
          },
        }),
        sctx.webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}/probe`,
          handler: async (req, res) => {
            if (!authorize(req, res)) return;
            const registry = sctx.get('workspaceRegistry');
            const sessions = sctx.get('sessions');
            const live = typeof sessions?.list === 'function'
              ? sessions.list().map((session) => session?.id ?? session?.header?.id).filter((id) => typeof id === 'string')
              : null;
            const rows = (registry?.list?.() ?? []).map((workspace) => ({
              path: workspace.path,
              title: workspace.title,
              sessions: workspace.sessionIds.length,
            }));
            let cache = null;
            try {
              const orphanScan = await findOrphans(sctx, DEFAULT_MIN_AGE_MS);
              cache = {
                rows: orphanScan.scanned,
                orphanRows: orphanScan.rows.length,
                orphanBytes: orphanScan.rows.reduce((sum, row) => sum + row.bytes, 0),
                persistenceIndex: orphanScan.persistenceIndex,
              };
            } catch {
              cache = null;
            }
            writeJson(res, 200, {
              ok: true,
              value: {
                sessionsRoot: sessionsRoot(),
                workspaces: rows,
                archived: (registry?.archivedSessionIds ?? []).length,
                pinned: (registry?.pinnedSessionIds ?? []).length,
                liveSessionIds: live,
                cache,
                services: {
                  workspaceRegistry: registry !== undefined,
                  sessions: sessions !== undefined,
                  sessionPersistence: sctx.get('sessionPersistence') !== undefined,
                },
              },
            });
          },
        }),
      ];
      return () => {
        for (const dispose of disposers) dispose();
      };
    }, 'delete-session: bridge routes');
  });
}
