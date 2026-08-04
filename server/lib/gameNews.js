/**
 * 游戏快讯：每日洞察一次（真实新闻源），按天批次累积近半年。
 *
 * - 数据源：默认机核 gcores RSS（真实中文游戏资讯，带原文链接）。RSS_SOURCES 可扩展多源。
 * - 每日一次：与今日热点同模式——当天首次打开页面才抓取+入库；之后读库；在途锁防并发。
 * - 去重：按归一化标题去重，当天新内容上限 10 条；不重复录入。
 * - NEW 标记：batch_date == 当天 的条目标记 NEW。
 * - 清理：入库超过 6 个月的旧条目自动删除（保留近半年）。
 *
 * 注意：运行时通过 Node 全局 fetch 访问外网，需服务端可联网。
 */
const RSS_SOURCES = [
  { name: '机核', url: 'https://www.gcores.com/rss' }
];
const UA = 'Mozilla/5.0 (compatible; KOCWorkbench/1.0)';
const MAX_PER_DAY = 10;
const KEEP_DAYS = 180;

function dateOnly(d) { return new Date(d).toISOString().slice(0, 10); }
function normTitle(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[【】()（）\[\]「」“”"'‘’、，。,.!！?？:：;；\-—_~·>]/g, '');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
function stripHtml(s) {
  return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function toDateStr(pubDate) {
  if (!pubDate) return '';
  const t = Date.parse(pubDate);
  if (isNaN(t)) return '';
  return dateOnly(t);
}

function classify(title, summary) {
  const t = (title || '') + ' ' + (summary || '');
  if (/联动/.test(t)) return '联动';
  if (/(公测|开测|上线|开服|首发|预售|预约|公开测验)/.test(t)) return '公测';
  if (/(成绩|营收|流水|登顶|破[亿万]|销量|夺冠|夺得了|数据|财报|破纪录|霸榜|第一)/.test(t)) return '成绩';
  return '其他';
}

function parseRss(xml, sourceName) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map(it => {
    const g = (re) => { const m = it.match(re); return m ? m[1] : ''; };
    const rawDesc = g(/<description>([\s\S]*?)<\/description>/);
    const title = decodeEntities(g(/<title>([\s\S]*?)<\/title>/)).trim();
    const link = g(/<link>([\s\S]*?)<\/link>/).trim();
    const pub = g(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const summary = stripHtml(rawDesc).slice(0, 220);
    return {
      title,
      url: link,
      pub_date: toDateStr(pub),
      summary,
      source: sourceName,
      category: classify(title, summary)
    };
  }).filter(x => x.title && x.url);
}

async function fetchJsonNews() {
  const status = {};
  let all = [];
  await Promise.all(RSS_SOURCES.map(async (src) => {
    try {
      const r = await fetch(src.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const xml = await r.text();
      const items = parseRss(xml, src.name);
      status[src.name] = items.length ? 'ok' : 'empty';
      all = all.concat(items);
    } catch (e) {
      console.warn(`[gameNews] 源 ${src.name} 抓取失败:`, e.message);
      status[src.name] = 'fail';
    }
  }));
  return { all, status };
}

/** 入库当天新内容（去重 + 限 10 条），返回当天新增条数 */
async function ingest(db, today) {
  const { all, status } = await fetchJsonNews();
  // 已有标题集合（近半年内，用于跨天去重）
  const existing = db.prepare(
    `SELECT title FROM game_news WHERE batch_date >= date('now', ?)`
  ).all(`-${KEEP_DAYS} days`).map(r => normTitle(r.title));
  const seen = new Set(existing);
  const nowIso = new Date().toISOString();
  let added = 0;
  for (const it of all) {
    if (added >= MAX_PER_DAY) break;
    const key = normTitle(it.title);
    if (seen.has(key)) continue;
    seen.add(key);
    db.prepare(`INSERT INTO game_news (batch_date, title, category, summary, source, url, pub_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      today, it.title, it.category, it.summary, it.source, it.url, it.pub_date, nowIso);
    added++;
  }
  // 清理超期（保留近半年）
  db.prepare(`DELETE FROM game_news WHERE batch_date < date('now', ?)`).run(`-${KEEP_DAYS} days`);
  return { added, status };
}

function listAll(db, today) {
  const rows = db.prepare(
    `SELECT id, batch_date, title, category, summary, source, url, pub_date
     FROM game_news ORDER BY batch_date DESC, id DESC`
  ).all();
  const items = rows.map(r => ({ ...r, isNew: r.batch_date === today }));
  const lastBatch = rows.length ? rows[0].batch_date : null;
  return { items, lastBatch };
}

async function ensure(db, { force } = {}) {
  const today = dateOnly(new Date());
  const hasToday = db.prepare('SELECT 1 FROM game_news WHERE batch_date=? LIMIT 1').get(today);
  if (!force && hasToday) return { ran: false, ...listAll(db, today) };
  const { added, status } = await ingest(db, today);
  return { ran: true, added, status, ...listAll(db, today) };
}

let inFlight = null;
function getSnapshot(db, { force } = {}) {
  if (inFlight) {
    return (async () => {
      try { await inFlight; } catch (e) { /* 忽略，下面按需重跑 */ }
      return await ensure(db, { force });
    })();
  }
  inFlight = (async () => {
    try { return await ensure(db, { force }); }
    finally { inFlight = null; }
  })();
  return inFlight;
}

module.exports = { getSnapshot, ensure, dateOnly, RSS_SOURCES };
