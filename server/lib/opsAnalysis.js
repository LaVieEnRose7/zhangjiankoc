/**
 * 内容经营分析引擎（第6页：内容经营分析）
 * analyze(db, {campaignId, cycleMode, start, end}) -> 返回 8 模块结构化结果
 * 模块1-3 实现完整；模块4-8 本阶段返回占位骨架（后续逐模块确认实现）。
 *
 * 数据来源（按已确认决策：V1 复用现有数据，不接文件导入）：
 *   - executions（stage∈已发布/数据回收）
 *   - cases（source='项目执行结果' 且 play_count>0）
 * 历史周期对照：reviews 表中 status='已确认' 且 period_end < 当前周期起点的快照（analysis_json.overview）
 */

const creatorAnalysis = require('./creatorAnalysis');

// ---------- 工具 ----------
function parseJson(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); }
function round1(n) { return Math.round((n || 0) * 10) / 10; }
function uniq(a) { return [...new Set(a.filter(Boolean))]; }
function getSetting(db, key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row && row.value != null ? row.value : fallback;
  } catch (e) {
    return fallback;
  }
}

const CT_MAP = { '攻略': '攻略', '测评': '测评', '评测': '测评', '整活': '整活', '剧情': '剧情', '切片': '切片', '解说': '解说', '情怀': '情怀', '手书': '手书', 'cos': 'COS', '真人cos': 'COS' };
function normContentType(s) {
  if (!s) return '其他';
  for (const k in CT_MAP) if (s.includes(k)) return CT_MAP[k];
  return '其他';
}
const PLAY_TAGS = [
  { tag: '平民养成', words: ['平民', '零氪', '微氪', '月卡', '养成', '资源规划', '省钱'] },
  { tag: '新手攻略', words: ['新手', '入门', '开荒', '萌新', '避坑', '必看', '教学'] },
  { tag: '职业测评', words: ['职业', '强度', '测评', '评测', '配装', '技能', '流派'] },
  { tag: '副本攻略', words: ['副本', '秘境', 'boss', '首领', '通关', '打法', '攻略'] },
  { tag: '速通竞速', words: ['速通', '竞速', '最快', '极限', '纪录', '冲榜'] },
  { tag: '整活挑战', words: ['整活', '挑战', '翻车', '搞笑', '抽象', '名场面', '梗'] },
  { tag: '剧情二创', words: ['剧情', '二创', '同人', '手书', '配音', '短剧', '故事'] },
  { tag: '盘点解说', words: ['盘点', '解说', '一分钟', '看懂', '科普', '解析', '总结'] },
  { tag: '抽卡体验', words: ['抽卡', '欧皇', '非酋', '卡池', '出货', '保底'] },
  { tag: '外观展示', words: ['外观', '时装', '皮肤', '捏脸', '坐骑', '展示'] },
  { tag: 'PVP 对战', words: ['pvp', '竞技场', '对战', 'pk', '团战'] },
  { tag: '版本资讯', words: ['版本', '更新', '活动', '前瞻', '上线', '公告'] },
  { tag: '情怀回忆', words: ['情怀', '回忆', '怀旧', '青春', '周年'] }
];
function normPlay(s) {
  if (!s) return '其他玩法';
  const text = String(s).toLowerCase().replace(/\s+/g, '');
  for (const group of PLAY_TAGS) {
    if (group.words.some(word => text.includes(word))) return group.tag;
  }
  return '其他玩法';
}
function normGoal(s) {
  if (!s) return '未标注';
  if (s.includes('周年庆')) return '周年庆';
  if (s.includes('暑期')) return '暑期';
  if (s.includes('版本上线') || s.includes('上线')) return '版本上线';
  return s.trim() || '未标注';
}

// ---------- 取内容条目 ----------
function getContentItems(db, { campaignId, start, end }) {
  start = start || '1970-01-01'; end = end || '2999-12-31';
  const items = [];
  const exRows = db.prepare(`
    SELECT e.*, o.campaign_id AS op_campaign, o.direction AS op_direction, o.play_method AS op_play,
           o.title AS op_title, c.platform AS creator_platform
    FROM executions e
    LEFT JOIN opportunities o ON e.opportunity_id = o.id
    LEFT JOIN creators c ON e.creator_id = c.id
    WHERE e.stage IN ('已发布','数据回收')
      AND e.publish_date BETWEEN ? AND ?
      ${campaignId ? 'AND (o.campaign_id = ? OR o.campaign_id IS NULL)' : ''}
  `).all(start, end, ...(campaignId ? [campaignId] : []));
  for (const r of exRows) {
    items.push({
      source: 'ex', id: r.id, title: r.op_title || ('执行#' + r.id),
      platform: r.creator_platform || 'B站',
      creator_id: r.creator_id, creator_name: r.creator_name,
      opportunity_id: r.opportunity_id, campaign_id: r.op_campaign,
      content_type: normContentType(r.exec_play_method || r.op_direction || r.op_play),
      play_method: normPlay(r.exec_play_method || r.op_play),
      publish_date: r.publish_date,
      play: r.play_count || 0, like: r.like_count || 0, comment: r.comment_count || 0,
      activation: r.activation_d1, roi: r.roi_d7, cost: r.cost || 0
    });
  }
  const caRows = db.prepare(`
    SELECT * FROM cases
    WHERE play_count > 0
      AND COALESCE(publish_date, date(created_at)) BETWEEN ? AND ?
      ${campaignId ? 'AND campaign_id = ?' : ''}
  `).all(start, end, ...(campaignId ? [campaignId] : []));
  for (const r of caRows) {
    items.push({
      source: 'case', id: r.id, title: r.title,
      platform: r.platform, creator_id: r.creator_id, creator_name: r.creator_name,
      opportunity_id: r.linked_opportunity_id, campaign_id: r.campaign_id,
      content_type: normContentType(r.content_type || r.copy || r.raw_content || r.title),
      play_method: normPlay(r.play_method || r.copy || r.title),
      publish_date: r.publish_date || String(r.created_at || '').slice(0, 10),
      play: r.play_count || 0, like: r.like_count || 0, comment: r.comment_count || 0,
      activation: r.activation_d1, roi: r.roi_d7, cost: r.cost || 0
    });
  }
  return items;
}

