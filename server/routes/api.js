const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const { getDb, saveNow } = require('../db/database');
const ai = require('../lib/ai');
const rec = require('../lib/recommend');
const creatorAnalysis = require('../lib/creatorAnalysis');
const opsAnalysis = require('../lib/opsAnalysis');
const dailyHotspot = require('../lib/dailyHotspot');
const gameNews = require('../lib/gameNews');
const automation = require('../lib/automation');
const { fetchProfile } = require('../lib/creatorFetch');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const ok = (res, data) => res.json({ success: true, data });
const fail = (res, msg, code = 500) => res.status(code).json({ success: false, message: String(msg) });
const safeParse = (s, fb) => { try { return JSON.parse(s); } catch (e) { return fb; } };

// ---------- 主页链接 → 粉丝量/昵称 自动抓取回填 ----------
async function fillAccountFans(home_url, accId) {
  try {
    const r = await fetchProfile(home_url);
    if (r.ok && (r.fans || r.name)) {
      const db = getDb();
      const acc = db.prepare('SELECT account_name, fans FROM creator_accounts WHERE id=?').get(accId);
      const name = (acc && acc.account_name && String(acc.account_name).trim()) ? acc.account_name : (r.name || '');
      const fans = (r.fans && r.fans > 0) ? r.fans : (acc ? acc.fans : 0);
      db.prepare('UPDATE creator_accounts SET fans=?, account_name=? WHERE id=?').run(fans, name, accId);
    }
  } catch (e) { /* 抓取失败静默：不阻断导入 */ }
}

// 从已导入的案例库发布数据反匹配粉丝量（平台+达人昵称 或 已关联的 creator_id），作为联网抓取失败时的可靠兜底
function matchFansFromCases(db, acc) {
  let row = null;
  const platform = String(acc.platform || '').trim();
  if (acc.creator_id && platform) {
    row = db.prepare(`SELECT fans FROM cases
      WHERE creator_id=? AND platform=? AND fans>0
      ORDER BY publish_date DESC,id DESC LIMIT 1`).get(acc.creator_id, platform);
  }
  if (!row && platform && acc.account_name) {
    row = db.prepare(`SELECT fans FROM cases
      WHERE platform=? AND creator_name=? AND fans>0
      ORDER BY publish_date DESC,id DESC LIMIT 1`).get(platform, acc.account_name);
  }
  return row ? (Number(row.fans) || 0) : 0;
}

/* ============ 案例结果自动判定 ============ */
// 系统按「内容声量 + 转化表现」自动分级，不依赖人工选择。
const DEFAULT_CASE_RATING_RULES = Object.freeze({
  viral_play: 300000,
  good_play: 50000,
  normal_play: 5000,
  roi: 0.8,
  activation: 3
});

function getCaseRatingRules(db = getDb()) {
  const row = db.prepare("SELECT value FROM settings WHERE key='case_rating_rules'").get();
  if (!row || !row.value) return { ...DEFAULT_CASE_RATING_RULES };
  try {
    const parsed = JSON.parse(row.value);
    return Object.fromEntries(Object.entries(DEFAULT_CASE_RATING_RULES).map(([key, fallback]) => {
      const value = Number(parsed[key]);
      return [key, Number.isFinite(value) && value >= 0 ? value : fallback];
    }));
  } catch (e) { return { ...DEFAULT_CASE_RATING_RULES }; }
}

function judgeCaseResult(c, rules = getCaseRatingRules()) {
  const play = Number(c.play_count) || 0;
  if (play >= rules.viral_play) return '爆款';
  if (play >= rules.good_play) return '良好';
  if (play >= rules.normal_play) return '一般';
  return '失败';
}

function caseAnalysisText(c) {
  return [c.title, c.copy, c.raw_content, c.topic_tags, c.summary].filter(Boolean).join('\n');
}

function applyCaseClassification(db, id, fields, mode) {
  if (!fields) return;
  const current = db.prepare('SELECT * FROM cases WHERE id=?').get(id);
  if (!current) return;
  const contentType = mode === 'ai' ? (fields.content_type || current.content_type || '') : (current.content_type || fields.content_type || '');
  const playMethod = mode === 'ai' ? (fields.play_method || current.play_method || '') : (current.play_method || fields.play_method || '');
  const hotspot = mode === 'ai' ? (fields.hotspot || current.hotspot || '') : (current.hotspot || fields.hotspot || '');
  const analysis = { mode, analyzed_at: new Date().toISOString(), borrowable: fields.borrowable || '', risk_info: fields.risk_info || '' };
  db.prepare('UPDATE cases SET content_type=?,play_method=?,hotspot=?,analysis_json=? WHERE id=?')
    .run(contentType, playMethod, hotspot, JSON.stringify(analysis), id);
}

async function enrichCaseClassification(id) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(id);
  if (!c) return false;
  const text = caseAnalysisText(c);
  if (!text) return false;
  // 规则先落库，保证导入后立即能进入内容分层；AI 成功后再覆盖缺失分类。
  applyCaseClassification(db, id, ai.ruleExtractCase(text, c.url || ''), 'rule');
  try {
    const fields = await ai.extractCase({ text, link: c.url || '' });
    applyCaseClassification(db, id, fields, 'ai');
    return true;
  } catch (e) { return false; }
}

/* ============ 今日工作（六模块） ============ */
const DAY = 86400000;
function dateOnly(d) { return d.toISOString().slice(0, 10); }

router.get('/today', (req, res) => {
  try {
    const db = getDb();
    const today = dateOnly(new Date());
    const todayMs = new Date(today).getTime();

    // 模块1：营销任务摘要（默认背景 = 当前任务 is_current，否则取执行中）
    const activeCamps = rec.activeCampaigns(db);
    const camp = activeCamps[0] || null;
    let campaignSummary = null;
    if (camp) {
      const remain = camp.end_date ? Math.round((new Date(camp.end_date).getTime() - todayMs) / DAY) : null;
      campaignSummary = {
        game_name: camp.game_name || '《杖剑传说》', id: camp.id, name: camp.name, version_event: camp.version_event,
        goal: camp.goal, target_audience: camp.target_audience,
        cycle_start: camp.start_date, cycle_end: camp.end_date,
        focus_content: camp.focus_content, remain_days: remain, active_count: db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status='执行中'").get().c, priority: camp.priority,
        is_current: !!camp.is_current, target_platform: camp.target_platform, owner: camp.owner, agency: camp.agency
      };
    }

    // 模块2：今日候选热点（含筛查结论 + 风险规则命中）
    const baseCamp = activeCamps[0] || null;
    const candidateHotspots = db.prepare("SELECT * FROM hotspots WHERE status='候选' ORDER BY (screen_result='不符合'), heat DESC").all()
      .map(h => {
        const risk = baseCamp ? rec.evaluateRisk(h, baseCamp) : { blocked: false, hits: [] };
        return {
          id: h.id, title: h.title, source_label: h.source_label || h.platform, platform: h.platform, category: h.category,
          detected_at: (h.detected_at || '').slice(0, 10), heat: h.heat, trend: h.trend,
          valid_until: h.valid_until, relevance: h.relevance, risk_note: h.risk_note,
          screen_result: h.screen_result || '待定', screen_reason: h.screen_reason, observed: !!h.observed, status: h.status, tags: h.tags,
          risk_blocked: risk.blocked, risk_hits: risk.hits
        };
      });

    // 模块3：今日推荐机会（实时计算，不落库；受风险红线限制的热点不进入推荐）
    const campaigns = activeCamps;
    const creatorsAll = db.prepare('SELECT * FROM creators').all();
    const recos = [];
    for (const h of db.prepare("SELECT * FROM hotspots WHERE status='候选' AND (screen_result IS NULL OR screen_result!='不符合') ORDER BY heat DESC").all()) {
      if (baseCamp && rec.evaluateRisk(h, baseCamp).blocked) continue; // 风险红线：不推荐
      let best = null, bestCamp = null;
      if (campaigns.length === 0) best = rec.scoreHotspot(h, null);
      else for (const c of campaigns) { const r = rec.scoreHotspot(h, c); if (!best || r.score > best.score) { best = r; bestCamp = c; } }
      let draft = null;
      if (h.ai_draft_json) { try { draft = JSON.parse(h.ai_draft_json); } catch (e) {} }
      recos.push(rec.buildRecommendation(h, bestCamp, creatorsAll, draft));
    }
    recos.sort((a, b) => b.score - a.score);

    // 模块4：即将过期机会
    const expiring = [];
    for (const o of db.prepare(`SELECT o.*, h.url AS hotspot_url
      FROM opportunities o LEFT JOIN hotspots h ON h.id=o.hotspot_id
      WHERE o.status NOT IN ('已验证','不采用','已过期') AND o.deadline IS NOT NULL`).all()) {
      const dl = new Date(o.deadline).getTime();
      let urgency = null, note = '';
      if (dl < todayMs) { urgency = 'missed'; note = '已错过最佳时效'; }
      else if (dateOnly(new Date(dl)) === today) { urgency = 'today'; note = '建议今天确认'; }
      else if (dl <= todayMs + DAY) { urgency = '24h'; note = '24小时内需启动'; }
      if (urgency) expiring.push({ kind: 'opportunity', id: o.id, title: o.title, deadline: o.deadline, urgency, note, url: o.hotspot_url || null });
    }
    for (const h of db.prepare("SELECT * FROM hotspots WHERE status='候选' AND valid_until IS NOT NULL").all()) {
      const dl = new Date(h.valid_until).getTime();
      let urgency = null, note = '';
      if (dl < todayMs) { urgency = 'missed'; note = '热点已过期，建议尽快处理或放弃'; }
      else if (dateOnly(new Date(dl)) === today) { urgency = 'today'; note = '建议今天确认'; }
      else if (dl <= todayMs + DAY) { urgency = '24h'; note = '24小时内需启动'; }
      // 没有真实来源链接的旧演示数据不再出现在“即将过期”热点中。
      if (urgency && h.url) expiring.push({ kind: 'hotspot', id: h.id, title: h.title, deadline: h.valid_until, urgency, note, url: h.url });
    }
    const urgencyRank = u => u === 'missed' ? 0 : u === 'today' ? 1 : u === '24h' ? 2 : 3;
    expiring.sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency));

    // 模块5：执行待办聚合
    const 待确认机会 = db.prepare("SELECT id,title FROM opportunities WHERE status='待判断'").all().map(r => ({ type: '待确认机会', id: r.id, title: r.title, ref: 'opportunity' }));
    const 待分配创作者 = db.prepare("SELECT id,title FROM opportunities WHERE status IN ('已采纳','待匹配创作者') AND (matched_creator_ids IS NULL OR matched_creator_ids='')").all().map(r => ({ type: '待分配创作者', id: r.id, title: r.title, ref: 'opportunity' }));
    const 创作中内容 = db.prepare("SELECT e.id, o.title, e.stage FROM executions e LEFT JOIN opportunities o ON e.opportunity_id=o.id WHERE e.stage IN ('脚本确认','制作中')").all().map(r => ({ type: '创作中内容', id: r.id, title: r.title || '(未命名机会)', ref: 'execution', sub: r.stage }));
    const 待发布内容 = db.prepare("SELECT e.id, o.title, e.stage FROM executions e LEFT JOIN opportunities o ON e.opportunity_id=o.id WHERE e.stage='待发布'").all().map(r => ({ type: '待发布内容', id: r.id, title: r.title || '(未命名机会)', ref: 'execution', sub: r.stage }));
    const 延期内容 = db.prepare("SELECT id,title,deadline FROM opportunities WHERE status NOT IN ('已验证','不采用','已过期','待判断') AND deadline IS NOT NULL AND date(deadline) < date('now')").all().map(r => ({ type: '延期内容', id: r.id, title: r.title, ref: 'opportunity', due: r.deadline }));
    const 数据缺失记录 = db.prepare("SELECT e.id, o.title FROM executions e LEFT JOIN opportunities o ON e.opportunity_id=o.id WHERE e.stage IN ('已发布','数据回收') AND e.roi_d7 IS NULL").all().map(r => ({ type: '数据缺失记录', id: r.id, title: r.title || '(未命名机会)', ref: 'execution' }));
    const 待确认复盘结论 = db.prepare("SELECT id,title FROM reviews WHERE status='草稿'").all().map(r => ({ type: '待确认复盘结论', id: r.id, title: r.title, ref: 'review' }));
    const execTodos = { 待确认机会, 待分配创作者, 创作中内容, 待发布内容, 延期内容, 数据缺失记录, 待确认复盘结论 };
    const todoTotal = Object.values(execTodos).reduce((s, a) => s + a.length, 0);

    // 模块6：近期结果反馈（近7天）
    const since = dateOnly(new Date(todayMs - 7 * DAY));
    const recentExecs = db.prepare("SELECT e.*, o.title as opp_title FROM executions e LEFT JOIN opportunities o ON e.opportunity_id=o.id WHERE (e.publish_date >= ? OR (e.stage IN ('已发布','数据回收') AND e.updated_at >= ?))").all(since, since);
    const published = recentExecs.filter(e => e.stage === '已发布' || e.stage === '数据回收');
    const highlights = published.filter(e => e.roi_d7 != null && e.roi_d7 >= 1.0).slice(0, 3).map(e => ({ id: e.opportunity_id, title: e.opp_title || '(未命名)', roi: e.roi_d7, play: e.play_count }));
    const new_directions = db.prepare("SELECT content,category FROM experiences WHERE created_at >= ?").all(since).map(e => ({ content: e.content, category: e.category }));
    const observe = db.prepare("SELECT id,title FROM opportunities WHERE status IN ('创作中','已采纳','待匹配创作者') AND id NOT IN (SELECT opportunity_id FROM executions)").all().map(r => ({ id: r.id, title: r.title }));
    const running = published.filter(e => e.roi_d7 == null).map(e => ({ title: e.opp_title || '(未命名)', stage: e.stage }));

    const stats = {
      candidateHotspots: candidateHotspots.length,
      recommendations: recos.length,
      expiring: expiring.length,
      todoTotal,
      published7d: published.length
    };

    ok(res, {
      today, campaignSummary, candidateHotspots, recommendations: recos, expiring, execTodos, todoTotal,
      recentFeedback: { published_count: published.length, highlights, new_directions, observe, running },
      stats
    });
  } catch (e) { fail(res, e.message); }
});

