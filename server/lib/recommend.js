/**
 * 规则推荐/打分引擎（AI不可用时的兜底，也用于今日工作的机会推荐）
 * 打分维度：
 *  A 热点热度与趋势        (0-25)
 *  B 与营销任务关键词匹配   (0-30)
 *  C 历史案例题材表现       (0-25)
 *  D 团队经验加/降权        (-20 ~ +20)
 */
const { getDb } = require('../db/database');

function tokenize(str) {
  return (str || '').split(/[,，、\s/|]+/).map(s => s.trim()).filter(s => s.length >= 2);
}

function textHasAny(text, words) {
  const t = (text || '').toLowerCase();
  return words.filter(w => t.includes(w.toLowerCase()));
}

function parseJson(s, fallback) {
  if (!s) return fallback;
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : fallback; }
  catch (e) { return fallback; }
}

// 限制与风险规则：可自动识别的维度（其余维度为人工核对红线，不自动扣分）
// 注意：detect 必须返回布尔值（textHasAny 返回数组，空数组在 JS 里为真值，需显式判断 .length）
const RISK_DEFS = [
  { key: 'opinion', label: '舆情风险', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['争议', '绯闻', '负面', '吐槽', '差评', '维权']).length > 0 && !/竞品/.test(h.title || '') },
  { key: 'copyright', label: '版权风险', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['搬运', '盗用', '抄袭', '侵权', '未授权']).length > 0 },
  { key: 'ip_unauth', label: '未授权IP使用', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['未授权', '侵权', '盗用IP']).length > 0 },
  { key: 'exaggerate', label: '过度夸大宣传', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['暴涨', '必看', '最强', '逆天', '百分百', '保证', '稳赚', '封神', '神作']).length > 0 },
  { key: 'platform_rule', label: '不符合平台规则', detect: h => (h.category === '泛娱乐' || h.category === '社会热点' || h.trend === '下降') },
  { key: 'real_person', label: '过度依赖真人拍摄', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['真人', '实拍', '拍摄', '露脸', '出镜']).length > 0 },
  { key: 'outdated', label: '已经过时的热点', detect: h => (h.trend === '下降' || (h.valid_until && new Date(h.valid_until) < new Date()) || (h.heat || 0) < 50) }
];
const MANUAL_RISK = { char_error: '角色设定错误', high_cost: '制作成本过高', koc_mismatch: '不适合KOC能力的玩法' };

/** 评估热点命中的风险规则；返回 {blocked, hits:[{key,label,level,manual}]} */
function evaluateRisk(hotspot, campaign) {
  const rules = parseJson(campaign && campaign.risk_rules, null);
  const hits = [];
  if (rules) {
    for (const def of RISK_DEFS) {
      const lvl = rules[def.key];
      if (!lvl || lvl === 'off') continue;
      if (def.detect(hotspot)) hits.push({ key: def.key, label: def.label, level: lvl });
    }
    for (const k of Object.keys(MANUAL_RISK)) {
      const lvl = rules[k];
      if (lvl && lvl !== 'off') hits.push({ key: k, label: MANUAL_RISK[k], level: lvl, manual: true });
    }
  }
  const blocked = hits.some(h => h.level === 'forbid' && !h.manual);
  return { blocked, hits };
}

/** 取"作为业务背景"的任务：优先用当前任务(is_current)，否则取所有执行中任务 */
function activeCampaigns(db) {
  const cur = db.prepare("SELECT * FROM campaigns WHERE is_current=1 LIMIT 1").get();
  if (cur) return [cur];
  return db.prepare("SELECT * FROM campaigns WHERE status='执行中' ORDER BY (priority='高') DESC, end_date ASC").all();
}