// ---------- 模块1 数据中心 ----------
function computeDataCenter(items) {
  const total = items.length;
  const missing = items.filter(it => !it.play || it.play <= 0);
  const unmatched = items.filter(it => !it.creator_id && !it.opportunity_id);
  const seenKey = {}; const dups = [];
  for (const it of items) {
    // 判重以「作者+标题归一+发布日」为键：导入数据 content_type 大面积为空，
    // 若用 content_type 作键会把同作者同日多发的内容全部误判为重复。
    const pd = it.publish_date;
    const title = (it.title || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!pd || !title) continue;
    const k = (it.creator_id || '') + '|' + title + '|' + pd;
    if (seenKey[k]) dups.push({ type: '重复内容', detail: `${it.title}（${it.creator_name || '未关联'}）与同期其他内容重复` });
    else seenKey[k] = 1;
  }
  const issues = [
    ...missing.map(it => ({ type: '数据缺失', detail: `${it.title}（${it.creator_name || '未关联'}）无播放数据，建议回收或剔除` })),
    ...dups
  ];
  const matched = total - unmatched.length;
  return {
    total, matched, unmatched: unmatched.length, missing: missing.length,
    duplicates: dups.length, issues,
    dataCompleteness: total ? round1(matched / total * 100) : 0
  };
}

// ---------- 模块2 业务总览 ----------
function getBaselines(db, currentStart) {
  const rows = db.prepare(`SELECT period_label, period_end, analysis_json FROM reviews WHERE status='已确认' AND analysis_json IS NOT NULL AND period_end < ? ORDER BY period_end DESC`).all(currentStart);
  const prev = rows[0] || null;
  const prevOverview = prev ? parseJson(prev.analysis_json, {}).overview : null;
  let avg = null;
  if (rows.length) {
    const os = rows.map(r => parseJson(r.analysis_json, {}).overview).filter(Boolean);
    if (os.length) {
      avg = {
        published: Math.round(mean(os.map(o => o.published || 0))),
        totalPlay: Math.round(mean(os.map(o => o.totalPlay || 0))),
        avgRoi7: round1(mean(os.map(o => o.avgRoi7 || 0))),
        completion: round1(mean(os.map(o => o.completion || 0))),
        baiZan: Math.round(mean(os.map(o => o.baiZan || 0)))
      };
    }
  }
  return { prev, prevLabel: prev ? prev.period_label : '上周期', prevOverview, avg, count: rows.length };
}

function buildCompare(m, baselines) {
  const target = { avgRoi7: 0.8, avgActivation: 3.0, completion: 100 };
  const prev = baselines.prevOverview;
  const avg = baselines.avg;
  const delta = (cur, base) => (base == null || base === 0) ? null : round1((cur - base) / base * 100);
  return {
    prev: prev ? {
      label: baselines.prevLabel, metrics: prev, deltas: {
        totalPlay: delta(m.totalPlay, prev.totalPlay), avgRoi7: delta(m.avgRoi7, prev.avgRoi7),
        completion: delta(m.completion, prev.completion * 100), baiZan: delta(m.baiZan, prev.baiZan)
      }
    } : null,
    avg: avg ? {
      label: '历史平均', metrics: avg, deltas: {
        totalPlay: delta(m.totalPlay, avg.totalPlay), avgRoi7: delta(m.avgRoi7, avg.avgRoi7),
        completion: delta(m.completion, avg.completion * 100), baiZan: delta(m.baiZan, avg.baiZan)
      }
    } : null,
    target: {
      label: '当前目标', metrics: target, reach: {
        avgRoi7: m.avgRoi7 >= 0.8, avgActivation: m.avgActivation >= 3.0, completion: m.completion >= 100
      }
    }
  };
}

function computeOverview(items, baselines, planned, pmGroups) {
  const published = items.filter(it => it.play > 0);
  const creators = uniq(published.map(i => i.creator_id).filter(Boolean)).length;
  const totalPlay = published.reduce((s, i) => s + i.play, 0);
  const totalInteraction = published.reduce((s, i) => s + i.like + i.comment, 0);
  const baiZan = published.filter(i => i.like >= 100).length;
  const gaoQian = published.filter(i => i.play >= 150000 || (i.roi && i.roi >= 1.0)).length;
  const newPlays = (pmGroups || []).filter(g => g.level === '值得测试').length;
  const platforms = {};
  const platformPlays = {};
  for (const i of published) {
    const platform = i.platform || '其他';
    platforms[platform] = (platforms[platform] || 0) + 1;
    platformPlays[platform] = (platformPlays[platform] || 0) + (i.play || 0);
  }
  const roiArr = published.map(i => i.roi).filter(x => x != null);
  const actArr = published.map(i => i.activation).filter(x => x != null);
  const avgRoi7 = round1(mean(roiArr));
  const avgActivation = round1(mean(actArr));
  const completion = planned ? round1(published.length / planned * 100) : 0;
  const metrics = {
    published: published.length, creators, completion, totalPlay, totalInteraction,
    baiZan, gaoQian, newPlays, avgRoi7, avgActivation, platforms, platformPlays,
    dataCompleteness: published.length ? round1(published.filter(i => i.play > 0).length / published.length * 100) : 0
  };
  return { metrics, compare: buildCompare(metrics, baselines) };
}

