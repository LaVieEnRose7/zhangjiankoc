/**
 * Gemini AI 调用模块
 * - REST API 直调（无需SDK），支持 503/429 指数退避重试
 * - Key 存在 settings 表，未配置或调用失败时由调用方降级为规则引擎
 */
const { getDb } = require('../db/database');

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_OPENAI_COMPAT_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_OPENAI_COMPAT_BASE_URL = 'https://api.openai.com/v1';
const MAX_RETRIES = 3;

function getSetting(key, fallback) {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row && row.value ? row.value : fallback;
  } catch (e) { return fallback; }
}

function normalizeProvider(v) {
  const value = String(v || '').trim().toLowerCase();
  if (['openai', 'openai_compatible', 'openai-compatible', 'proxy', 'relay'].includes(value)) return 'openai_compatible';
  return 'gemini';
}

function getAiConfig() {
  let provider = normalizeProvider(getSetting('ai_provider', process.env.AI_PROVIDER || 'gemini'));
  const legacyGeminiKey = getSetting('gemini_api_key', process.env.GEMINI_API_KEY || '');
  const apiKey = getSetting(
    'ai_api_key',
    process.env.AI_API_KEY || process.env.OPENAI_API_KEY || legacyGeminiKey
  );
  const baseUrl = getSetting(
    'ai_base_url',
    process.env.AI_BASE_URL || (provider === 'openai_compatible' ? DEFAULT_OPENAI_COMPAT_BASE_URL : DEFAULT_GEMINI_BASE_URL)
  );
  const model = getSetting(
    'ai_model',
    process.env.AI_MODEL || getSetting(
      'gemini_model',
      provider === 'openai_compatible' ? DEFAULT_OPENAI_COMPAT_MODEL : DEFAULT_MODEL
    )
  );
  if (
    provider === 'gemini'
    && (
      /\/v1\/?$/i.test(String(baseUrl || ''))
      || /openai|deepseek|gpt|kimi|qwen|glm|claude/i.test(String(model || ''))
    )
  ) {
    provider = 'openai_compatible';
  }
  return { provider, apiKey, baseUrl, model };
}

function getAiApiKey() {
  return getAiConfig().apiKey;
}

function withQueryKey(url, apiKey) {
  const u = new URL(url);
  if (!u.searchParams.has('key')) u.searchParams.set('key', apiKey);
  return u.toString();
}

function buildGeminiUrl(baseUrl, model, apiKey) {
  const base = String(baseUrl || DEFAULT_GEMINI_BASE_URL).trim();
  const replaced = base
    .replaceAll('{model}', model)
    .replaceAll('{apiKey}', apiKey)
    .replaceAll('{key}', apiKey);
  if (/generateContent/i.test(replaced)) return replaced.includes('{') ? replaced : withQueryKey(replaced, apiKey);
  return withQueryKey(`${replaced.replace(/\/+$/, '')}/models/${model}:generateContent`, apiKey);
}