/** 对一个热点(或机会标题)进行规则打分 */
function scoreHotspot(hotspot, campaign) {
  const db = getDb();
  const detail = [];
  let score = 0;

  // A 热度与趋势
  const heat = Math.min(hotspot.heat || 0, 100);
  let a = Math.round(heat * 0.2); // 0-20
  if (hotspot.trend === '上升') a += 5;
  if (hotspot.trend === '下降') a -= 5;
  a = Math.max(0, Math.min(25, a));
  score += a;
  detail.push({ dim: '热度趋势', score: a, max: 25, note: `热度${hotspot.heat}/${hotspot.trend}` });

  // B 任务关键词匹配
  const text = `${hotspot.title} ${hotspot.description || ''} ${hotspot.tags || ''}`;
  let b = 0, bNote = '未关联任务';
  if (campaign) {
    const kws = tokenize(campaign.keywords).concat(tokenize(campaign.content_directions));
    const hits = textHasAny(text, kws);
    b = Math.min(30, hits.length * 10);
    bNote = hits.length ? `命中关键词: ${hits.slice(0, 4).join('、')}` : '与任务关键词无匹配';
  }
  score += b;
  detail.push({ dim: '任务匹配', score: b, max: 30, note: bNote });

  // C 历史案例题材表现
  const hotTags = tokenize(hotspot.tags).concat(tokenize(hotspot.title));
  const allCases = db.prepare('SELECT * FROM cases').all();
  let bestRoi = null, hitCase = null;
  for (const c of allCases) {
    const caseTags = tokenize(c.topic_tags).concat(tokenize(c.content_type));
    const overlap = hotTags.filter(t => caseTags.some(ct => ct.includes(t) || t.includes(ct)));
    if (overlap.length > 0 && c.roi_d7 != null) {
      if (bestRoi === null || c.roi_d7 > bestRoi) { bestRoi = c.roi_d7; hitCase = c; }
    }
  }
  let cScore = 10, cNote = '无相似历史案例（中性）';
  if (bestRoi !== null) {
    if (bestRoi >= 1.2) { cScore = 25; cNote = `相似案例《${hitCase.title.slice(0, 14)}…》ROI7=${bestRoi}，表现优秀`; }
    else if (bestRoi >= 0.8) { cScore = 18; cNote = `相似案例ROI7=${bestRoi}，达标`; }
    else { cScore = 5; cNote = `相似案例ROI7=${bestRoi}，历史表现不佳`; }
  }
  score += cScore;
  detail.push({ dim: '历史案例', score: cScore, max: 25, note: cNote });

  // D 经验加降权
  const exps = db.prepare("SELECT * FROM experiences WHERE status='已确认'").all();
  let d = 0; const dNotes = [];
  for (const e of exps) {
    const ekws = tokenize(e.keywords);
    const hits = textHasAny(text, ekws);
    if (hits.length > 0) {
      d += e.boost > 0 ? 10 : -10;
      dNotes.push(`${e.boost > 0 ? '+' : '-'}[${e.category}]${e.content.slice(0, 24)}…`);
    }
  }
  d = Math.max(-20, Math.min(20, d));
  score += d;
  detail.push({ dim: '经验反哺', score: d, max: 20, note: dNotes.join('；') || '无匹配经验' });

  // E 推荐偏好加权（campaign.prefs）
  let e = 0; const eNotes = [];
  if (campaign && campaign.prefs) {
    const prefs = parseJson(campaign.prefs, null);
    if (prefs) {
      const t2 = `${hotspot.platform} ${hotspot.title} ${hotspot.tags || ''} ${hotspot.description || ''}`.toLowerCase();
      if (prefs.platform && prefs.platform.length && prefs.platform.map(p => p.toLowerCase()).includes((hotspot.platform || '').toLowerCase())) { e += 5; eNotes.push('命中优先平台'); }
      if (prefs.content_form && prefs.content_form.length) {
        const hf = prefs.content_form.filter(f => t2.includes(f.toLowerCase()));
        if (hf.length) { e += Math.min(6, hf.length * 3); eNotes.push(`命中优先内容形式:${hf.join('/')}`); }
      }
      if (prefs.play_method && prefs.play_method.length) {
        const hp = prefs.play_method.filter(p => t2.includes(p.toLowerCase()));
        if (hp.length) { e += Math.min(6, hp.length * 3); eNotes.push(`命中优先玩法:${hp.join('/')}`); }
      }
      if (prefs.require_case && bestRoi === null) { e -= 8; eNotes.push('要求成功案例但无相似案例'); }
      if (prefs.same_day && hotspot.valid_until) {
        const days = Math.round((new Date(hotspot.valid_until).getTime() - Date.now()) / 86400000);
        if (days >= 0 && days <= 1) { e += 3; eNotes.push('可当天/近期发布'); }
      }
    }
  }
  e = Math.max(-12, Math.min(15, e));
  score += e;
  detail.push({ dim: '推荐偏好', score: e, max: 15, note: eNotes.join('；') || '无偏好匹配' });

  // F 限制与风险规则（campaign.risk_rules）
  let f = 0; const fNotes = [];
  if (campaign) {
    const risk = evaluateRisk(hotspot, campaign);
    risk.hits.filter(h => h.level === 'caution' && !h.manual).forEach(h => { f -= 12; fNotes.push(`谨慎:${h.label}`); });
    risk.hits.filter(h => h.level === 'forbid' && !h.manual).forEach(h => { f -= 40; fNotes.push(`红线:${h.label}`); });
    risk.hits.filter(h => h.manual).forEach(h => { fNotes.push(`人工核对:${h.label}(${h.level === 'forbid' ? '禁止' : '谨慎'})`); });
    if (risk.hits.some(h => h.level === 'forbid' && !h.manual)) score = Math.min(score, 15);
  }
  f = Math.max(-40, Math.min(0, f));
  score += f;
  detail.push({ dim: '风险规则', score: f, max: 40, note: fNotes.join('；') || '无触发' });

  score = Math.max(0, Math.min(100, score));
  let verdict = '谨慎观察';
  if (score >= 70) verdict = '值得做';
  else if (score < 45) verdict = '不建议做';
  return { score, verdict, detail };
}