// ---------- 模块3 内容分层 ----------
function judgeLevel(n, avgRoi, cv, trend) {
  if (n <= 2 && avgRoi >= 0.9) return { level: '值得测试', reason: '样本少但表现达到基准，建议扩大测试' };
  if (avgRoi < 0.6) return { level: '应停止', reason: 'ROI低于0.6，整体表现一般，建议暂停投入' };
  if (avgRoi >= 1.0 && cv < 0.5 && n >= 3) return { level: '优秀', reason: '高ROI且稳定，建议持续放大' };
  if (avgRoi >= 0.8 && n >= 2) return { level: '稳定', reason: 'ROI达标且较稳定，保持投入' };
  return { level: '观察', reason: '表现中性，建议继续观察' };
}

function computeLayers(items, dimension) {
  const published = items.filter(i => i.play > 0);
  const groups = {};
  for (const i of published) {
    let key;
    if (dimension === 'content_type') key = i.content_type || '其他';
    else if (dimension === 'play_method') key = i.play_method || '其他';
    else key = i.goal || '未标注';
    (groups[key] = groups[key] || []).push(i);
  }
  const out = Object.keys(groups).map(key => {
    const g = groups[key];
    const plays = g.map(i => i.play);
    const rois = g.map(i => i.roi).filter(x => x != null);
    const avgPlay = round1(mean(plays));
    const medPlay = Math.round(median(plays));
    const baiZanRate = round1(g.filter(i => i.like >= 100).length / g.length * 100);
    const baoKuan = g.filter(i => i.play >= 200000).length;
    const creators = uniq(g.map(i => i.creator_id).filter(Boolean)).length;
    const cv = avgPlay ? Math.round(std(plays) / avgPlay * 100) / 100 : 0;
    const sorted = [...g].sort((a, b) => a.publish_date < b.publish_date ? -1 : 1);
    const mid = Math.floor(sorted.length / 2);
    let trend = '样本不足';
    if (sorted.length >= 4) {
      const m1 = median(sorted.slice(0, mid).map(i => i.play));
      const m2 = median(sorted.slice(mid).map(i => i.play));
      if (m2 >= m1 * 1.15) trend = '上升';
      else if (m2 <= m1 * 0.85) trend = '下降';
      else trend = '平稳';
    }
    const lvl = judgeLevel(g.length, round1(mean(rois)), cv, trend);
    return {
      key, n: g.length, creators, avgPlay, medianPlay: medPlay, baiZanRate, baoKuan,
      avgRoi7: round1(mean(rois)), stability: cv < 0.4 ? '稳定' : cv > 0.8 ? '波动大' : '一般', cv, trend,
      level: lvl.level, reason: lvl.reason
    };
  });
  out.sort((a, b) => b.avgPlay - a.avgPlay);
  return out;
}

// ---------- 模块4 机会表现归因 ----------
// 判定口径：只看本周期导入/归档后的内容表现，不依赖人工「已验证」状态。
//   达标：ROI7≥0.8，或首日激活率≥3%，或总播放≥5万
//   待复测：ROI7≥0.6，或首日激活率≥2%，或总播放≥5000
//   未达标：有播放但转化/播放都未达复测线
//   无数据：本周期无有效播放
function computeOpp(db, items) {
  const oppIds = uniq(items.map(i => i.opportunity_id).filter(Boolean));
  const empty = { ready: true, summary: { verified: 0, partial: 0, failed: 0, none: 0, total: 0 }, groups: { verified: [], partial: [], failed: [], none: [] }, note: '本周期无关联机会的内容' };
  if (!oppIds.length) return empty;
  const q = oppIds.map(() => '?').join(',');
  const oppRows = db.prepare(`SELECT id,title,status,platform,node,play_method,direction FROM opportunities WHERE id IN (${q})`).all(...oppIds);
  const byOpp = {};
  for (const i of items) { if (!i.opportunity_id) continue; (byOpp[i.opportunity_id] = byOpp[i.opportunity_id] || []).push(i); }
  const groups = { verified: [], partial: [], failed: [], none: [] };
  for (const o of oppRows) {
    const linkedAll = byOpp[o.id] || [];
    const linked = linkedAll.filter(i => i.play > 0);
    const n = linked.length;
    const plays = linked.map(i => i.play);
    const rois = linked.map(i => i.roi).filter(x => x != null);
    const acts = linked.map(i => i.activation).filter(x => x != null);
    const totalPlay = plays.reduce((s, x) => s + x, 0);
    const avgRoi = round1(mean(rois));
    const avgAct = round1(mean(acts));
    const baiZan = linked.filter(i => i.like >= 100).length;
    const gaoQian = linked.filter(i => i.play >= 150000 || (i.roi && i.roi >= 1.0)).length;
    let verdict, reason;
    if (n === 0) {
      verdict = 'none';
      reason = '本周期关联内容无有效播放数据，无法判断表现';
    } else if (avgRoi >= 0.8 || avgAct >= 3 || totalPlay >= 50000) {
      verdict = 'verified';
      reason = `表现达标：ROI7=${avgRoi ?? '暂无'}，激活率=${avgAct ?? '暂无'}%，总播放=${totalPlay}`;
    } else if (avgRoi >= 0.6 || avgAct >= 2 || totalPlay >= 5000) {
      verdict = 'partial';
      reason = `需要复测：ROI7=${avgRoi ?? '暂无'}，激活率=${avgAct ?? '暂无'}%，总播放=${totalPlay}`;
    } else {
      verdict = 'failed';
      reason = `未达标：ROI7=${avgRoi ?? '暂无'}，激活率=${avgAct ?? '暂无'}%，总播放=${totalPlay}`;
    }
    groups[verdict].push({
      id: o.id, title: o.title, status: o.status, platform: o.platform || '—', node: o.node || '—',
      play_method: o.play_method || '—', direction: o.direction || '',
      linkedCount: linkedAll.length, validCount: n, totalPlay, avgRoi, avgAct, baiZan, gaoQian,
      verdict, reason
    });
  }
  for (const k in groups) groups[k].sort((a, b) => b.totalPlay - a.totalPlay);
  const summary = { verified: groups.verified.length, partial: groups.partial.length, failed: groups.failed.length, none: groups.none.length, total: oppRows.length };
  return { ready: true, summary, groups };
}

