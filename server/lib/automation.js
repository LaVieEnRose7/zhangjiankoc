/**
 * 后台自动任务：每日固定抓取一次热点/快讯，并在热点抓取后立即生成 AI 推荐分析。
 *
 * 不额外引入 cron 依赖，使用 setTimeout 计算下一次 Asia/Shanghai 执行时间。
 * 业务结果继续写入现有 daily_hotspot_snapshot / game_news 表。
 */
const dailyHotspot = require('./dailyHotspot');
const gameNews = require('./gameNews');
const { saveNow } = require('../db/database');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DEFAULT_RUN_TIME = '07:00';
const TIMEZONE = 'Asia/Shanghai';

let dbRef = null;
let timer = null;
let running = null;
let nextRunAt = null;

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row && row.value !== undefined && row.value !== null ? String(row.value) : fallback;
}

function setSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(value));
}

function parseStatus(db) {
  const raw = getSetting(db, 'auto_task_status', '{}');
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

function writeStatus(db, patch) {
  const status = { ...parseStatus(db), ...patch, updatedAt: new Date().toISOString() };
  setSetting(db, 'auto_task_status', JSON.stringify(status));
  saveNow();
  return status;
}

function normalizeTime(value) {
  const text = String(value || '').trim();
  const m = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : DEFAULT_RUN_TIME;
}

function isEnabled(db) {
  return getSetting(db, 'auto_task_enabled', '1') !== '0';
}

function getRunTime(db) {
  return normalizeTime(getSetting(db, 'auto_task_time', process.env.AUTO_TASK_TIME || DEFAULT_RUN_TIME));
}

function shanghaiParts(timeMs) {
  const d = new Date(timeMs + 8 * HOUR);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes()
  };
}

function formatShanghai(timeMs) {
  if (!timeMs) return null;
  const p = shanghaiParts(timeMs);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.date).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function calcNextRunMs(runTime, nowMs = Date.now()) {
  const [hour, minute] = normalizeTime(runTime).split(':').map(Number);
  const p = shanghaiParts(nowMs);
  let target = Date.UTC(p.year, p.month, p.date, hour - 8, minute, 0, 0);
  if (target <= nowMs) target += DAY;
  return target;
}

function getStatus(db = dbRef) {
  if (!db) return { enabled: false, running: false };
  const enabled = isEnabled(db);
  const runTime = getRunTime(db);
  const saved = parseStatus(db);
  return {
    enabled,
    runTime,
    timezone: TIMEZONE,
    running: !!running,
    nextRunAt,
    nextRunLocal: formatShanghai(nextRunAt),
    ...saved
  };
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
}

function scheduleNext(db = dbRef) {
  clearTimer();
  if (!db || !isEnabled(db)) return getStatus(db);
  const runTime = getRunTime(db);
  nextRunAt = calcNextRunMs(runTime);
  const delay = Math.max(1000, nextRunAt - Date.now());
  timer = setTimeout(async () => {
    try {
      await runNow(db, { force: true, reason: 'scheduled' });
    } catch (e) {
      console.error('[automation] scheduled task failed:', e.message);
    } finally {
      scheduleNext(db);
    }
  }, delay);
  if (timer.unref) timer.unref();
  writeStatus(db, { nextRunAt, nextRunLocal: formatShanghai(nextRunAt) });
  return getStatus(db);
}

async function runNow(db = dbRef, { force = true, reason = 'manual' } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (running) return running;

  running = (async () => {
    const startedAt = new Date().toISOString();
    writeStatus(db, {
      running: true,
      lastStartedAt: startedAt,
      lastReason: reason,
      lastError: '',
      steps: ['开始抓取热点并生成推荐分析']
    });

    try {
      const hotspotSnap = await dailyHotspot.getSnapshot(db, { force });
      const hotspots = JSON.parse(hotspotSnap.hotspots_json || '[]');
      const recommendations = JSON.parse(hotspotSnap.recommendations_json || '[]');
      writeStatus(db, {
        running: true,
        steps: ['热点抓取完成', 'AI 推荐分析完成', '开始抓取游戏快讯'],
        lastHotspotCount: hotspots.length,
        lastRecommendationCount: recommendations.length,
        lastSourceStatus: JSON.parse(hotspotSnap.source_status_json || '{}')
      });

      const newsSnap = await gameNews.getSnapshot(db, { force });
      const finishedAt = new Date().toISOString();
      const result = {
        running: false,
        lastSuccess: true,
        lastFinishedAt: finishedAt,
        lastError: '',
        lastHotspotCount: hotspots.length,
        lastRecommendationCount: recommendations.length,
        lastHotspotFetchedAt: hotspotSnap.fetched_at,
        lastHotspotAnalyzedAt: hotspotSnap.analyzed_at,
        lastNewsAdded: newsSnap.added || 0,
        lastNewsTotal: newsSnap.items ? newsSnap.items.length : 0,
        lastNewsBatch: newsSnap.lastBatch || null,
        steps: ['热点抓取完成', 'AI 推荐分析完成', '游戏快讯抓取完成']
      };
      writeStatus(db, result);
      return getStatus(db);
    } catch (e) {
      const failed = {
        running: false,
        lastSuccess: false,
        lastFinishedAt: new Date().toISOString(),
        lastError: e.message || '自动任务执行失败',
        steps: ['自动任务失败']
      };
      writeStatus(db, failed);
      throw e;
    } finally {
      running = null;
    }
  })();

  return running;
}

function configure(db = dbRef, { enabled, runTime } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (enabled !== undefined) setSetting(db, 'auto_task_enabled', enabled ? '1' : '0');
  if (runTime !== undefined) setSetting(db, 'auto_task_time', normalizeTime(runTime));
  saveNow();
  return scheduleNext(db);
}

function start(db) {
  dbRef = db;
  if (!getSetting(db, 'auto_task_time')) setSetting(db, 'auto_task_time', process.env.AUTO_TASK_TIME || DEFAULT_RUN_TIME);
  if (!getSetting(db, 'auto_task_enabled')) setSetting(db, 'auto_task_enabled', process.env.AUTO_TASK_ENABLED === '0' ? '0' : '1');
  const status = scheduleNext(db);
  if (isEnabled(db) && process.env.AUTO_TASK_BOOTSTRAP !== '0') {
    setTimeout(() => {
      runNow(db, { force: false, reason: 'bootstrap' }).catch(e => {
        console.error('[automation] bootstrap task failed:', e.message);
      });
    }, 3000).unref?.();
  }
  return status;
}

module.exports = { start, configure, getStatus, runNow, normalizeTime, calcNextRunMs };