/** 为机会推荐创作者（规则）*/
function recommendCreators(opportunity, hotspot, campaign, limit = 3) {
  const db = getDb();
  const creators = db.prepare("SELECT * FROM creators WHERE status IN ('可合作','合作中')").all();
  const text = `${opportunity?.title || ''} ${opportunity?.direction || ''} ${hotspot?.title || ''} ${hotspot?.tags || ''} ${campaign?.content_directions || ''}`;
  const scored = creators.map(c => {
    let s = 0; const why = [];
    const cats = tokenize(c.categories);
    const hits = textHasAny(text, cats);
    if (hits.length) { s += hits.length * 20; why.push(`擅长${hits.join('/')}`); }
    if (c.avg_roi7 != null) {
      if (c.avg_roi7 >= 1.2) { s += 25; why.push(`历史ROI7=${c.avg_roi7}优秀`); }
      else if (c.avg_roi7 >= 0.8) { s += 15; why.push(`历史ROI7=${c.avg_roi7}达标`); }
      else { s -= 10; why.push(`历史ROI7=${c.avg_roi7}偏低`); }
    }
    if (c.avg_activation != null && c.avg_activation >= 3) { s += 10; why.push(`激活率${c.avg_activation}%`); }
    if (c.avg_play >= 50000) s += 5;
    return { creator: c, score: s, reason: why.join('，') || '基础数据一般' };
  }).filter(x => x.score > 0).sort((x, y) => y.score - x.score);
  return scored.slice(0, limit);
}

