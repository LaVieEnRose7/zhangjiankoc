// 主页链接 → 平台账号信息抓取（粉丝量 / 昵称）
// 支持：B站（空间 API + WBI 签名，较稳）；抖音（尽力而为，best-effort，失败返回 ok:false）
// 设计原则：单条失败不影响整体；所有外部请求带浏览器 UA + 超时；调用方自行限速。

const crypto = require('crypto');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// B站 WBI 签名所需的混排表
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52
];
function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32);
}
function encWbi(params, mixinKey) {
  const wts = Math.floor(Date.now() / 1000);
  const p = { ...params, wts };
  const sorted = Object.keys(p).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join('&');
  const w_rid = crypto.createHash('md5').update(sorted + mixinKey).digest('hex');
  return `${sorted}&w_rid=${w_rid}`;
}
// 缓存 WBI 密钥 + buvid3（10 分钟），减少请求
let wbiCache = { mixinKey: null, buvid3: null, ts: 0 };
async function getWbiKeys() {
  if (wbiCache.mixinKey && Date.now() - wbiCache.ts < 10 * 60 * 1000) return wbiCache;
  const r = await fetchWithTimeout('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/' },
  });
  const j = await r.json();
  const img = (j.data && j.data.wbi_img && j.data.wbi_img.img_url || '').split('/').pop().split('.')[0];
  const sub = (j.data && j.data.wbi_img && j.data.wbi_img.sub_url || '').split('/').pop().split('.')[0];
  const mixinKey = getMixinKey(img + sub);
  const cookie = r.headers.get('set-cookie') || '';
  const m = cookie.match(/buvid3=([^;]+)/);
  const buvid3 = m ? m[1] : '';
  wbiCache = { mixinKey, buvid3, ts: Date.now() };
  return wbiCache;
}

function detectPlatform(url) {
  if (!url) return null;
  const u = String(url).toLowerCase();
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'B站';
  if (u.includes('douyin.com') || u.includes('iesdouyin.com')) return '抖音';
  return null;
}

function parseBiliMid(url) {
  // space.bilibili.com/123456  /  live.bilibili.com/123456  /  bilibili.com/123456
  const m = String(url).match(/bilibili\.com\/(\d{1,12})/);
  if (m) return m[1];
  return null; // 用户名形式（非数字 UID）暂不支持
}

async function fetchWithTimeout(url, opts, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchBili(mid) {
  try {
    const { mixinKey, buvid3 } = await getWbiKeys();
    const qs = encWbi({ mid: String(mid) }, mixinKey);
    const api = `https://api.bilibili.com/x/space/acc/info?${qs}`;
    const headers = { 'User-Agent': UA, 'Referer': 'https://space.bilibili.com/', 'Accept': 'application/json' };
    if (buvid3) headers['Cookie'] = 'buvid3=' + buvid3;
    const r = await fetchWithTimeout(api, { headers });
    const j = await r.json();
    if (j && j.code === 0 && j.data) {
      return { ok: true, name: j.data.name, fans: Number(j.data.follower) || 0, platform: 'B站' };
    }
    return { ok: false, error: 'bili api code ' + (j && j.code), platform: 'B站' };
  } catch (e) {
    return { ok: false, error: e.message, platform: 'B站' };
  }
}

async function fetchDouyin(url) {
  // best-effort：跟随短链拿到真实 user 页，尝试解析 SSR 渲染数据里的粉丝/昵称
  let realUrl = url;
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
    realUrl = r.url || url;
  } catch (e) { /* 忽略，用原链接继续 */ }
  try {
    const r2 = await fetchWithTimeout(realUrl, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
    const html = await r2.text();
    const m = html.match(/<script id="RENDER_DATA"[^>]*>([^<]*)<\/script>/);
    if (m) {
      const decoded = decodeURIComponent(m[1]);
      const fm = decoded.match(/"fansCount"\s*:\s*(\d+)/) || decoded.match(/"followerCount"\s*:\s*(\d+)/);
      const nm = decoded.match(/"nickname"\s*:\s*"([^"]+)"/) || decoded.match(/"uniqueId"\s*:\s*"([^"]+)"/);
      if (fm) return { ok: true, name: nm ? nm[1] : null, fans: Number(fm[1]) || 0, platform: '抖音' };
    }
  } catch (e) { /* 忽略 */ }
  return { ok: false, error: '抖音解析失败（反爬/需登录）', platform: '抖音' };
}

async function fetchProfile(url) {
  const platform = detectPlatform(url);
  if (!platform) return { ok: false, error: '无法识别平台', platform: null };
  if (platform === 'B站') {
    const mid = parseBiliMid(url);
    if (!mid) return { ok: false, error: 'B站链接未解析到 UID', platform };
    return await fetchBili(mid);
  }
  if (platform === '抖音') return await fetchDouyin(url);
  return { ok: false, error: '未支持平台', platform };
}

module.exports = { fetchProfile, detectPlatform };
