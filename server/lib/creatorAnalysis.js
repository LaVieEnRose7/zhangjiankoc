/**
 * 创作者库分析引擎（V3）
 * - 历史发布与表现：executions(已发布/数据回收) + 项目执行案例，按平台分开展示
 * - 创作趋势：尝试新玩法 / 攻略转剧情 / AI内容 / 素材重复 / 质量下降 / 新方向磨合期
 * - 系统合作建议：结合「当前任务偏好」+「未关闭机会匹配」，给出带依据的建议（不自动决定去留）
 * 所有分析实时计算，不落库（符合"系统不自动决定创作者去留"）。
 */
function parseJson(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function mean(arr) {
  const a = arr.filter(x => x !== null && x !== undefined && !isNaN(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
function median(arr) {
  const a = arr.filter(x => x !== null && x !== undefined && !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
function uniq(arr) { return [...new Set(arr.map(String).filter(Boolean))]; }
function round1(n) { return n == null ? null : Math.round(n * 100) / 100; }
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }

// 把玩法/内容归类为大内容类型，供趋势与分平台分析使用
function classify(play, contentType) {
  const s = `${play || ''} ${contentType || ''}`;
  if (/剧情|情怀|故事|情感/.test(s)) return '剧情';
  if (/攻略|测评|速通|养成|强度|配装/.test(s)) return '攻略';
  if (/整活|梗|挑战|玩梗|搞笑/.test(s)) return '整活';
  if (/解说|快节奏|盘点|杂谈/.test(s)) return '解说';
  if (/切片|搬运/.test(s)) return '切片';
  return '其他';
}
function parseCycle(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function currentCampaign(db) {
  let c = db.prepare("SELECT * FROM campaigns WHERE is_current=1").get();
  if (!c) c = db.prepare("SELECT * FROM campaigns WHERE status='执行中' ORDER BY (priority='高') DESC, end_date ASC LIMIT 1").get();
  return c || null;
}

// 统一历史内容：执行记录(已发布/数据回收) + 项目执行案例
function getHistory(db, creator, primaryPlatform) {
  const ex = db.prepare(`
    SELECT e.id, e.opportunity_id, e.creator_id, e.creator_name, e.stage, e.publish_date,
           e.play_count, e.like_count, e.comment_count, e.activation_d1, e.roi_d7, e.cost, e.exec_play_method, e.note,
           o.platform AS opp_platform, o.campaign_id AS campaign_id, o.title AS opp_title
    FROM executions e LEFT JOIN opportunities o ON e.opportunity_id = o.id
    WHERE (e.creator_id=? OR (e.creator_id IS NULL AND e.creator_name=?)) AND e.stage IN ('已发布','数据回收')
    ORDER BY e.publish_date`).all(creator.id, creator.name);
  const exItems = ex.map(r => ({
    src: 'exec', id: r.id, opp_id: r.opportunity_id, date: r.publish_date, platform: r.opp_platform || primaryPlatform,
    play_method: r.exec_play_method || '', content_type: classify(r.exec_play_method), play_count: r.play_count,
    like_count: r.like_count, comment_count: r.comment_count, activation_d1: r.activation_d1, roi_d7: r.roi_d7,
    cost: r.cost, campaign_id: r.campaign_id, campaign_name: null, title: r.opp_title, note: r.note
  }));
  const cs = db.prepare(`SELECT * FROM cases WHERE source='项目执行结果' AND (creator_id=? OR (creator_id IS NULL AND creator_name=?)) AND play_count>0`).all(creator.id, creator.name);
  const csItems = cs.map(r => ({
    src: 'case', id: r.id, opp_id: r.linked_opportunity_id, date: r.publish_date, platform: r.platform,
    play_method: r.play_method || '', content_type: r.content_type || classify(r.play_method), play_count: r.play_count,
    like_count: r.like_count, comment_count: r.comment_count, activation_d1: r.activation_d1, roi_d7: r.roi_d7,
    cost: r.cost, campaign_id: r.campaign_id, campaign_name: r.campaign_name, title: r.title, note: r.summary
  }));
  return [...exItems, ...csItems];
}

// 合作执行记录（所有阶段）
function getExecRecords(db, creator) {
  return db.prepare(`SELECT e.*, o.title AS opp_title, o.campaign_id AS campaign_id
    FROM executions e LEFT JOIN opportunities o ON e.opportunity_id = o.id
    WHERE (e.creator_id=? OR (e.creator_id IS NULL AND e.creator_name=?))
    ORDER BY e.publish_date DESC, e.id DESC`).all(creator.id, creator.name);
}

function computeTrends(history) {
  const sorted = [...history].filter(h => h.date).sort((a, b) => a.date < b.date ? -1 : 1);
  const signals = [];
  if (sorted.length >= 2) {
    const mid = Math.floor(sorted.length / 2);
    const older = sorted.slice(0, mid), recent = sorted.slice(mid);
    const olderTypes = uniq(older.map(h => classify(h.play_method, h.content_type)));
    const recentTypes = uniq(recent.map(h => classify(h.play_method, h.content_type)));
    const newT = recentTypes.filter(t => !olderTypes.includes(t) && t !== '其他');
    if (newT.length) signals.push({ type: 'new_play', label: '尝试新玩法', detected: true, level: 'info', evidence: `近期出现新内容类型：${newT.join('/')}（此前主要为 ${olderTypes.filter(t => t !== '其他').join('/') || '—'}）` });
    const olderGong = older.filter(h => classify(h.play_method, h.content_type) === '攻略').length / older.length;
    const recentJu = recent.filter(h => classify(h.play_method, h.content_type) === '剧情').length / recent.length;
    if (olderGong >= 0.5 && recentJu >= 0.4) signals.push({ type: 'to_story', label: '从攻略转向剧情', detected: true, level: 'info', evidence: `前期攻略占比 ${Math.round(olderGong * 100)}%，近期剧情占比 ${Math.round(recentJu * 100)}%` });
    const recentPlays = recent.map(h => (h.play_method || '').trim()).filter(Boolean);
    const dup = recentPlays.length - uniq(recentPlays).length;
    if (recentPlays.length >= 2 && dup >= 1) signals.push({ type: 'repeat', label: '素材重复', detected: true, level: 'warn', evidence: `近期存在重复玩法：${recentPlays.join(' / ')}` });
    const oPlay = mean(older.map(h => h.play_count)), rPlay = mean(recent.map(h => h.play_count));
    const oRoi = mean(older.map(h => h.roi_d7)), rRoi = mean(recent.map(h => h.roi_d7));
    if (oPlay && rPlay != null && rPlay < oPlay * 0.7) signals.push({ type: 'quality_drop', label: '内容质量下降', detected: true, level: 'warn', evidence: `近期平均播放 ${fmt(rPlay)} 较前期 ${fmt(oPlay)} 明显下滑` });
    else if (oRoi != null && rRoi != null && rRoi < oRoi * 0.7) signals.push({ type: 'quality_drop', label: '内容质量下降', detected: true, level: 'warn', evidence: `近期平均 ROI ${round1(rRoi)} 较前期 ${round1(oRoi)} 明显下滑` });
    if (newT.length && ((rPlay != null && oPlay && rPlay < oPlay) || (rRoi != null && oRoi && rRoi < oRoi))) signals.push({ type: 'honeymoon', label: '新方向磨合期', detected: true, level: 'warn', evidence: '新玩法尝试期数据略低于自身基线，处于磨合期' });
    const aiHit = sorted.some(h => /AI|人工智能|生成式|AIGC/i.test(`${h.play_method || ''} ${h.note || ''}`));
    if (aiHit) signals.push({ type: 'ai', label: '开始使用 AI 内容', detected: true, level: 'info', evidence: '历史内容中检测到 AI 相关玩法/素材' });
  }
  return signals;
}

function computeRecentTrend(history) {
  const sorted = history.filter(h => h.date && h.play_count).sort((a, b) => a.date < b.date ? -1 : 1);
  if (sorted.length < 3) return '样本不足';
  const mid = Math.floor(sorted.length / 2);
  const o = mean(sorted.slice(0, mid).map(h => h.play_count));
  const r = mean(sorted.slice(mid).map(h => h.play_count));
  if (o == null || r == null) return '样本不足';
  if (r >= o * 1.15) return '上升';
  if (r <= o * 0.85) return '下降';
  return '平稳';
}

// 当前任务适配度（平台/方向/成本/周期）
function fitCampaign(creator, camp, platforms) {
  const prefs = parseJson(camp.prefs, {});
  const reasons = [];
  let ok = true;
  if (prefs.platform && prefs.platform.length) {
    const hitPlat = prefs.platform.filter(p => (platforms || []).includes(p));
    if (hitPlat.length) reasons.push(`平台匹配（${hitPlat.join('/')} ∈ 当前任务优先平台）`);
    else { ok = false; reasons.push(`平台不匹配（当前任务优先 ${prefs.platform.join('/')}，创作者平台：${(platforms || []).join('/') || '—'}）`); }
  }
  const creatorTags = uniq([].concat(
    (creator.categories || '').split(/[,，]/),
    (creator.content_type || '').split(/[,，]/),
    (creator.good_play || '').split(/[,，]/)
  ));
  const want = uniq([].concat(prefs.creator_type || [], prefs.content_form || [], prefs.play_method || []));
  const hit = want.filter(w => creatorTags.some(t => t && (t.includes(w) || w.includes(t))));
  if (want.length) {
    if (hit.length) reasons.push(`擅长方向命中当前任务偏好：${hit.slice(0, 3).join('/')}`);
    else reasons.push(`擅长方向未直接命中当前任务偏好（${want.slice(0, 3).join('/')}）`);
  }
  if (prefs.cost && creator.cost_ceiling != null) {
    if (creator.cost_ceiling >= prefs.cost) reasons.push(`成本可控（上限 ¥${creator.cost_ceiling} ≥ 任务预算 ¥${prefs.cost}）`);
    else { ok = false; reasons.push(`成本超预算（上限 ¥${creator.cost_ceiling} < 任务 ¥${prefs.cost}）`); }
  }
  if (prefs.cycle && creator.avg_cycle_days != null) {
    const d = parseCycle(prefs.cycle);
    if (d) {
      if (creator.avg_cycle_days <= d) reasons.push(`制作周期满足（${creator.avg_cycle_days}天 ≤ ${d}天）`);
      else reasons.push(`制作周期偏长（${creator.avg_cycle_days}天 > ${d}天）`);
    }
  }
  return { ok, reasons, hit };
}

function analyze(db, creator) {
  const accounts = db.prepare('SELECT * FROM creator_accounts WHERE creator_id=? ORDER BY is_primary DESC, id').all(creator.id);
  const platforms = accounts.map(a => a.platform);
  const primaryPlatform = (accounts.find(a => a.is_primary) || accounts[0] || {}).platform || null;
  const platRole = {}; accounts.forEach(a => { platRole[a.platform] = a.role; });
  const roiVals = accounts.map(a => a.avg_roi7).filter(v => v != null && !isNaN(v));
  const creatorAvgRoi = roiVals.length ? roiVals.reduce((s, x) => s + x, 0) / roiVals.length : null;
  const history = getHistory(db, creator, primaryPlatform);
  const signals = computeTrends(history);
  const recentTrend = computeRecentTrend(history);
  const camp = currentCampaign(db);
  const campFit = camp ? fitCampaign(creator, camp, platforms) : { ok: true, reasons: ['无当前任务'], hit: [] };

  const openOpps = db.prepare("SELECT * FROM opportunities WHERE status NOT IN ('已验证','不采用','已过期')").all();
  const creatorTags = uniq([].concat(
    (creator.categories || '').split(/[,，]/),
    (creator.content_type || '').split(/[,，]/),
    (creator.good_play || '').split(/[,，]/)
  ));
  const matchedOpps = openOpps.filter(o => {
    const ids = (o.matched_creator_ids || '').split(',').filter(Boolean).map(Number);
    if (ids.includes(creator.id)) return true;
    const op = o.play_method || '';
    return op && creatorTags.some(t => t && (t.includes(op) || op.includes(t)));
  });

  // ===== 系统合作建议（带依据，不自动决定去留）=====
  const drop = signals.find(s => s.type === 'quality_drop' && s.detected);
  let verdict, recommendedDir, basis = [];
  const roi = creatorAvgRoi;
  const stability = creator.stability;

  if (creator.status === '黑名单') {
    verdict = '暂不推荐当前机会'; recommendedDir = '停止合作';
    basis.push('已列入黑名单，不建议继续合作');
  } else if (creator.status === '暂停') {
    verdict = '暂不推荐当前机会'; recommendedDir = '暂停中，重新评估后再启';
    basis.push('当前状态：暂停合作，需重新评估');
    basis.push(...campFit.reasons);
  } else if (!campFit.ok && matchedOpps.length === 0) {
    verdict = '暂不推荐当前机会'; recommendedDir = '当前任务暂不匹配，优先其他方向';
    basis.push(...campFit.reasons);
  } else if (drop) {
    verdict = '需要调整内容要求'; recommendedDir = '保留但收紧内容要求';
    basis.push(drop.evidence);
    basis.push('建议聚焦其擅长方向，明确内容要求与验收标准');
  } else if (creator.is_new) {
    verdict = '建议继续观察'; recommendedDir = '小成本试单观察';
    basis.push('暂无合作历史数据，建议小成本试单验证');
    if (campFit.ok) basis.push('适配当前任务类型，可作为候选创作者');
  } else if (roi != null && roi >= 1.0 && (stability === '高' || stability === '中')) {
    verdict = '适合继续合作'; recommendedDir = campFit.ok ? '继续当前任务方向合作' : '可继续合作，但当前任务优先级调低';
    basis.push(`历史平均 ROI ${roi}，内容稳定性${stability}`);
    basis.push(...campFit.reasons.filter(r => /匹配|可控|满足|命中/.test(r)));
    if (matchedOpps.length) basis.push(`当前有可承接机会：${matchedOpps.map(o => '#' + o.id).join('、')}`);
  } else if (roi != null && roi >= 0.8) {
    verdict = '建议继续观察'; recommendedDir = '维持观察';
    basis.push(`历史 ROI ${roi}，处于临界，建议持续观察表现`);
    basis.push(...campFit.reasons.slice(0, 2));
  } else {
    const newPlay = signals.find(s => s.type === 'new_play' && s.detected);
    verdict = newPlay ? '适合测试新方向' : '建议继续观察';
    recommendedDir = newPlay ? '测试新玩法方向' : '维持观察，控制预算';
    basis.push(`历史 ROI ${roi != null ? roi : '缺失'}，整体表现一般`);
    if (newPlay) basis.push('近期尝试新玩法，可给予测试机会');
  }

  const suitableForCurrent = campFit.ok && (creator.status === '可合作' || creator.status === '合作中') && !drop && creator.status !== '黑名单';
  const trendSummary = signals.length ? signals.map(s => s.label).join('、') : '未发现明显变化';

  // ===== 历史发布与表现 =====
  const plays = history.map(h => h.play_count).filter(x => x);
  const avgPlay = mean(plays), medPlay = median(plays);
  const highPerf = [...history].filter(h => h.roi_d7 != null || h.play_count).sort((a, b) => (b.roi_d7 ?? -1) - (a.roi_d7 ?? -1) || (b.play_count || 0) - (a.play_count || 0)).slice(0, 2);
  const lowPerf = [...history].filter(h => h.roi_d7 != null || h.play_count).sort((a, b) => (a.roi_d7 ?? 99) - (b.roi_d7 ?? 99) || (a.play_count || 0) - (b.play_count || 0)).slice(0, 2);
  const byPlatform = {}; history.forEach(h => (byPlatform[h.platform] = byPlatform[h.platform] || []).push(h));
  const byPlatformObj = Object.entries(byPlatform).map(([p, arr]) => ({ platform: p, role: platRole[p] || null, count: arr.length, avgPlay: Math.round(mean(arr.map(x => x.play_count).filter(x => x)) || 0), avgRoi: round1(mean(arr.map(x => x.roi_d7).filter(x => x != null))) }));
  const byPlay = {}; history.forEach(h => { const t = classify(h.play_method, h.content_type); (byPlay[t] = byPlay[t] || []).push(h); });
  const byPlayObj = Object.entries(byPlay).map(([t, arr]) => ({ type: t, count: arr.length, avgPlay: Math.round(mean(arr.map(x => x.play_count).filter(x => x)) || 0), avgRoi: round1(mean(arr.map(x => x.roi_d7).filter(x => x != null))) }));
  const byCamp = {}; history.forEach(h => { const k = h.campaign_name || (h.opp_id ? '机会#' + h.opp_id : '未归类'); (byCamp[k] = byCamp[k] || []).push(h); });
  const byCampObj = Object.entries(byCamp).map(([k, arr]) => ({ campaign: k, count: arr.length, avgPlay: Math.round(mean(arr.map(x => x.play_count).filter(x => x)) || 0), avgRoi: round1(mean(arr.map(x => x.roi_d7).filter(x => x != null))) }));
  const natural = history.filter(h => !h.cost), paid = history.filter(h => h.cost);

  const publishCount = history.length;
  const currentCyclePublish = camp ? history.filter(h => h.campaign_id === camp.id).length : 0;

  const performance = {
    publishCount,
    avgPlay: Math.round(avgPlay || 0),
    medianPlay: Math.round(medPlay || 0),
    avgLike: Math.round(mean(history.map(h => h.like_count).filter(x => x)) || 0),
    avgComment: Math.round(mean(history.map(h => h.comment_count).filter(x => x)) || 0),
    avgActivation: round1(mean(history.map(h => h.activation_d1).filter(x => x != null))),
    avgRoi7: round1(mean(history.map(h => h.roi_d7).filter(x => x != null))),
    highPerf: highPerf.map(h => ({ title: h.title || ('机会#' + h.opp_id), play: h.play_count, roi: h.roi_d7, platform: h.platform })),
    lowPerf: lowPerf.map(h => ({ title: h.title || ('机会#' + h.opp_id), play: h.play_count, roi: h.roi_d7, platform: h.platform })),
    byPlatform: byPlatformObj,
    byPlay: byPlayObj,
    byCampaign: byCampObj,
    naturalAvg: Math.round(mean(natural.map(h => h.play_count).filter(x => x)) || 0),
    paidAvg: Math.round(mean(paid.map(h => h.play_count).filter(x => x)) || 0)
  };

  return {
    creator,
    accounts,
    platforms,
    primaryPlatform,
    performance,
    trend: { signals, summary: trendSummary },
    suggestion: {
      verdict, recommendedDir, basis, suitableForCurrent,
      fitCampaign: campFit,
      matchedOpps: matchedOpps.map(o => ({ id: o.id, title: o.title, status: o.status }))
    },
    currentCyclePublish,
    recentTrend,
    publishCount,
    execRecords: getExecRecords(db, creator)
  };
}

module.exports = { analyze };