/* ============ 通用 CRUD ============ */
const TABLES = {
  campaigns: ['name','game_name','goal','target_audience','criteria','keywords','content_directions','version_event','focus_content','goals','focus_detail','prefs','risk_rules','rule_summary','target_platform','owner','agency','is_current','start_date','end_date','priority','status','created_by'],
  hotspots: ['title','platform','category','heat','trend','source','source_label','url','description','tags','valid_until','relevance','risk_note','status','created_by'],
  creators: ['name','platform','home_url','fans','categories','avg_play','avg_activation','avg_roi7','price','manual_cpm','strengths','contact','notes','account_type','agency','content_type','coop_cycle','willingness','stability','is_new','good_play','good_role','style','forms','avg_cycle_days','cost_ceiling','bad_direction'],
  creator_accounts: ['creator_id','platform','account_name','home_url','fans','avg_play','avg_activation','avg_roi7','role','is_primary'],
  cases: ['title','platform','url','creator_id','creator_name','campaign_id','campaign_name','game_name','content_type','marketing_node','hotspot','play_method','creator_type','topic_tags','raw_content','analysis_json','analysis_edited','play_count','like_count','comment_count','activation_d1','roi_d7','cost','result','summary','source','confirm_status','is_favorite','is_reusable','linked_opportunity_id','benchmark_met','review_conclusion','note','publish_date','created_by','fans','copy','favorite_count','share_count','creator_platform_id'],
  executions: ['opportunity_id','creator_id','creator_name','stage','publish_url','publish_date','planned_date','exec_play_method','adjustment','fail_reason','play_count','like_count','comment_count','activation_d1','roi_d7','cost','income','note','revision_count','on_time','coop_rating','accuracy','agency_feedback','created_by'],
  experiences: ['content','category','keywords','boost','source_review_id','status','created_by','target_direction','platform','applicable_creator','data_basis','source_cycle','validation_count','confidence','is_effective','analysis_id'],
  todos: ['title','ref_type','ref_id','assignee','due_date','status','created_by'],
  opportunities: ['title','hotspot_id','campaign_id','status','direction','decision','decision_by','matched_creator_ids','assignee','deadline','created_by','platform','node','basis','risk_json','direction_json','play_method','game_combo','cost','suggested_time','risk_level','risk_note'],
  creative_templates: ['name','core_logic','applicable_hotspot','applicable_node','creator_type','cost','cases','usage_count','validation','risks','source_opportunity_id','created_by'],
  creator_videos: ['creator_id','title','url','platform','publish_date','play_count','note','created_by']
};

/* ============ 今日工作：实时热点 & AI 推荐机会（抖音热榜 + B站热门） ============ */
// 注意：以下路由必须在通用 CRUD 循环之前注册，否则会被 /:table 拦截

// 今日候选热点 = 每日快照（每日仅抓取一次 + 分析一次，结果落库持久化）
router.get('/today/hotspots', async (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 200, 300);
    const snap = await dailyHotspot.getSnapshot(db);
    const list = safeParse(snap.hotspots_json, []).slice(0, limit);
    ok(res, {
      list,
      biliCount: list.filter(x => x.source === 'B站').length,
      douyinCount: list.filter(x => x.source === '抖音').length,
      fetchedAt: snap.fetched_at,
      analyzedAt: snap.analyzed_at,
      sourceStatus: safeParse(snap.source_status_json, {}),
      daily: true,
      snapDate: snap.snap_date
    });
  } catch (e) { fail(res, e.message); }
});

// 今日推荐机会 = 当日快照中的 AI 分析结论（即「分析一次得一次结论」）
router.get('/today/recommendations', async (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 8, 20);
    const snap = await dailyHotspot.getSnapshot(db);
    const list = safeParse(snap.recommendations_json, []).slice(0, limit);
    ok(res, {
      list,
      fetchedAt: snap.fetched_at,
      analyzedAt: snap.analyzed_at,
      sourceStatus: safeParse(snap.source_status_json, {}),
      cached: true,
      daily: true,
      snapDate: snap.snap_date
    });
  } catch (e) { fail(res, e.message); }
});

// 手动强制重新抓取今日热点 + 重新分析（测试用；默认每日只自动跑一次）
router.post('/today/refresh', async (req, res) => {
  try {
    const db = getDb();
    const snap = await dailyHotspot.getSnapshot(db, { force: true });
    ok(res, {
      snapDate: snap.snap_date,
      fetchedAt: snap.fetched_at,
      analyzedAt: snap.analyzed_at,
      hotspotCount: safeParse(snap.hotspots_json, []).length,
      recoCount: safeParse(snap.recommendations_json, []).length
    });
  } catch (e) { fail(res, e.message); }
});

/* ============ 游戏快讯（真实新闻源，每日洞察一次） ============ */
router.get('/game-news', async (req, res) => {
  try {
    const db = getDb();
    const snap = await gameNews.getSnapshot(db, { force: false });
    ok(res, {
      today: gameNews.dateOnly(new Date()),
      items: snap.items,
      lastBatch: snap.lastBatch,
      sourceStatus: snap.status || null,
      ranToday: !!snap.ran,
      addedToday: snap.added || 0
    });
  } catch (e) { fail(res, e.message); }
});

router.post('/game-news/refresh', async (req, res) => {
  try {
    const db = getDb();
    const snap = await gameNews.getSnapshot(db, { force: true });
    ok(res, {
      today: gameNews.dateOnly(new Date()),
      addedToday: snap.added || 0,
      total: snap.items.length,
      sourceStatus: snap.status || null
    });
  } catch (e) { fail(res, e.message); }
});

/* ============ 创作者库：实时分析（历史表现/趋势/系统建议） ============ */
// 营销任务阶段：结束边界取下一任务开始日，避免依赖不准确的手填结束日期。
function creatorPhases(db) {
  const rows = db.prepare("SELECT id,name,start_date,end_date,status FROM campaigns WHERE start_date IS NOT NULL AND start_date<>'' ORDER BY date(start_date), id").all();
  return rows.map((row, index) => ({
    ...row,
    phase_start: String(row.start_date).slice(0, 10),
    phase_end_exclusive: rows[index + 1] ? String(rows[index + 1].start_date).slice(0, 10) : null
  })).reverse();
}

router.get('/creators/phases', (req, res) => {
  try { ok(res, creatorPhases(getDb())); }
  catch (e) { fail(res, e.message); }
});

router.get('/creators/:id/accounts', (req, res) => {
  try {
    ok(res, getDb().prepare('SELECT * FROM creator_accounts WHERE creator_id=? ORDER BY is_primary DESC,id ASC').all(req.params.id));
  } catch (e) { fail(res, e.message); }
});

router.put('/creators/:id/accounts', (req, res) => {
  try {
    const db = getDb();
    const creator = db.prepare('SELECT * FROM creators WHERE id=?').get(req.params.id);
    if (!creator) return fail(res, '创作者不存在', 404);
    const accounts = Array.isArray(req.body.accounts) ? req.body.accounts.slice(0, 2).filter(account => String(account.platform || '').trim()) : [];
    if (!accounts.length) return fail(res, '至少需要保留一个主平台账号', 400);
    db.transaction(() => {
      const existing = db.prepare('SELECT * FROM creator_accounts WHERE creator_id=? ORDER BY is_primary DESC,id').all(req.params.id);
      const insert = db.prepare(`INSERT INTO creator_accounts
        (creator_id,platform,account_name,home_url,fans,role,is_primary,created_at)
        VALUES (?,?,?,?,?,?,?,datetime('now','localtime'))`);
      const update = db.prepare('UPDATE creator_accounts SET platform=?,account_name=?,home_url=?,fans=?,role=?,is_primary=? WHERE id=?');
      const retainedIds = [];
      accounts.forEach((account, index) => {
        const platform = String(account.platform || '').trim();
        const homeUrl = String(account.home_url || '').trim() || null;
        const matched = existing.find(row => !retainedIds.includes(row.id) && ((homeUrl && row.home_url === homeUrl) || row.platform === platform || Number(row.is_primary) === (index === 0 ? 1 : 0)));
        const values = [platform, String(account.account_name || creator.name).trim(), homeUrl, Math.max(0, Number(account.fans) || 0), index === 0 ? '创作' : '分发', index === 0 ? 1 : 0];
        if (matched) { update.run(...values, matched.id); retainedIds.push(matched.id); }
        else { const result = insert.run(req.params.id, ...values); retainedIds.push(Number(result.lastInsertRowid)); }
      });
      for (const row of existing) if (!retainedIds.includes(row.id)) db.prepare('DELETE FROM creator_accounts WHERE id=?').run(row.id);
    })();
    saveNow();
    ok(res, { updated: true, accounts: db.prepare('SELECT * FROM creator_accounts WHERE creator_id=? ORDER BY is_primary DESC,id').all(req.params.id) });
  } catch (e) { fail(res, e.message); }
});

router.get('/creators/:id/phase-cost', (req, res) => {
  try {
    const creatorId = Number(req.params.id);
    const campaignId = Number(req.query.campaign_id);
    if (!creatorId || !campaignId) return fail(res, '缺少创作者或营销阶段', 400);
    const row = getDb().prepare('SELECT paid_amount,note,updated_at FROM creator_phase_costs WHERE creator_id=? AND campaign_id=?').get(creatorId, campaignId);
    ok(res, row || { paid_amount: null, note: '', updated_at: null });
  } catch (e) { fail(res, e.message); }
});

router.put('/creators/:id/phase-cost', (req, res) => {
  try {
    const creatorId = Number(req.params.id);
    const campaignId = Number(req.body && req.body.campaign_id);
    const paidAmount = Number(req.body && req.body.paid_amount);
    if (!creatorId || !campaignId) return fail(res, '缺少创作者或营销阶段', 400);
    if (!Number.isFinite(paidAmount) || paidAmount < 0) return fail(res, '阶段付费必须是非负数', 400);
    const db = getDb();
    db.prepare(`INSERT INTO creator_phase_costs (creator_id,campaign_id,paid_amount,note,updated_at)
      VALUES (?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(creator_id,campaign_id) DO UPDATE SET paid_amount=excluded.paid_amount,note=excluded.note,updated_at=datetime('now','localtime')`)
      .run(creatorId, campaignId, paidAmount, String(req.body.note || '').trim());
    saveNow();
    ok(res, { creator_id: creatorId, campaign_id: campaignId, paid_amount: paidAmount });
  } catch (e) { fail(res, e.message); }
});

router.get('/creators/phase-performance', (req, res) => {
  try {
    const db = getDb();
    const phases = creatorPhases(db);
    const customStart = String(req.query.date_from || '').slice(0, 10);
    const customEnd = String(req.query.date_to || '').slice(0, 10);
    const phase = customStart ? {
      id: 'custom', name: '自定义时间段', phase_start: customStart,
      phase_end_exclusive: customEnd ? dateOnly(new Date(new Date(customEnd).getTime() + DAY)) : null
    } : phases.find(p => Number(p.id) === Number(req.query.campaign_id));
    if (!phase) return fail(res, '营销任务阶段不存在', 404);
    const cases = db.prepare(`SELECT id,creator_id,creator_name,platform,publish_date,play_count,activation_d1,roi_d7,result
      FROM cases WHERE publish_date>=? AND (? IS NULL OR publish_date<?)`).all(phase.phase_start, phase.phase_end_exclusive, phase.phase_end_exclusive);
    const byCreator = new Map();
    for (const item of cases) {
      const creatorId = Number(item.creator_id) || resolveCreatorId(db, { creator_name: item.creator_name, platform: item.platform });
      if (!creatorId) continue;
      if (!byCreator.has(creatorId)) byCreator.set(creatorId, []);
      byCreator.get(creatorId).push(item);
    }
    const avg = (rows, key) => {
      const nums = rows.map(x => Number(x[key])).filter(x => Number.isFinite(x));
      return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 100) / 100 : null;
    };
    const list = [...byCreator.entries()].map(([creator_id, rows]) => {
      const totalPlay = rows.reduce((sum, x) => sum + (Number(x.play_count) || 0), 0);
      const costRow = phase.id === 'custom' ? null : db.prepare('SELECT paid_amount FROM creator_phase_costs WHERE creator_id=? AND campaign_id=?').get(creator_id, phase.id);
      const paidAmount = costRow ? Number(costRow.paid_amount) : null;
      const creatorAccounts = db.prepare('SELECT platform,is_primary FROM creator_accounts WHERE creator_id=?').all(creator_id);
      const primaryPlatform = creatorAccounts.find(account => account.is_primary)?.platform || null;
      const primaryRows = primaryPlatform ? rows.filter(item => item.platform === primaryPlatform) : rows;
      const distRows = primaryPlatform ? rows.filter(item => item.platform !== primaryPlatform) : [];
      return {
        creator_id,
        content_count: rows.length,
        primary_content_count: primaryRows.length,
        dist_content_count: distRows.length,
        total_play: totalPlay,
        avg_play: avg(rows, 'play_count'),
        paid_amount: paidAmount,
        cpm: paidAmount != null && totalPlay > 0 ? Math.round(paidAmount / totalPlay * 1000 * 100) / 100 : null,
        avg_activation: avg(rows.filter(x => x.activation_d1 != null), 'activation_d1'),
        avg_roi7: avg(rows.filter(x => x.roi_d7 != null), 'roi_d7'),
        high_count: rows.filter(x => x.result === '爆款' || x.result === '良好').length
      };
    });
    ok(res, { phase, list, unmatched_count: cases.length - [...byCreator.values()].reduce((n, rows) => n + rows.length, 0) });
  } catch (e) { fail(res, e.message); }
});

// 列表用：带派生字段的创作者（用于筛选/排序）
router.get('/creators/insight-all', (req, res) => {
  try {
    const db = getDb();
    const list = db.prepare('SELECT * FROM creators ORDER BY id DESC').all();
    const out = list.map(c => {
      const a = creatorAnalysis.analyze(db, c);
      return {
        ...c, publishCount: a.publishCount, currentCyclePublish: a.currentCyclePublish,
        recentTrend: a.recentTrend, suitableForCurrent: a.suggestion.suitableForCurrent,
        recommendedDir: a.suggestion.recommendedDir, trendSummary: a.trend.summary,
        verdict: a.suggestion.verdict,
        accounts: a.accounts, platforms: a.platforms, primaryPlatform: a.primaryPlatform
      };
    });
    ok(res, out);
  } catch (e) { fail(res, e.message); }
});

// 详情用：完整分析
router.get('/creators/:id/insight', (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM creators WHERE id=?').get(req.params.id);
    if (!c) return fail(res, '创作者不存在', 404);
    ok(res, creatorAnalysis.analyze(db, c));
  } catch (e) { fail(res, e.message); }
});

function ruleCreatorStrengths(cases) {
  const groups = new Map();
  for (const item of cases) {
    const tags = [item.play_method, item.content_type].filter(Boolean)
      .flatMap(value => String(value).split(/[,，、/]/)).map(value => value.trim()).filter(Boolean);
    for (const tag of tags) {
      const row = groups.get(tag) || { tag, count: 0, play: 0, maxPlay: 0 };
      const play = Number(item.play_count) || 0;
      row.count++; row.play += play; row.maxPlay = Math.max(row.maxPlay, play);
      groups.set(tag, row);
    }
  }
  const ranked = [...groups.values()].map(row => ({ ...row, avgPlay: row.count ? Math.round(row.play / row.count) : 0 }))
    .sort((a, b) => (b.count * 2 + Math.log10(b.avgPlay + 1)) - (a.count * 2 + Math.log10(a.avgPlay + 1)));
  const top = ranked.slice(0, 5);
  return {
    categories: top.map(row => row.tag),
    core_advantage: top.length ? `${top[0].tag}表现最突出：${top[0].count}条，均播${top[0].avgPlay}` : '案例尚未形成可统计的内容标签',
    pending_direction: ranked.length > 1 && ranked[1].count === 1 ? `${ranked[1].tag}目前仅1条样本，建议继续验证` : '暂无',
    evidence: top.slice(0, 3).map(row => `${row.tag}：${row.count}条 · 均播${row.avgPlay} · 最高播放${row.maxPlay}`)
  };
}