function buildOpenAICompatUrl(baseUrl) {
  const base = String(baseUrl || DEFAULT_OPENAI_COMPAT_BASE_URL).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

async function fetchAiJson(url, options, label) {
  let lastErr = null;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status === 429 || resp.status === 503) {
        lastErr = new Error(`HTTP ${resp.status}`);
        const wait = Math.min(2000 * Math.pow(2, i), 15000);
        console.warn(`[ai] ${label} ${resp.status}, retry after ${wait}ms (${i + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`${label} ${resp.status}: ${t.slice(0, 300)}`);
      }
      return await resp.json();
    } catch (e) {
      lastErr = e;
      if (i < MAX_RETRIES && /fetch failed|network|ECONN|ETIMEDOUT|timeout/i.test(e.message)) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      break;
    }
  }
  throw lastErr || new Error('AI_CALL_FAILED');
}

async function callConfiguredAi(prompt, { system, maxTokens = 8192, temperature = 0.4, responseFormat = null, model: modelOverride = null } = {}) {
  const { provider, apiKey, baseUrl, model } = getAiConfig();
  const activeModel = modelOverride || model;
  if (!apiKey) throw new Error('NO_API_KEY');
  if (/^https?:\/\//i.test(String(apiKey).trim())) throw new Error('API_KEY_SHOULD_NOT_BE_URL');

  if (provider === 'openai_compatible') {
    const data = await fetchAiJson(buildOpenAICompatUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: activeModel,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: maxTokens,
        ...(responseFormat ? { response_format: responseFormat } : {})
      })
    }, 'OpenAI-compatible API');
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.output_text || '';
    if (!text) throw new Error('EMPTY_RESPONSE');
    return text;
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const data = await fetchAiJson(buildGeminiUrl(baseUrl, activeModel, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 'Gemini API');
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}

async function callGemini(prompt, options = {}) {
  return await callConfiguredAi(prompt, options);
  const apiKey = getAiApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const model = getSetting('gemini_model', DEFAULT_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let lastErr = null;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (resp.status === 429 || resp.status === 503) {
        lastErr = new Error(`HTTP ${resp.status}`);
        const wait = Math.min(2000 * Math.pow(2, i), 15000);
        console.warn(`[ai] ${resp.status}，${wait}ms 后重试 (${i + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Gemini API ${resp.status}: ${t.slice(0, 300)}`);
      }
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      if (!text) throw new Error('EMPTY_RESPONSE');
      return text;
    } catch (e) {
      lastErr = e;
      if (e.message === 'NO_API_KEY') throw e;
      if (i < MAX_RETRIES && /fetch failed|network|ECONN|ETIMEDOUT/i.test(e.message)) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      if (i >= MAX_RETRIES) break;
    }
  }
  throw lastErr || new Error('AI_CALL_FAILED');
}

/** 从AI回复中提取JSON（容错：markdown围栏/前后杂讯/贪婪与逐层回退） */
function extractBracket(t, open, close) {
  const si = t.indexOf(open);
  if (si < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = si; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(si, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

function extractJson(text) {
  if (text == null) return null;
  let t = String(text).trim();
  // 去 markdown 代码围栏 ```json / ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // 处理整段被外层双引号包裹的情况： "{"picks":[...]}" 或 "```json ... ```"
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      const unescaped = JSON.parse(t);
      if (typeof unescaped === 'string') {
        t = unescaped.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }
    } catch (e) { /* 不是字符串包裹，忽略 */ }
  }
  // 先整体尝试
  try { return JSON.parse(t); } catch (e) { /* fallthrough */ }
  // 提取最外层对象
  const obj = extractBracket(t, '{', '}');
  if (obj !== null) return obj;
  // 提取最外层数组（部分模型直接返回数组）
  const arr = extractBracket(t, '[', ']');
  if (arr !== null) return arr;
  return null;
}

/** 机会评估 */
async function evaluateOpportunity({ opportunity, hotspot, campaign, cases, experiences, creators }) {
  const prompt = `你是《杖剑传说》(B站KOC营销) 的资深内容策略顾问。请评估以下内容机会是否值得执行。

【当前营销任务】
${campaign ? `名称：${campaign.name}\n目标：${campaign.goal}\n判断标准：${campaign.criteria}\n期望方向：${campaign.content_directions}` : '（未关联营销任务）'}

【候选热点】
${hotspot ? `${hotspot.title}（平台:${hotspot.platform} 热度:${hotspot.heat} 趋势:${hotspot.trend}）\n描述：${hotspot.description || '无'}` : '（手动创建的机会，无来源热点）'}

【机会】${opportunity.title}

【历史相关案例（近似题材）】
${(cases || []).slice(0, 5).map(c => `- ${c.title}｜形式:${c.content_type}｜播放:${c.play_count}｜激活:${c.activation_d1 ?? '无'}%｜ROI7:${c.roi_d7 ?? '无'}｜结论:${c.summary}`).join('\n') || '无'}

【团队沉淀经验】
${(experiences || []).map(e => `- [${e.boost > 0 ? '正向' : '负向'}][${e.category}] ${e.content}`).join('\n') || '无'}

【可选创作者】
${(creators || []).slice(0, 8).map(c => `- id:${c.id} ${c.name}｜${c.categories}｜粉丝:${c.fans}｜均播:${c.avg_play}｜合作${c.coop_count}次｜平均激活:${c.avg_activation ?? '无'}%｜平均ROI7:${c.avg_roi7 ?? '无'}｜状态:${c.status}`).join('\n') || '无'}

评估维度：高消费潜力、良好播放量预期、首日激活转化率预期、7日付费ROI预期。
请严格输出以下JSON（不要输出其他内容）：
{
  "score": 0到100的整数,
  "verdict": "值得做" 或 "不建议做" 或 "谨慎观察",
  "analysis": "150字以内的评估分析，说明与任务匹配度、热点窗口期、历史数据依据、风险",
  "direction": "一句话内容方向建议（具体到题材+形式+钩子）",
  "recommended_creator_ids": [推荐的创作者id数组，最多3个],
  "creator_reason": "创作者推荐理由，50字以内"
}`;
  const text = await callGemini(prompt);
  const json = extractJson(text);
  if (!json) throw new Error('AI_PARSE_FAILED');
  return json;
}

/** 周期复盘生成 */
async function generateReview({ periodStart, periodEnd, stats, opportunities, executions, campaigns }) {
  const prompt = `你是《杖剑传说》B站KOC营销团队的复盘分析师。根据以下周期数据，生成一份结构化复盘报告（Markdown格式）。

【复盘周期】${periodStart} ~ ${periodEnd}

【周期统计】
${JSON.stringify(stats, null, 2)}

【本周期机会明细】
${(opportunities || []).map(o => `- ${o.title}｜状态:${o.status}｜规则分:${o.rule_score ?? '无'}｜AI分:${o.ai_score ?? '无'}｜结论:${o.decision || '未判断'}`).join('\n') || '无'}

【执行与数据明细】
${(executions || []).map(e => `- ${e.creator_name || '未定'}｜阶段:${e.stage}｜播放:${e.play_count}｜激活D1:${e.activation_d1 ?? '未回收'}%｜ROI7:${e.roi_d7 ?? '未回收'}｜成本:${e.cost ?? 0}｜备注:${e.note || ''}`).join('\n') || '无'}

【进行中的营销任务】
${(campaigns || []).map(c => `- ${c.name}：${c.goal}`).join('\n') || '无'}

要求：
1. 结构：## 周期概览 / ## 数据表现（对照首日激活≥3%、ROI7≥0.8等目标）/ ## 核心结论 / ## 待改进 / ## 下周期建议
2. 结论必须基于给出的真实数据，不要编造数字
3. 最后附一节 "## 建议沉淀的经验"，列出2-4条可复用经验，每条格式：[选题|创作者|时机|形式] 经验内容（正向/负向）
4. 全文中文，务实、可执行，600字以内`;
  return await callGemini(prompt);
}

/** 机会推荐草稿生成（「重新分析」用）：给出玩法/结合方式/风险/理由 */
async function generateOpportunityDraft({ hotspot, campaign, creators }) {
  const prompt = `你是《杖剑传说》B站KOC内容策略顾问。基于以下候选热点与当前营销任务，给出一条可落地的「内容机会推荐草稿」。

【当前营销任务】
${campaign ? `名称：${campaign.name}\n版本/活动：${campaign.version_event || '—'}\n目标：${campaign.goal}\n重点内容：${campaign.focus_content || '—'}\n期望方向：${campaign.content_directions || '—'}` : '（未关联任务）'}

【候选热点】
标题：${hotspot.title}
分类：${hotspot.category}｜平台：${hotspot.platform}｜热度：${hotspot.heat}｜趋势：${hotspot.trend}
描述：${hotspot.description || '无'}
标签：${hotspot.tags || '无'}
风险提示：${hotspot.risk_note || '无'}

【可选创作者】
${(creators || []).slice(0, 8).map(c => `- ${c.name}｜${c.categories}｜粉丝:${c.fans}｜报价:${c.price || '未知'}`).join('\n') || '无'}

请输出以下JSON（不要输出其他内容）：
{
  "direction": "一句话内容方向（具体到题材+形式+钩子，如「以新职业星术师首测为钩子，做一期3分钟测评+平民养成路线演示，切片发短视频」）",
  "play_method": "推荐玩法（一句话，具体到形式，如「新职业强度测评+平民养成路线」）",
  "game_combo": "游戏结合方式（如何把热点与《杖剑传说》宣发结合，一句话）",
  "risk_note": "风险提示（30字内，结合热点风险与平台规范）",
  "reason": "推荐理由（结合任务匹配、热点窗口、历史依据，60字内）"
}`;
  const text = await callGemini(prompt);
  const json = extractJson(text);
  if (!json) throw new Error('AI_PARSE_FAILED');
  return json;
}

/**
 * 生成机会「完整方案」：机会结论补充 + 推荐依据 + 风险判断 + 内容方向建议（结构化）。
 * 返回对象含 platform/suggested_time/cost/play_method/game_combo/direction/basis/risk_json/direction_json/reason。
 */
async function generateOpportunityPlan({ opportunity, hotspot, campaign, creators }) {
  const focus = safeParse(campaign && campaign.focus_detail) || {};
  const prefs = safeParse(campaign && campaign.prefs) || {};
  const goals = safeParse(campaign && campaign.goals) || {};
  const riskRules = safeParse(campaign && campaign.risk_rules) || {};
  const prompt = `你是《杖剑传说》KOC内容策略顾问。基于候选热点与当前营销任务，生成一条"完整内容机会方案"，输出JSON（不要其他内容）。

【当前营销任务】
${campaign ? `名称：${campaign.name}\n版本/活动：${campaign.version_event || '—'}\n目标：${campaign.goal || '—'}\n重点内容：${campaign.focus_content || '—'}\n传播目标主:${Array.isArray(goals.primary) ? goals.primary.join('、') : '—'} 次:${Array.isArray(goals.secondary) ? goals.secondary.join('、') : '—'}\n营销重点：${JSON.stringify(focus)}\n推荐偏好：${JSON.stringify(prefs)}\n风险规则：${JSON.stringify(riskRules)}` : '（未关联任务）'}

【机会/热点】
标题：${opportunity ? opportunity.title : (hotspot && hotspot.title)}
分类：${hotspot ? hotspot.category : '—'}｜平台：${hotspot ? hotspot.platform : (campaign && campaign.target_platform || 'B站')}｜热度：${hotspot ? hotspot.heat : '—'}｜趋势：${hotspot ? hotspot.trend : '—'}
描述：${hotspot ? (hotspot.description || '无') : '—'}
标签：${hotspot ? (hotspot.tags || '无') : '—'}

【可选创作者】
${(creators || []).slice(0, 8).map(c => `- ${c.name}｜${c.categories}｜粉丝:${c.fans}｜报价:${c.price || '未知'}`).join('\n') || '无'}

请输出：
{
  "platform": "适合平台(从 候选热点平台/任务目标平台 选一个：B站/抖音/微博/小红书/其他)",
  "suggested_time": "建议执行时间(一句话，如：资料片上线后24小时内)",
  "cost": "预估制作成本(整数，单位元，如 6000)",
  "play_method": "推荐玩法(一句话，具体到形式)",
  "game_combo": "游戏结合方式(一句话)",
  "direction": "一句话内容方向(题材+形式+钩子)",
  "basis": { "version_fit":"与当前版本契合点(30字内)","hotspot_dev":"热点发展情况(30字内)","cases":"其他游戏/本游戏成功案例(30字内)","history_perf":"历史项目表现(30字内)","creators":"适配的现有创作者(30字内)","feasibility":"制作可行性(30字内)" },
  "risk_json": { "opinion":{"level":"高/中/低","note":"舆情风险说明(20字内)"},"copyright":{"level":"高/中/低","note":"版权风险说明(20字内)"},"character":{"level":"高/中/低","note":"角色设定风险说明(20字内)"},"difficulty":{"level":"高/中/低","note":"执行难度说明(20字内)"},"expiry":{"level":"高/中/低","note":"热点过期风险说明(20字内)"},"irreproducible":{"level":"高/中/低","note":"不可复制风险说明(20字内)"} },
  "direction_json": { "core":"核心内容设定(一句话)","angle":"建议切入角度(一句话)","structure":"参考结构(如：引入→展开→高潮→游戏引出)","must_show":"必须体现的信息(逗号分隔)","forbid":"禁止出现的内容(逗号分隔)","ref_cases":"可参考案例(一句话)" },
  "reason": "推荐理由(结合任务匹配/热点窗口/历史依据，60字内)"
}`;
  const text = await callGemini(prompt);
  const json = extractJson(text);
  if (!json) throw new Error('AI_PARSE_FAILED');
  if (json.cost != null) json.cost = Number(json.cost) || null;
  return json;
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

/**
 * 模块6：AI 经营洞察（跨维度规律发现）
 * 输入为 opsAnalysis.analyze 的结果摘要；输出结构化洞察数组。
 * 定位是「发现规律」而不是「写总结」——要求每条洞察给出数据依据/覆盖内容数/创作者数/可信度/是否需验证。
 */
async function discoverInsights({ period, overview, layers, opp, creator, ruleInsights }) {
  const m = overview.metrics;
  const cfg = getAiConfig();
  const insightModel = getSetting(
    'ai_insight_model',
    cfg.provider === 'openai_compatible' && /^deepseek-/i.test(cfg.model) ? 'gpt-5.4-mini' : cfg.model
  );
  const topContentTypes = (layers.content_type || []).slice(0, 8);
  const topPlayMethods = (layers.play_method || []).slice(0, 8);
  const oppRows = opp && opp.ready ? Object.values(opp.groups).flat().slice(0, 8) : [];
  const creatorRows = creator && creator.ready
    ? Object.entries(creator.groups).flatMap(([k, arr]) => arr.slice(0, 4).map(c => ({ ...c, group: k }))).slice(0, 12)
    : [];
  const knownRules = (ruleInsights || []).slice(0, 8);
  const prompt = `你是《杖剑传说》KOC 内容营销的经营分析师。你的任务是从下面的周期数据中【发现规律】，不是写总结。
规律 = 可指导下周期决策的模式（如"X类型内容在Y条件下转化显著更高"、"Z类创作者更适配W玩法"、"某信号预示风险"）。
禁止输出：复述数据、空泛建议（如"继续保持"）、与规则引擎已发现规律重复的内容。

【周期】${period.start} ~ ${period.end}
【总览】发布${m.published}条 / ${m.creators}位创作者 / 总播放${m.totalPlay} / 平均ROI7=${m.avgRoi7} / 平均激活=${m.avgActivation}% / 百赞${m.baiZan} / 高潜${m.gaoQian} / 平台分布${JSON.stringify(m.platforms)}

【内容类型分层】
${topContentTypes.map(g => `- ${g.key}：${g.n}条/${g.creators}人｜均播${Math.round(g.avgPlay)}｜百赞率${g.baiZanRate}%｜ROI7=${g.avgRoi7}｜趋势${g.trend}｜判级${g.level}`).join('\n')}

【玩法分层】
${topPlayMethods.map(g => `- ${g.key}：${g.n}条｜均播${Math.round(g.avgPlay)}｜ROI7=${g.avgRoi7}｜判级${g.level}`).join('\n')}

【机会验证】${opp && opp.ready ? `已验证${opp.summary.verified}/部分验证${opp.summary.partial}/失败${opp.summary.failed}/共${opp.summary.total}` : '无'}
${oppRows.map(o => `- ${o.title}｜结论:${o.verdict}｜玩法:${o.play_method}｜内容${o.validCount}条｜ROI7=${o.avgRoi}｜${o.reason}`).join('\n')}

【创作者经营】${creator && creator.ready ? `成长${creator.summary.growth}/瓶颈${creator.summary.bottleneck}/培养${creator.summary.cultivate}/观察${creator.summary.watch}` : '无'}
${creatorRows.map(c => `- [${c.group}] ${c.name}｜发布${c.published}｜ROI7=${c.avgRoi}｜激活${c.avgAct}%｜趋势${c.periodTrend}｜${c.reason}`).join('\n')}

【规则引擎已发现的规律（不要重复）】
${knownRules.map(r => `- [${r.category}] ${r.title}`).join('\n') || '无'}

请输出2-4条【新的、跨维度的】规律洞察，严格输出以下JSON（不要其他内容）：
{
  "insights": [
    {
      "category": "内容规律/平台规律/创作者规律/机会验证/异常信号 之一",
      "title": "规律标题（一句话，20字内）",
      "statement": "规律陈述（60字内，必须含具体数字）",
      "basis": "数据依据（引用上面给出的真实数字，40字内）",
      "contentCount": 覆盖内容条数(整数),
      "creatorCount": 涉及创作者数(整数),
      "confidence": "高/中/低（样本≥5且模式清晰=高；样本<3或推断成分大=低）",
      "needsVerify": true或false（低可信度必须true）,
      "suggestion": "下周期怎么用这条规律（30字内，可执行）"
    }
  ]
}`;
  const text = await callGemini(prompt, {
    model: insightModel,
    maxTokens: 4096,
    temperature: 0.2,
    responseFormat: { type: 'json_object' }
  });
  const json = extractJson(text);
  if (!json || !Array.isArray(json.insights)) throw new Error('AI_PARSE_FAILED');
  return json.insights.map(i => ({
    category: i.category || '内容规律',
    title: String(i.title || '').slice(0, 40),
    statement: String(i.statement || ''),
    basis: String(i.basis || ''),
    contentCount: Number(i.contentCount) || 0,
    creatorCount: Number(i.creatorCount) || 0,
    confidence: ['高', '中', '低'].includes(i.confidence) ? i.confidence : '低',
    needsVerify: i.confidence === '低' ? true : !!i.needsVerify,
    suggestion: String(i.suggestion || ''),
    source: 'ai'
  }));
}

/** 规则兜底：从链接/描述文本提取案例字段（无外网时用） */
function ruleExtractCase(text, link) {
  const t = String(text || '');
  const PLAT = [['抖音', '抖音'], ['快手', '快手'], ['微博', '微博'], ['小红书', '小红书'], ['视频号', '视频号'], ['B站', 'B站'], ['bilibili', 'B站'], ['b23.tv', 'B站'], ['douyin', '抖音']];
  let platform = 'B站';
  for (const [k, v] of PLAT) if (t.includes(k) || (link && String(link).includes(k))) { platform = v; break; }
  const CT = ['攻略', '整活', '剧情', '测评', '切片', '解说', '情怀', '盘点', '二创', '速通'];
  const content_type = CT.find(c => t.includes(c)) || '';
  const PM = ['强度测评', '速通', '养成', '挑战', '盘点', '二创', '剧情向', '情怀回顾'];
  const play_method = PM.find(p => t.includes(p)) || (content_type ? `${content_type}类内容` : '');
  const game = (t.match(/《([^》]+)》/) || t.match(/杖剑传说/)) ? (t.match(/《([^》]+)》/) ? `《${t.match(/《([^》]+)》/)[1]}》` : '《杖剑传说》') : '';
  const mPlay = t.match(/播放[：: ]*(\d+(?:\.\d+)?)\s*万/);
  const play_count = mPlay ? Math.round(parseFloat(mPlay[1]) * 10000) : null;
  const mRoi = t.match(/ROI\s*D?\s*7\s*[日天]?\s*[：: ]*\s*(\d+(?:\.\d+)?)/i);
  const roi_d7 = mRoi ? parseFloat(mRoi[1]) : null;
  const mAct = t.match(/激活\s*D?\s*1\s*[日天]?\s*[：: ]*\s*(\d+(?:\.\d+)?)\s*%?/);
  const activation_d1 = mAct ? parseFloat(mAct[1]) : null;
  const title = (t.split(/[\n。]/)[0] || '').slice(0, 40) || (link ? '来自链接的案例' : '未命名案例');
  return {
    title: title || '未命名案例',
    platform, content_type, play_method,
    game_name: game || '《杖剑传说》',
    hotspot: '', play_count, like_count: null, comment_count: null,
    activation_d1, roi_d7, cost: null, publish_date: '',
    borrowable: '', risk_info: ''
  };
}

/** 案例 AI 辅助提取：链接/截图描述/文本 → 结构化字段（失败降级规则） */
async function extractCase({ text, link }) {
  const input = `链接：${link || '（无）'}\n内容描述/截图文字/群聊反馈：\n${text || '（无）'}`;
  const prompt = `你是《杖剑传说》KOC内容团队的案例入库助手。用户会粘贴一条内容链接、截图文字或一段案例描述/群聊反馈。请提取为结构化案例字段，只输出JSON（不要其他内容）：
{
  "title": "案例标题（一句话概括内容，不超过40字）",
  "platform": "平台，从 B站/抖音/微博/小红书/快手/视频号/其他 选一个",
  "game_name": "游戏或品牌（如《杖剑传说》，若无则空字符串）",
  "content_type": "内容形式，从 攻略/整活/剧情/测评/切片/解说/情怀/盘点 选最贴切的一个，无则空字符串",
  "hotspot": "关联热点（一句话，无则空字符串）",
  "play_method": "采用的玩法（一句话，如：新职业强度测评、速通竞速、平民养成，无则空字符串）",
  "publish_date": "发布日期(YYYY-MM-DD，能从内容推断则填，否则空字符串)",
  "play_count": "播放量(整数，无则null)",
  "like_count": "点赞量(整数，无则null)",
  "comment_count": "评论量(整数，无则null)",
  "activation_d1": "首日激活转化率(数字百分比，无则null)",
  "roi_d7": "7日付费ROI(数字，无则null)",
  "cost": "制作成本(整数元，无则null)",
  "borrowable": "可借鉴点（一句话，无则空字符串）",
  "risk_info": "风险信息（如版权/设定错误/夸大等，无则空字符串）"
}
【用户输入】
${input}`;
  const t = await callGemini(prompt);
  const j = extractJson(t);
  if (!j) throw new Error('AI_PARSE_FAILED');
  // 数字字段规整
  ['play_count', 'like_count', 'comment_count', 'cost'].forEach(k => { if (j[k] != null) j[k] = Number(j[k]) || null; });
  ['activation_d1', 'roi_d7'].forEach(k => { if (j[k] != null) j[k] = Number(j[k]) || null; });
  return j;
}

/** 模块4：自然语言→结构化营销重点（AI提取） */
async function extractFocus(text, campaign) {
  const prompt = `你是《杖剑传说》KOC营销的内容策略助手。把下面"本期营销重点"的自然语言描述，提取为结构化字段（只输出JSON，不要其他内容）：
{
  "role": "重点角色（如：新职业星术师，无则空字符串）",
  "play": "重点玩法（如：秘境速通/整活，无则空字符串）",
  "selling_point": "版本卖点（无则空字符串）",
  "linkage": "联动信息（无则空字符串）",
  "node": "节日或营销节点（如：暑期，无则空字符串）",
  "cognition": "希望强化的用户认知（无则空字符串）",
  "gap": "当前内容缺口（无则空字符串）"
}
【自然语言描述】
${text}
【任务背景】${campaign ? campaign.name + ' ' + (campaign.version_event || '') : ''}`;
  const t = await callGemini(prompt);
  const j = extractJson(t);
  if (!j) throw new Error('AI_PARSE_FAILED');
  return j;
}

/** 模块7：根据任务配置生成"推荐规则摘要" */
async function generateRuleSummary(campaign) {
  const prefs = safeParse(campaign.prefs) || {};
  const risks = safeParse(campaign.risk_rules) || {};
  const goals = safeParse(campaign.goals) || {};
  const focus = safeParse(campaign.focus_detail) || {};
  const prompt = `你是《杖剑传说》KOC营销的规则引擎。根据下面的营销任务配置，用一段中文（150字以内）概括"本期推荐逻辑"，说明系统将优先推荐什么、规避什么、降低哪些内容的权重。要具体、可执行，不要空话。
【任务】${campaign.name}｜${campaign.version_event || ''}
【传播目标】主:${Array.isArray(goals.primary) ? goals.primary.join('、') : '—'} 次:${Array.isArray(goals.secondary) ? goals.secondary.join('、') : '—'}
【营销重点】${JSON.stringify(focus)}
【推荐偏好】${JSON.stringify(prefs)}
【风险规则】${JSON.stringify(risks)}
只输出摘要正文，不要JSON、不要解释。`;
  return await callGemini(prompt);
}

/**
 * 今日推荐机会：从实时热点中 AI 挑选「可结合《杖剑传说》」的热点
 * - 输入：归一化热点列表（来自 hotspotSource.getHotspots().list）+ 游戏背景文本
 * - 优先调 Gemini 实时评估；失败则回退关键词规则打分（保证页面始终有推荐）
 * - 返回合并后的推荐项：{title, source, url, heat, score, verdict, angle, reason}
 */
const GAME_KW = ['剑', '魔法', '奇幻', '冒险', '副本', '职业', '坐骑', '剧情', '二创', 'cos', '抽卡', '卡牌', '公会', 'pvp', '版本', '联动', '逆袭', '平民', '养成', '攻略', '整活', '测评', '速通', '怀旧', '情怀', '国风', '仙侠', 'mmo', '角色', '皮肤', '活动', '直播', '武器', '战斗', '团战', '沙雕', '搞笑', '名场面', '神还原', '挑战', '盘点'];

function normalizeTitle(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[【】()（）\[\]「」“”"'‘’、，。,.!！?？:：;；\-—_~·]/g, '');
}

function matchHotspot(hotspots, title) {
  if (!title) return null;
  const t = String(title).trim().toLowerCase();
  const tn = normalizeTitle(title);
  // 1) 精确或包含匹配（双向）
  for (const h of hotspots) {
    const ht = String(h.title || '').trim().toLowerCase();
    if (!ht) continue;
    if (ht === t || ht.includes(t) || t.includes(ht)) return h;
  }
  if (!tn) return null;
  // 2) 归一化后精确/包含匹配
  for (const h of hotspots) {
    const hn = normalizeTitle(h.title);
    if (!hn) continue;
    if (hn === tn || hn.includes(tn) || tn.includes(hn)) return h;
  }
  // 3) 字符重叠兜底（防止 Gemini 轻微改写标题）
  for (const h of hotspots) {
    const hn = normalizeTitle(h.title);
    if (!hn) continue;
    const short = tn.length <= hn.length ? tn : hn;
    const long = tn.length <= hn.length ? hn : tn;
    let shared = 0;
    for (const ch of short) if (long.includes(ch)) shared++;
    if (short.length && shared / short.length >= 0.6) return h;
  }
  return null;
}

function ruleRecommend(hotspots, topN) {
  const scored = hotspots.map(h => {
    const t = String(h.title || '');
    let hit = 0;
    for (const k of GAME_KW) if (t.includes(k)) hit++;
    return { h, hit };
  }).filter(x => x.hit > 0)
    .sort((a, b) => (b.hit - a.hit) || ((b.h.heat || 0) - (a.h.heat || 0)));
  return scored.slice(0, topN).map(x => ({
    title: x.h.title,
    score: Math.min(95, 55 + x.hit * 10),
    verdict: x.hit >= 2 ? '推荐' : '可尝试',
    angle: '结合游戏相关题材做 KOC 内容',
    reason: '含「' + GAME_KW.filter(k => String(x.h.title).includes(k)).join('、') + '」等游戏相关关键词，可尝试结合《杖剑传说》做内容'
  }));
}

async function recommendOpportunities({ hotspots, gameContext, topN = 8 }) {
  if (!hotspots || !hotspots.length) return [];
  const numbered = hotspots.map((h, i) => `${i + 1}. [${h.source}] ${h.title}（热度:${h.heat != null ? h.heat : '—'}）`).join('\n');
  const apiKey = getAiApiKey();
  const prompt = `你是《杖剑传说》手游的 KOC 内容营销分析师。下面是当前实时抓取的抖音热榜与B站热门的真实热点。
游戏背景：${gameContext || '《杖剑传说》是一款剑与魔法的奇幻题材手游，适合测评/攻略/剧情/二创/整活类 KOC 内容。'}

任务：从这些热点中挑出最值得结合《杖剑传说》做 KOC 内容营销的 Top ${topN}（不足则全挑）。判断标准：话题与游戏题材/玩法/情绪/版本节点/二创有自然结合点，容易产出有传播力的内容。
只输出 JSON，不要其他内容：
{"picks":[{"title":<热点原标题，必须一字不差>,"score":<1-100 匹配度整数>,"verdict":"强烈推荐"|"推荐"|"可尝试","angle":"结合角度一句话","reason":"推荐理由1-2句"}]}

热点列表：
${numbered}`;

  let picks = null;
  if (apiKey) {
    try {
      const text = await callGemini(prompt);
      const j = extractJson(text);
      if (Array.isArray(j)) picks = j;
      else if (j && Array.isArray(j.picks)) picks = j.picks;
    } catch (e) {
      console.warn('[ai] recommendOpportunities Gemini 失败，回退规则打分:', e.message);
    }
  }
  if (!picks || !picks.length) picks = ruleRecommend(hotspots, topN);

  return picks.map(p => {
    const h = matchHotspot(hotspots, p.title);
    return {
      title: p.title,
      source: h ? h.source : '',
      url: h ? h.url : '',
      heat: h ? h.heat : null,
      score: Number(p.score) || (h ? 60 : 50),
      verdict: p.verdict || '推荐',
      angle: String(p.angle || ''),
      reason: String(p.reason || '')
    };
  }).filter(x => x.url); // 必须能匹配到真实热点才返回
}

/**
 * 为「今日推荐机会」生成视频创意内容（标题 + 切入角度 + 脚本要点 + 建议话题 + 注意事项）。
 * 优先 Gemini；无 key 或失败时回退为规则模板，保证演示环境可用。
 */
async function generateCreative({ title, angle, reason, creatorName, user } = {}) {
  const sys = '你是《杖剑传说》手游的 KOC 内容创意策划，擅长把热点转化为可落地的短视频/图文创意。输出简洁、可执行、符合平台调性。';
  const prompt = `请基于下面这条「今日推荐机会」产出一份可直接给创作者参考的视频创意方案。

【机会标题】${title || '（未命名）'}
【系统建议结合角度】${angle || '—'}
【系统推荐理由】${reason || '—'}
${creatorName ? `【目标创作者】${creatorName}` : ''}
${user ? `【操作人】${user}` : ''}

请按以下结构输出（用 Markdown，条目清晰，不要寒暄）：
## 创意标题
（2-3 个候选短视频标题，带钩子）

## 切入角度
（基于系统建议角度，展开 1-2 个具体切入方式）

## 脚本要点
（分镜/口播结构，3-5 步，每步一句话）

## 建议话题/标签
（5-8 个 #话题，利于平台分发）

## 注意事项
（结合《杖剑传说》题材与平台规则的 1-3 条提醒）`;

  try {
    const apiKey = getAiApiKey();
    if (!apiKey) throw new Error('NO_API_KEY');
    const text = await callGemini(prompt, { system: sys });
    return { ok: true, source: 'ai', text: text.trim() };
  } catch (e) {
    // 规则兜底
    const t = title || '热点内容';
    const a = angle || '结合游戏题材做内容';
    const fallback = `## 创意标题
- 《${t}》还能这么玩？杖剑传说玩家看完破防了
- 当《${t}》遇上杖剑传说：这波联动我打满分

## 切入角度
- ${a}

## 脚本要点
- 开头：用「${t}」的冲突/名场面钩住注意力
- 中段：自然过渡到《杖剑传说》的对应玩法/职业/剧情
- 结尾：抛互动问题，引导评论区讨论

## 建议话题/标签
#杖剑传说 #游戏热点 #蹭热点 #内容营销 #二创

## 注意事项
- 热点与游戏的结合需自然，避免生硬嫁接
- 注意平台对商业内容的标注规范

> ⚠️ 当前为规则模板（AI 暂不可用：${e.message}），可在配置 Gemini Key 后生成更贴合的创意。`;
    return { ok: false, source: 'rule', text: fallback };
  }
}

module.exports = { callGemini, evaluateOpportunity, generateReview, generateOpportunityDraft, generateOpportunityPlan, extractFocus, generateRuleSummary, extractCase, ruleExtractCase, getSetting, getAiConfig, discoverInsights, recommendOpportunities, generateCreative };