// ---------- 模块5 创作者经营分析 ----------
// 三维（非排名）：成长 / 瓶颈 / 值得培养（+ 观察兜底）
// 判定（已确认·规则综合）：复用 lib/creatorAnalysis 的趋势信号/系统建议 + 本周期内容表现
//   瓶颈：近期下降 / 质量下降或素材重复信号 / 系统建议「暂不推荐」或「调整内容要求」
//   值得培养：新人，或样本少但趋势正向(上升/平稳)且适配当前任务
//   成长：近期上升 且 本周期 ROI7≥0.8（无瓶颈信号）
//   其余 → 观察
function classifyCreator(period, eng, benchmark) {
  const signals = (eng.trend && eng.trend.signals) || [];
  const hasQualityDrop = signals.some(s => s.type === 'quality_drop');
  const hasRepeat = signals.some(s => s.type === 'repeat');
  const isNew = !!eng.creator.is_new;
  const pub = period.published;
  const totalPlay = period.totalPlay || 0;
  const cpm = period.cpm;
  const highCpm = cpm != null && benchmark.avgCpm > 0 && cpm > benchmark.avgCpm * 1.5;
  const lowPlay = pub >= 2 && benchmark.avgCreatorPlay > 0 && totalPlay < benchmark.avgCreatorPlay * 0.5;
  const bottleneckByPerf = hasQualityDrop || hasRepeat || highCpm || lowPlay;
  if (bottleneckByPerf) {
    const bits = [];
    if (hasQualityDrop) bits.push('内容质量下降');
    if (hasRepeat) bits.push('素材重复');
    if (highCpm) bits.push(`CPM ¥${cpm} 高于整体 ¥${benchmark.avgCpm}`);
    if (lowPlay) bits.push(`发布 ${pub} 条但总播放 ${Math.round(totalPlay)} 偏低`);
    return { cls: 'bottleneck', reason: bits.join('；') || '综合表现偏弱' };
  }
  const efficient = cpm != null && benchmark.avgCpm > 0 && cpm <= benchmark.avgCpm;
  const strongPlay = benchmark.avgCreatorPlay > 0 && totalPlay >= benchmark.avgCreatorPlay;
  if (pub >= 2 && strongPlay && (efficient || cpm == null)) {
    return { cls: 'growth', reason: `发布 ${pub} 条、总播放 ${Math.round(totalPlay)} 达到整体水平，CPM ${cpm == null ? '待补充' : '¥' + cpm}` };
  }
  if (isNew || (pub <= 2 && (efficient || strongPlay))) {
    return { cls: 'cultivate', reason: `样本 ${pub} 条，${efficient ? 'CPM 效率较好' : '播放潜力较好'}，建议继续小规模培养` };
  }
  return { cls: 'watch', reason: `发布 ${pub} 条、总播放 ${Math.round(totalPlay)}，CPM ${cpm == null ? '待补充' : '¥' + cpm}，继续观察` };
}

function computeCreator(db, items) {
  const creatorIds = uniq(items.map(i => i.creator_id).filter(Boolean));
  const empty = { ready: true, summary: { growth: 0, bottleneck: 0, cultivate: 0, watch: 0, total: 0 }, groups: { growth: [], bottleneck: [], cultivate: [], watch: [] }, note: '本周期无关联创作者的内容' };
  if (!creatorIds.length) return empty;
  const q = creatorIds.map(() => '?').join(',');
  const creatorRows = db.prepare(`SELECT * FROM creators WHERE id IN (${q})`).all(...creatorIds);
  const byC = {};
  for (const i of items) { if (!i.creator_id) continue; (byC[i.creator_id] = byC[i.creator_id] || []).push(i); }
  const totalAllPlay = items.reduce((s, i) => s + (i.play || 0), 0);
  const totalAllCost = items.reduce((s, i) => s + (i.cost || 0), 0);
  const benchmark = {
    avgCreatorPlay: creatorRows.length ? totalAllPlay / creatorRows.length : 0,
    avgCpm: totalAllPlay > 0 && totalAllCost > 0 ? Math.round(totalAllCost / totalAllPlay * 1000 * 10) / 10 : 0
  };
  const groups = { growth: [], bottleneck: [], cultivate: [], watch: [] };
  for (const cr of creatorRows) {
    const cItems = (byC[cr.id] || []).filter(i => i.play > 0);
    const published = cItems.length;
    const totalPlay = cItems.reduce((s, i) => s + i.play, 0);
    const totalCost = cItems.reduce((s, i) => s + (i.cost || 0), 0);
    const actualCpm = totalPlay > 0 && totalCost > 0 ? Math.round(totalCost / totalPlay * 1000 * 10) / 10 : null;
    const cpm = actualCpm != null ? actualCpm : (Number(cr.manual_cpm) > 0 ? Number(cr.manual_cpm) : null);
    const rois = cItems.map(i => i.roi).filter(x => x != null);
    const acts = cItems.map(i => i.activation).filter(x => x != null);
    const sortedC = [...cItems].sort((a, b) => a.publish_date < b.publish_date ? -1 : 1);
    let periodTrend = '样本不足';
    if (sortedC.length >= 4) {
      const mid = Math.floor(sortedC.length / 2);
      const m1 = median(sortedC.slice(0, mid).map(i => i.play));
      const m2 = median(sortedC.slice(mid).map(i => i.play));
      if (m2 >= m1 * 1.15) periodTrend = '上升';
      else if (m2 <= m1 * 0.85) periodTrend = '下降';
      else periodTrend = '平稳';
    }
    const period = { published, totalPlay, totalCost, cpm, avgRoi: round1(mean(rois)), avgAct: round1(mean(acts)), trend: periodTrend, roiCount: rois.length, avgPlay: published ? totalPlay / published : 0 };
    const eng = creatorAnalysis.analyze(db, cr);
    const { cls, reason } = classifyCreator(period, eng, benchmark);
    const signals = ((eng.trend && eng.trend.signals) || []).map(s => ({ label: s.label, level: s.level, evidence: s.evidence }));
    groups[cls].push({
      id: cr.id, name: cr.name, platform: cr.platform || '—', status: cr.status || '—', is_new: !!cr.is_new,
      published, totalPlay, totalCost, cpm, avgPlay: period.avgPlay, avgRoi: period.avgRoi, avgAct: period.avgAct,
      baiZan: cItems.filter(i => i.like >= 100).length,
      gaoQian: cItems.filter(i => i.play >= 150000 || (i.roi && i.roi >= 1.0)).length,
      recentTrend: eng.recentTrend, periodTrend, trendSummary: (eng.trend && eng.trend.summary) || '',
      signals, verdict: (eng.suggestion && eng.suggestion.verdict) || '', recommendedDir: (eng.suggestion && eng.suggestion.recommendedDir) || '',
      cls, reason
    });
  }
  for (const k in groups) groups[k].sort((a, b) => b.totalPlay - a.totalPlay);
  const summary = { growth: groups.growth.length, bottleneck: groups.bottleneck.length, cultivate: groups.cultivate.length, watch: groups.watch.length, total: creatorRows.length };
  return { ready: true, summary, groups };
}