router.post('/creators/:id/analyze-strengths', async (req, res) => {
  try {
    const db = getDb();
    const creator = db.prepare(`SELECT c.*, COALESCE((SELECT platform FROM creator_accounts a WHERE a.creator_id=c.id ORDER BY is_primary DESC,id LIMIT 1),c.platform) platform
      FROM creators c WHERE c.id=?`).get(req.params.id);
    if (!creator) return fail(res, '创作者不存在', 404);
    const start = String(req.body && req.body.start || '').slice(0, 10);
    const end = String(req.body && req.body.end || '').slice(0, 10);
    let rows = db.prepare(`SELECT title,content_type,play_method,hotspot,play_count,like_count,publish_date
      FROM cases WHERE (creator_id=? OR (creator_id IS NULL AND creator_name=?)) ORDER BY publish_date DESC,id DESC`).all(creator.id, creator.name);
    if (start) rows = rows.filter(row => row.publish_date && row.publish_date >= start);
    if (end) rows = rows.filter(row => row.publish_date && row.publish_date <= end);
    if (!rows.length) return fail(res, '该分析范围内没有已关联的案例内容', 400);
    const fallback = ruleCreatorStrengths(rows);
    try {
      const result = await ai.analyzeCreatorStrengths({ creator, cases: rows, periodLabel: start ? `${start} 至 ${end || '今天'}` : '全部历史' });
      ok(res, { ...result, mode: 'ai', sample_count: rows.length, message: 'AI 分析完成' });
    } catch (e) {
      const message = e.message === 'NO_API_KEY' ? '未配置 AI Key，已使用数据规则分析' : `AI 分析失败，已使用数据规则分析（${String(e.message).slice(0, 60)}）`;
      ok(res, { ...fallback, mode: 'rule', sample_count: rows.length, message });
    }
  } catch (e) { fail(res, e.message); }
});

// 创作者发布内容：优先使用 creator_id，兜底使用平台账号昵称匹配未关联案例
router.get('/creators/:id/published', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const creator = db.prepare('SELECT * FROM creators WHERE id=?').get(id);
    if (!creator) return fail(res, '创作者不存在', 404);

    const accounts = db.prepare('SELECT * FROM creator_accounts WHERE creator_id=? ORDER BY is_primary DESC, id ASC').all(id);
    const names = new Set([creator.name, ...accounts.map(a => a.account_name)].map(normName).filter(Boolean));
    const platforms = new Set([creator.platform, ...accounts.map(a => a.platform)].filter(Boolean).map(String));

    let phase = null;
    const customStart = String(req.query.date_from || '').slice(0, 10);
    const customEnd = String(req.query.date_to || '').slice(0, 10);
    if (customStart) phase = {
      id: 'custom', name: '自定义时间段', phase_start: customStart,
      phase_end_exclusive: customEnd ? dateOnly(new Date(new Date(customEnd).getTime() + DAY)) : null
    };
    else if (req.query.campaign_id) phase = creatorPhases(db).find(p => Number(p.id) === Number(req.query.campaign_id)) || null;
    const inPhase = row => !phase || (row.publish_date && row.publish_date >= phase.phase_start && (!phase.phase_end_exclusive || row.publish_date < phase.phase_end_exclusive));

    const allCases = db.prepare(`SELECT id, title, url, platform, creator_id, creator_name, play_count, like_count, comment_count,
        favorite_count, share_count, activation_d1, roi_d7, cost, result, source, benchmark_met, publish_date
      FROM cases ORDER BY (publish_date IS NULL), publish_date DESC, id DESC`).all();
    const caseRows = allCases.filter(v => {
      if (!inPhase(v)) return false;
      const direct = Number(v.creator_id) === id;
      if (direct) return true;
      if (v.creator_id) return false;
      const sameName = names.has(normName(v.creator_name));
      const samePlatform = !platforms.size || !v.platform || platforms.has(String(v.platform));
      return sameName && samePlatform;
    });

    const manual = db.prepare(`SELECT id, title, url, platform, play_count, publish_date, created_by
      FROM creator_videos WHERE creator_id=? ORDER BY (publish_date IS NULL), publish_date DESC`).all(id).filter(inPhase);
    const allExecs = db.prepare(`SELECT e.*, o.title AS opportunity_title
      FROM executions e LEFT JOIN opportunities o ON e.opportunity_id=o.id
      ORDER BY (e.publish_date IS NULL), e.publish_date DESC, e.id DESC`).all();
    const executions = allExecs.filter(e => {
      if (!inPhase(e)) return false;
      const direct = Number(e.creator_id) === id;
      if (direct) return true;
      if (e.creator_id) return false;
      const sameName = names.has(normName(e.creator_name));
      return sameName;
    });

    const num = v => (v == null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
    const avg = rows => {
      const values = rows.map(num).filter(v => v != null);
      if (!values.length) return null;
      return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    };
    const resultTag = r => r === '爆款' ? 'red' : r === '良好' ? 'green' : r === '失败' ? 'gray' : 'blue';
    const fromCases = caseRows.map(v => ({
      caseId: v.id, title: v.title, url: v.url, platform: v.platform,
      creator_name: v.creator_name, play_count: v.play_count, like_count: v.like_count,
      comment_count: v.comment_count, favorite_count: v.favorite_count, share_count: v.share_count,
      activation_d1: v.activation_d1, roi_d7: v.roi_d7, cost: v.cost,
      publish_date: v.publish_date, result: v.result,
      benchmark_met: v.benchmark_met,
      resultTag: resultTag(v.result), source: '案例库', deletable: false
    }));
    const fromManual = manual.map(v => ({
      id: v.id, title: v.title, url: v.url, platform: v.platform,
      play_count: v.play_count, publish_date: v.publish_date, created_by: v.created_by,
      source: '人工导入', deletable: true
    }));
    const items = [...fromCases, ...fromManual].sort((a, b) => String(b.publish_date || '').localeCompare(String(a.publish_date || '')));
    const plays = items.map(v => v.play_count);
    const roiRows = fromCases.map(v => v.roi_d7);
    const activationRows = fromCases.map(v => v.activation_d1);
    const latest = items.find(v => v.publish_date)?.publish_date || null;
    const highCount = fromCases.filter(v => v.result === '爆款' || v.result === '良好').length;
    const totalPlay = plays.map(num).filter(v => v != null).reduce((a, b) => a + b, 0);
    const phaseCostRow = phase && phase.id !== 'custom'
      ? db.prepare('SELECT paid_amount FROM creator_phase_costs WHERE creator_id=? AND campaign_id=?').get(id, phase.id)
      : null;
    const paidAmount = phaseCostRow ? Number(phaseCostRow.paid_amount) : null;
    const summary = {
      content_count: items.length,
      case_count: fromCases.length,
      manual_count: fromManual.length,
      execution_count: executions.length,
      total_play: totalPlay,
      avg_play: avg(plays),
      paid_amount: paidAmount,
      cpm: paidAmount != null && totalPlay > 0 ? Math.round(paidAmount / totalPlay * 1000 * 100) / 100 : null,
      avg_roi7: avg(roiRows),
      avg_activation: avg(activationRows),
      high_count: highCount,
      benchmark_count: fromCases.filter(v => Number(v.benchmark_met) === 1).length,
      latest_publish_date: latest
    };
    const primaryAccount = accounts.find(account => Number(account.is_primary) === 1) || accounts[0] || null;
    const platformsSummary = [...new Set(items.map(item => item.platform).filter(Boolean))].map(platform => {
      const platformItems = items.filter(item => item.platform === platform);
      const platformPlay = platformItems.reduce((sum, item) => sum + (Number(item.play_count) || 0), 0);
      return { platform, role: primaryAccount && platform === primaryAccount.platform ? '主平台' : '分发平台', content_count: platformItems.length,
        total_play: platformPlay, avg_play: platformItems.length ? Math.round(platformPlay / platformItems.length * 100) / 100 : 0 };
    });
    ok(res, { total: items.length, summary, items, fromCases, fromManual, executions, phase, accounts, platformsSummary });
  } catch (e) { fail(res, e.message); }
});

// 创作者删除：级联清理平台账号（须在通用 CRUD 循环前注册）
router.delete('/creators/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM creator_accounts WHERE creator_id=?').run(req.params.id);
    db.prepare('DELETE FROM creators WHERE id=?').run(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e.message); }
});

// 机会删除（级联清理：日志/执行记录，解除案例关联）——须在通用 CRUD 循环前注册
router.delete('/opportunities/:id', (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;
    db.prepare('DELETE FROM opportunity_logs WHERE opportunity_id=?').run(id);
    db.prepare('DELETE FROM executions WHERE opportunity_id=?').run(id);
    db.prepare('UPDATE cases SET linked_opportunity_id=NULL WHERE linked_opportunity_id=?').run(id);
    db.prepare('DELETE FROM opportunities WHERE id=?').run(id);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e.message); }
});

// 内容经营分析：实时分析（第6页）
router.get('/ops/creator-tier-rules', (req, res) => {
  try {
    const db = getDb();
    const result = opsAnalysis.analyze(db, { start: '1900-01-01', end: '1900-01-01' });
    ok(res, result.creator.rules);
  } catch (e) { fail(res, e.message); }
});

router.put('/ops/creator-tier-rules', (req, res) => {
  try {
    const defaults = {
      growth_min_published: 2, growth_min_total_play: 100000,
      growth_min_avg_play: 50000, growth_max_cpm: 80,
      cultivate_max_published: 2, cultivate_min_avg_play: 20000,
      cultivate_max_cpm: 120, bottleneck_min_published: 2,
      bottleneck_max_avg_play: 10000, bottleneck_min_cpm: 150
    };
    const rules = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      const value = Number(req.body && req.body[key]);
      rules[key] = Number.isFinite(value) && value >= 0 ? value : fallback;
    }
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('creator_tier_rules', ?)").run(JSON.stringify(rules));
    saveNow();
    ok(res, rules);
  } catch (e) { fail(res, e.message); }
});

router.get('/ops/analyze', (req, res) => {
  try {
    const db = getDb();
    const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
    const cycleMode = req.query.cycleMode || 'task';
    const start = req.query.start || null;
    const end = req.query.end || null;
    ok(res, opsAnalysis.analyze(db, { campaignId, cycleMode, start, end }));
  } catch (e) { fail(res, e.message); }
});

// 内容经营分析：轻量总览（兼容当前 Vue 页面）
router.get('/ops/overview', (req, res) => {
  try {
    const db = getDb();
    const one = (sql) => db.prepare(sql).get();
    const totalOpps = one('SELECT COUNT(*) c FROM opportunities').c;
    const verified = one("SELECT COUNT(*) c FROM opportunities WHERE status='已验证'").c;
    const totalContent = one('SELECT COUNT(*) c FROM cases').c + one('SELECT COUNT(*) c FROM executions').c;
    const totalCreators = one('SELECT COUNT(*) c FROM creators').c;
    const recent = db.prepare(`
      SELECT id, title, creator_name, platform, publish_date, play_count, activation_d1, roi_d7, result
      FROM cases
      ORDER BY COALESCE(publish_date, created_at) DESC, id DESC
      LIMIT 20
    `).all();
    ok(res, { total_opps: totalOpps, verified, total_content: totalContent, total_creators: totalCreators, recent });
  } catch (e) { fail(res, e.message); }
});

