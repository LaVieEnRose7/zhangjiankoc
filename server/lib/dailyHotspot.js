/**
 * 今日热点每日快照：保证「每日仅抓取一次 + 分析一次」，结果落库持久化。
 *
 * - ensure(db, {force})：若当日快照已存在则直接返回；否则实时抓取热点 + 跑一次
 *   Gemini 分析，写入 daily_hotspot_snapshot 表。force=true 时忽略已有快照、重抓重分析。
 * - getSnapshot(db, {force})：对外统一入口，带「在途锁」避免并发重复抓取/重复烧 API。
 *
 * 设计目标：一天内无论前端刷新多少次、服务是否重启，今日工作页都只读同一份当日快照。
 */
const hotspotSource = require('./hotspotSource');
const ai = require('./ai');

/**
 * 受众相关度：过滤掉与《杖剑传说》用户明显无关的热点，按相关度排序（游戏/二次元类优先）。
 * - 与杖剑传说用户兴趣相关的词（游戏/二次元/泛娱乐/美妆/旅游/绘画/AIGC 等）加权累加得正分；
 * - 无任何兴趣命中且命中「软无关词」→ 排除；中性内容（无兴趣也无无关词）→ 也排除，避免无关噪音；
 * - 有兴趣命中时，仅遇「强硬新闻/时政/社会事件」词才排除（允许"游戏新闻""版号政策"这类）。
 */
const INTERESTS = [
  // 游戏 / 二次元（高权重）
  { k: '游戏', w: 3 }, { k: '手游', w: 3 }, { k: '端游', w: 3 }, { k: '主机', w: 3 }, { k: 'switch', w: 3 }, { k: 'ps5', w: 3 }, { k: 'steam', w: 3 },
  { k: '攻略', w: 3 }, { k: '电竞', w: 3 }, { k: '直播', w: 2 }, { k: '速通', w: 3 }, { k: 'mod', w: 2 }, { k: 'dlc', w: 2 }, { k: '副本', w: 3 }, { k: '坐骑', w: 3 }, { k: '抽卡', w: 3 }, { k: '氪', w: 2 }, { k: '公测', w: 3 }, { k: '内测', w: 3 }, { k: '开服', w: 3 },
  { k: '二次元', w: 3 }, { k: '动漫', w: 3 }, { k: '番剧', w: 3 }, { k: '漫画', w: 2 }, { k: '动画', w: 2 }, { k: '国漫', w: 3 }, { k: 'acg', w: 3 }, { k: 'cos', w: 3 }, { k: '手办', w: 2 }, { k: '同人', w: 2 }, { k: '二创', w: 2 }, { k: '声优', w: 2 }, { k: '配音', w: 2 }, { k: '鬼畜', w: 2 },
  // 泛娱乐 / 创作 / 生活
  { k: 'up主', w: 2 }, { k: 'vlog', w: 2 }, { k: '整活', w: 2 }, { k: '搞笑', w: 1 }, { k: '萌宠', w: 1 }, { k: '美食', w: 1 }, { k: '探店', w: 1 }, { k: '旅游', w: 2 }, { k: '旅行', w: 2 }, { k: '穿搭', w: 1 }, { k: '时尚', w: 1 }, { k: '美妆', w: 2 }, { k: '护肤', w: 1 }, { k: '化妆', w: 1 }, { k: '综艺', w: 1 }, { k: '影视', w: 1 }, { k: '电影', w: 1 }, { k: '电视剧', w: 1 }, { k: '短剧', w: 1 }, { k: '剧', w: 1 }, { k: '挑战', w: 1 }, { k: '变装', w: 1 }, { k: '卡点', w: 1 },
  { k: '绘画', w: 2 }, { k: '插画', w: 2 }, { k: '手绘', w: 2 }, { k: '板绘', w: 2 }, { k: '色彩', w: 2 }, { k: '设计', w: 1 }, { k: '摄影', w: 1 }, { k: '场景', w: 2 }, { k: '建模', w: 2 }, { k: '特效', w: 1 }, { k: '短片', w: 1 },
  { k: '音乐', w: 1 }, { k: '翻唱', w: 1 }, { k: '舞蹈', w: 1 }, { k: '街舞', w: 1 }, { k: '说唱', w: 1 }, { k: 'hiphop', w: 1 },
  // 科技 / AIGC
  { k: '科技', w: 2 }, { k: '数码', w: 2 }, { k: 'aigc', w: 3 }, { k: 'ai', w: 2 }, { k: '人工智能', w: 2 }, { k: '大模型', w: 2 }, { k: '3d', w: 2 }, { k: '剪辑', w: 1 }, { k: '后期', w: 1 },
  // 知识 / 文化 / 其他
  { k: '知识', w: 1 }, { k: '科普', w: 1 }, { k: '学习', w: 1 }, { k: '校园', w: 1 }, { k: '职场', w: 1 }, { k: '情感', w: 1 }, { k: '剧情', w: 1 }, { k: '悬疑', w: 1 }, { k: '治愈', w: 1 }, { k: '国风', w: 2 }, { k: '汉服', w: 2 }, { k: '古风', w: 2 }, { k: '手工', w: 1 }, { k: 'diy', w: 1 }, { k: '编程', w: 1 }, { k: '代码', w: 1 }, { k: '开源', w: 1 }, { k: '健身', w: 1 }
];
// 软无关词：仅在没有兴趣命中时才排除（避免误伤"游戏新闻"等）
const SOFT_EXCLUDE = ['新闻', '时政', '政治', '政策', '主席', '总理', '书记', '地震', '台风', '洪水', '暴雨', '暴雪', '疫情', '病毒', '确诊', '无症状', '股票', '股市', '证券', '基金', '期货', '房产', '楼市', '中考', '高考', '考研', '军事', '战争', '导弹', '制裁', '冲突', '演习', '事故', '遇难', '去世', '讣告', '辟谣', '通报', '处罚', '逮捕', '起诉', '判决', '勒索', '诈骗'];
// 强无关词：即使有兴趣命中也排除（硬新闻/时政/社会事件）
const HARD_EXCLUDE = ['时政', '政治', '主席', '总理', '书记', '地震', '台风', '洪水', '疫情', '确诊', '股票', '股市', '证券', '军事', '战争', '导弹', '制裁', '冲突', '演习', '事故', '遇难', '去世', '讣告', '逮捕', '起诉', '判决', '勒索', '诈骗'];
const GENERIC_CASE_WORDS = new Set(['游戏', '手游', '端游', '直播', '剧情', '角色', '活动', '挑战', '搞笑', '整活', '测评', '攻略', '视频']);