// ---------- 模块8 经营经验库 ----------
// 已确认口径：洞察一键入库+手动新建（人工确认后入库）；反哺=定义查询接口+机会页展示入口（只读，不改推荐逻辑）；页内列表+筛选
function computeKnowledge(db) {
  const rows = db.prepare(`SELECT * FROM experiences ORDER BY (is_effective IS NULL OR is_effective=1) DESC, created_at DESC`).all();
  const list = rows.map(r => ({
    id: r.id, content: r.content, category: r.category || '其他',
    target_direction: r.target_direction || '', platform: r.platform || '',
    applicable_creator: r.applicable_creator || '', data_basis: r.data_basis || '',
    source_cycle: r.source_cycle || '', validation_count: r.validation_count || 0,
    confidence: r.confidence || '中', boost: r.boost == null ? 1 : r.boost,
    is_effective: r.is_effective == null ? 1 : r.is_effective, status: r.status || '已确认',
    created_at: r.created_at
  }));
  const effective = list.filter(e => e.is_effective);
  const directions = uniq(effective.map(e => e.target_direction).filter(Boolean));
  const platforms = uniq(effective.map(e => e.platform).filter(Boolean));
  return {
    ready: true,
    summary: { total: list.length, effective: effective.length, archived: list.length - effective.length, highConfidence: effective.filter(e => e.confidence === '高').length },
    directions, platforms, list
  };
}

/**
 * 反哺查询接口（供机会推荐/创作者匹配/AI策略调用）
 * 返回与 direction/platform 相关的有效经验，按 可信度(高>中>低) + 验证次数 排序
 */
function getEffectiveExperiences(db, { direction, platform } = {}) {
  const rows = db.prepare(`SELECT * FROM experiences WHERE (is_effective IS NULL OR is_effective=1) AND status='已确认'`).all();
  const CONF = { '高': 3, '中': 2, '低': 1 };
  const match = rows.filter(r => {
    const dOk = !direction || !r.target_direction || r.target_direction.includes(direction) || direction.includes(r.target_direction) || (r.keywords || '').split(/[,，\s]+/).some(k => k && direction.includes(k));
    const pOk = !platform || !r.platform || r.platform === platform || r.platform.includes(platform);
    return dOk && pOk;
  });
  match.sort((a, b) => (CONF[b.confidence] || 2) - (CONF[a.confidence] || 2) || (b.validation_count || 0) - (a.validation_count || 0));
  return match.map(r => ({
    id: r.id, content: r.content, category: r.category, boost: r.boost == null ? 1 : r.boost,
    target_direction: r.target_direction || '', platform: r.platform || '',
    confidence: r.confidence || '中', validation_count: r.validation_count || 0,
    data_basis: r.data_basis || '', source_cycle: r.source_cycle || ''
  }));
}

// ---------- 模块7 资源经营建议 ----------
// 已确认口径：
//   对象：玩法+创作者双线（放大优秀玩法+成长创作者；暂停应停止玩法+瓶颈创作者；验证待验证玩法+培养名单；优化高播低转/波动大）
//   星级(1-5)=执行优先级：把握度（样本量/判级可信）× 影响面（播放/ROI 体量）
//   展示：四象限分栏卡片（amplify/verify/optimize/pause）
function calcStars(grip, impact) {
  // grip: 1-3 把握度；impact: 1-3 影响面 → 星级 1-5
  return Math.max(1, Math.min(5, grip + impact - 1));
}