// 内容经营分析：创作者表现列表（兼容当前 Vue 页面）
router.get('/ops/creators', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        c.id,
        c.name,
        COALESCE((SELECT platform FROM creator_accounts a WHERE a.creator_id=c.id ORDER BY is_primary DESC, id ASC LIMIT 1), c.platform) AS platform,
        COALESCE(c.coop_count, 0) AS cooperated_count,
        ((SELECT COUNT(*) FROM cases ca WHERE ca.creator_id=c.id) + (SELECT COUNT(*) FROM executions e WHERE e.creator_id=c.id)) AS content_count,
        COALESCE((SELECT ROUND(AVG(play_count), 0) FROM cases ca WHERE ca.creator_id=c.id AND play_count>0), c.avg_play, 0) AS avg_play,
        COALESCE((SELECT ROUND(AVG(roi_d7), 2) FROM cases ca WHERE ca.creator_id=c.id AND roi_d7 IS NOT NULL), c.avg_roi7) AS avg_roi7,
        COALESCE((SELECT coop_rating FROM executions e WHERE e.creator_id=c.id AND coop_rating IS NOT NULL ORDER BY id DESC LIMIT 1), '中') AS coop_rating
      FROM creators c
      ORDER BY c.id DESC
    `).all();
    ok(res, rows);
  } catch (e) { fail(res, e.message); }
});

// 模块6：AI 深度洞察（按钮触发；失败/无Key 返回明确降级信息，不影响规则洞察）
router.post('/ops/insight-ai', async (req, res) => {
  let r = null;
  let db = null;
  let model = '';
  try {
    db = getDb();
    const { campaignId, cycleMode, start, end } = req.body || {};
    r = opsAnalysis.analyze(db, { campaignId: campaignId ? Number(campaignId) : null, cycleMode, start, end });
    const cfg = ai.getAiConfig ? ai.getAiConfig() : {};
    model = ai.getSetting ? ai.getSetting('ai_insight_model', cfg.model || '') : (cfg.model || '');
    const insights = await ai.discoverInsights({
      period: r.period, overview: r.overview, layers: r.layers,
      opp: r.opp, creator: r.creator, ruleInsights: (r.insights && r.insights.rules) || []
    });
    const generatedAt = new Date().toISOString();
    if (db) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ops_last_ai_insight_at', ?)").run(generatedAt);
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ops_last_ai_insight_mode', ?)").run('ai');
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ops_last_ai_insight_model', ?)").run(model || '');
      saveNow();
    }
    ok(res, { mode: 'ai', insights, message: 'AI 洞察已生成', generatedAt, model });
  } catch (e) {
    const ruleInsights = (r && r.insights && r.insights.rules) || [];
    const errText = e.message === 'EMPTY_RESPONSE'
      ? 'AI 服务返回内容为空，可能是模型/中转路由对长分析响应不稳定。'
      : String(e.message || '').slice(0, 120);
    const msg = e.message === 'NO_API_KEY'
      ? '未配置 AI API Key，已返回规则洞察。'
      : `AI 洞察生成失败，已返回规则洞察：${errText}`;
    ok(res, { mode: 'rule', insights: ruleInsights.slice(0, 4), message: msg, model });
  }
});

// 周期归档：把当前周期的完整分析结果存为 reviews 快照（status='已确认'），供下周期环比/历史平均
// 口径（用户确认）：分析页顶部按钮入口 / 同周期已有快照时前端弹窗选覆盖或取消（force=1 覆盖）/ 存完整分析结果
// 注意：overview 快照的 completion/dataCompleteness 需转成小数（与 seed 历史快照格式一致，buildCompare 中会 *100）
router.post('/ops/archive', (req, res) => {
  try {
    const db = getDb();
    const { campaignId, cycleMode, start, end, user, force } = req.body || {};
    if (!start || !end) return fail(res, '缺少周期起止日期', 400);
    const r = opsAnalysis.analyze(db, { campaignId: campaignId ? Number(campaignId) : null, cycleMode, start, end });
    const m = (r.overview && r.overview.metrics) || {};
    // 基线兼容格式：completion/dataCompleteness 转小数
    const snapOverview = { ...m, completion: (m.completion || 0) / 100, dataCompleteness: (m.dataCompleteness || 0) / 100 };
    const analysisJson = JSON.stringify({ overview: snapOverview, full: r, archivedAt: new Date().toISOString() });
    const label = `${start} ~ ${end}`;
    const title = `内容经营分析归档 ${label}`;
    const statsJson = JSON.stringify({ period: label, published: m.published, total_play: m.totalPlay, avg_roi7: m.avgRoi7, avg_activation: m.avgActivation });
    const exist = db.prepare(`SELECT id,title FROM reviews WHERE period_start=? AND period_end=? AND cycle_mode=? ${campaignId ? 'AND campaign_id=?' : ''}`)
      .get(start, end, cycleMode || 'task', ...(campaignId ? [Number(campaignId)] : []));
    if (exist && !force) return ok(res, { exists: true, id: exist.id, title: exist.title });
    if (exist) {
      db.prepare(`UPDATE reviews SET title=?, stats_json=?, analysis_json=?, period_label=?, status='已确认', confirmed_by=?, campaign_id=? WHERE id=?`)
        .run(title, statsJson, analysisJson, label, user || '', campaignId ? Number(campaignId) : null, exist.id);
      return ok(res, { archived: true, id: exist.id, updated: true });
    }
    const ins = db.prepare(`INSERT INTO reviews (title,period_start,period_end,stats_json,content,ai_generated,status,confirmed_by,campaign_id,cycle_mode,period_label,analysis_json) VALUES (?,?,?,?,?,?,'已确认',?,?,?,?,?)`)
      .run(title, start, end, statsJson, '（周期归档快照，供环比与历史平均对照）', 1, user || '', campaignId ? Number(campaignId) : null, cycleMode || 'task', label, analysisJson);
    ok(res, { archived: true, id: ins.lastInsertRowid, updated: false });
  } catch (e) { fail(res, e.message); }
});

// 模块8：反哺查询接口 —— 有效经验（供机会推荐/创作者匹配/AI策略消费；机会详情抽屉「相关经验」也走这里）
// 注意：必须注册在通用 CRUD 循环之前，否则会被 /experiences/:id 拦截
router.get('/experiences/effective', (req, res) => {
  try {
    const { direction, platform } = req.query;
    ok(res, opsAnalysis.getEffectiveExperiences(getDb(), { direction, platform }));
  } catch (e) { fail(res, e.message); }
});

// 候选热点 → 关联发布视频（沿链路：热点→机会→案例，取成片 url 作为外部视频链接）
// 注册在通用 CRUD 循环前；路径 3 段，不会被 /:table/:id（2段）拦截
router.get('/hotspots/:id/video', (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const hs = db.prepare('SELECT id,title,platform,status,url FROM hotspots WHERE id=?').get(id);
    if (!hs) return fail(res, '热点不存在', 404);
    const cases = [];
    const seen = new Set();
    const pushCase = (row) => {
      if (!row || seen.has(row.id) || !row.url) return;
      seen.add(row.id);
      cases.push({ id: row.id, title: row.title, url: row.url, platform: row.platform, source: row.source, via: 'link' });
    };
    const oppRows = db.prepare('SELECT id FROM opportunities WHERE hotspot_id=?').all(id);
    if (oppRows.length) {
      const ids = oppRows.map(o => o.id);
      db.prepare(`SELECT id,title,url,platform,source FROM cases WHERE linked_opportunity_id IN (${ids.map(() => '?').join(',')})`).all(ids).forEach(pushCase);
    }
    // 兜底：若链路无关联成片但热点自身带来源链接，也允许跳转
    if (!cases.length && hs.url) {
      cases.push({ id: null, title: hs.title + '（来源链接）', url: hs.url, platform: hs.platform, source: 'hotspot', via: 'hotspot' });
    }
    ok(res, { hotspotId: id, hotspotTitle: hs.title, status: hs.status, cases });
  } catch (e) { fail(res, e.message); }
});

/* ============ 今日推荐机会：生成创意内容（AI） ============ */
router.post('/today/recommendations/creative', async (req, res) => {
  try {
    const db = getDb();
    const { title, angle, reason, creatorName, user } = req.body || {};
    if (!title && !angle && !reason) return fail(res, '缺少机会内容', 400);
    const campaign = rec.activeCampaigns(db)[0] || null;
    const r = await ai.generateCreative({ title, angle, reason, creatorName, user, campaign });
    ok(res, r);
  } catch (e) { fail(res, e.message); }
});

/* ============ 创作者匹配：为某条内容找适合的创作者 ============ */
// 输入 {text}（机会标题+角度），按创作者标签（擅长玩法/类型/角色/分类）与文本做重叠打分，返回排序后的适配创作者。
router.post('/creators/match', async (req, res) => {
  try {
    const db = getDb();
    const text = String((req.body && req.body.text) || '').toLowerCase();
    const creators = db.prepare('SELECT * FROM creators').all();
    const tokens = text.split(/[\s,，、#]+/).filter(t => t.length >= 2);
    const scored = creators.map(c => {
      const tags = [...(c.categories || '').split(/[,，]/), ...(c.content_type || '').split(/[,，]/),
        ...(c.good_play || '').split(/[,，]/), ...(c.good_role || '').split(/[,，]/), ...(c.style || '').split(/[,，]/)]
        .map(t => t.trim().toLowerCase()).filter(Boolean);
      let hit = 0; const matched = new Set();
      tokens.forEach(t => tags.forEach(tag => {
        if (tag && (tag.includes(t) || t.includes(tag)) && t.length >= 2) { hit++; matched.add(tag); }
      }));
      return { ...c, hit, matched: [...matched] };
    }).filter(c => c.hit > 0 || c.is_new)
      .sort((a, b) => b.hit - a.hit)
      .slice(0, 8)
      .map(c => ({ id: c.id, name: c.name, platform: c.platform, fans: c.fans, status: c.status,
        hit: c.hit, matched: c.matched, good_play: c.good_play, content_type: c.content_type }));
    ok(res, { items: scored });
  } catch (e) { fail(res, e.message); }
});

/* ============ 推荐机会 → 机会 + 执行待办（待发布） ============ */
// 把一条「今日推荐机会」转为正式机会（同标题去重），并为其创建一条「待发布」执行记录（即进入今日工作·执行待办），
// 关联所选创作者。所有操作记录 created_by（多用户协作）。
router.post('/opportunities/from-reco', async (req, res) => {
  try {
    const db = getDb();
    const { title, angle, reason, creator_id, creative, user } = req.body || {};
    if (!title) return fail(res, '缺少机会标题', 400);
    if (!creator_id) return fail(res, '请选择创作者', 400);
    const creator = db.prepare('SELECT id,name,platform FROM creators WHERE id=?').get(creator_id);
    if (!creator) return fail(res, '创作者不存在', 400);
    const camp = db.prepare("SELECT * FROM campaigns WHERE is_current=1").get()
      || db.prepare("SELECT * FROM campaigns WHERE status='执行中' ORDER BY id DESC LIMIT 1").get();

    // 去重：同标题且未关闭的机会直接复用
    let opp = db.prepare('SELECT * FROM opportunities WHERE title=? AND status NOT IN (\'已验证\',\'不采用\',\'已过期\')').get(title);
    if (!opp) {
      const info = db.prepare(`INSERT INTO opportunities
        (title, campaign_id, status, direction, basis, note, created_by, created_at)
        VALUES (?,?,?,?,?,?,?, datetime('now','localtime'))`)
        .run(title, camp ? camp.id : null, '待判断',
          angle || '', `推荐理由：${reason || ''}`,
          `来源：今日推荐机会${creative ? '\n创意方案：\n' + creative : ''}`,
          user || '', );
      opp = db.prepare('SELECT * FROM opportunities WHERE id=?').get(info.lastInsertRowid);
    }
    // 执行记录（待发布）→ 自动出现在「今日工作·执行待办」
    const exInfo = db.prepare(`INSERT INTO executions
      (opportunity_id, creator_id, creator_name, stage, note, created_by, created_at)
      VALUES (?,?,?,?,?,?, datetime('now','localtime'))`)
      .run(opp.id, creator.id, creator.name, '待发布',
        `创意方案：\n${creative || ''}`, user || '');
    // 记录操作日志
    try {
      db.prepare(`INSERT INTO opportunity_logs (opportunity_id, action, note, user, created_at)
        VALUES (?,?,?,?, datetime('now','localtime'))`)
        .run(opp.id, '从推荐机会创建', `匹配创作者「${creator.name}」进入执行待办`, user || '');
    } catch (e) { /* opportunity_logs 可能不存在则忽略 */ }
    ok(res, { opportunity_id: opp.id, execution_id: exInfo.lastInsertRowid, creator: creator.name });
  } catch (e) { fail(res, e.message); }
});

/* ============ 案例：批量按播放数据重判结果（系统判定，供历史数据一键重算） ============ */
router.get('/cases/rating-rules', (req, res) => {
  try { ok(res, getCaseRatingRules(getDb())); }
  catch (e) { fail(res, e.message); }
});

router.put('/cases/rating-rules', (req, res) => {
  try {
    const db = getDb();
    const rules = {};
    for (const [key, fallback] of Object.entries(DEFAULT_CASE_RATING_RULES)) {
      const value = Number(req.body && req.body[key]);
      if (!Number.isFinite(value) || value < 0) return fail(res, `${key} 必须是大于等于 0 的数字`, 400);
      rules[key] = value;
    }
    if (rules.viral_play < rules.good_play || rules.good_play < rules.normal_play) {
      return fail(res, '播放量阈值必须满足：爆款 ≥ 良好 ≥ 一般', 400);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('case_rating_rules', ?)").run(JSON.stringify(rules));
    const rows = db.prepare('SELECT * FROM cases').all();
    const upd = db.prepare('UPDATE cases SET result=? WHERE id=?');
    let updated = 0;
    for (const c of rows) {
      const result = judgeCaseResult(c, rules);
      if (result !== c.result) { upd.run(result, c.id); updated++; }
    }
    ok(res, { rules, total: rows.length, updated });
  } catch (e) { fail(res, e.message); }
});

router.post('/cases/rejudge', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cases').all();
    const upd = db.prepare('UPDATE cases SET result=? WHERE id=?');
    const rules = getCaseRatingRules(db);
    const dist = {};
    let updated = 0;
    for (const c of rows) {
      const r = judgeCaseResult(c, rules);
      dist[r] = (dist[r] || 0) + 1;
      if (r !== c.result) { upd.run(r, c.id); updated++; }
    }
    ok(res, { total: rows.length, updated, dist });
  } catch (e) { fail(res, e.message); }
});

router.post('/cases/analyze-missing', async (req, res) => {
  try {
    const rows = getDb().prepare("SELECT id FROM cases WHERE content_type IS NULL OR content_type='' OR play_method IS NULL OR play_method=''").all();
    let aiUpdated = 0;
    for (const row of rows) if (await enrichCaseClassification(row.id)) aiUpdated++;
    ok(res, { total: rows.length, updated: rows.length, aiUpdated });
  } catch (e) { fail(res, e.message); }
});

// 批量重匹配：案例 → 创作者（按 平台+达人昵称/主页链接），修复历史未关联项
router.post('/cases/rematch', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM cases WHERE (creator_id IS NULL OR creator_id='') AND creator_name IS NOT NULL AND creator_name <> ''").all();
    const upd = db.prepare('UPDATE cases SET creator_id=? WHERE id=?');
    let updated = 0;
    for (const c of rows) {
      const cid = resolveCreatorId(db, { creator_name: c.creator_name, platform: c.platform, home_url: c.home_url });
      if (cid) { upd.run(cid, c.id); updated++; }
    }
    ok(res, { scanned: rows.length, updated });
  } catch (e) { fail(res, e.message); }
});

// 批量回填：把导入的案例纳入经营分析（source='项目执行结果'；系统发现的热点转案例不纳入）
router.post('/cases/fix-source', (req, res) => {
  try {
    const db = getDb();
    const r = db.prepare("UPDATE cases SET source='项目执行结果' WHERE source IS NULL OR source IN ('人工新增','表格导入')").run();
    ok(res, { updated: r.changes });
  } catch (e) { fail(res, e.message); }
});

// 批量同步改为后台任务，避免创作者较多时被浏览器或 K8s Ingress 判为请求超时。
let syncFansJob = { status: 'idle', total: 0, done: 0, liveOk: 0, caseOk: 0, failCount: 0, startedAt: null, finishedAt: null, error: '' };
async function runSyncFansJob() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, creator_id, platform, account_name, home_url, fans FROM creator_accounts').all();
    syncFansJob = { status: 'running', total: rows.length, done: 0, liveOk: 0, caseOk: 0, failCount: 0, startedAt: new Date().toISOString(), finishedAt: null, error: '' };
    for (const a of rows) {
      let fans = a.fans || 0, name = a.account_name || '', src = null;
      const siblingAccounts = rows.filter(row => Number(row.creator_id) === Number(a.creator_id) && row.id !== a.id);
      const duplicatedAcrossPlatforms = Number(a.fans) > 0 && siblingAccounts.some(row => row.platform !== a.platform && Number(row.fans) === Number(a.fans));
      if (a.home_url) {
        const result = await fetchProfile(a.home_url);
        if (result.ok && result.fans) {
          fans = result.fans;
          if (!name || !name.trim()) name = result.name || name;
          src = 'live'; syncFansJob.liveOk++;
        }
      }
      // 案例库粉丝数只用于空值回填。已有的实时/手动粉丝数优先，避免导入表中的
      // “106W”等非标准值被错误解析后，反向覆盖创作者库的可靠数据。
      if (!src && (!(Number(a.fans) > 0) || duplicatedAcrossPlatforms)) {
        const caseFans = matchFansFromCases(db, a);
        if (caseFans && (!duplicatedAcrossPlatforms || Number(caseFans) !== Number(a.fans))) {
          fans = caseFans; src = 'cases'; syncFansJob.caseOk++;
        }
      }
      if (src) db.prepare('UPDATE creator_accounts SET fans=?, account_name=? WHERE id=?').run(fans, name || '', a.id);
      else syncFansJob.failCount++;
      syncFansJob.done++;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    saveNow();
    syncFansJob.status = 'completed';
    syncFansJob.finishedAt = new Date().toISOString();
  } catch (e) {
    console.error('SYNC-FANS ERR', e && e.stack || e);
    syncFansJob.status = 'failed';
    syncFansJob.error = e && e.message || 'sync error';
    syncFansJob.finishedAt = new Date().toISOString();
  }
}

router.post('/creator-accounts/sync-fans', (req, res) => {
  if (syncFansJob.status === 'running') return ok(res, syncFansJob);
  runSyncFansJob();
  ok(res, { ...syncFansJob, started: true });
});

router.get('/creator-accounts/sync-fans/status', (req, res) => ok(res, syncFansJob));

// 根据创作者主页实时获取平台、昵称和粉丝数，供录入表单即时回填。
router.post('/creators/fetch-profile', async (req, res) => {
  try {
    const url = String((req.body && req.body.url) || '').trim();
    if (!url) return fail(res, '请先填写主页链接', 400);
    const result = await fetchProfile(url);
    if (!result.ok) return fail(res, result.error || '主页数据获取失败', 422);
    ok(res, { platform: result.platform, name: result.name || '', fans: Number(result.fans) || 0, fetched_at: new Date().toISOString() });
  } catch (e) { fail(res, e.message); }
});

for (const [table, cols] of Object.entries(TABLES)) {
  router.get(`/${table}`, (req, res) => {
    try {
      const db = getDb();
      let rows;
      if (table === 'opportunities') {
        rows = db.prepare(`SELECT o.*, c.name as campaign_name, h.title as hotspot_title FROM opportunities o
          LEFT JOIN campaigns c ON o.campaign_id=c.id LEFT JOIN hotspots h ON o.hotspot_id=h.id ORDER BY o.id DESC`).all();
      } else if (table === 'creators') {
        rows = db.prepare(`
          SELECT
            c.*,
            (SELECT platform FROM creator_accounts a WHERE a.creator_id=c.id ORDER BY is_primary DESC, id ASC LIMIT 1) AS primary_platform,
            (SELECT home_url FROM creator_accounts a WHERE a.creator_id=c.id ORDER BY is_primary DESC, id ASC LIMIT 1) AS primary_home_url,
            (SELECT fans FROM creator_accounts a WHERE a.creator_id=c.id ORDER BY is_primary DESC, id ASC LIMIT 1) AS primary_fans,
            (SELECT avg_play FROM creator_accounts a WHERE a.creator_id=c.id ORDER BY is_primary DESC, id ASC LIMIT 1) AS primary_avg_play,
            (SELECT ROUND(AVG(play_count), 0) FROM cases ca WHERE ca.creator_id=c.id AND ca.play_count>0) AS case_avg_play,
            (SELECT avg_roi7 FROM creator_accounts a WHERE a.creator_id=c.id ORDER BY is_primary DESC, id ASC LIMIT 1) AS primary_avg_roi7
          FROM creators c
          ORDER BY c.id DESC
        `).all().map(r => ({
          ...r,
          platform: r.primary_platform || r.platform,
          home_url: r.primary_home_url || r.home_url,
          fans: r.primary_fans ?? r.fans,
          avg_play: r.case_avg_play ?? r.primary_avg_play ?? r.avg_play,
          avg_roi7: r.primary_avg_roi7 ?? r.avg_roi7
        }));
      } else if (table === 'cases') {
        const selectCols = ['id', ...cols, 'created_at'];
        rows = db.prepare(`SELECT ${selectCols.join(',')} FROM cases ORDER BY id DESC`).all();
      } else {
        rows = db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
      }
      ok(res, rows);
    } catch (e) { fail(res, e.message); }
  });

  router.get(`/${table}/:id`, (req, res) => {
    try {
      if (table === 'cases') {
        const selectCols = ['id', ...cols, 'created_at'];
        return ok(res, getDb().prepare(`SELECT ${selectCols.join(',')} FROM cases WHERE id=?`).get(req.params.id));
      }
      ok(res, getDb().prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id));
    }
    catch (e) { fail(res, e.message); }
  });

  router.post(`/${table}`, (req, res) => {
    try {
      const db = getDb();
      const vals = cols.map(c => req.body[c] === undefined ? null : req.body[c]);
      const r = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
      if (table === 'hotspots') {
        const nh = db.prepare('SELECT * FROM hotspots WHERE id=?').get(r.lastInsertRowid);
        try { rec.screenHotspotById(db, nh); } catch (e) {}
      }
      if (table === 'creators' && (req.body.platform || req.body.home_url)) {
        db.prepare(`INSERT INTO creator_accounts
          (creator_id, platform, account_name, home_url, fans, avg_play, avg_activation, avg_roi7, role, is_primary, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '创作', 1, datetime('now','localtime'))`)
          .run(
            r.lastInsertRowid,
            req.body.platform || 'B站',
            req.body.name || '',
            req.body.home_url || null,
            req.body.fans || 0,
            req.body.avg_play || 0,
            req.body.avg_activation ?? null,
            req.body.avg_roi7 ?? null
          );
      }
      ok(res, { id: r.lastInsertRowid });
    } catch (e) { fail(res, e.message); }
  });

  router.put(`/${table}/:id`, (req, res) => {
    try {
      const db = getDb();
      const sets = [], vals = [];
      for (const c of cols) {
        if (req.body[c] !== undefined) { sets.push(`${c}=?`); vals.push(req.body[c]); }
      }
      if (table === 'opportunities') sets.push(`updated_at=datetime('now','localtime')`);
      if (!sets.length) return fail(res, '无更新字段', 400);
      // 案例保存：若更新了播放相关字段，自动按播放数据重新判定结果
      if (table === 'cases') {
        const cur = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
        const merged = { ...cur };
        for (const f of ['play_count', 'fans', 'like_count', 'comment_count', 'favorite_count', 'share_count', 'activation_d1', 'roi_d7', 'cost']) {
          if (req.body[f] !== undefined) merged[f] = req.body[f];
        }
        db.prepare('UPDATE cases SET result=? WHERE id=?').run(judgeCaseResult(merged), req.params.id);
      }
      vals.push(req.params.id);
      db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`).run(...vals);
      if (table === 'creators' && (req.body.platform !== undefined || req.body.home_url !== undefined || req.body.fans !== undefined || req.body.avg_play !== undefined || req.body.avg_activation !== undefined || req.body.avg_roi7 !== undefined || req.body.name !== undefined)) {
        const c = db.prepare('SELECT * FROM creators WHERE id=?').get(req.params.id);
        const acc = db.prepare('SELECT * FROM creator_accounts WHERE creator_id=? ORDER BY is_primary DESC, id ASC LIMIT 1').get(req.params.id);
        const platform = req.body.platform ?? acc?.platform ?? c.platform ?? 'B站';
        const accountName = req.body.name ?? acc?.account_name ?? c.name ?? '';
        const homeUrl = req.body.home_url ?? acc?.home_url ?? c.home_url ?? null;
        const fans = req.body.fans ?? acc?.fans ?? c.fans ?? 0;
        const avgPlay = req.body.avg_play ?? acc?.avg_play ?? c.avg_play ?? 0;
        const avgActivation = req.body.avg_activation ?? acc?.avg_activation ?? c.avg_activation ?? null;
        const avgRoi7 = req.body.avg_roi7 ?? acc?.avg_roi7 ?? c.avg_roi7 ?? null;
        if (acc) {
          db.prepare('UPDATE creator_accounts SET platform=?, account_name=?, home_url=?, fans=?, avg_play=?, avg_activation=?, avg_roi7=?, is_primary=1 WHERE id=?')
            .run(platform, accountName, homeUrl, fans, avgPlay, avgActivation, avgRoi7, acc.id);
        } else {
          db.prepare(`INSERT INTO creator_accounts
            (creator_id, platform, account_name, home_url, fans, avg_play, avg_activation, avg_roi7, role, is_primary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '创作', 1, datetime('now','localtime'))`)
            .run(req.params.id, platform, accountName, homeUrl, fans, avgPlay, avgActivation, avgRoi7);
        }
      }
      if (table === 'opportunities' && (req.body.status === '已发布' || req.body.status === '已验证')) {
        try { autoDepositCase(db, parseInt(req.params.id, 10)); } catch (e) { console.warn('[autoDeposit]', e.message); }
      }
      ok(res, { updated: true });
    } catch (e) { fail(res, e.message); }
  });

  router.delete(`/${table}/:id`, (req, res) => {
    try {
      getDb().prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
      ok(res, { deleted: true });
    } catch (e) { fail(res, e.message); }
  });
}

