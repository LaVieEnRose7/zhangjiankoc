/**
 * 实时热点源：抖音热榜（官方 aweme 接口）+ B站热门（popular 接口）
 * - 归一化为统一结构 {id, source, title, url, heat, up?, pic?, rank}
 * - 内存缓存（默认 10 分钟），单源失败不影响另一源
 * - 抖音失败回退到备用聚合源；两源均失败返回空列表并标记状态
 *
 * 注意：本模块在运行时通过 Node 全局 fetch 访问外网，需服务端可联网。
 */
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

let cache = { ts: 0, data: null };

function withHttps(pic) {
  if (!pic) return null;
  return pic.startsWith('http') ? pic : 'https:' + pic;
}

function normalizeBili(j) {
  const list = (j && j.data && j.data.list) || [];
  return list.map((x, i) => ({
    id: 'bili-' + x.bvid,
    source: 'B站',
    title: x.title,
    url: 'https://www.bilibili.com/video/' + x.bvid,
    heat: x.stat && x.stat.view != null ? x.stat.view : null,
    up: x.owner && x.owner.name,
    pic: withHttps(x.pic),
    rank: i + 1
  }));
}

function normalizeDouyin(j) {
  const wl = (j && j.data && j.data.word_list) || [];
  return wl.map((x, i) => ({
    id: 'dy-' + encodeURIComponent(x.word || ''),
    source: '抖音',
    title: x.word,
    url: 'https://www.douyin.com/search/' + encodeURIComponent(x.word || ''),
    heat: x.hot_value != null ? x.hot_value : null,
    up: null,
    pic: null,
    rank: i + 1
  }));
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}),
    signal: AbortSignal.timeout(opts.timeout || 8000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function fetchBilibili(limit) {
  const j = await fetchJson('https://api.bilibili.com/x/web-interface/popular?ps=' + (limit || 20) + '&pn=1', {
    headers: { Referer: 'https://www.bilibili.com' }
  });
  return normalizeBili(j);
}

async function fetchDouyin(limit) {
  // 优先用稳定的第三方聚合源（官方 aweme 接口在服务器端常被反爬拦截，仅作回退）
  // 聚合源偶发抖动，做一次重试以提升稳定性
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await fetchJson('https://v2.xxapi.cn/api/douyinhot', { timeout: 8000 });
      const arr = (j && j.data) || [];
      if (arr.length) return normalizeXxapi(j);
    } catch (e) { lastErr = e; }
  }
  // 回退官方源
  try {
    const j = await fetchJson('https://aweme.snssdk.com/aweme/v1/hot/search/list/?device_id=1&aid=1703');
    return normalizeDouyin(j);
  } catch (e2) {
    console.warn('[hotspotSource] 抖音全源失败:', (lastErr && lastErr.message) || '', e2.message);
    return [];
  }
}

function normalizeXxapi(j) {
  const arr = (j && j.data) || [];
  return arr.map((x, i) => ({
    id: 'dy-' + encodeURIComponent(x.word || ''),
    source: '抖音',
    title: x.word,
    url: 'https://www.douyin.com/search/' + encodeURIComponent(x.word || ''),
    heat: x.hot_value != null ? x.hot_value : null,
    up: null,
    pic: null,
    rank: x.position != null ? x.position : (i + 1)
  }));
}

/**
 * 取实时热点（合并两源），带缓存与降级
 * @param {number} limit 每源最多条数（默认 20）
 * @returns {Promise<{list:Array, biliCount:number, douyinCount:number, fetchedAt:string, sourceStatus:{bili:string,douyin:string}}>}
 */
async function getHotspots(limit) {
  const lim = limit || 20;
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) {
    return pack(cache.data, lim);
  }
  const [biliRes, dyRes] = await Promise.allSettled([fetchBilibili(lim), fetchDouyin(lim)]);
  const biliList = biliRes.status === 'fulfilled' ? biliRes.value : [];
  const dyList = dyRes.status === 'fulfilled' ? dyRes.value : [];
  const data = {
    bili: biliList,
    douyin: dyList,
    fetchedAt: new Date().toISOString()
  };
  // 仅当两源都成功才缓存，避免把「抖音抖动为空」缓存成 0 长达 10 分钟
  if (biliList.length && dyList.length) cache = { ts: now, data };
  return pack(data, lim);
}

function pack(data, lim) {
  const bili = data.bili.slice(0, lim);
  const douyin = data.douyin.slice(0, lim);
  // 交错排列（抖音/B站/抖音/B站…），保证前列同时出现两种来源，避免 limit 切片把某一源全部切掉
  const list = [];
  const n = Math.max(bili.length, douyin.length);
  for (let i = 0; i < n; i++) {
    if (i < douyin.length) list.push(douyin[i]);
    if (i < bili.length) list.push(bili[i]);
  }
  return {
    list,
    biliCount: bili.length,
    douyinCount: douyin.length,
    fetchedAt: data.fetchedAt,
    sourceStatus: {
      bili: bili.length ? 'ok' : 'fail',
      douyin: douyin.length ? 'ok' : 'fail'
    }
  };
}

/** 强制刷新缓存（供前端「实时刷新」按钮调用） */
function invalidate() { cache = { ts: 0, data: null }; }

module.exports = { getHotspots, invalidate, fetchBilibili, fetchDouyin };