function computeResource(layers, opp, creator, overview) {
  const totalPlayAll = (overview.metrics && overview.metrics.totalPlay) || 0;
  const out = { amplify: [], verify: [], optimize: [], pause: [] };
  const push = (dim, line, target, advice, basis, grip, impact) => {
    out[dim].push({ line, target, advice, basis, stars: calcStars(grip, impact) });
  };
  const gripOfN = n => n >= 5 ? 3 : n >= 3 ? 2 : 1;
  const impactOfPlay = play => {
    if (!totalPlayAll) return 1;
    const share = play / totalPlayAll;
    return share >= 0.25 ? 3 : share >= 0.1 ? 2 : 1;
  };

  // —— 玩法线（play_method 分层） ——
  const pmGroups = (layers.play_method || []);
  for (const g of pmGroups) {
    const gPlay = (g.avgPlay || 0) * g.n;
    const basis = `${g.n}条/${g.creators}人 · 均播${Math.round((g.avgPlay || 0) / 10000 * 10) / 10}万 · ROI7=${g.avgRoi7} · ${g.stability} · 趋势${g.trend} · 判级「${g.level}」`;
    if (g.level === '优秀') {
      push('amplify', 'play', g.key, `下周期追加排期与预算，保持当前创作者组合，目标产能提升 30-50%`, basis, gripOfN(g.n), impactOfPlay(gPlay));
    } else if (g.level === '值得测试') {
      push('verify', 'play', g.key, `样本不足，追加 2-3 条内容小成本测试，验证 ROI 是否稳定 ≥0.8`, basis, gripOfN(g.n), impactOfPlay(gPlay));
    } else if (g.level === '应停止') {
      push('pause', 'play', g.key, `暂停投入，存量排期完成后不再新增；如需保留请先改方向再测`, basis, gripOfN(g.n), impactOfPlay(gPlay));
    } else if (g.level === '稳定') {
      if (g.trend === '下降' || g.cv > 0.8) {
        push('optimize', 'play', g.key, `表现稳定但${g.trend === '下降' ? '趋势下滑' : '波动偏大'}，优化选题/发布节奏后维持现有投入`, basis, gripOfN(g.n), impactOfPlay(gPlay));
      } else if ((g.avgRoi7 || 0) < ((overview.metrics.avgRoi7 || 0))) {
        push('optimize', 'play', g.key, `播放稳定但 ROI 低于整体均值(${overview.metrics.avgRoi7})，优化转化引导（评论区/引导语/落点）`, basis, gripOfN(g.n), impactOfPlay(gPlay));
      } else {
        push('amplify', 'play', g.key, `表现稳定达标，维持并小幅追加投入`, basis, Math.max(1, gripOfN(g.n) - 1), impactOfPlay(gPlay));
      }
    } else if (g.level === '观察') {
      // 高播低转：播放占比可观但 ROI 介于 0.6~0.8 → 优化转化路径
      if (impactOfPlay(gPlay) >= 2 && (g.avgRoi7 || 0) >= 0.6 && (g.avgRoi7 || 0) < 0.8) {
        push('optimize', 'play', g.key, `播放体量可观但 ROI7=${g.avgRoi7} 未达 0.8，属高播低转——优化转化引导（落点/引导语/评论区置顶）后再评估`, basis, gripOfN(g.n), impactOfPlay(gPlay));
      }
    }
  }

  // —— 机会线并入复测/优化（待复测→追加样本；未达标→优化或放弃） ——
  for (const o of (opp.groups && opp.groups.partial) || []) {
    push('verify', 'play', `机会「${o.title}」`, `追加 1-2 条内容做小样本复测，确认是否值得放量`, `关联${o.validCount}条内容 · 总播${Math.round(o.totalPlay / 10000)}万 · ${o.reason}`, gripOfN(o.validCount), impactOfPlay(o.totalPlay));
  }
  for (const o of (opp.groups && opp.groups.failed) || []) {
    push('optimize', 'play', `机会「${o.title}」`, `本周期表现未达标，回机会中心重判方向或调整玩法后再投`, `关联${o.validCount}条内容 · ${o.reason}`, gripOfN(o.validCount), impactOfPlay(o.totalPlay || 0));
  }

  // —— 创作者线 ——
  const cg = creator.groups || {};
  for (const c of cg.growth || []) {
    push('amplify', 'creator', c.name, `下周期优先派单，可承接放大方向的玩法；适当上调合作单价/条数`, `本周期${c.published}条 · 总播${Math.round(c.totalPlay / 10000)}万 · ROI=${c.avgRoi} · ${c.reason}`, gripOfN(c.published), impactOfPlay(c.totalPlay));
  }
  for (const c of cg.cultivate || []) {
    push('verify', 'creator', c.name, `小成本培养：派 1-2 条适配选题，观察数据再决定是否加码`, `本周期${c.published}条 · ROI=${c.avgRoi} · ${c.reason}`, gripOfN(c.published), impactOfPlay(c.totalPlay));
  }
  for (const c of cg.bottleneck || []) {
    push('pause', 'creator', c.name, `暂停新派单，与创作者沟通调整内容方向；两周后复评`, `本周期${c.published}条 · ROI=${c.avgRoi} · ${c.reason}`, gripOfN(c.published), impactOfPlay(c.totalPlay));
  }
  for (const c of cg.watch || []) {
    if ((c.avgRoi || 0) >= 0.8 && c.published >= 2) {
      push('optimize', 'creator', c.name, `表现中性但 ROI 达标，微调选题匹配度后维持合作`, `本周期${c.published}条 · ROI=${c.avgRoi} · ${c.reason}`, gripOfN(c.published), impactOfPlay(c.totalPlay));
    }
  }

  // 每栏按星级降序，最多 5 条防刷屏
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => b.stars - a.stars);
    out[k] = out[k].slice(0, 5);
  }
  const summary = { amplify: out.amplify.length, verify: out.verify.length, optimize: out.optimize.length, pause: out.pause.length };
  // 下周期 TOP3 行动：全量按星级取前3
  const top3 = [...out.amplify, ...out.verify, ...out.optimize, ...out.pause]
    .sort((a, b) => b.stars - a.stars).slice(0, 3)
    .map(r => ({ target: r.target, line: r.line, stars: r.stars, advice: r.advice }));
  return { ready: true, summary, groups: out, top3 };
}