/* ============ 营销任务：当前任务 / AI提取 / 规则摘要 ============ */
const RISK_LABEL = { opinion: '舆情风险', copyright: '版权风险', char_error: '角色设定错误', ip_unauth: '未授权IP使用', exaggerate: '过度夸大宣传', platform_rule: '不符合平台规则', high_cost: '制作成本过高', real_person: '过度依赖真人拍摄', outdated: '已经过时的热点', koc_mismatch: '不适合KOC能力的玩法' };

// 规则兜底：自然语言 → 结构化营销重点（轻量提取）
function ruleExtractFocus(text) {
  const fields = { role: '', play: '', selling_point: '', linkage: '', node: '', cognition: '', gap: '' };
  const map = [
    [/角色|重点角色/, 'role'], [/玩法|重点玩法/, 'play'],
    [/卖点|版本卖点|亮点/, 'selling_point'], [/联动/, 'linkage'],
    [/节点|节日|营销节点/, 'node'], [/认知|希望强化/, 'cognition'],
    [/缺口|内容缺口/, 'gap']
  ];
  // 中文/英文逗号都作为切分，逐句扫描每个字段关键词
  const segs = String(text).split(/[。；;.\n，,]+/).map(s => s.trim()).filter(Boolean);
  for (const seg of segs) {
    for (const [re, key] of map) {
      const m = seg.match(re);
      if (m && !fields[key]) {
        const val = seg.slice(m.index + m[0].length).replace(/^[：:是\s]+/, '').trim();
        if (val) fields[key] = val.slice(0, 40);
      }
    }
  }
  return fields;
}

// 规则兜底：根据任务配置生成推荐规则摘要
function ruleSummaryFromCampaign(c) {
  const prefs = rec.parseJson(c.prefs, {});
  const risks = rec.parseJson(c.risk_rules, {});
  const goals = rec.parseJson(c.goals, {});
  const lines = [];
  const pPrimary = Array.isArray(goals.primary) ? goals.primary.join('、') : '';
  const pSecondary = Array.isArray(goals.secondary) ? goals.secondary.join('、') : '';
  if (pPrimary) lines.push(`本期主目标：${pPrimary}${pSecondary ? '；次目标：' + pSecondary : ''}。`);
  if (prefs.platform && prefs.platform.length) lines.push(`优先平台：${prefs.platform.join('、')}。`);
  if (prefs.creator_type && prefs.creator_type.length) lines.push(`优先创作者类型：${prefs.creator_type.join('、')}。`);
  if (prefs.content_form && prefs.content_form.length) lines.push(`优先内容形式：${prefs.content_form.join('、')}。`);
  if (prefs.play_method && prefs.play_method.length) lines.push(`优先玩法：${prefs.play_method.join('、')}。`);
  if (prefs.cycle) lines.push(`可接受制作周期：${prefs.cycle}。`);
  if (prefs.cost) lines.push(`可接受制作成本：¥${prefs.cost}。`);
  if (prefs.same_day) lines.push('优先当天可发布的内容。');
  if (prefs.require_case) lines.push('倾向存在历史成功案例的方向。');
  const forbids = Object.entries(risks).filter(([, v]) => v === 'forbid').map(([k]) => RISK_LABEL[k]).filter(Boolean);
  const cautions = Object.entries(risks).filter(([, v]) => v === 'caution').map(([k]) => RISK_LABEL[k]).filter(Boolean);
  if (forbids.length) lines.push(`红线（不得推荐）：${forbids.join('、')}。`);
  if (cautions.length) lines.push(`谨慎（降权）：${cautions.join('、')}。`);
  return lines.length ? lines.join('') : '（暂无配置，保存营销重点/偏好/风险规则后点击“重新解析”生成摘要）';
}

// 设为当前任务（同一时间仅一个）
router.post('/campaigns/:id/set-current', (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
    if (!c) return fail(res, '任务不存在', 404);
    db.prepare('UPDATE campaigns SET is_current=0').run();
    db.prepare('UPDATE campaigns SET is_current=1 WHERE id=?').run(c.id);
    ok(res, { current: c.id });
  } catch (e) { fail(res, e.message); }
});

// 自然语言 → 结构化营销重点（AI提取，失败降级规则）
router.post('/campaigns/:id/extract-focus', async (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
    if (!c) return fail(res, '任务不存在', 404);
    const text = (req.body.text || '').trim();
    if (!text) return fail(res, '请提供自然语言描述', 400);
    let detail = null, mode = 'rule', message = null;
    try { detail = await ai.extractFocus(text, c); mode = 'ai'; }
    catch (e) {
      mode = 'rule';
      message = e.message === 'NO_API_KEY' ? '未配置API Key，已用规则提取' : `AI提取失败，已用规则提取（${e.message.slice(0, 60)}）`;
      detail = ruleExtractFocus(text);
    }
    ok(res, { mode, message, detail });
  } catch (e) { fail(res, e.message); }
});

// 生成推荐规则摘要（AI生成，失败降级规则）
router.post('/campaigns/:id/rule-summary', async (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
    if (!c) return fail(res, '任务不存在', 404);
    let summary = null, mode = 'rule', message = null;
    try { summary = await ai.generateRuleSummary(c); mode = 'ai'; }
    catch (e) {
      mode = 'rule';
      message = e.message === 'NO_API_KEY' ? '未配置API Key，已用规则生成' : `AI生成失败，已用规则生成（${e.message.slice(0, 60)}）`;
      summary = ruleSummaryFromCampaign(c);
    }
    if (summary) db.prepare('UPDATE campaigns SET rule_summary=? WHERE id=?').run(summary, c.id);
    ok(res, { mode, message, summary });
  } catch (e) { fail(res, e.message); }
});

/* ============ 热点 → 转机会 ============ */
router.post('/hotspots/:id/to-opportunity', (req, res) => {
  try {
    const db = getDb();
    const h = db.prepare('SELECT * FROM hotspots WHERE id=?').get(req.params.id);
    if (!h) return fail(res, '热点不存在', 404);
    const { campaign_id, title, user } = req.body;
    const camp = campaign_id ? db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaign_id) : null;
    const score = rec.scoreHotspot(h, camp);
    const r = db.prepare(`INSERT INTO opportunities (title,hotspot_id,campaign_id,status,rule_score,rule_detail,created_by) VALUES (?,?,?,?,?,?,?)`)
      .run(title || h.title, h.id, campaign_id || null, '待判断', score.score, JSON.stringify(score.detail), user || '');
    db.prepare("UPDATE hotspots SET status='已转机会' WHERE id=?").run(h.id);
    db.prepare(`INSERT INTO opportunity_logs (opportunity_id,action,note,user) VALUES (?,?,?,?)`)
      .run(r.lastInsertRowid, '创建', `由热点「${h.title}」转化，规则分${score.score}`, user || '');
    ok(res, { id: r.lastInsertRowid, score });
  } catch (e) { fail(res, e.message); }
});

/* ============ 热点动作：保留观察 / 暂不关注 / 标记不准确 ============ */
router.post('/hotspots/:id/action', (req, res) => {
  try {
    const db = getDb();
    const h = db.prepare('SELECT * FROM hotspots WHERE id=?').get(req.params.id);
    if (!h) return fail(res, '热点不存在', 404);
    const { action } = req.body;
    let upd = {}, label = '';
    if (action === 'observe') { upd.observed = 1; label = '保留观察'; }
    else if (action === 'ignore') { upd.status = '已忽略'; label = '暂不关注'; }
    else if (action === 'inaccurate') { upd.status = '不准确'; label = '标记信息不准确'; }
    else return fail(res, '未知操作', 400);
    const sets = Object.keys(upd).map(k => `${k}=?`).join(',');
    db.prepare(`UPDATE hotspots SET ${sets} WHERE id=?`).run(...Object.values(upd), h.id);
    ok(res, { updated: true, label, hotspot: db.prepare('SELECT * FROM hotspots WHERE id=?').get(h.id) });
  } catch (e) { fail(res, e.message); }
});

/* ============ 热点：重新分析（AI生成推荐草稿） ============ */
router.post('/hotspots/:id/analyze', async (req, res) => {
  try {
    const db = getDb();
    const h = db.prepare('SELECT * FROM hotspots WHERE id=?').get(req.params.id);
    if (!h) return fail(res, '热点不存在', 404);
    const camps = rec.activeCampaigns(db);
    let best = null, bestCamp = null;
    for (const c of camps) { const r = rec.scoreHotspot(h, c); if (!best || r.score > best.score) { best = r; bestCamp = c; } }
    const creators = db.prepare('SELECT * FROM creators').all();
    let draft = null, mode = 'rule', errMsg = null;
    try { draft = await ai.generateOpportunityDraft({ hotspot: h, campaign: bestCamp, creators }); }
    catch (e) { mode = 'rule'; errMsg = e.message === 'NO_API_KEY' ? '未配置API Key，已用规则生成' : `AI生成失败，已用规则生成（${e.message.slice(0, 60)}）`; }
    db.prepare('UPDATE hotspots SET ai_draft_json=? WHERE id=?').run(draft ? JSON.stringify(draft) : null, h.id);
    const recommendation = rec.buildRecommendation(h, bestCamp, creators, draft);
    ok(res, { mode, message: errMsg, draft, recommendation });
  } catch (e) { fail(res, e.message); }
});

