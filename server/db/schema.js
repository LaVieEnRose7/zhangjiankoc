/**
 * 数据模型（V3 六页面架构）
 * campaigns 营销任务 → hotspots 候选热点 → opportunities 机会 →
 * executions 执行记录 → reviews 周期复盘 → experiences 经验沉淀
 * cases 案例库 / creators 创作者库 提供判断依据
 */
function createSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                -- 任务名称
    game_name TEXT,                    -- 游戏名称
    goal TEXT,                         -- 营销目标（总述）
    target_audience TEXT,              -- 目标人群
    criteria TEXT,                     -- 判断标准（机会评估依据，文本）
    keywords TEXT,                     -- 关键词（逗号分隔，用于推荐匹配）
    content_directions TEXT,           -- 期望内容方向
    version_event TEXT,                -- 当前版本或活动（首页任务摘要展示）
    focus_content TEXT,                -- 当前重点角色/内容（首页任务摘要展示，=营销重点的自然语言摘要）
    goals TEXT,                        -- 本期传播目标 JSON {primary:[],secondary:[]}
    focus_detail TEXT,                 -- 本期营销重点结构化 JSON {role,play,selling_point,linkage,node,cognition,gap}
    prefs TEXT,                        -- 内容推荐偏好 JSON {platform:[],creator_type:[],content_form:[],play_method:[],cycle,cost,same_day,require_case}
    risk_rules TEXT,                   -- 限制与风险规则 JSON {key:'forbid'|'caution'|'off'}
    rule_summary TEXT,                 -- 推荐规则摘要（系统生成，可改）
    target_platform TEXT,              -- 目标平台
    owner TEXT,                        -- 项目负责人
    agency TEXT,                       -- 合作机构/代理
    is_current INTEGER DEFAULT 0,      -- 是否当前任务（首页/推荐默认业务背景，同一时间仅一个）
    start_date TEXT,
    end_date TEXT,
    priority TEXT DEFAULT '中',        -- 高/中/低
    status TEXT DEFAULT '执行中',      -- 草稿/执行中/已结束/已归档
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS hotspots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,               -- 热点标题
    platform TEXT DEFAULT 'B站',       -- B站/抖音/微博/其他（平台归类，用于匹配）
    category TEXT,                     -- 分类：游戏内/泛游戏/泛娱乐/社会热点
    heat INTEGER DEFAULT 0,            -- 热度值
    trend TEXT DEFAULT '上升',         -- 上升/平稳/下降
    source TEXT DEFAULT '手动录入',    -- 手动录入/表格导入/自动抓取（采集方式）
    source_label TEXT,                 -- 来源平台：B站热门内容/抖音热点榜/微博热点/手动补充/外部智能体推送
    url TEXT,
    description TEXT,
    tags TEXT,                         -- 逗号分隔
    status TEXT DEFAULT '候选',        -- 候选/已转机会/已忽略/不准确
    detected_at TEXT DEFAULT (datetime('now','localtime')),
    valid_until TEXT,                  -- 预计有效期（用于即将过期提醒）
    relevance TEXT,                    -- 初步相关性：强/中/弱（筛查计算）
    risk_note TEXT,                    -- 风险提示
    screen_result TEXT,                -- 筛查结论：符合/待定/不符合（NULL=未筛查）
    screen_reason TEXT,                -- 筛查理由
    observed INTEGER DEFAULT 0,        -- 保留观察标记（1=已标记）
    ai_draft_json TEXT,                -- AI生成的推荐草稿（重新分析结果）
    created_by TEXT
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    hotspot_id INTEGER,                -- 来源热点（可空：手动创建）
    campaign_id INTEGER,               -- 关联营销任务
    status TEXT DEFAULT '待判断',      -- 待判断/已采纳/待匹配创作者/创作中/待发布/已发布/已验证/不采用/已过期
    rule_score REAL,                   -- 规则打分 0-100
    rule_detail TEXT,                  -- 规则打分明细 JSON
    ai_score REAL,                     -- AI评估分
    ai_analysis TEXT,                  -- AI分析文本
    ai_suggestion TEXT,                -- AI内容方向建议
    direction TEXT,                    -- 确定的内容方向
    decision TEXT,                     -- 判断结论说明
    decision_by TEXT,
    matched_creator_ids TEXT,          -- 匹配创作者ID 逗号分隔
    assignee TEXT,                     -- 跟进人
    deadline TEXT,
    play_method TEXT,                  -- 推荐玩法（采纳时从推荐草稿带入）
    game_combo TEXT,                   -- 游戏结合方式
    cost REAL,                         -- 制作成本
    suggested_time TEXT,               -- 建议执行时间
    risk_level TEXT DEFAULT '中',      -- 风险等级：高/中/低
    risk_note TEXT,                    -- 风险说明（generate-plan 写入）
    hotspot_source TEXT,               -- 热点来源（采纳时带入 source_label）
    recommended_to_creator INTEGER DEFAULT 0, -- 是否已推荐给创作者
    platform TEXT,                     -- 适合平台（机会结论）
    node TEXT,                         -- 对应营销节点（机会结论）
    basis TEXT,                        -- 推荐依据 JSON {version_fit,hotspot_dev,cases,history_perf,creators,feasibility}
    risk_json TEXT,                    -- 风险判断结构化 JSON {opinion,copyright,character,difficulty,expiry,irreproducible} 各 {level,note}
    direction_json TEXT,               -- 内容方向建议结构化 JSON {core,angle,structure,must_show,forbid,ref_cases}
    plan_generated INTEGER DEFAULT 0,  -- 是否已生成完整方案
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS opportunity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL,
    action TEXT,                       -- 状态变更/备注/匹配/数据更新
    note TEXT,
    user TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS creators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platform TEXT DEFAULT 'B站',
    home_url TEXT,
    fans INTEGER DEFAULT 0,
    categories TEXT,                   -- 擅长内容类型，逗号分隔
    avg_play INTEGER DEFAULT 0,        -- 近期平均播放
    coop_count INTEGER DEFAULT 0,      -- 合作次数
    avg_activation REAL,               -- 平均首日激活转化率 %
    avg_roi7 REAL,                     -- 平均7日付费ROI
    price REAL,                        -- 报价（元）
    strengths TEXT,                    -- 能力标签/优势
    contact TEXT,
    status TEXT DEFAULT '可合作',      -- 可合作/合作中/暂停/黑名单
    notes TEXT,
    -- 创作者库 V3 扩展字段
    account_type TEXT DEFAULT '个人',  -- 账号类型：个人/机构/MCN
    agency TEXT,                       -- 所属机构/MCN
    content_type TEXT,                 -- 内容类型（擅长大类）
    coop_cycle TEXT,                   -- 合作周期
    willingness TEXT DEFAULT '中',     -- 创作意愿：高/中/低
    stability TEXT DEFAULT '中',       -- 内容稳定性：高/中/低
    is_new INTEGER DEFAULT 0,          -- 是否新增创作者
    good_play TEXT,                    -- 擅长玩法（逗号分隔）
    good_role TEXT,                    -- 擅长角色/题材
    style TEXT,                        -- 内容风格
    forms TEXT,                        -- 可接受制作形式（逗号分隔）
    avg_cycle_days INTEGER,            -- 平均制作周期（天）
    cost_ceiling REAL,                 -- 可承受制作成本上限（元）
    bad_direction TEXT,                -- 不适合方向
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    platform TEXT DEFAULT 'B站',
    url TEXT,
    creator_id INTEGER,
    creator_name TEXT,
    campaign_id INTEGER,               -- 所属营销任务ID（项目执行案例关联）
    campaign_name TEXT,                -- 所属营销任务/活动
    game_name TEXT,                    -- 游戏或品牌
    content_type TEXT,                 -- 内容形式：攻略/整活/剧情/测评/切片/解说
    marketing_node TEXT,               -- 营销节点
    hotspot TEXT,                      -- 热点
    play_method TEXT,                  -- 玩法
    creator_type TEXT,                 -- 创作者类型
    topic_tags TEXT,                   -- 选题标签
    raw_content TEXT,                  -- 原始内容
    analysis_json TEXT,                -- 结构化AI分析 JSON {structure,why,borrowable,irreproducible,risk_tip,scenario}
    analysis_edited INTEGER DEFAULT 0, -- 人工修改后不再被自动分析覆盖
    play_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    activation_d1 REAL,                -- 首日激活转化率 %
    roi_d7 REAL,                       -- 7日付费ROI
    cost REAL,
    result TEXT DEFAULT '一般',        -- 爆款/良好/一般/失败
    summary TEXT,                      -- 成败要点总结
    source TEXT DEFAULT '人工新增',    -- 系统发现/人工新增/项目执行结果
    confirm_status TEXT DEFAULT '已收录', -- 待确认/已收录/已退回（仅系统发现用待确认）
    is_favorite INTEGER DEFAULT 0,     -- 收藏
    is_verified INTEGER DEFAULT 0,     -- 是否已验证
    is_reusable INTEGER DEFAULT 1,     -- 是否可复用
    linked_opportunity_id INTEGER,     -- 关联机会（项目执行案例）
    benchmark_met INTEGER DEFAULT 0,   -- 是否达到项目基准（项目执行案例）
    review_conclusion TEXT,            -- 复盘结论（项目执行案例）
    note TEXT,                         -- 人工备注
    publish_date TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL,
    creator_id INTEGER,
    creator_name TEXT,
    stage TEXT DEFAULT '沟通中',       -- 沟通中/脚本确认/制作中/待发布/已发布/数据回收
    publish_url TEXT,
    publish_date TEXT,
    play_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    activation_d1 REAL,
    roi_d7 REAL,
    cost REAL,
    income REAL,
    note TEXT,
    planned_date TEXT,               -- 计划发布时间
    fail_reason TEXT,                 -- 未执行/延期原因
    exec_play_method TEXT,            -- 实际采用玩法
    adjustment TEXT,                  -- 内容调整情况
    -- 创作者库：合作执行记录扩展
    revision_count INTEGER DEFAULT 0, -- 内容修改次数
    on_time INTEGER DEFAULT 1,        -- 是否按时交付 1/0
    coop_rating TEXT,                 -- 配合度：高/中/低
    accuracy TEXT,                    -- 内容准确性：高/中/低
    agency_feedback TEXT,             -- 代理反馈
    created_by TEXT,                  -- 操作人（多用户协作记录）
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS creative_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,               -- 模板名称
    core_logic TEXT,                   -- 核心逻辑
    applicable_hotspot TEXT,          -- 适用热点
    applicable_node TEXT,             -- 适用营销节点
    creator_type TEXT,                -- 适合的创作者类型
    cost REAL,                        -- 制作成本
    cases TEXT,                       -- 历史案例
    usage_count INTEGER DEFAULT 0,    -- 使用次数
    validation TEXT,                  -- 验证结果
    risks TEXT,                       -- 风险与限制
    source_opportunity_id INTEGER,    -- 来源机会（沉淀时带入）
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    stats_json TEXT,                   -- 周期统计数据 JSON
    content TEXT,                      -- 复盘正文（AI生成+人工修改）
    ai_generated INTEGER DEFAULT 0,
    status TEXT DEFAULT '草稿',        -- 草稿/已确认
    confirmed_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS experiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,             -- 经验描述
    category TEXT DEFAULT '选题',      -- 选题/创作者/时机/形式/其他
    keywords TEXT,                     -- 关键词，用于反哺推荐
    boost INTEGER DEFAULT 1,           -- 推荐加权方向 1正向 / -1负向
    source_review_id INTEGER,
    status TEXT DEFAULT '已确认',      -- 待确认/已确认
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    ref_type TEXT,                     -- opportunity/review/其他
    ref_id INTEGER,
    assignee TEXT,
    due_date TEXT,
    status TEXT DEFAULT '待办',        -- 待办/已完成
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- 创作者按营销阶段结算的实际付费，用阶段总播放自动计算 CPM
  CREATE TABLE IF NOT EXISTS creator_phase_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    campaign_id INTEGER NOT NULL,
    paid_amount REAL DEFAULT 0,
    note TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(creator_id, campaign_id)
  );

  -- 今日热点每日快照：每日仅抓取一次 + 分析一次，结果落库持久化（跨重启仍读同一份）
  CREATE TABLE IF NOT EXISTS daily_hotspot_snapshot (
    snap_date TEXT PRIMARY KEY,             -- 日期 YYYY-MM-DD
    hotspots_json TEXT,                     -- 候选热点列表 JSON [{id,source,title,url,heat,up,pic,rank}]
    recommendations_json TEXT,              -- AI 推荐机会列表 JSON
    source_status_json TEXT,                -- 来源状态 JSON {bili,douyin}
    fetched_at TEXT,                        -- 抓取时间（ISO）
    analyzed_at TEXT                        -- AI 分析时间（ISO）
  );

  -- 游戏快讯：每日洞察一次（真实新闻源，默认机核 gcores RSS），按天批次累积近半年，
  -- 当日新增标记 NEW（batch_date = 当天）；标题去重，超 6 个月自动清理。
  CREATE TABLE IF NOT EXISTS game_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_date TEXT,            -- 入库日期 YYYY-MM-DD（用于 NEW 标记与清理）
    title TEXT,                 -- 资讯标题
    category TEXT,              -- 分类：公测/联动/成绩/其他（系统归类，可空）
    summary TEXT,               -- 摘要（去除 HTML 后的纯文本）
    source TEXT,                -- 来源名（如 机核）
    url TEXT,                   -- 原文链接（真实可跳转）
    pub_date TEXT,              -- 原文发布日期 YYYY-MM-DD（来自 RSS pubDate）
    created_at TEXT             -- 入库时间 ISO
  );
  CREATE INDEX IF NOT EXISTS idx_game_news_batch ON game_news(batch_date);

  -- 创作者已发布视频：人工导入（非 AI 抓取），用于创作者详情展示其发过的视频链接
  CREATE TABLE IF NOT EXISTS creator_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,       -- 关联创作者
    title TEXT,                        -- 视频标题（可选）
    url TEXT NOT NULL,                 -- 视频链接
    platform TEXT,                     -- 平台（B站/抖音/...）
    publish_date TEXT,                 -- 发布日期
    play_count INTEGER,                -- 播放量（可选）
    note TEXT,                         -- 备注
    created_by TEXT,                   -- 导入人（多用户协作记录）
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_creator_videos_creator ON creator_videos(creator_id);

  -- 创作者平台账号：一个「人」(creators) 可挂多个平台账号，平台级指标与角色在此，避免作者信息冗余
  CREATE TABLE IF NOT EXISTS creator_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,            -- 关联 creators.id
    platform TEXT NOT NULL,                 -- 抖音 / B站 / 快手 / 小红书 / 其他
    account_name TEXT,                      -- 平台显示名（可与人名不同）
    home_url TEXT,                          -- 主页链接（跨平台归人的钥匙）
    fans INTEGER DEFAULT 0,                 -- 该平台粉丝数
    avg_play INTEGER DEFAULT 0,             -- 该平台近期平均播放
    avg_activation REAL,                    -- 该平台平均首日激活转化率 %
    avg_roi7 REAL,                          -- 该平台平均7日付费ROI
    role TEXT DEFAULT '创作',               -- 创作 / 分发（账号级角色，固定每作者一套）
    is_primary INTEGER DEFAULT 0,           -- 是否主平台账号
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_ca_creator ON creator_accounts(creator_id);
  CREATE INDEX IF NOT EXISTS idx_ca_url ON creator_accounts(home_url);
  `);
}

/**
 * 数据库迁移：为已有库补充新字段，并对候选热点执行一次智能筛查。
 * 设计原则：自动抓取仅提供候选信息，筛查逻辑负责过滤掉不符合游戏宣发的内容。
 */
function migrate(db) {
  const add = (table, col, type) => {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(r => r.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  };

  // campaigns 新字段
  add('campaigns', 'version_event', 'TEXT');
  add('campaigns', 'focus_content', 'TEXT');
  add('campaigns', 'game_name', 'TEXT');
  add('campaigns', 'goals', 'TEXT');
  add('campaigns', 'focus_detail', 'TEXT');
  add('campaigns', 'prefs', 'TEXT');
  add('campaigns', 'risk_rules', 'TEXT');
  add('campaigns', 'rule_summary', 'TEXT');
  add('campaigns', 'target_platform', 'TEXT');
  add('campaigns', 'owner', 'TEXT');
  add('campaigns', 'agency', 'TEXT');
  add('campaigns', 'is_current', 'INTEGER DEFAULT 0');

  // 旧状态枚举归一化（进行中→执行中，未开始→草稿）
  db.exec("UPDATE campaigns SET status='执行中' WHERE status='进行中'");
  db.exec("UPDATE campaigns SET status='草稿' WHERE status='未开始'");

  // 自动设定"当前任务"：若没有任何任务被标记为当前，则取优先级最高、结束最早的"执行中"任务
  const curCnt = db.prepare('SELECT COUNT(*) c FROM campaigns WHERE is_current=1').get();
  if (curCnt.c === 0) {
    const top = db.prepare("SELECT id FROM campaigns WHERE status='执行中' ORDER BY (priority='高') DESC, end_date ASC LIMIT 1").get();
    if (top) db.prepare('UPDATE campaigns SET is_current=1 WHERE id=?').run(top.id);
  }
  // hotspots 新字段
  ['source_label', 'valid_until', 'relevance', 'risk_note', 'screen_result', 'screen_reason', 'ai_draft_json']
    .forEach(c => add('hotspots', c, 'TEXT'));
  add('hotspots', 'observed', 'INTEGER DEFAULT 0');
  // opportunities 新字段
  add('opportunities', 'play_method', 'TEXT');
  add('opportunities', 'game_combo', 'TEXT');
  add('opportunities', 'cost', 'REAL');
  add('opportunities', 'suggested_time', 'TEXT');
  add('opportunities', 'risk_level', "TEXT DEFAULT '中'");
  add('opportunities', 'hotspot_source', 'TEXT');
  add('opportunities', 'recommended_to_creator', 'INTEGER DEFAULT 0');
  add('opportunities', 'platform', 'TEXT');
  add('opportunities', 'node', 'TEXT');
  add('opportunities', 'basis', 'TEXT');
  add('opportunities', 'risk_json', 'TEXT');
  add('opportunities', 'direction_json', 'TEXT');
  add('opportunities', 'plan_generated', 'INTEGER DEFAULT 0');
  add('opportunities', 'risk_note', 'TEXT');
  add('opportunities', 'note', 'TEXT');
  add('executions', 'planned_date', 'TEXT');
  add('executions', 'fail_reason', 'TEXT');
  add('executions', 'exec_play_method', 'TEXT');
  add('executions', 'adjustment', 'TEXT');
  add('executions', 'revision_count', 'INTEGER DEFAULT 0');
  add('executions', 'on_time', 'INTEGER DEFAULT 1');
  add('executions', 'coop_rating', 'TEXT');
  add('executions', 'accuracy', 'TEXT');
  add('executions', 'agency_feedback', 'TEXT');
  add('executions', 'created_by', 'TEXT');
  add('executions', 'created_at', 'TEXT');

  // creators 新字段（创作者库 V3）
  add('creators', 'account_type', "TEXT DEFAULT '个人'");
  add('creators', 'agency', 'TEXT');
  add('creators', 'content_type', 'TEXT');
  add('creators', 'coop_cycle', 'TEXT');
  add('creators', 'willingness', "TEXT DEFAULT '中'");
  add('creators', 'stability', "TEXT DEFAULT '中'");
  add('creators', 'is_new', 'INTEGER DEFAULT 0');
  add('creators', 'good_play', 'TEXT');
  add('creators', 'good_role', 'TEXT');
  add('creators', 'style', 'TEXT');
  add('creators', 'forms', 'TEXT');
  add('creators', 'avg_cycle_days', 'INTEGER');
  add('creators', 'cost_ceiling', 'REAL');
  add('creators', 'manual_cpm', 'REAL');
  add('creators', 'bad_direction', 'TEXT');
  // executions 增加「待发布」阶段
  // （阶段为自由文本，无需加列，仅导入/表单使用枚举）

  // reviews 新字段（内容经营分析：周期快照）
  add('reviews', 'campaign_id', 'INTEGER');
  add('reviews', 'cycle_mode', "TEXT DEFAULT 'task'");
  add('reviews', 'period_label', 'TEXT');
  add('reviews', 'analysis_json', 'TEXT');
  // experiences 新字段（经营经验库：影响字段）
  add('experiences', 'target_direction', 'TEXT');
  add('experiences', 'platform', 'TEXT');
  add('experiences', 'applicable_creator', 'TEXT');
  add('experiences', 'data_basis', 'TEXT');
  add('experiences', 'source_cycle', 'TEXT');
  add('experiences', 'validation_count', 'INTEGER DEFAULT 0');
  add('experiences', 'confidence', "TEXT DEFAULT '中'");
  add('experiences', 'is_effective', 'INTEGER DEFAULT 1');
  add('experiences', 'analysis_id', 'INTEGER');

  // cases 新字段（案例库重构）
  const casesInt = ['campaign_id', 'analysis_edited', 'is_favorite', 'is_verified', 'is_reusable', 'linked_opportunity_id', 'benchmark_met'];
  const casesText = ['game_name', 'marketing_node', 'hotspot', 'play_method', 'creator_type', 'raw_content', 'analysis_json', 'confirm_status', 'review_conclusion', 'note'];
  casesInt.forEach(c => add('cases', c, 'INTEGER DEFAULT 0'));
  casesText.forEach(c => add('cases', c, 'TEXT'));
  add('cases', 'source', "TEXT DEFAULT '人工新增'");
  // cases 新字段（发布数据表导入：粉丝数/视频文案/收藏/分享/达人平台ID）
  add('cases', 'fans', 'INTEGER DEFAULT 0');
  add('cases', 'copy', 'TEXT');
  add('cases', 'favorite_count', 'INTEGER DEFAULT 0');
  add('cases', 'share_count', 'INTEGER DEFAULT 0');
  add('cases', 'creator_platform_id', 'TEXT');
  // creator_accounts 新增平台账号ID，供按达人平台ID精确归人（发布/消耗表导入回填）
  add('creator_accounts', 'platform_id', 'TEXT');

  // 1) 来源平台标注补全（按平台推断 source_label：B站热门内容/抖音热点榜/微博热点）
  db.prepare(`UPDATE hotspots SET source_label = CASE platform
      WHEN 'B站' THEN 'B站热门内容'
      WHEN '抖音' THEN '抖音热点榜'
      WHEN '微博' THEN '微博热点'
      ELSE '手动补充' END
    WHERE source_label IS NULL OR source_label=''`).run();

  // 2) 智能筛查：仅对未筛查(screen_result IS NULL)的候选热点执行
  const setRow = db.prepare('UPDATE hotspots SET screen_result=?,screen_reason=?,relevance=? WHERE id=?');
  const blRow = db.prepare("SELECT value FROM settings WHERE key='screen_blacklist'").get();
  const blacklist = (blRow && blRow.value)
    ? blRow.value.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)
    : ['争议', '绯闻', '政治', '擦边', '社会负面'];
  const camps = db.prepare("SELECT * FROM campaigns WHERE status='执行中'").all();
  const kws = new Set();
  camps.forEach(c => (c.keywords || '').split(/[,，、\s/]+/).forEach(k => { k = k.trim().toLowerCase(); if (k.length >= 2) kws.add(k); }));

  const cands = db.prepare("SELECT * FROM hotspots WHERE status='候选' AND screen_result IS NULL").all();
  for (const h of cands) {
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
      const bad = blacklist.filter(b => text.includes(b));
      if (bad.length) { result = '不符合'; reason = `含疑似不适配宣发的内容(${bad.join('/')})，已标记筛查不通过`; }
    }
    const rel = result === '符合' ? '强' : result === '待定' ? '中' : '弱';
    setRow.run(result, reason, rel, h.id);
  }

  // ===== 创作者多平台模型：历史单平台数据迁移到账号表（一次性，幂等）=====
  // 1) 确保账号表存在（createSchema 已建，这里再保险一次）
  db.exec(`CREATE TABLE IF NOT EXISTS creator_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    account_name TEXT,
    home_url TEXT,
    fans INTEGER DEFAULT 0,
    avg_play INTEGER DEFAULT 0,
    avg_activation REAL,
    avg_roi7 REAL,
    role TEXT DEFAULT '创作',
    is_primary INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // 2) 每条有 platform 且无账号的创作者 → 拆出「人」+ 1 个主平台账号（创作）
  const needMig = db.prepare(`SELECT c.* FROM creators c WHERE (c.platform IS NOT NULL AND c.platform <> '') AND NOT EXISTS (SELECT 1 FROM creator_accounts a WHERE a.creator_id=c.id)`).all();
  const migIns = db.prepare(`INSERT INTO creator_accounts (creator_id,platform,account_name,home_url,fans,avg_play,avg_activation,avg_roi7,role,is_primary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`);
  for (const c of needMig) {
    migIns.run(c.id, c.platform, c.name, c.home_url, c.fans || 0, c.avg_play || 0, c.avg_activation, c.avg_roi7, '创作', 1);
  }
  // 3) 平台级指标已落到账号表，清理 creators 上的冗余平台字段（列保留，置空，账号表为权威来源）
  db.exec(`UPDATE creators SET platform=NULL, home_url=NULL, fans=NULL, avg_play=NULL, avg_activation=NULL, avg_roi7=NULL WHERE EXISTS (SELECT 1 FROM creator_accounts a WHERE a.creator_id=creators.id)`);
}

module.exports = { createSchema, migrate };