/** 今日推荐：对所有候选热点打分排序 */
function dailyRecommendations() {
  const db = getDb();
  const hotspots = db.prepare("SELECT * FROM hotspots WHERE status='候选' ORDER BY heat DESC").all();
  const campaigns = activeCampaigns(db);
  const results = [];
  for (const h of hotspots) {
    let best = null, bestCamp = null;
    if (campaigns.length === 0) {
      best = scoreHotspot(h, null);
    } else {
      for (const c of campaigns) {
        const r = scoreHotspot(h, c);
        if (!best || r.score > best.score) { best = r; bestCamp = c; }
      }
    }
    results.push({ hotspot: h, campaign: bestCamp ? { id: bestCamp.id, name: bestCamp.name } : null, ...best });
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * 实时生成「今日推荐机会」卡片所需字段（不落库）。
 * 结合候选热点 + 营销任务 + 创作者，给出玩法/结合方式/成本/时间/风险等。
 * aiDraft 存在时（用户点过「重新分析」），用 AI 生成内容覆盖规则默认。
 */
function buildRecommendation(hotspot, campaign, creators, aiDraft) {
  const score = scoreHotspot(hotspot, campaign);
  const matched = recommendCreators(hotspot, hotspot, campaign, 3);
  const types = new Set();
  matched.forEach(m => (m.creator.categories || '').split(/[,，]/).forEach(t => { t = t.trim(); if (t) types.add(t); }));
  const costEst = matched.length ? Math.round(matched.reduce((s, m) => s + (m.creator.price || 0), 0) / matched.length) : null;

  let play_method, game_combo, risk_note, reason;
  if (aiDraft && (aiDraft.play_method || aiDraft.game_combo)) {
    play_method = aiDraft.play_method;
    game_combo = aiDraft.game_combo;
    risk_note = aiDraft.risk_note;
    reason = aiDraft.reason;
  } else {
    const t = (hotspot.title + ' ' + (hotspot.tags || '')).toLowerCase();
    if (hotspot.category === '游戏内') play_method = '版本玩法深度解析 + 实操演示，优先攻略/测评形式';
    else if (hotspot.category === '泛游戏') play_method = '热点梗二次创作 + 游戏自然植入，整活/挑战类更易传播';
    else play_method = '情怀/话题向内容 + 游戏彩蛋植入，弱引导不硬广';
    const focus = campaign ? (campaign.focus_content || campaign.content_directions || '') : '';
    const form = [...types].slice(0, 2).join('/') || '攻略';
    game_combo = `将《杖剑传说》${focus} 与热点「${hotspot.title}」结合，以 ${form} 形式呈现`;
    risk_note = hotspot.risk_note || (score.score < 45 ? '热点关联度偏低，建议谨慎' : '常规风险，注意内容合规与平台规范');
    reason = score.detail.map(x => `${x.dim} ${x.score}分`).join('｜');
  }

  const risk_level = score.score >= 70 ? '低' : score.score >= 45 ? '中' : '高';
  const suggested_time = hotspot.valid_until ? `建议在 ${hotspot.valid_until} 前启动` : '建议尽快确认执行时间';

  // 风险规则注入：被红线命中则强制高风险，并在风险说明中标注
  const riskInfo = campaign ? evaluateRisk(hotspot, campaign) : { blocked: false, hits: [] };
  if (riskInfo.blocked) risk_level = '高';
  const riskTags = riskInfo.hits.filter(h => !h.manual).map(h => `[${h.level === 'forbid' ? '禁止' : '谨慎'}]${h.label}`);
  if (riskTags.length) risk_note = (risk_note ? risk_note + '；' : '') + '风险规则：' + riskTags.join('、');

  return {
    hotspot_id: hotspot.id,
    hotspot_title: hotspot.title,
    hotspot_source: hotspot.source_label || hotspot.platform,
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
    score: score.score,
    verdict: score.verdict,
    play_method,
    game_combo,
    reason,
    creator_types: [...types],
    matched_creators: matched.map(m => ({ id: m.creator.id, name: m.creator.name, score: m.score, reason: m.reason, price: m.creator.price })),
    cost_estimate: costEst,
    suggested_time,
    risk_level,
    risk_note
  };
}

/**
 * 对单条热点执行宣发适配筛查（自动抓取仅提供候选，此函数负责过滤不合规内容）。
 * 用营销任务关键词 + 可配置黑名单判定 符合/待定/不符合。
 */
function screenHotspotById(db, h) {
  const setRow = db.prepare('UPDATE hotspots SET screen_result=?,screen_reason=?,relevance=? WHERE id=?');
  const blRow = db.prepare("SELECT value FROM settings WHERE key='screen_blacklist'").get();
  const bl = (blRow && blRow.value)
    ? blRow.value.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)
    : ['争议', '绯闻', '政治', '擦边', '社会负面'];
  const camps = activeCampaigns(db);
  const kws = new Set();
  camps.forEach(c => (c.keywords || '').split(/[,，、\s/]+/).forEach(k => { k = k.trim().toLowerCase(); if (k.length >= 2) kws.add(k); }));
  const text = `${h.title} ${h.description || ''} ${h.tags || ''}`.toLowerCase();
  let result = '待定', reason = '泛娱乐/社会热点，需人工判断是否与游戏宣发相关';
  if (h.category === '游戏内') { result = '符合'; reason = '游戏内原生热点，与版本宣发高度贴合'; }
  else if (h.category === '泛游戏') { result = '符合'; reason = '泛游戏热点，易植入游戏内容'; }
  else {
    const hit = [...kws].filter(k => text.includes(k));
    if (hit.length) { result = '待定'; reason = `泛娱乐/社会热点但命中任务关键词(${hit.slice(0, 3).join('/')})，需人工判断`; }
    else { result = '不符合'; reason = '与当前游戏宣发关联弱，建议不采用'; }
  }
  if (result !== '不符合') {
    const bad = bl.filter(b => text.includes(b));
    if (bad.length) { result = '不符合'; reason = `含疑似不适配宣发的内容(${bad.join('/')})，已标记筛查不通过`; }
  }
  const rel = result === '符合' ? '强' : result === '待定' ? '中' : '弱';
  setRow.run(result, reason, rel, h.id);
  return { screen_result: result, screen_reason: reason, relevance: rel };
}

module.exports = { scoreHotspot, recommendCreators, dailyRecommendations, buildRecommendation, screenHotspotById, evaluateRisk, activeCampaigns, parseJson, tokenize };
