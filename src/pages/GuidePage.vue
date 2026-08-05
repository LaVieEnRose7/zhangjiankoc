<template>
  <div>
    <div class="page-head">
      <div class="page-head-left"><h2>使用指南</h2><div class="sub">快速了解工作台的使用流程</div></div>
    </div>

    <div class="card">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:12px">KOC 工作台怎么用？</h3>
      <div style="line-height:2;font-size:14px;color:var(--ink-dim)">
        <p><b style="color:var(--ink)">1. 今日工作</b> — 每天打开先看。查看活跃任务摘要、AI 推荐的热点机会、即将过期的机会和待办项。</p>
        <p><b style="color:var(--ink)">2. 营销任务</b> — 创建和管理营销 Campaign。设置游戏名称、目标、周期、重点内容和推荐规则。</p>
        <p><b style="color:var(--ink)">3. 机会中心</b> — 核心流程：热点判断 → AI 方案 → 机会结论 → 风险判断 → 内容方向 → 匹配创作者 → 执行 → 复盘。</p>
        <p><b style="color:var(--ink)">4. 游戏快讯</b> — 聚合最新游戏行业资讯，发现外部内容趋势。</p>
        <p><b style="color:var(--ink)">5. 案例库</b> — 沉淀发布案例。记录播放量、激活率、ROI 等数据。</p>
        <p><b style="color:var(--ink)">6. 创作者库</b> — 管理合作创作者。记录平台账号、粉丝量、擅长方向和历史数据。</p>
        <p><b style="color:var(--ink)">7. 内容运营分析</b> — 周期复盘。查看内容趋势、创作者表现，沉淀经验。</p>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:12px">典型工作流</h3>
      <div style="line-height:2;font-size:14px;color:var(--ink-dim)">
        <p><b style="color:var(--ink)">早间检查：</b>打开「今日工作」→ 查看 AI 推荐热点 → 对潜力热点点「采纳为机会」</p>
        <p><b style="color:var(--ink)">机会决策：</b>在「机会中心」→ 对每个待判断机会做 AI 评估 → 判断「值得做」或「不采用」</p>
        <p><b style="color:var(--ink)">方案生成：</b>AI 自动生成完整方案（玩法、风险、内容方向）→ 人工确认 → 沉淀为创意模板</p>
        <p><b style="color:var(--ink)">匹配创作者：</b>系统自动推荐匹配创作者 → 选定合作者 → 进入执行待办</p>
        <p><b style="color:var(--ink)">执行跟进：</b>导入发布/跑量数据 → 系统按平台、标题、创作者和发布时间自动关联机会 → 回看机会表现</p>
        <p><b style="color:var(--ink)">周期复盘：</b>在「内容运营分析」查看表现 → 沉淀有效经验到经验库</p>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:12px">AI 能力说明</h3>
      <div style="line-height:2;font-size:14px;color:var(--ink-dim)">
        <p>工作台支持 Gemini 官方接口，也支持 OpenAI 兼容格式的中转站，用于热点机会分析、方案生成、创作者匹配推荐。</p>
        <p>在未配置 API Key 时，系统自动降级为<b style="color:var(--ink)">规则引擎</b>，基于预设策略给出判断建议。</p>
      </div>
    </div>
  </div>
</template>