function relevanceScore(title) {
  if (!title) return 0;
  const t = String(title).toLowerCase();
  let s = 0;
  for (const it of INTERESTS) { if (t.indexOf(it.k) !== -1) s += it.w; }
  if (s <= 0) {
    for (const e of SOFT_EXCLUDE) { if (t.indexOf(e) !== -1) return -1; }
    return 0; // 中性、无兴趣也无排除 → 排除
  }
  for (const e of HARD_EXCLUDE) { if (t.indexOf(e) !== -1) return -1; }
  return s;
}

// 过滤掉无关热点，按相关度从高到低排序（游戏/二次元类排前）
function filterRelevant(list, db = null) {
  const scored = [];
  const caseTexts = db ? db.prepare(`SELECT title,copy,summary,content_type,play_method,topic_tags,play_count,result
      FROM cases WHERE play_count>0 AND source='项目执行结果'`).all()
    .map(row => ({
      text: `${row.title || ''} ${row.copy || ''} ${row.summary || ''} ${row.content_type || ''} ${row.play_method || ''} ${row.topic_tags || ''}`.toLowerCase(),
      weight: ['爆款', '良好', '高表现'].includes(row.result) ? 2 : 1,
      play: Number(row.play_count) || 0
    })) : [];
  for (const h of (list || [])) {
    // 垂类游戏榜内容天然具备游戏相关性；综合榜仍需关键词验证。
    const s = h.gameVertical ? Math.max(6, relevanceScore(h.title)) : relevanceScore(h.title);
    if (s > 0) {
      const title = String(h.title || '').toLowerCase();
      const words = INTERESTS.filter(item => item.w >= 2 && title.includes(item.k) && !GENERIC_CASE_WORDS.has(item.k)).map(item => item.k);
      const matches = caseTexts.filter(item => words.some(word => item.text.includes(word)));
      const caseHits = matches.length;
      const successfulCaseCount = matches.filter(item => item.weight > 1).length;
      const caseScore = matches.reduce((sum, item) => sum + item.weight + Math.min(2, Math.log10(Math.max(1, item.play)) / 3), 0);
      const heatScore = Math.max(0, 8 - Math.log2(Math.max(1, Number(h.rank) || 100)));
      const totalScore = s * 4 + Math.min(24, caseScore * 2) + heatScore;
      scored.push({ h: { ...h, relevanceScore: s, similarCaseCount: caseHits, successfulCaseCount, candidateScore: Math.round(totalScore * 10) / 10 }, s: totalScore });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  // 主池按综合分优先；另为每个平台保留少量榜单探索项，提升覆盖且避免单平台霸榜。
  const primary = scored.slice(0, 80);
  const picked = new Set(primary.map(item => item.h.id || `${item.h.source}-${item.h.title}`));
  for (const source of ['抖音', 'B站']) {
    const explorers = scored.filter(item => item.h.source === source && !picked.has(item.h.id || `${item.h.source}-${item.h.title}`))
      .sort((a, b) => (Number(a.h.rank) || 999) - (Number(b.h.rank) || 999)).slice(0, 10);
    for (const item of explorers) { primary.push(item); picked.add(item.h.id || `${item.h.source}-${item.h.title}`); }
  }
  return primary.sort((a, b) => b.s - a.s).map(x => x.h);
}

function dateOnly(d) { return d.toISOString().slice(0, 10); }

function buildGameContext(camp) {
  if (!camp) return '《杖剑传说》是一款剑与魔法的奇幻题材手游，适合测评/攻略/剧情/二创/整活类 KOC 内容。';
  return `《${camp.game_name || '杖剑传说'}》是一款奇幻题材手游。当前任务：${camp.name}；版本/活动：${camp.version_event || '—'}；目标：${camp.goal || '—'}；重点内容：${camp.focus_content || '—'}；期望方向：${camp.content_directions || '—'}。游戏卖点：剑与魔法的奇幻冒险、职业/坐骑/副本/剧情、二创与整活空间大、适合测评/攻略/情怀向内容。`;
}

async function generate(db, { force } = {}) {
  if (force) hotspotSource.invalidate(); // 强制时先清空热点源内存缓存，确保真正重抓
  const hs = await hotspotSource.getHotspots(150);
  // 每源最多抓 150 条，再按游戏相关度、历史落地案例与热度综合排序。
  const list = filterRelevant(hs.list || [], db);
  const camp = db.prepare("SELECT * FROM campaigns WHERE status='执行中' ORDER BY (is_current=1) DESC, id DESC LIMIT 1").get();
  const recos = await ai.recommendOpportunities({ hotspots: list, gameContext: buildGameContext(camp), topN: 20 });
  const now = new Date().toISOString();
  const snap = {
    snap_date: dateOnly(new Date()),
    hotspots_json: JSON.stringify(list),
    recommendations_json: JSON.stringify(recos),
    source_status_json: JSON.stringify(hs.sourceStatus || {}),
    fetched_at: hs.fetchedAt || now,
    analyzed_at: now
  };
  db.prepare(`INSERT OR REPLACE INTO daily_hotspot_snapshot
    (snap_date, hotspots_json, recommendations_json, source_status_json, fetched_at, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      snap.snap_date, snap.hotspots_json, snap.recommendations_json,
      snap.source_status_json, snap.fetched_at, snap.analyzed_at);
  return snap;
}

async function ensure(db, { force } = {}) {
  const today = dateOnly(new Date());
  if (!force) {
    const row = db.prepare('SELECT * FROM daily_hotspot_snapshot WHERE snap_date=?').get(today);
    if (row) return row;
  }
  return await generate(db, { force });
}

// 在途锁：同一时刻只跑一个 generate，其余请求复用其结果，避免并发重复烧 API
let inFlight = null;
function getSnapshot(db, { force } = {}) {
  if (inFlight) {
    return (async () => {
      try { await inFlight; } catch (e) { /* 忽略，下面按需重抓 */ }
      if (!force) {
        const row = db.prepare('SELECT * FROM daily_hotspot_snapshot WHERE snap_date=?').get(dateOnly(new Date()));
        if (row) return row;
      }
      return await generate(db, { force });
    })();
  }
  inFlight = (async () => {
    try { return await ensure(db, { force }); }
    finally { inFlight = null; }
  })();
  return inFlight;
}

module.exports = { getSnapshot, generate, ensure, dateOnly, filterRelevant, relevanceScore };