// ---------- 模块6 AI经营洞察（规则引擎部分） ----------
// 已确认口径：
//   触发：规则洞察随 analyze 即时返回；AI 洞察由前端按钮单独触发（/ops/insight-ai）
//   覆盖：内容规律 / 平台规律 / 创作者规律 / 机会表现 / 异常信号 五类，每类≤2条
//   可信度：高=样本≥5且差异≥50%；低=样本<3（自动标「需验证」）；其余=中
function gradeConfidence(n, diffPct) {
  if (n < 3) return { confidence: '低', needsVerify: true };
  if (n >= 5 && Math.abs(diffPct || 0) >= 50) return { confidence: '高', needsVerify: false };
  return { confidence: '中', needsVerify: false };
}

function computeInsights(items, layers, overview, opp, creator, dataCenter) {
  const published = items.filter(i => i.play > 0);
  const overallRoi = overview.metrics.avgRoi7 || 0;
  const out = [];
  const push = (category, title, statement, basis, contentCount, creatorCount, diffPct) => {
    const g = gradeConfidence(contentCount, diffPct);
    out.push({ category, title, statement, basis, contentCount, creatorCount, confidence: g.confidence, needsVerify: g.needsVerify, source: 'rule' });
  };

  // ① 内容规律：content_type 组 ROI 相对整体的显著偏差（各取最高/最低一条）
  if (overallRoi > 0) {
    const cts = layers.content_type.filter(g => g.n >= 1 && g.avgRoi7 > 0 && g.key !== '其他');
    const withDiff = cts.map(g => ({ ...g, diff: round1((g.avgRoi7 - overallRoi) / overallRoi * 100) }));
    const best = withDiff.filter(g => g.diff >= 25).sort((a, b) => b.diff - a.diff)[0];
    const worst = withDiff.filter(g => g.diff <= -25).sort((a, b) => a.diff - b.diff)[0];
    if (best) push('内容规律', `「${best.key}」类内容显著跑赢整体`,
      `「${best.key}」类平均 ROI7=${best.avgRoi7}，高出整体均值（${overallRoi}）${best.diff}%，判级「${best.level}」`,
      `样本 ${best.n} 条内容 / ${best.creators} 位创作者，均播 ${Math.round(best.avgPlay)}，百赞率 ${best.baiZanRate}%`,
      best.n, best.creators, best.diff);
    if (worst) push('内容规律', `「${worst.key}」类内容表现低于整体`,
      `「${worst.key}」类平均 ROI7=${worst.avgRoi7}，低于整体均值（${overallRoi}）${Math.abs(worst.diff)}%，判级「${worst.level}」`,
      `样本 ${worst.n} 条内容 / ${worst.creators} 位创作者，均播 ${Math.round(worst.avgPlay)}`,
      worst.n, worst.creators, worst.diff);
  }

  // ② 平台规律：平台间均播/ROI 差异（需≥2平台）
  const byPlat = {};
  for (const i of published) (byPlat[i.platform] = byPlat[i.platform] || []).push(i);
  const plats = Object.keys(byPlat).filter(p => byPlat[p].length >= 1);
  if (plats.length >= 2) {
    const stat = plats.map(p => {
      const g = byPlat[p];
      const rois = g.map(i => i.roi).filter(x => x != null);
      return { p, n: g.length, creators: uniq(g.map(i => i.creator_id).filter(Boolean)).length, avgPlay: Math.round(mean(g.map(i => i.play))), avgRoi: round1(mean(rois)) };
    }).sort((a, b) => b.avgPlay - a.avgPlay);
    const top = stat[0], low = stat[stat.length - 1];
    if (low.avgPlay > 0) {
      const diff = round1((top.avgPlay - low.avgPlay) / low.avgPlay * 100);
      if (Math.abs(diff) >= 30) {
        push('平台规律', `${top.p} 均播显著高于 ${low.p}`,
          `${top.p} 均播 ${top.avgPlay}（ROI7=${top.avgRoi}），是 ${low.p}（均播 ${low.avgPlay}，ROI7=${low.avgRoi}）的 ${round1(top.avgPlay / low.avgPlay)} 倍`,
          `${top.p} ${top.n} 条 / ${low.p} ${low.n} 条内容`,
          Math.min(top.n, low.n), top.creators + low.creators, diff);
      }
    }
  }

  // ③ 创作者规律：成长组共性 + 新人表现
  if (creator && creator.ready) {
    const growth = creator.groups.growth || [];
    if (growth.length >= 1) {
      const gRoi = round1(mean(growth.map(c => c.avgRoi).filter(x => x > 0)));
      const gPub = growth.reduce((s, c) => s + c.published, 0);
      const diff = overallRoi > 0 ? round1((gRoi - overallRoi) / overallRoi * 100) : 0;
      push('创作者规律', `${growth.length} 位创作者处于成长通道`,
        `成长组（${growth.map(c => c.name).join('、')}）本周期平均 ROI7=${gRoi}${diff > 0 ? `，高出整体 ${diff}%` : ''}，可作为下周期放量主力`,
        `覆盖 ${gPub} 条内容，均无质量下降/素材重复信号`,
        gPub, growth.length, diff);
    }
    const newCs = [];
    for (const k in creator.groups) for (const c of creator.groups[k]) if (c.is_new) newCs.push(c);
    if (newCs.length >= 1) {
      const nRoi = round1(mean(newCs.map(c => c.avgRoi).filter(x => x > 0)));
      const nPub = newCs.reduce((s, c) => s + c.published, 0);
      const diff = overallRoi > 0 && nRoi > 0 ? round1((nRoi - overallRoi) / overallRoi * 100) : 0;
      push('创作者规律', `新合作创作者${nRoi >= overallRoi ? '首战表现不输老将' : '仍在磨合期'}`,
        `${newCs.length} 位新人（${newCs.map(c => c.name).join('、')}）平均 ROI7=${nRoi || '暂缺'}，${nRoi >= overallRoi ? '达到整体水平，验证了新人筛选标准有效' : '低于整体均值，需给磨合空间或调整选题'}`,
        `新人共发布 ${nPub} 条内容`,
        nPub, newCs.length, diff);
    }
  }

  // ④ 机会表现规律：达标率 + 达标机会的玩法共性
  if (opp && opp.ready && opp.summary.total > 0) {
    const s = opp.summary;
    const vRate = round1(s.verified / s.total * 100);
    const vPMs = uniq(opp.groups.verified.map(o => o.play_method).filter(p => p && p !== '—'));
    const vContent = opp.groups.verified.reduce((sum, o) => sum + o.validCount, 0);
    push('机会表现', `机会达标率 ${vRate}%（${s.verified}/${s.total}）`,
      `本周期关联内容的机会中 ${s.verified} 个达标${s.partial ? `、${s.partial} 个待复测` : ''}${s.failed ? `、${s.failed} 个未达标` : ''}${vPMs.length ? `；达标机会集中在「${vPMs.join('、')}」玩法` : ''}`,
      `覆盖 ${vContent} 条有效内容`,
      vContent, uniq(items.filter(i => i.opportunity_id).map(i => i.creator_id).filter(Boolean)).length, vRate - 50);
    const partials = opp.groups.partial || [];
    if (partials.length) {
      const p0 = partials[0];
      push('机会表现', `「${p0.title}」表现接近达标，值得追加测试`,
        `该机会方向可能成立但样本不足（${p0.validCount} 条），建议下周期追加 1-2 条内容做复测`,
        `关联 ${p0.validCount} 条有效内容，总播放 ${p0.totalPlay}`,
        p0.validCount, 1, null);
    }
  }

  // ⑤ 异常信号：高播低转 + 波动大
  const highPlayLowRoi = published.filter(i => i.play >= 100000 && i.roi != null && i.roi < 0.6);
  if (highPlayLowRoi.length) {
    push('异常信号', `${highPlayLowRoi.length} 条内容高播放但低转化`,
      `播放≥10万 但 ROI7<0.6：${highPlayLowRoi.slice(0, 3).map(i => `「${i.title}」(播放${i.play}/ROI ${i.roi})`).join('、')}。流量与转化脱节，检查内容是否偏离游戏卖点或人群不匹配`,
      `涉及 ${highPlayLowRoi.length} 条内容 / ${uniq(highPlayLowRoi.map(i => i.creator_id).filter(Boolean)).length} 位创作者`,
      highPlayLowRoi.length, uniq(highPlayLowRoi.map(i => i.creator_id).filter(Boolean)).length, null);
  }
  const volatile = layers.content_type.filter(g => g.cv > 0.8 && g.n >= 3);
  if (volatile.length) {
    const v0 = volatile[0];
    push('异常信号', `「${v0.key}」类内容数据波动大`,
      `「${v0.key}」类波动系数 cv=${v0.cv}（>0.8），单条内容表现忽高忽低，说明该类型成功依赖个别爆款而非稳定方法论，放量需谨慎`,
      `样本 ${v0.n} 条，均播 ${Math.round(v0.avgPlay)}，中位播 ${v0.medianPlay}`,
      v0.n, v0.creators, null);
  }

  // 每类最多2条（构造时已控制），按 可信度(高>中>低) 排序
  const rank = { '高': 0, '中': 1, '低': 2 };
  out.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  return { ready: true, rules: out, ruleCount: out.length, aiHint: '点击「AI 深度洞察」调用 Gemini 做跨维度规律发现（需配置 API Key，约 5-10 秒）' };
}