/* ============ 热点：采纳为正式机会（推荐机会→机会） ============ */
router.post('/hotspots/:id/adopt', async (req, res) => {
  try {
    const db = getDb();
    const h = db.prepare('SELECT * FROM hotspots WHERE id=?').get(req.params.id);
    if (!h) return fail(res, '热点不存在', 404);
    const { campaign_id, draft, user } = req.body;
    const camp = campaign_id ? db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaign_id) : null;
    const score = rec.scoreHotspot(h, camp);
    const creators = db.prepare('SELECT * FROM creators').all();
    let play_method, game_combo, cost, suggested_time, risk_level, risk_note;
    if (draft && (draft.play_method || draft.game_combo)) {
      play_method = draft.play_method; game_combo = draft.game_combo; risk_note = draft.risk_note;
    }
    if (!play_method) {
      const r = rec.buildRecommendation(h, camp, creators, null);
      play_method = r.play_method; game_combo = r.game_combo; risk_note = r.risk_note;
      suggested_time = r.suggested_time; risk_level = r.risk_level; cost = r.cost_estimate;
    }
    const r = db.prepare(`INSERT INTO opportunities
      (title,hotspot_id,campaign_id,status,rule_score,rule_detail,play_method,game_combo,cost,suggested_time,risk_level,risk_note,hotspot_source,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(h.title, h.id, campaign_id || null, '已采纳', score.score, JSON.stringify(score.detail),
        play_method || null, game_combo || null, cost ?? null, suggested_time || h.valid_until || null, risk_level || '中', risk_note || null,
        h.source_label || h.platform, user || '');
    db.prepare("UPDATE hotspots SET status='已转机会' WHERE id=?").run(h.id);
    db.prepare(`INSERT INTO opportunity_logs (opportunity_id,action,note,user) VALUES (?,?,?,?)`)
      .run(r.lastInsertRowid, '采纳推荐', `由热点「${h.title}」采纳，规则分${score.score}`, user || '');
    ok(res, { id: r.lastInsertRowid, score });
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会：AI评估（含规则降级） ============ */
router.post('/opportunities/:id/evaluate', async (req, res) => {
  try {
    const db = getDb();
    const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
    if (!o) return fail(res, '机会不存在', 404);
    const h = o.hotspot_id ? db.prepare('SELECT * FROM hotspots WHERE id=?').get(o.hotspot_id) : null;
    const camp = o.campaign_id ? db.prepare('SELECT * FROM campaigns WHERE id=?').get(o.campaign_id) : null;

    // 相关案例：标签重叠
    const kws = rec.tokenize(`${o.title} ${h ? h.tags : ''} ${h ? h.title : ''}`);
    const allCases = db.prepare('SELECT * FROM cases').all();
    const relCases = allCases.filter(c => {
      const t = `${c.topic_tags} ${c.content_type} ${c.title}`.toLowerCase();
      return kws.some(k => t.includes(k.toLowerCase()));
    }).slice(0, 5);
    const exps = db.prepare("SELECT * FROM experiences WHERE status='已确认'").all();
    const creators = db.prepare('SELECT * FROM creators').all();

    // 规则打分（始终计算，作为兜底和对照）
    const ruleResult = h ? rec.scoreHotspot(h, camp) : { score: null, verdict: null, detail: [] };
    let mode = 'ai', aiResult = null, errMsg = null;
    try {
      aiResult = await ai.evaluateOpportunity({ opportunity: o, hotspot: h, campaign: camp, cases: relCases, experiences: exps, creators });
    } catch (e) {
      mode = 'rule';
      errMsg = e.message === 'NO_API_KEY' ? '未配置API Key，已用规则打分' : `AI调用失败(${e.message.slice(0, 80)})，已降级为规则打分`;
    }

    const upd = { rule_score: ruleResult.score, rule_detail: JSON.stringify(ruleResult.detail) };
    if (aiResult) {
      upd.ai_score = aiResult.score;
      upd.ai_analysis = aiResult.analysis;
      upd.ai_suggestion = aiResult.direction;
    }
    const sets = Object.keys(upd).map(k => `${k}=?`).join(',');
    db.prepare(`UPDATE opportunities SET ${sets}, updated_at=datetime('now','localtime') WHERE id=?`).run(...Object.values(upd), o.id);
    db.prepare(`INSERT INTO opportunity_logs (opportunity_id,action,note,user) VALUES (?,?,?,?)`)
      .run(o.id, 'AI评估', mode === 'ai' ? `AI评分${aiResult.score}（${aiResult.verdict}）` : `规则评分${ruleResult.score}（${ruleResult.verdict}）`, req.body.user || '');

    // 创作者推荐补充（AI给了就用AI的，否则规则）
    let creatorRecs = [];
    if (aiResult && Array.isArray(aiResult.recommended_creator_ids) && aiResult.recommended_creator_ids.length) {
      creatorRecs = aiResult.recommended_creator_ids
        .map(id => creators.find(c => c.id === id)).filter(Boolean)
        .map(c => ({ creator: c, reason: aiResult.creator_reason || 'AI推荐' }));
    } else {
      creatorRecs = rec.recommendCreators(o, h, camp);
    }

    ok(res, { mode, message: errMsg, ai: aiResult, rule: ruleResult, creatorRecs });
  } catch (e) { fail(res, e.message); }
});

/* ============ 案例：机会执行发布后自动沉淀为项目案例 ============ */
function autoDepositCase(db, opportunityId) {
  const existing = db.prepare("SELECT id FROM cases WHERE linked_opportunity_id=? AND source='项目执行结果'").get(opportunityId);
  if (existing) return existing;
  const o = db.prepare(`SELECT o.*, c.name as campaign_name, c.game_name as camp_game, h.title as hotspot_title
    FROM opportunities o LEFT JOIN campaigns c ON o.campaign_id=c.id LEFT JOIN hotspots h ON o.hotspot_id=h.id
    WHERE o.id=?`).get(opportunityId);
  if (!o) return null;
  const ex = db.prepare("SELECT * FROM executions WHERE opportunity_id=? ORDER BY (stage='数据回收') DESC, (stage='已发布') DESC, id DESC").get(opportunityId);
  const benchmark_met = (ex && ex.roi_d7 != null && ex.roi_d7 >= 0.8 && ex.activation_d1 != null && ex.activation_d1 >= 3) ? 1 : 0;
  const djson = o.direction_json ? safeParseJson(o.direction_json) : {};
  const rjson = o.risk_json ? safeParseJson(o.risk_json) : {};
  const analysis = {
    structure: ex ? `${ex.stage || ''}阶段内容` : '项目执行内容',
    why: ex && ex.roi_d7 != null ? (ex.roi_d7 >= 0.8 ? '达到项目基准，转化表现良好' : '未达项目基准，需复盘优化') : '数据待回收',
    borrowable: djson.core || '可复用内容方向',
    irreproducible: (rjson.irreproducible && rjson.irreproducible.note) || '',
    risk_tip: (rjson.opinion && rjson.opinion.note) || '',
    scenario: o.node || ''
  };
  const r = db.prepare(`INSERT INTO cases (title,platform,url,creator_id,creator_name,campaign_id,campaign_name,game_name,content_type,marketing_node,hotspot,play_method,creator_type,topic_tags,raw_content,analysis_json,play_count,like_count,comment_count,activation_d1,roi_d7,cost,result,summary,source,confirm_status,linked_opportunity_id,benchmark_met,review_conclusion,publish_date,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    o.title, o.platform || 'B站', ex ? ex.publish_url : null, ex ? ex.creator_id : null, ex ? ex.creator_name : null,
    o.campaign_id || null, o.campaign_name || null, o.camp_game || null,
    ex ? ex.exec_play_method : null, o.node || null, o.hotspot_title || null, ex ? ex.exec_play_method : (o.play_method || null),
    null, o.hotspot_title || '', null, JSON.stringify(analysis),
    ex ? ex.play_count : 0, ex ? ex.like_count : 0, ex ? ex.comment_count : 0, ex ? ex.activation_d1 : null, ex ? ex.roi_d7 : null, ex ? ex.cost : null,
    ex ? (ex.roi_d7 != null && ex.roi_d7 >= 0.8 ? '良好' : '一般') : '一般',
    ex ? ex.note : null, '项目执行结果', '已收录', o.id, benchmark_met, ex ? ex.note : null,
    ex ? ex.publish_date : null, o.created_by || '系统');
  return { id: r.lastInsertRowid };
}

/* ============ 机会：一键生成内容方向（AI + 规则降级） ============ */
// 规则兜底：内容方向（题材+形式+钩子）
const safeParseJson = s => { try { return JSON.parse(s); } catch (e) { return null; } };

// 规则兜底：生成机会完整方案（机会结论补充 + 推荐依据 + 风险判断 + 内容方向建议）
function rulePlan(o, h, camp, creators) {
  const gameRaw = camp && camp.game_name ? String(camp.game_name).replace(/[《》]/g, '') : '杖剑传说';
  const game = `《${gameRaw}》`;
  const platform = (h && h.platform) || (camp && camp.target_platform) || 'B站';
  const focusD = camp && camp.focus_detail ? safeParseJson(camp.focus_detail) : {};
  const prefs = camp && camp.prefs ? safeParseJson(camp.prefs) : {};
  const riskRules = camp && camp.risk_rules ? safeParseJson(camp.risk_rules) : {};
  let recR = null;
  try { recR = rec.buildRecommendation(h, camp, creators, null); } catch (e) {}
  const play_method = (recR && recR.play_method) || (focusD.play ? `结合${focusD.play}做内容` : '结合版本内容做内容');
  const game_combo = (recR && recR.game_combo) || `将热点与${game}宣发结合`;
  const cost = (prefs && prefs.cost) || 6000;
  const suggested_time = (h && h.valid_until) ? `热点有效期内（${h.valid_until}前）` : '版本窗口内尽快';
  const direction = ruleDirection(h, camp) || `围绕${game}做一条${platform}内容`;
  const lvl = (key, def) => { const v = riskRules[key]; if (v === 'forbid') return '高'; if (v === 'caution') return '中'; return def; };
  const risk_json = {
    opinion: { level: lvl('opinion', '低'), note: '官方正向内容，舆情风险低' },
    copyright: { level: lvl('copyright', '低'), note: '使用官方素材' },
    character: { level: lvl('char_error', '低'), note: '角色设定以官方为准' },
    difficulty: { level: '中', note: '依赖素材与排期' },
    expiry: { level: (h && h.trend === '下降') ? '高' : '中', note: '依赖热点/版本窗口' },
    irreproducible: { level: '低', note: '题材可复用' }
  };
  const direction_json = {
    core: direction.split('。')[0],
    angle: `围绕「${h ? h.title : (o ? o.title : '当前热点')}」做${platform}内容`,
    structure: '引入热点→展开玩法→游戏结合→行动引导',
    must_show: (focusD.selling_point || '版本卖点'),
    forbid: '不得夸大强度/不得暗示付费必赢',
    ref_cases: '参考历史高ROI题材'
  };
  const basis = {
    version_fit: `与${camp ? (camp.version_event || '当前版本') : '当前版本'}强相关`,
    hotspot_dev: `热点趋势${(h && h.trend) || '上升'}`,
    cases: '历史案例库含高ROI题材',
    history_perf: '攻略/养成类历史表现好',
    creators: (creators && creators.length) ? `适配 ${creators.slice(0, 2).map(c => c.name).join('、')}` : '待补充创作者',
    feasibility: '素材可得，制作可行'
  };
  return { platform, suggested_time, cost, play_method, game_combo, direction, basis, risk_json, direction_json, reason: (recR && recR.reason) || '任务强相关+热点窗口+历史依据' };
}

function ruleDirection(h, camp) {
  if (!h) return '';
  const gameRaw = camp && camp.game_name ? String(camp.game_name).replace(/[《》]/g, '') : '杖剑传说';
  const game = `《${gameRaw}》`;
  const PLAT_FORM = { 'B站': '深度测评/攻略向中视频', '抖音': '快节奏卡点/反转短视频', '微博': '话题向图文/短打', '小红书': '清单/种草图文', '快手': '接地气剧情', '视频号': '轻量资讯' };
  const form = PLAT_FORM[h.platform] || '短视频/图文';
  const focus = camp && camp.focus_content ? `，重点落到${camp.focus_content}` : '';
  const hook = h.title ? `以「${h.title}」为钩子` : '以当前热点为钩子';
  return `${hook}，在${h.platform}做一条${form}，带出${game}的版本卖点${focus}。建议1条主内容+切片分发。`;
}

router.post('/opportunities/:id/generate-direction', async (req, res) => {
  try {
    const db = getDb();
    const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
    if (!o) return fail(res, '机会不存在', 404);
    const h = o.hotspot_id ? db.prepare('SELECT * FROM hotspots WHERE id=?').get(o.hotspot_id) : null;
    const camp = o.campaign_id ? db.prepare('SELECT * FROM campaigns WHERE id=?').get(o.campaign_id) : null;
    const creators = db.prepare('SELECT * FROM creators').all();
    // 手动创建的机会可能没有关联热点，用机会标题拼一个最小热点对象给 AI
    const hsForAi = h || { title: o.title, category: '手动创建', platform: camp ? (camp.target_platform || 'B站') : 'B站', heat: null, trend: '—', description: o.decision || '', tags: '' };
    let draft = null, mode = 'rule', errMsg = null;
    try {
      draft = await ai.generateOpportunityDraft({ hotspot: hsForAi, campaign: camp, creators });
      if (!draft || !draft.direction) throw new Error('NO_DIRECTION');
      mode = 'ai';
    } catch (e) {
      mode = 'rule';
      errMsg = e.message === 'NO_API_KEY' ? '未配置API Key，已用规则生成' : `AI生成失败，已用规则生成（${e.message.slice(0, 60)}）`;
      draft = { direction: ruleDirection(h, camp) };
    }
    const direction = (draft && draft.direction) || ruleDirection(h, camp);
    const sets = ['direction=?']; const vals = [direction];
    if (!o.play_method && draft && draft.play_method) { sets.push('play_method=?'); vals.push(draft.play_method); }
    if (!o.game_combo && draft && draft.game_combo) { sets.push('game_combo=?'); vals.push(draft.game_combo); }
    if (!o.risk_note && draft && draft.risk_note) { sets.push('risk_note=?'); vals.push(draft.risk_note); }
    sets.push("updated_at=datetime('now','localtime')");
    db.prepare(`UPDATE opportunities SET ${sets.join(',')} WHERE id=?`).run(...vals, o.id);
    db.prepare(`INSERT INTO opportunity_logs (opportunity_id,action,note,user) VALUES (?,?,?,?)`)
      .run(o.id, '生成方向', mode === 'ai' ? 'AI生成内容方向' : '规则生成内容方向', req.body.user || '');
    ok(res, { mode, message: errMsg, direction, draft: { play_method: draft && draft.play_method, game_combo: draft && draft.game_combo, risk_note: draft && draft.risk_note } });
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会：生成完整方案（机会结论补充+推荐依据+风险判断+内容方向建议，AI+规则降级） ============ */
router.post('/opportunities/:id/generate-plan', async (req, res) => {
  try {
    const db = getDb();
    const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
    if (!o) return fail(res, '机会不存在', 404);
    const h = o.hotspot_id ? db.prepare('SELECT * FROM hotspots WHERE id=?').get(o.hotspot_id) : null;
    const camp = o.campaign_id ? db.prepare('SELECT * FROM campaigns WHERE id=?').get(o.campaign_id) : null;
    const creators = db.prepare('SELECT * FROM creators').all();
    const hsForAi = h || { title: o.title, category: '手动创建', platform: (camp && camp.target_platform) || 'B站', heat: null, trend: '—', description: o.decision || '', tags: '' };
    let plan = null, mode = 'rule', errMsg = null;
    try {
      plan = await ai.generateOpportunityPlan({ opportunity: o, hotspot: hsForAi, campaign: camp, creators });
      if (!plan || !plan.direction) throw new Error('NO_PLAN');
      mode = 'ai';
    } catch (e) {
      mode = 'rule';
      errMsg = e.message === 'NO_API_KEY' ? '未配置API Key，已用规则生成' : `AI生成失败，已用规则生成（${e.message.slice(0, 60)}）`;
      plan = rulePlan(o, h, camp, creators);
    }
    const rj = plan.risk_json || {};
    const sets = ['platform=?', 'suggested_time=?', 'cost=?', 'play_method=?', 'game_combo=?', 'direction=?', 'basis=?', 'risk_json=?', 'direction_json=?', 'risk_level=?', 'risk_note=?', 'plan_generated=1', "updated_at=datetime('now','localtime')"];
    const vals = [
      plan.platform || (h && h.platform) || (camp && camp.target_platform) || 'B站',
      plan.suggested_time || null,
      plan.cost != null ? plan.cost : null,
      plan.play_method || null,
      plan.game_combo || null,
      plan.direction || null,
      JSON.stringify(plan.basis || {}),
      JSON.stringify(plan.risk_json || {}),
      JSON.stringify(plan.direction_json || {}),
      (rj.opinion && rj.opinion.level) || '中',
      (rj.opinion && rj.opinion.note) || null
    ];
    db.prepare(`UPDATE opportunities SET ${sets.join(',')} WHERE id=?`).run(...vals, o.id);
    db.prepare(`INSERT INTO opportunity_logs (opportunity_id,action,note,user) VALUES (?,?,?,?)`).run(o.id, '生成方案', mode === 'ai' ? 'AI生成完整方案' : '规则生成完整方案', req.body.user || '');
    ok(res, { mode, message: errMsg, plan });
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会：根据当前营销任务主动生成候选机会（不落库，供确认） ============ */
router.post('/opportunities/generate-candidates', async (req, res) => {
  try {
    const db = getDb();
    const camps = rec.activeCampaigns(db);
    const camp = camps[0];
    if (!camp) return fail(res, '请先在「营销任务」设置当前任务', 400);
    const templates = db.prepare('SELECT * FROM creative_templates ORDER BY usage_count DESC').all();
    const cases = db.prepare("SELECT * FROM cases WHERE result IN ('爆款','良好') ORDER BY roi_d7 DESC").all();
    const creators = db.prepare('SELECT * FROM creators').all();
    const focusD = camp.focus_detail ? safeParseJson(camp.focus_detail) : {};
    const goals = camp.goals ? safeParseJson(camp.goals) : {};
    const prefs = camp.prefs ? safeParseJson(camp.prefs) : {};
    const game = `《${camp.game_name ? String(camp.game_name).replace(/[《》]/g, '') : '杖剑传说'}》`;
    const candidates = [];
    const sources = templates.length ? templates : [null];
    for (const t of sources.slice(0, 6)) {
      const tpl = t ? { name: t.name, core: t.core_logic, hotspot: t.applicable_hotspot, node: t.applicable_node, creator_type: t.creator_type, cost: t.cost, cases: t.cases } : null;
      const node = (tpl && tpl.node) || (Array.isArray(goals.primary) && goals.primary[0]) || '版本窗口';
      const play = (tpl && tpl.core) || `结合${focusD.play || '版本内容'}做内容`;
      const title = tpl ? `${tpl.name}（候选）` : `基于任务目标的原创机会（候选）`;
      const direction = tpl ? `${tpl.core}；适用节点：${node}` : `围绕${camp.version_event || '当前版本'}做一条${(prefs.platform && prefs.platform[0]) || camp.target_platform || 'B站'}内容`;
      candidates.push({
        title,
        platform: (prefs.platform && prefs.platform[0]) || camp.target_platform || 'B站',
        node,
        play_method: play,
        game_combo: `将节点/热点与${game}宣发结合`,
        direction,
        basis: {
          version_fit: `对齐${camp.version_event || '当前版本'}`,
          hotspot_dev: tpl ? `复用模板「${tpl.name}」` : '原创机会',
          cases: tpl ? (tpl.cases || '—') : (cases[0] ? cases[0].title : '—'),
          history_perf: '参考历史高ROI题材',
          creators: (creators && creators.length) ? creators.slice(0, 2).map(c => c.name).join('、') : '待补充',
          feasibility: '素材可得，制作可行'
        },
        risk_json: {
          opinion: { level: '低', note: '官方正向' }, copyright: { level: '低', note: '使用官方素材' },
          character: { level: '低', note: '设定以官方为准' }, difficulty: { level: '中', note: '依赖排期' },
          expiry: { level: '中', note: '依赖窗口' }, irreproducible: { level: tpl ? '低' : '中', note: tpl ? '模板可复用' : '需验证' }
        },
        suggested_template_id: t ? t.id : null,
        reason: '系统综合创意模板/任务目标/历史案例生成'
      });
    }
    ok(res, { mode: 'rule', candidates });
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会：沉淀为创意模板（从机会结构化内容自动预填） ============ */
router.post('/opportunities/:id/deposit-template', async (req, res) => {
  try {
    const db = getDb();
    const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
    if (!o) return fail(res, '机会不存在', 404);
    const djson = o.direction_json ? safeParseJson(o.direction_json) : {};
    const bjson = o.basis ? safeParseJson(o.basis) : {};
    const rjson = o.risk_json ? safeParseJson(o.risk_json) : {};
    const name = req.body.name || (o.title + ' 创意模板');
    const r = db.prepare(`INSERT INTO creative_templates (name,core_logic,applicable_hotspot,applicable_node,creator_type,cost,cases,usage_count,validation,risks,source_opportunity_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(name, djson.core || o.direction || '', o.hotspot_title || (bjson.hotspot_dev || ''), o.node || (bjson.version_fit || ''), '', o.cost || null, (bjson.cases || ''), 0, '', (rjson.opinion ? rjson.opinion.note : ''), o.id, req.body.user || o.created_by || '');
    db.prepare(`INSERT INTO opportunity_logs (opportunity_id,action,note,user) VALUES (?,?,?,?)`).run(o.id, '沉淀模板', `沉淀为创意模板「${name}」`, req.body.user || '');
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { fail(res, e.message); }
});

/* ============ 案例：AI辅助提取（人工新增） ============ */
router.post('/cases/extract', async (req, res) => {
  try {
    const { text, link } = req.body;
    if (!text && !link) return fail(res, '请提供链接或描述文本', 400);
    let fields = null, mode = 'rule', message = null;
    try { fields = await ai.extractCase({ text: text || '', link: link || '' }); mode = 'ai'; }
    catch (e) {
      mode = 'rule';
      message = e.message === 'NO_API_KEY' ? '未配置API Key，已用规则提取' : `AI提取失败，已用规则提取（${e.message.slice(0, 60)}）`;
      fields = ai.ruleExtractCase(text || '', link || '');
    }
    ok(res, { mode, message, fields });
  } catch (e) { fail(res, e.message); }
});

/* ============ 案例：系统发现确认/退回 ============ */
router.post('/cases/:id/confirm', (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
    if (!c) return fail(res, '案例不存在', 404);
    const action = req.body.action; // 'confirm' | 'reject'
    const status = action === 'reject' ? '已退回' : '已收录';
    db.prepare('UPDATE cases SET confirm_status=? WHERE id=?').run(status, c.id);
    ok(res, { confirm_status: status });
  } catch (e) { fail(res, e.message); }
});

/* ============ 案例：收藏切换 ============ */
router.post('/cases/:id/favorite', (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
    if (!c) return fail(res, '案例不存在', 404);
    const nv = c.is_favorite ? 0 : 1;
    db.prepare('UPDATE cases SET is_favorite=? WHERE id=?').run(nv, c.id);
    ok(res, { is_favorite: nv });
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会：手动沉淀为项目案例 ============ */
router.post('/opportunities/:id/deposit-case', (req, res) => {
  try {
    const db = getDb();
    const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
    if (!o) return fail(res, '机会不存在', 404);
    const dep = autoDepositCase(db, o.id);
    if (!dep) return fail(res, '沉淀失败', 500);
    const sets = [], vals = [];
    if (req.body.review_conclusion !== undefined) { sets.push('review_conclusion=?'); vals.push(req.body.review_conclusion); }
    if (req.body.benchmark_met !== undefined) { sets.push('benchmark_met=?'); vals.push(req.body.benchmark_met ? 1 : 0); }
    if (req.body.note !== undefined) { sets.push('note=?'); vals.push(req.body.note); }
    if (sets.length) { vals.push(dep.id); db.prepare(`UPDATE cases SET ${sets.join(',')} WHERE id=?`).run(...vals); }
    ok(res, { id: dep.id });
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会：创作者匹配（规则） ============ */
router.get('/opportunities/:id/match', (req, res) => {
  try {
    const db = getDb();
    const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
    if (!o) return fail(res, '机会不存在', 404);
    const h = o.hotspot_id ? db.prepare('SELECT * FROM hotspots WHERE id=?').get(o.hotspot_id) : null;
    const camp = o.campaign_id ? db.prepare('SELECT * FROM campaigns WHERE id=?').get(o.campaign_id) : null;
    ok(res, rec.recommendCreators(o, h, camp, 5));
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会日志 ============ */
router.get('/opportunities/:id/logs', (req, res) => {
  try { ok(res, getDb().prepare('SELECT * FROM opportunity_logs WHERE opportunity_id=? ORDER BY id DESC').all(req.params.id)); }
  catch (e) { fail(res, e.message); }
});
router.post('/opportunities/:id/logs', (req, res) => {
  try {
    const r = getDb().prepare('INSERT INTO opportunity_logs (opportunity_id,action,note,user) VALUES (?,?,?,?)')
      .run(req.params.id, req.body.action || '备注', req.body.note || '', req.body.user || '');
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { fail(res, e.message); }
});

/* ============ 机会关联执行记录 ============ */
router.get('/opportunities/:id/executions', (req, res) => {
  try { ok(res, getDb().prepare('SELECT * FROM executions WHERE opportunity_id=? ORDER BY id DESC').all(req.params.id)); }
  catch (e) { fail(res, e.message); }
});

/* ============ 周期复盘：自动生成 ============ */
router.post('/reviews/generate', async (req, res) => {
  try {
    const db = getDb();
    const { period_start, period_end, user } = req.body;
    if (!period_start || !period_end) return fail(res, '请提供复盘周期', 400);

    const opps = db.prepare(`SELECT * FROM opportunities WHERE date(created_at) BETWEEN ? AND ? OR date(updated_at) BETWEEN ? AND ?`)
      .all(period_start, period_end, period_start, period_end);
    const execs = db.prepare(`SELECT e.*, o.title as opp_title FROM executions e LEFT JOIN opportunities o ON e.opportunity_id=o.id
      WHERE (e.publish_date BETWEEN ? AND ?) OR e.opportunity_id IN (${opps.map(o => o.id).join(',') || '0'})`)
      .all(period_start, period_end);
    const campaigns = rec.activeCampaigns(db);

    const published = execs.filter(e => e.stage === '已发布' || e.stage === '数据回收');
    const withData = execs.filter(e => e.roi_d7 != null);
    const stats = {
      period: `${period_start} ~ ${period_end}`,
      opportunities_total: opps.length,
      judged_ok: opps.filter(o => !['待判断', '不采用'].includes(o.status)).length,
      abandoned: opps.filter(o => o.status === '不采用').length,
      published: published.length,
      total_cost: execs.reduce((s, e) => s + (e.cost || 0), 0),
      total_play: execs.reduce((s, e) => s + (e.play_count || 0), 0),
      avg_activation: withData.length ? +(withData.reduce((s, e) => s + (e.activation_d1 || 0), 0) / withData.length).toFixed(2) : null,
      avg_roi7: withData.length ? +(withData.reduce((s, e) => s + (e.roi_d7 || 0), 0) / withData.length).toFixed(2) : null
    };

    let content = '', aiGenerated = 0, message = null;
    try {
      content = await ai.generateReview({ periodStart: period_start, periodEnd: period_end, stats, opportunities: opps, executions: execs, campaigns });
      aiGenerated = 1;
    } catch (e) {
      message = e.message === 'NO_API_KEY' ? '未配置API Key，已生成基础版复盘' : `AI生成失败，已生成基础版复盘（${e.message.slice(0, 60)}）`;
      content = buildFallbackReview(stats, opps, execs);
    }

    const title = `${period_start} ~ ${period_end} 周期复盘`;
    const r = db.prepare(`INSERT INTO reviews (title,period_start,period_end,stats_json,content,ai_generated,status) VALUES (?,?,?,?,?,?,'草稿')`)
      .run(title, period_start, period_end, JSON.stringify(stats), content, aiGenerated);
    ok(res, { id: r.lastInsertRowid, title, stats, content, ai_generated: aiGenerated, message });
  } catch (e) { fail(res, e.message); }
});

function buildFallbackReview(stats, opps, execs) {
  const lines = [];
  lines.push(`## 周期概览`);
  lines.push(`本周期共产生机会 ${stats.opportunities_total} 个，判断通过 ${stats.judged_ok} 个，放弃 ${stats.abandoned} 个，已发布 ${stats.published} 条。`);
  lines.push(`\n## 数据表现`);
  lines.push(`- 总成本：¥${stats.total_cost}｜总播放：${stats.total_play}`);
  lines.push(`- 平均首日激活：${stats.avg_activation ?? '暂无回收数据'}%（目标≥3%）`);
  lines.push(`- 平均7日ROI：${stats.avg_roi7 ?? '暂无回收数据'}（目标≥0.8）`);
  lines.push(`\n## 机会明细`);
  opps.forEach(o => lines.push(`- ${o.title}｜${o.status}｜${o.decision || '未记录结论'}`));
  lines.push(`\n## 执行明细`);
  execs.forEach(e => lines.push(`- ${e.opp_title || ''}｜${e.creator_name || '未定'}｜${e.stage}｜播放${e.play_count || 0}｜ROI7:${e.roi_d7 ?? '未回收'}`));
  lines.push(`\n## 建议沉淀的经验`);
  lines.push(`（AI不可用，请人工补充本周期可复用经验）`);
  return lines.join('\n');
}

router.post('/reviews/:id/confirm', (req, res) => {
  try {
    getDb().prepare("UPDATE reviews SET status='已确认', confirmed_by=? WHERE id=?").run(req.body.user || '', req.params.id);
    ok(res, { confirmed: true });
  } catch (e) { fail(res, e.message); }
});

/* ============ 数据导入（Excel/CSV） ============ */
// 模板列定义
const IMPORT_MAP = {
  hotspots: { cols: { '热点标题': 'title', '来源平台': 'source_label', '平台': 'platform', '分类': 'category', '热度': 'heat', '趋势': 'trend', '预计有效期': 'valid_until', '初步相关性': 'relevance', '风险提示': 'risk_note', '链接': 'url', '描述': 'description', '标签': 'tags' }, required: 'title' },
  creators: { cols: { '昵称': 'name', '主发平台': 'main_platform', '主发平台主页链接': 'main_home_url', '分发平台昵称': 'dist_nickname', '分发平台': 'dist_platform', '分发平台主页链接': 'dist_home_url', '阶段付费金额（元）': 'phase_paid_amount' }, required: 'name' },
  cases: { cols: { '平台': 'platform', '达人昵称': 'creator_name', 'ID': 'creator_platform_id', '视频发布时间': 'publish_date', '视频链接': 'url', '播放数': 'play_count', '粉丝数': 'fans', '视频文案': 'copy', '点赞数': 'like_count', '评论数': 'comment_count', '收藏数': 'favorite_count', '分享数': 'share_count' }, required: 'creator_name' },
  executions: { cols: { '机会ID': 'opportunity_id', '创作者': 'creator_name', '主页链接': 'home_url', '阶段': 'stage', '发布链接': 'publish_url', '发布日期': 'publish_date', '播放量': 'play_count', '点赞': 'like_count', '评论': 'comment_count', '首日激活率': 'activation_d1', '7日ROI': 'roi_d7', '成本': 'cost', '收入': 'income', '备注': 'note' }, required: 'opportunity_id' }
};

// 按 主页链接(平台+链接) 或 创作者名/账号名 解析到创作者（支持同一作者不同平台名字不同）
// 归一化账号名：去括号/方括号、去首尾空格、转小写（用于模糊匹配平台昵称）
function normName(s) {
  if (!s) return '';
  return String(s)
    .replace(/[（(【].*?[)）】]/g, '') // 去掉 （...）/ (...) / 【...】
    .replace(/\s+/g, '')
    .toLowerCase();
}
function resolveCreatorId(db, { creator_name, platform, home_url }) {
  if (home_url) {
    const byPU = db.prepare('SELECT creator_id FROM creator_accounts WHERE platform=? AND home_url=? LIMIT 1').get(platform || '', home_url);
    if (byPU) return byPU.creator_id;
    const byU = db.prepare('SELECT creator_id FROM creator_accounts WHERE home_url=? LIMIT 1').get(home_url);
    if (byU) return byU.creator_id;
  }
  if (creator_name) {
    // 精确（归一化）匹配平台账号名；兜底用包含关系，同平台优先
    const nName = normName(creator_name);
    const byAccP = platform ? db.prepare('SELECT creator_id, account_name FROM creator_accounts WHERE platform=?').all(platform) : [];
    const byAccAll = db.prepare('SELECT creator_id, account_name FROM creator_accounts').all();
    for (const a of byAccP) { if (normName(a.account_name) === nName) return a.creator_id; }
    for (const a of byAccAll) { if (normName(a.account_name) === nName) return a.creator_id; }
    for (const a of byAccP) { const na = normName(a.account_name); if (na && nName && (na.includes(nName) || nName.includes(na))) return a.creator_id; }
    for (const a of byAccAll) { const na = normName(a.account_name); if (na && nName && (na.includes(nName) || nName.includes(na))) return a.creator_id; }
  }
  return null;
}

router.post('/import/:type', upload.single('file'), (req, res) => {
  try {
    const map = IMPORT_MAP[req.params.type];
    if (!map) return fail(res, '不支持的导入类型', 400);
    if (!req.file) return fail(res, '请上传文件', 400);
    // 自动识别 xlsx(以 PK 开头的 zip) / csv(其余)：CSV 必须以字符串模式读取，
    // 否则 UTF-8 中文表头会被按二进制解码成乱码，导致必填项缺失而被静默跳过
    const head = req.file.buffer.slice(0, 2).toString('latin1');
    const isXlsx = head === 'PK';
    let wb;
    if (isXlsx) {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } else {
      let s = req.file.buffer.toString('utf-8');
      if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // 去除 UTF-8 BOM
      wb = XLSX.read(s, { type: 'string' });
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    if (!rows.length) return fail(res, '表格为空', 400);

    const db = getDb();
    const cols = TABLES[req.params.type];
    let inserted = 0, updated = 0, skipped = 0, paymentImported = 0;
    const importCampaignId = Number(req.query.campaign_id) || null;
    if (req.params.type === 'creators' && importCampaignId) {
      const campaign = db.prepare('SELECT id FROM campaigns WHERE id=?').get(importCampaignId);
      if (!campaign) return fail(res, '所选营销阶段不存在', 400);
    }
    if (req.params.type === 'creators') {
      const paymentRows = rows.filter(row => row['阶段付费金额（元）'] !== undefined && row['阶段付费金额（元）'] !== '');
      if (paymentRows.length && !importCampaignId) return fail(res, '模板包含阶段付费金额，请先选择营销阶段后再导入', 400);
      const invalid = paymentRows.find(row => !Number.isFinite(Number(row['阶段付费金额（元）'])) || Number(row['阶段付费金额（元）']) < 0);
      if (invalid) return fail(res, `${invalid['昵称'] || '某位创作者'} 的阶段付费金额格式不正确`, 400);
    }
    for (const row of rows) {
      const record = {};
      for (const [cn, en] of Object.entries(map.cols)) {
        if (row[cn] !== undefined) record[en] = row[cn];
        else if (row[en] !== undefined) record[en] = row[en]; // 兼容英文列名
      }
      if ((req.params.type === 'cases' || req.params.type === 'executions') && req.query.platform && !record.platform) {
        record.platform = String(req.query.platform);
      }
      if (!record[map.required]) { skipped++; continue; }
      // CSV/xlsx 导入时日期常被推断为 Excel 序列数字（如 2026-07-29 → 46232.33），转回 YYYY-MM-DD 字符串
      if (record.publish_date != null && typeof record.publish_date === 'number') {
        const excelEpoch = Date.UTC(1899, 11, 30);
        const d = new Date(excelEpoch + Math.round(record.publish_date * 86400 * 1000));
        const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
        record.publish_date = `${y}-${m}-${day}`;
      }
      if (req.params.type === 'hotspots') record.source = '表格导入';
      if (req.params.type === 'cases') {
        record.source = '项目执行结果';
        // 发布数据表模板无「标题」列：用「视频文案」前 20 字当标题，保证 cases.title(NOT NULL) 有值
        if (!record.title) {
          const base = (record.copy || '').toString().trim();
          record.title = base ? base.slice(0, 20) : `${record.creator_name || '未知达人'} 的发布`;
        }
      }
      let existingCreatorId = null;
      if (req.params.type === 'creators') {
        existingCreatorId = resolveCreatorId(db, {
          creator_name: record.name,
          platform: record.main_platform,
          home_url: record.main_home_url
        });
        if (!existingCreatorId) {
          const sameName = db.prepare('SELECT id,name FROM creators').all().find(item => normName(item.name) === normName(record.name));
          existingCreatorId = sameName ? sameName.id : null;
        }
      }
      const useCols = cols.filter(c => record[c] !== undefined);
      let r;
      if (existingCreatorId) {
        r = { lastInsertRowid: existingCreatorId };
        updated++;
      } else {
        r = db.prepare(`INSERT INTO ${req.params.type} (${useCols.join(',')}) VALUES (${useCols.map(() => '?').join(',')})`)
          .run(...useCols.map(c => record[c]));
        inserted++;
      }
      // 案例导入：按播放数据自动判定结果（系统替用户判断，非手动选择）
      if (req.params.type === 'cases') {
        db.prepare('UPDATE cases SET result=? WHERE id=?').run(judgeCaseResult(record), r.lastInsertRowid);
        const ruleFields = ai.ruleExtractCase(caseAnalysisText(record), record.url || '');
        applyCaseClassification(db, r.lastInsertRowid, ruleFields, 'rule');
        setImmediate(() => enrichCaseClassification(r.lastInsertRowid));
      }
      // 创作者导入（新模板：昵称 + 主发平台账号 + 可选分发平台账号），两层模型落库避免作者冗余
      if (req.params.type === 'creators') {
        const mainPlat = (record.main_platform || '').trim();
        const distPlat = (record.dist_platform || '').trim();
        if (!existingCreatorId && mainPlat) {
          const ins = db.prepare(`INSERT INTO creator_accounts (creator_id,platform,account_name,home_url,role,is_primary,created_at) VALUES (?,?,?,?,?,?,datetime('now','localtime'))`)
            .run(r.lastInsertRowid, mainPlat, record.name || '', (record.main_home_url || '').trim() || null, '创作', 1);
          const hu = (record.main_home_url || '').trim();
          if (hu) setImmediate(() => fillAccountFans(hu, ins.lastInsertRowid));
        }
        if (!existingCreatorId && distPlat) {
          // 仅当没有主发平台时，分发账号才置为主账号
          const ins2 = db.prepare(`INSERT INTO creator_accounts (creator_id,platform,account_name,home_url,role,is_primary,created_at) VALUES (?,?,?,?,?,?,datetime('now','localtime'))`)
            .run(r.lastInsertRowid, distPlat, (record.dist_nickname || '').trim() || (record.name || ''), (record.dist_home_url || '').trim() || null, '分发', mainPlat ? 0 : 1);
          const hu2 = (record.dist_home_url || '').trim();
          if (hu2) setImmediate(() => fillAccountFans(hu2, ins2.lastInsertRowid));
        }
        // creators.platform 为冗余旧列（平台信息已下放到 creator_accounts），清空避免默认 'B站' 误导
        if (!existingCreatorId) db.prepare(`UPDATE creators SET platform=NULL WHERE id=?`).run(r.lastInsertRowid);
        if (record.phase_paid_amount !== undefined && record.phase_paid_amount !== '') {
          if (!importCampaignId) return fail(res, '模板包含阶段付费金额，请先选择营销阶段后再导入', 400);
          const paidAmount = Number(record.phase_paid_amount);
          if (!Number.isFinite(paidAmount) || paidAmount < 0) return fail(res, `${record.name} 的阶段付费金额格式不正确`, 400);
          db.prepare(`INSERT INTO creator_phase_costs (creator_id,campaign_id,paid_amount,note,updated_at)
            VALUES (?,?,?,?,datetime('now','localtime'))
            ON CONFLICT(creator_id,campaign_id) DO UPDATE SET paid_amount=excluded.paid_amount,note=excluded.note,updated_at=datetime('now','localtime')`)
            .run(r.lastInsertRowid, importCampaignId, paidAmount, '');
          paymentImported++;
        }
      }
      // case/exec 导入：按 平台+达人昵称(或主页链接) 解析 creator_id；无 home_url 时按 平台+昵称 匹配
      if ((req.params.type === 'cases' || req.params.type === 'executions')) {
        const cid = resolveCreatorId(db, { creator_name: record.creator_name, platform: record.platform, home_url: record.home_url });
        if (cid) {
          db.prepare(`UPDATE ${req.params.type} SET creator_id=? WHERE id=?`).run(cid, r.lastInsertRowid);
          // 导入带「达人平台ID」时，回填到该创作者的对应平台账号，供后续按 ID 精确归人
          if (req.params.type === 'cases' && record.creator_platform_id) {
            const acc = db.prepare('SELECT id, platform_id FROM creator_accounts WHERE creator_id=? AND platform=? LIMIT 1').get(cid, record.platform);
            if (acc && !acc.platform_id) db.prepare('UPDATE creator_accounts SET platform_id=? WHERE id=?').run(String(record.creator_platform_id).trim(), acc.id);
          }
        }
      }
    }
    if (req.params.type === 'hotspots') {
      // 对导入的候选热点执行宣发适配筛查
      db.prepare("SELECT * FROM hotspots WHERE status='候选' AND screen_result IS NULL").all()
        .forEach(h => { try { rec.screenHotspotById(db, h); } catch (e) {} });
    }
    saveNow();
    ok(res, { inserted, updated, skipped, paymentImported });
  } catch (e) { fail(res, e.message); }
});

/* 下载导入模板 */
router.get('/import/:type/template', (req, res) => {
  try {
    const map = IMPORT_MAP[req.params.type];
    if (!map) return fail(res, '不支持的类型', 400);
    const ws = XLSX.utils.aoa_to_sheet([Object.keys(map.cols)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '模板');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename=template_${req.params.type}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { fail(res, e.message); }
});

/* ============ 数据导出 ============ */
router.get('/export', (req, res) => {
  try {
    const db = getDb();
    saveNow();
    const wb = XLSX.utils.book_new();
    for (const table of Object.keys(TABLES)) {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
      XLSX.utils.book_append_sheet(wb, ws, table.slice(0, 31));
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="koc-workbench-${date}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { fail(res, e.message); }
});

/* ============ 设置 ============ */
router.get('/automation/status', (req, res) => {
  try {
    ok(res, automation.getStatus(getDb()));
  } catch (e) { fail(res, e.message); }
});

router.post('/automation/config', (req, res) => {
  try {
    const { enabled, runTime } = req.body || {};
    ok(res, automation.configure(getDb(), { enabled, runTime }));
  } catch (e) { fail(res, e.message); }
});

router.post('/automation/run', async (req, res) => {
  try {
    const { force } = req.body || {};
    const status = await automation.runNow(getDb(), { force: force !== false, reason: 'manual' });
    ok(res, status);
  } catch (e) { fail(res, e.message); }
});

router.get('/settings', (req, res) => {
  try {
    const rows = getDb().prepare('SELECT * FROM settings').all();
    const obj = {};
    rows.forEach(r => {
      const isSecret = ['gemini_api_key', 'ai_api_key'].includes(r.key);
      obj[r.key] = isSecret && r.value ? r.value.slice(0, 8) + '****' + r.value.slice(-4) : r.value;
    });
    ok(res, obj);
  } catch (e) { fail(res, e.message); }
});
router.post('/settings', (req, res) => {
  try {
    const db = getDb();
    for (const [k, v] of Object.entries(req.body || {})) {
      if (['gemini_api_key', 'ai_api_key'].includes(k) && String(v).includes('****')) continue; // 掩码回传不覆盖
      if (['gemini_api_key', 'ai_api_key'].includes(k) && /^https?:\/\//i.test(String(v).trim())) {
        return fail(res, 'API Key 不能填写网址，请把中转站地址填到 Base URL，把密钥填到 API Key。', 400);
      }
      db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(k, String(v));
    }
    ok(res, { saved: true });
  } catch (e) { fail(res, e.message); }
});

/* AI连通性测试 */
router.post('/settings/test-ai', async (req, res) => {
  try {
    const t = await ai.callGemini('请回复两个字：正常');
    const cfg = ai.getAiConfig ? ai.getAiConfig() : {};
    ok(res, { reply: t.slice(0, 50), provider: cfg.provider, model: cfg.model });
  } catch (e) {
    const msg = e.message === 'API_KEY_SHOULD_NOT_BE_URL'
      ? 'API Key 当前保存成了网址，请在设置里把中转站地址填到 Base URL，把密钥填到 API Key。'
      : e.message;
    fail(res, msg);
  }
});

/* ============ 清空演示数据 ============ */
router.post('/reset-demo', (req, res) => {
  try {
    const db = getDb();
    ['campaigns','hotspots','opportunities','opportunity_logs','creators','cases','executions','reviews','experiences','todos'].forEach(t => db.exec(`DELETE FROM ${t}`));
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('seeded','1')").run(); // 防止重新注入
    ok(res, { cleared: true });
  } catch (e) { fail(res, e.message); }
});

module.exports = router;