// ---------- 主入口 ----------
function analyze(db, { campaignId, cycleMode, start, end } = {}) {
  const campaign = campaignId ? db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId) : null;
  if (!start || !end) { start = '2026-07-01'; end = '2026-08-31'; }

  // 任务节点映射（营销目标维度）
  const camps = db.prepare('SELECT id,focus_detail FROM campaigns').all();
  const campNode = {};
  camps.forEach(c => { const f = parseJson(c.focus_detail, {}); campNode[c.id] = f.node || ''; });

  let items = getContentItems(db, { campaignId, start, end });
  items = items.map(it => it.source === 'ex'
    ? { ...it, goal: (it.campaign_id && campNode[it.campaign_id]) ? campNode[it.campaign_id] : '未标注' }
    : { ...it, goal: it.goal || '未标注' });

  const baselines = getBaselines(db, start);
  const dataCenter = computeDataCenter(items);
  const layers = {
    content_type: computeLayers(items, 'content_type'),
    play_method: computeLayers(items, 'play_method'),
    marketing_goal: computeLayers(items, 'marketing_goal')
  };
  const planned = db.prepare(`SELECT COUNT(*) c FROM executions WHERE publish_date BETWEEN ? AND ? ${campaignId ? 'AND opportunity_id IN (SELECT id FROM opportunities WHERE campaign_id=?)' : ''}`).get(start, end, ...(campaignId ? [campaignId] : [])).c;
  const overview = computeOverview(items, baselines, planned, layers.play_method);
  const opp = computeOpp(db, items);
  const creator = computeCreator(db, items);
  const insights = computeInsights(items, layers, overview, opp, creator, dataCenter);
  insights.aiMeta = {
    lastAt: getSetting(db, 'ops_last_ai_insight_at', ''),
    lastMode: getSetting(db, 'ops_last_ai_insight_mode', ''),
    lastModel: getSetting(db, 'ops_last_ai_insight_model', '')
  };

  return {
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
    period: { mode: cycleMode || 'task', start, end },
    baselines: { prevLabel: baselines.prevLabel, historyCount: baselines.count },
    dataCenter,
    overview,
    layers,
    opp,
    creator,
    insights,
    resource: computeResource(layers, opp, creator, overview),
    knowledge: computeKnowledge(db)
  };
}

module.exports = { analyze, getEffectiveExperiences };
