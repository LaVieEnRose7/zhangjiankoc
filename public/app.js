/* 杖剑传说 KOC 工作台 V3 - 前端 */
'use strict';

/* ================= 基础工具 ================= */
const $ = s => document.querySelector(s);
const main = $('#main');
const OPP_FLOW = ['待判断', '已采纳', '待匹配创作者', '创作中', '待发布', '已发布', '已验证'];
const OPP_CURRENT = ['待判断', '已采纳', '待匹配创作者', '创作中', '待发布', '已发布'];
const OPP_HISTORY = ['已验证', '不采用', '已过期'];
const OPP_ALL = [...OPP_FLOW, ...OPP_HISTORY];

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || '请求失败');
  return j.data;
}
async function upload(path, file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api' + path, { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success) throw new Error(j.message);
  return j.data;
}

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 2600);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) { return n == null || n === '' ? '—' : Number(n).toLocaleString(); }
function pct(n) { return n == null || n === '' ? '—' : n + '%'; }

/* 极简 markdown 渲染 */
function md(text) {
  if (!text) return '';
  let h = esc(text);
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>')
       .replace(/^## (.+)$/gm, '<h2>$1</h2>')
       .replace(/^# (.+)$/gm, '<h2>$1</h2>')
       .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
       .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
       .replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
       .replace(/\n{2,}/g, '</p><p>')
       .replace(/\n/g, '<br>');
  return `<div class="md"><p>${h}</p></div>`;
}

/* 弹窗 */
function openModal(html, wide = false) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-mask';
  wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  $('#modals').appendChild(wrap);
  return wrap;
}
function closeModals() { $('#modals').innerHTML = ''; }

function statusTag(s) {
  const map = { '待判断': 'orange', '已采纳': 'blue', '待匹配创作者': 'purple', '创作中': 'blue', '待发布': 'orange', '已发布': 'teal', '已验证': 'green', '不采用': 'gray', '已过期': 'gray',
    '候选': 'orange', '已转机会': 'green', '已忽略': 'gray',
    '进行中': 'blue', '已结束': 'gray', '未开始': 'orange',
    '爆款': 'red', '良好': 'green', '一般': 'gray', '失败': 'gray',
    '可合作': 'green', '合作中': 'blue', '暂停': 'orange', '黑名单': 'red',
    '草稿': 'orange', '已归档': 'gray', '已确认': 'green', '待办': 'orange',
    '沟通中': 'orange', '脚本确认': 'purple', '制作中': 'blue', '待发布': 'orange', '已发布': 'blue', '数据回收': 'green' };
  return `<span class="tag ${map[s] || 'gray'}">${esc(s)}</span>`;
}
function scoreColor(s) { return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--orange)' : 'var(--red)'; }

/* ================= 用户 ================= */
function getUser() { return localStorage.getItem('zj_user') || ''; }
function askUsername(force = false) {
  if (!force && getUser()) return refreshUserChip();
  const m = openModal(`
    <div class="modal-head"><h3>你是谁？</h3></div>
    <div class="modal-body">
      <div class="form-row"><label>输入你的名字（用于记录操作，如“小小收藏了”）</label>
      <input id="unInput" value="${esc(getUser())}" placeholder="如：李媒介" /></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="unOk">确定</button></div>`);
  m.querySelector('#unOk').onclick = () => {
    const v = m.querySelector('#unInput').value.trim();
    if (!v) return toast('请输入名字', true);
    localStorage.setItem('zj_user', v);
    refreshUserChip();
    m.remove();
  };
}
function refreshUserChip() {
  const u = getUser();
  $('#userName').textContent = u || '未设置';
  $('#userAvatar').textContent = u ? u[0] : '?';
}

/* ================= 路由 ================= */
const pages = {};
let currentPage = 'today';
function go(page, param) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  pages[page](param);
}
$('#nav').addEventListener('click', e => {
  const item = e.target.closest('.nav-item');
  if (item) go(item.dataset.page);
});

/* ================= 页面：今日工作 ================= */
function screenBadge(r) {
  if (r === '符合') return '<span class="screen-badge pass">✓ 符合宣发</span>';
  if (r === '不符合') return '<span class="screen-badge fail">✕ 不通过</span>';
  return '<span class="screen-badge wait">? 待确认</span>';
}
function urgencyBadge(u) {
  if (u === 'missed') return '<span class="urgency red">已错过时效</span>';
  if (u === 'today') return '<span class="urgency orange">今天确认</span>';
  if (u === '24h') return '<span class="urgency blue">24h内启动</span>';
  return '';
}

pages.today = async function () {
  main.innerHTML = '<div class="empty">加载中…</div>';
  const d = await api('/today');
  const today = new Date().toISOString().slice(0, 10);
  window.__activeCampId = d.campaignSummary ? d.campaignSummary.id : null;

  // 今日热点 & AI 推荐机会（抖音热榜 + B站热门，每日仅抓取一次 + 分析一次）
  let cands = [], recos = [], hsMeta = {}, recoMeta = {};
  try {
    const hs = await api('/today/hotspots?limit=100');
    cands = hs.list || [];
    hsMeta = { fetchedAt: hs.fetchedAt, sourceStatus: hs.sourceStatus, biliCount: hs.biliCount, douyinCount: hs.douyinCount };
  } catch (e) { console.warn('实时热点获取失败', e); }
  try {
    const rr = await api('/today/recommendations?limit=8');
    recos = rr.list || [];
    recoMeta = { fetchedAt: rr.fetchedAt, sourceStatus: rr.sourceStatus, cached: rr.cached };
  } catch (e) { console.warn('AI 推荐获取失败', e); }
  window.__recos = recos;

  const cs = d.campaignSummary;
  const exp = d.expiring || [];
  const fb = d.recentFeedback || {};
  const todos = d.execTodos || {};

  const summaryHtml = cs ? `
  <div class="card summary-card">
    <div class="sum-head">
      <div>
        <div class="game-name">${esc(cs.game_name)} <span class="tag ${cs.priority === '高' ? 'red' : 'gray'}">${esc(cs.priority)}优先级</span></div>
        <div class="sum-title">${esc(cs.name)}</div>
        <div class="hint">当前版本/活动：${esc(cs.version_event || '—')}</div>
      </div>
      <div class="sum-actions">
        <button class="btn" onclick="go('campaigns')">查看任务</button>
        <button class="btn primary" onclick="openAdjustFocus(${cs.id})">调整重点</button>
      </div>
    </div>
    <div class="sum-grid">
      <div><div class="lbl">本期传播目标</div><div class="val">${esc(cs.goal || '—')}</div></div>
      <div><div class="lbl">当前重点角色/内容</div><div class="val">${esc(cs.focus_content || '—')}</div></div>
      <div><div class="lbl">营销周期</div><div class="val">${esc(cs.cycle_start || '—')} ~ ${esc(cs.cycle_end || '—')}</div></div>
      <div><div class="lbl">剩余执行时间</div><div class="val ${cs.remain_days != null && cs.remain_days < 7 ? 'red' : ''}">${cs.remain_days != null ? cs.remain_days + ' 天' : '—'}</div></div>
    </div>
    ${cs.active_count > 1 ? `<div class="hint" style="margin-top:8px">另有 ${cs.active_count - 1} 个进行中任务，<span class="link-btn" onclick="go('campaigns')">查看全部</span></div>` : ''}
  </div>` : `
  <div class="card"><div class="empty">暂无进行中的营销任务。<button class="btn primary" onclick="go('campaigns')">去创建任务</button></div></div>`;

  const hsStatus = hsMeta.sourceStatus
    ? `（B站 ${hsMeta.sourceStatus.bili === 'ok' ? '✓' : '✕'} ｜ 抖音 ${hsMeta.sourceStatus.douyin === 'ok' ? '✓' : '✕'}）`
    : '';
  const candHtml = cands.length ? cands.map(h => `
    <div class="hotspot-card">
      <div class="hc-head">
        <span class="tag ${h.source === 'B站' ? 'blue' : h.source === '抖音' ? 'red' : 'gray'}">${esc(h.source)}</span>
        ${h.rank ? `<span class="hint">#${h.rank}</span>` : ''}
        ${h.heat != null ? `<span class="hint">🔥 ${fmt(h.heat)}</span>` : ''}
      </div>
      <div class="hc-title link" title="点击在${esc(h.source)}打开" onclick="openRealLink('${esc(h.url)}')">${esc(h.title)}</div>
      <div class="hc-meta">${h.up ? `UP ${esc(h.up)}` : (h.source === '抖音' ? '抖音热榜话题' : 'B站热门视频')}</div>
      ${h.pic ? `<img class="hc-pic" src="${esc(h.pic)}" alt="" onerror="this.style.display='none'"/>` : ''}
    </div>`).join('') : '<div class="empty">今日热点获取失败，点击右上角「重新抓取今日」重试</div>';

  const recoHtml = recos.length ? recos.map((r, i) => `
    <div class="reco-card">
      <div class="rc-head">
        <div class="score-ring" style="background:${scoreColor(r.score)}">${r.score}<span style="font-size:9px;font-weight:400">${esc(r.verdict)}</span></div>
        <div class="rc-title link" title="点击在${esc(r.source)}打开" onclick="openRealLink('${esc(r.url)}')">${esc(r.title)}</div>
      </div>
      <div class="rc-meta"><span class="tag gray">${esc(r.source)}</span>${r.heat != null ? `<span class="hint">🔥 ${fmt(r.heat)}</span>` : ''}${recoMeta.cached ? `<span class="hint">· 今日已分析</span>` : ''}</div>
      <div class="rc-line"><b>结合角度：</b>${esc(r.angle || '—')}</div>
      <div class="rc-line"><b>推荐理由：</b>${esc(r.reason || '—')}</div>
      <div class="rc-acts"><button class="btn small primary" onclick="genCreative(${i})">🎬 生成创意内容</button></div>
    </div>`).join('') : '<div class="empty">暂无可结合的热点（AI 今日分析无结果，或热点源不可用）</div>';

  const expHtml = exp.length ? `<div class="exp-list">` + exp.map(e => `
    <div class="exp-item ${e.urgency}">
      ${urgencyBadge(e.urgency)}
      <span class="exp-title" ${e.kind === 'opportunity' ? `onclick="openOppDrawer(${e.id})"` : ''}>${esc(e.title)}</span>
      <span class="hint">${esc(e.deadline)} · ${esc(e.note)}</span>
    </div>`).join('') + `</div>` : '<div class="empty">没有即将过期的机会</div>';

  const todoHtml = Object.keys(todos).length ? Object.entries(todos).map(([k, arr]) => arr.length ? `
    <div class="todo-group">
      <div class="tg-head">${esc(k)} <span class="tg-count">${arr.length}</span></div>
      ${arr.slice(0, 6).map(t => `<div class="tg-item" ${t.ref === 'opportunity' ? `onclick="openOppDrawer(${t.id})"` : t.ref === 'review' ? `onclick="go('ops')"` : t.ref === 'execution' ? `onclick="go('opportunities')"` : ''}>
        <span class="tg-title">${esc(t.title)}</span>
        ${t.sub ? `<span class="tag gray">${esc(t.sub)}</span>` : ''}
        ${t.due ? `<span class="hint">截止 ${esc(t.due)}</span>` : ''}
      </div>`).join('')}
      ${arr.length > 6 ? `<div class="hint">…还有 ${arr.length - 6} 条</div>` : ''}
    </div>` : '').join('') || '<div class="empty">暂无待办</div>' : '<div class="empty">暂无待办</div>';

  const fbHtml = `
  <div class="fb-section">
    <div class="fb-metrics">
      <div class="fb-metric">
        <div class="fbm-label">发布数</div>
        <div class="fbm-num">${fb.published_count || 0}</div>
      </div>
      <div class="fb-metric up">
        <div class="fbm-label">表现突出</div>
        <div class="fbm-num">${(fb.highlights || []).length}</div>
      </div>
      <div class="fb-metric warn">
        <div class="fbm-label">待观察</div>
        <div class="fbm-num">${(fb.observe || []).length}</div>
      </div>
    </div>

    ${(fb.highlights || []).length ? `
    <div class="fb-group">
      <div class="fb-group-title">表现突出内容</div>
      <div class="fb-highlight-list">
        ${fb.highlights.map(h => `
          <div class="fb-highlight-card" ${h.id ? `onclick="openOppDrawer(${h.id})"` : ''}>
            <div class="fbh-main">
              <div class="fbh-title">${esc(h.title)}</div>
              <div class="fbh-meta">
                <span class="fbh-chip up">ROI7 ${h.roi}</span>
                <span class="fbh-chip">播放 ${fmt(h.play)}</span>
              </div>
            </div>
            ${h.id ? '<div class="fbh-link">查看详情 →</div>' : ''}
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${(() => {
      const dirs = fb.new_directions || [];
      if (!dirs.length) return '';
      const groups = {};
      dirs.forEach(x => {
        const cat = x.category || '其他';
        const key = (x.content || '').trim();
        groups[cat] = groups[cat] || new Set();
        if (key) groups[cat].add(key);
      });
      const catClass = { '选题': 'blue', '时机': 'purple', '形式': 'orange', '创作者': 'green' };
      const cards = Object.entries(groups).map(([cat, set]) => `
        <div class="fb-dir-card">
          <div class="fb-dir-head">
            <span class="tag ${catClass[cat] || 'gray'}">${esc(cat)}</span>
            <span class="hint">${set.size} 条</span>
          </div>
          <div class="fb-dir-list">
            ${[...set].slice(0, 5).map(c => `<div class="fb-dir-item"><i></i><span>${esc(c)}</span></div>`).join('')}
            ${[...set].length > 5 ? `<div class="hint" style="margin-top:6px">…还有 ${[...set].length - 5} 条</div>` : ''}
          </div>
        </div>`).join('');
      return `<div class="fb-group"><div class="fb-group-title">新出现的有效方向</div><div class="fb-dir-grid">${cards}</div></div>`;
    })()}

    ${(fb.observe || []).length ? `
    <div class="fb-group">
      <div class="fb-group-title">需继续观察的机会</div>
      <div class="fb-observe-list">
        ${fb.observe.map(o => `
          <div class="fb-observe-item" onclick="openOppDrawer(${o.id})">
            <span class="fb-observe-dot"></span>
            <span class="fb-observe-title">${esc(o.title)}</span>
            <span class="fbh-link">查看详情 →</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${(fb.running || []).length ? `
    <div class="fb-group">
      <div class="fb-group-title">数据尚未跑完</div>
      <div class="fb-running-list">
        ${fb.running.map(x => `
          <div class="fb-running-item">
            <span class="fb-running-dot"></span>
            <span>${esc(x.title)}</span>
            <span class="hint">(${esc(x.stage)})</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${!(fb.highlights || []).length && !(fb.new_directions || []).length && !(fb.observe || []).length && !(fb.running || []).length ? '<div class="empty">近7天暂无执行结果</div>' : ''}
  </div>`;

  main.innerHTML = `
  <div class="page-head">
    <div><h2>今日工作</h2><div class="sub">${today} · 发现机会 — 判断优先级 — 跟进执行 — 复盘反哺</div></div>
    <div class="head-actions">
      <button class="btn" id="btnRefreshToday" onclick="refreshToday()">🔄 重新抓取今日</button>
    </div>
  </div>
  <div class="grid grid-4" style="margin-bottom:16px">
    <div class="stat-card"><div class="lbl">候选热点(今日)</div><div class="num" style="color:var(--orange)">${cands.length}</div></div>
    <div class="stat-card"><div class="lbl">推荐机会(AI)</div><div class="num" style="color:var(--brand)">${recos.length}</div></div>
    <div class="stat-card"><div class="lbl">即将过期</div><div class="num" style="color:var(--red)">${d.stats.expiring}</div></div>
    <div class="stat-card"><div class="lbl">执行待办</div><div class="num" style="color:var(--purple)">${d.stats.todoTotal}</div></div>
  </div>

  <div class="section-title">① 当前营销任务摘要</div>
  ${summaryHtml}

  <div class="section-title">② 今日候选热点 · ③ 今日推荐机会</div>
  <div class="grid grid-2">
    <div class="card">
      <h3>📡 今日候选热点 <span class="hint" style="font-weight:400">共 ${cands.length} 条相关 · 上下滑动查看</span></h3>
      <div class="list-scroll">${candHtml}</div>
    </div>
    <div class="card">
      <h3>💡 今日推荐机会</h3>
      <div class="list-scroll">${recoHtml}</div>
    </div>
  </div>

  <div class="section-title">④ 即将过期机会</div>
  <div class="card">${expHtml}</div>

  <div class="section-title">⑤ 执行待办 · ⑥ 近期结果反馈</div>
  <div class="grid grid-2">
    <div class="card">
      <h3>📋 执行待办 <span class="tag orange">${d.todoTotal}</span></h3>
      ${todoHtml}
    </div>
    <div class="card">
      <h3>📈 近期结果反馈</h3>
      ${fbHtml}
    </div>
  </div>`;
};

// 手动重新抓取今日热点 + 重新 AI 分析（测试用；默认每日自动只跑一次）
window.refreshToday = async function () {
  const btn = document.getElementById('btnRefreshToday');
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '抓取中…'; }
  try {
    const r = await api('/today/refresh', { method: 'POST' });
    toast(`已重新抓取今日热点并完成 AI 分析（${r.hotspotCount} 条热点 / ${r.recoCount} 条推荐）`);
    await pages.today();
  } catch (e) {
    toast('抓取失败：' + (e.message || e), true);
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
  }
};

window.toOpportunity = async function (hid, cid) {
  try {
  const camps = await api('/campaigns');
  const active = camps.filter(c => c.status === '执行中');
  const cur = camps.find(c => c.is_current);
  const def = cid || window.__activeCampId || (cur && cur.id) || (active[0] && active[0].id) || '';
    const m = openModal(`
      <div class="modal-head"><h3>生成内容机会</h3><span class="x" onclick="closeModals()">✕</span></div>
      <div class="modal-body">
        <div class="hint">将候选热点转为可判断的内容机会（状态：待判断）。</div>
        <div class="form-row"><label>关联营销任务（提供判断标准）</label>
          <select id="toCid">${active.map(c => `<option value="${c.id}" ${String(c.id) === String(def) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="">不关联</option></select>
        </div>
      </div>
      <div class="modal-foot"><button class="btn primary" id="toOk">创建机会</button></div>`);
    m.querySelector('#toOk').onclick = async () => {
      const campaign_id = m.querySelector('#toCid').value || null;
      const r = await api(`/hotspots/${hid}/to-opportunity`, { method: 'POST', body: { campaign_id, user: getUser() } });
      closeModals();
      toast('已创建机会，规则初评 ' + r.score.score + ' 分');
      await genDirection(r.id, { silent: true }).catch(() => {});
      openOppDrawer(r.id);
    };
  } catch (e) { toast(e.message, true); }
};

window.hotspotAction = async function (id, action) {
  const label = { observe: '已保留观察', ignore: '已暂不关注', inaccurate: '已标记信息不准确' }[action] || '已更新';
  try {
    await api(`/hotspots/${id}/action`, { method: 'POST', body: { action, user: getUser() } });
    toast(label);
    go('today');
  } catch (e) { toast(e.message, true); }
};

// 实时热点/推荐机会标题点击：直接打开该热点在抖音/B站的真实链接（新标签页）
window.openRealLink = function (url) {
  if (url) window.open(url, '_blank');
};

/* ============ 今日推荐机会：生成创意内容 → 匹配创作者 → 进入执行待办 ============ */
window.__gc = { r: null, creative: '' };

window.genCreative = async function (idx) {
  const r = (window.__recos || [])[idx];
  if (!r) return toast('未找到推荐机会', true);
  const m = openModal(`
    <div class="modal-head"><h3>🎬 生成创意内容</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="hint">基于这条推荐机会的 AI 创意方案（操作人：${esc(getUser() || '未设置')}）</div>
      <div class="form-row full"><label>机会标题</label><input id="gcTitle" value="${esc(r.title)}" readonly></div>
      <div class="form-row full"><label>结合角度</label><input id="gcAngle" value="${esc(r.angle || '')}" readonly></div>
      <div id="gcResult" class="gn-detail-sum" style="white-space:pre-wrap;margin-top:12px">生成中…</div>
    </div>
    <div class="modal-foot">
      <button class="btn" id="gcSave" disabled>保存为创意模板</button>
      <button class="btn primary" id="gcMatch">找适合创作者 →</button>
    </div>`);
  let creativeText = '';
  try {
    const resp = await api('/today/recommendations/creative', { method: 'POST', body: { title: r.title, angle: r.angle, reason: r.reason, user: getUser() } });
    creativeText = resp.text || '';
    m.querySelector('#gcResult').textContent = creativeText;
    m.querySelector('#gcSave').disabled = false;
  } catch (e) {
    m.querySelector('#gcResult').textContent = '生成失败：' + (e.message || e);
  }
  m.querySelector('#gcSave').onclick = async () => {
    const name = prompt('创意模板名称：', r.title);
    if (!name) return;
    try {
      await api('/creative_templates', { method: 'POST', body: { name, core_logic: creativeText, applicable_hotspot: r.title, created_by: getUser() } });
      toast('已保存为创意模板');
    } catch (e) { toast(e.message, true); }
  };
  m.querySelector('#gcMatch').onclick = () => findCreatorsForReco(r, creativeText);
};

window.findCreatorsForReco = async function (r, creativeText) {
  window.__gc = { r, creative: creativeText };
  const m = openModal(`
    <div class="modal-head"><h3>🔍 适合的创作者</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="hint">基于「${esc(r.title)}」匹配的创作者（按擅长方向重叠排序）</div>
      <div id="gcMatches"><div class="empty">匹配中…</div></div>
    </div>`);
  try {
    const resp = await api('/creators/match', { method: 'POST', body: { text: (r.title + ' ' + (r.angle || '') + ' ' + (r.reason || '')) } });
    const items = resp.items || [];
    const box = m.querySelector('#gcMatches');
    if (!items.length) { box.innerHTML = '<div class="empty">没有标签匹配的创作者，可手动在创作者库挑选</div>'; return; }
    box.innerHTML = items.map(c => `
      <div class="match-row">
        <div>
          <b>${esc(c.name)}</b>${c.platform ? ` <span class="tag gray">${esc(c.platform)}</span>` : ''}
          ${c.fans ? `<span class="hint">粉丝 ${fmt(c.fans)}</span>` : ''}
          ${c.matched && c.matched.length ? `<div class="hint">匹配：${esc(c.matched.join('、'))}</div>` : ''}
        </div>
        <button class="btn small primary" onclick="addRecoToTodo(${c.id}, '${esc(c.name)}')">加入执行待办</button>
      </div>`).join('');
  } catch (e) {
    m.querySelector('#gcMatches').innerHTML = '<div class="empty">匹配失败：' + esc(e.message) + '</div>';
  }
};

window.addRecoToTodo = async function (creatorId, creatorName) {
  const { r, creative } = window.__gc;
  if (!r) return toast('上下文丢失，请重试', true);
  try {
    const resp = await api('/opportunities/from-reco', {
      method: 'POST',
      body: { title: r.title, angle: r.angle, reason: r.reason, creator_id: creatorId, creative, user: getUser() }
    });
    closeModals();
    toast(`已为「${creatorName}」创建执行待办（机会#${resp.opportunity_id}）`);
    openOppDrawer(resp.opportunity_id);
  } catch (e) { toast(e.message, true); }
};

// 候选热点标题点击：沿链路（热点→机会→案例）找到关联发布视频，打开外部链接
// 用「同步占位窗口」规避异步回调里 window.open 被浏览器拦截
window.openHotspotVideo = async function (id) {
  let win = null;
  try { win = window.open('', '_blank'); } catch (e) { win = null; }
  try {
    const d = await api(`/hotspots/${id}/video`);
    const cases = (d && d.cases) || [];
    if (!cases.length) {
      if (win) try { win.close(); } catch (e) {}
      toast('该候选热点暂无关联发布视频（可先「生成机会」并发布成片后再关联）', true);
      return;
    }
    if (cases.length === 1) {
      const u = cases[0].url;
      if (win) { win.location.href = u; } else { window.open(u, '_blank'); }
      return;
    }
    if (win) try { win.close(); } catch (e) {}
    showVideoPicker(cases);
  } catch (e) {
    if (win) try { win.close(); } catch (e2) {}
    toast('获取关联视频失败：' + e.message, true);
  }
};

window.showVideoPicker = function (cases) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" style="width:480px">
    <div class="modal-head"><h3>选择要打开的发布视频</h3><span class="x" onclick="this.closest('.modal-mask').remove()">✕</span></div>
    <div class="modal-body">
      ${cases.map(c => `<div class="vp-item" data-url="${esc(c.url)}" onclick="openVideoUrl(this.dataset.url, this)">
        <div class="vp-title">${esc(c.title)}</div>
        <div class="vp-meta"><span class="tag blue">${esc(c.platform || '—')}</span>${c.source ? `<span class="tag gray">${esc(c.source)}</span>` : ''}<span class="hint">${esc(c.url)}</span></div>
      </div>`).join('')}
    </div>
  </div>`;
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
  document.body.appendChild(mask);
};

window.openVideoUrl = function (url, el) {
  window.open(url, '_blank'); // 处于用户点击手势内，不被拦截
  const mask = el.closest('.modal-mask');
  if (mask) mask.remove();
};

window.openAdjustFocus = async function (id) {
  const c = await api(`/campaigns/${id}`);
  const m = openModal(`
    <div class="modal-head"><h3>调整重点</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="hint">仅快速调整本周重点，完整配置请在「营销任务」页编辑。</div>
      <div class="form-row"><label>当前版本/活动</label><input id="afVer" value="${esc(c.version_event || '')}"></div>
      <div class="form-row"><label>当前重点角色/内容</label><textarea id="afFocus">${esc(c.focus_content || '')}</textarea></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="afOk">保存</button></div>`);
  m.querySelector('#afOk').onclick = async () => {
    await api(`/campaigns/${id}`, { method: 'PUT', body: { version_event: m.querySelector('#afVer').value, focus_content: m.querySelector('#afFocus').value } });
    closeModals(); toast('重点已更新'); go('today');
  };
};

window.viewRecoDetail = function (hid) {
  const r = (window.__recos || []).find(x => x.hotspot_id === hid);
  if (!r) return toast('推荐数据缺失', true);
  const m = openModal(`
    <div class="modal-head"><h3>推荐机会详情</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="rc-meta" style="margin-bottom:8px"><span class="tag gray">来源：${esc(r.hotspot_source)}</span>${r.campaign ? `<span class="tag blue">→ ${esc(r.campaign.name)}</span>` : ''} <span class="tag ${r.risk_level === '低' ? 'green' : r.risk_level === '高' ? 'red' : 'orange'}">风险${esc(r.risk_level)}</span> <span class="tag purple">评分 ${r.score}</span></div>
      <div class="sec-title">推荐理由</div><div class="rc-line">${esc(r.reason || '—')}</div>
      <div class="sec-title">推荐玩法</div><div class="rc-line">${esc(r.play_method || '—')}</div>
      <div class="sec-title">游戏结合方式</div><div class="rc-line">${esc(r.game_combo || '—')}</div>
      <div class="sec-title">适合创作者类型</div><div class="rc-line">${r.creator_types.length ? r.creator_types.map(t => `<span class="tag blue">${esc(t)}</span>`).join('') : '—'}</div>
      <div class="sec-title">建议执行时间</div><div class="rc-line">${esc(r.suggested_time || '—')}</div>
      <div class="sec-title">推荐创作者</div>
      <div>${r.matched_creators.length ? r.matched_creators.map(c => `<div class="reco" style="margin-top:6px"><div class="score-ring" style="background:${scoreColor(c.score)};width:40px;height:40px;font-size:13px">${c.score}</div><div class="body"><div class="t">${esc(c.name)}</div><div class="why">${esc(c.reason || '')}</div></div></div>`).join('') : '暂无可推荐创作者'}</div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" id="rcAdopt">采纳</button>
      <button class="btn" id="rcReco">推荐给创作者</button>
      <button class="btn" onclick="closeModals()">关闭</button>
    </div>`, true);
  m.querySelector('#rcAdopt').onclick = () => { closeModals(); adoptReco(hid); };
  m.querySelector('#rcReco').onclick = () => { closeModals(); recommendToCreator(hid); };
};

window.adoptReco = async function (hid) {
  try {
    const r = await api(`/hotspots/${hid}/adopt`, { method: 'POST', body: { campaign_id: window.__activeCampId || null, user: getUser() } });
    await genDirection(r.id, { silent: true }).catch(() => {});
    toast('已采纳为正式机会（值得做）');
    go('today');
  } catch (e) { toast(e.message, true); }
};

window.recommendToCreator = async function (hid) {
  try {
    const r = await api(`/hotspots/${hid}/adopt`, { method: 'POST', body: { campaign_id: window.__activeCampId || null, user: getUser() } });
    toast('已采纳并打开机会，系统已生成完整方案，可在「创作者匹配」选择合作者');
    await genDirection(r.id, { silent: true }).catch(() => {});
    openOppDrawer(r.id);
  } catch (e) { toast(e.message, true); }
};

window.analyzeReco = async function (hid) {
  try {
    const r = await api(`/hotspots/${hid}/analyze`, { method: 'POST', body: { user: getUser() } });
    if (r.message) toast(r.message, r.mode === 'rule'); else toast('已重新分析（AI生成）');
    if (r.recommendation) {
      const i = (window.__recos || []).findIndex(x => x.hotspot_id === hid);
      if (i >= 0) window.__recos[i] = r.recommendation;
    }
    go('today');
  } catch (e) { toast(e.message, true); }
};
window.doneTodo = async function (id) {
  await api(`/todos/${id}`, { method: 'PUT', body: { status: '已完成' } });
  toast('待办完成 ✓');
  setTimeout(() => go(currentPage), 400);
};
window.openTodoForm = function () {
  const m = openModal(`
    <div class="modal-head"><h3>新增待办</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="form-row"><label>内容</label><input id="tdTitle"></div>
      <div class="form-grid">
        <div class="form-row"><label>负责人</label><input id="tdAss" value="${esc(getUser())}"></div>
        <div class="form-row"><label>截止日期</label><input id="tdDue" type="date"></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="tdOk">保存</button></div>`);
  m.querySelector('#tdOk').onclick = async () => {
    const title = m.querySelector('#tdTitle').value.trim();
    if (!title) return toast('请输入内容', true);
    await api('/todos', { method: 'POST', body: { title, assignee: m.querySelector('#tdAss').value, due_date: m.querySelector('#tdDue').value, created_by: getUser() } });
    closeModals(); toast('已添加'); go(currentPage);
  };
};

window.openHotspotForm = function () {
  const m = openModal(`
    <div class="modal-head"><h3>录入候选热点</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body"><div class="form-grid">
      <div class="form-row full"><label>热点标题 *</label><input id="hsTitle"></div>
      <div class="form-row"><label>来源平台</label><select id="hsSrc"><option>B站热门内容</option><option>抖音热点榜</option><option>微博热点</option><option>手动补充</option><option>外部智能体推送</option></select></div>
      <div class="form-row"><label>平台归类</label><select id="hsPlat"><option>B站</option><option>抖音</option><option>微博</option><option>其他</option></select></div>
      <div class="form-row"><label>分类</label><select id="hsCat"><option>游戏内</option><option>泛游戏</option><option>泛娱乐</option><option>社会热点</option></select></div>
      <div class="form-row"><label>热度（0-100）</label><input id="hsHeat" type="number" value="60"></div>
      <div class="form-row"><label>趋势</label><select id="hsTrend"><option>上升</option><option>平稳</option><option>下降</option></select></div>
      <div class="form-row"><label>预计有效期</label><input id="hsValid" type="date"></div>
      <div class="form-row"><label>初步相关性</label><select id="hsRel"><option value="">（系统判定）</option><option>强</option><option>中</option><option>弱</option></select></div>
      <div class="form-row full"><label>链接</label><input id="hsUrl"></div>
      <div class="form-row full"><label>标签（逗号分隔）</label><input id="hsTags" placeholder="如：攻略,新职业"></div>
      <div class="form-row full"><label>描述</label><textarea id="hsDesc"></textarea></div>
      <div class="form-row full"><label>风险提示</label><input id="hsRisk" placeholder="如：争议话题需谨慎"></div>
    </div></div>
    <div class="modal-foot"><button class="btn primary" id="hsOk">保存</button></div>`);
  m.querySelector('#hsOk').onclick = async () => {
    const title = m.querySelector('#hsTitle').value.trim();
    if (!title) return toast('请输入标题', true);
    await api('/hotspots', { method: 'POST', body: {
      title, source_label: m.querySelector('#hsSrc').value, platform: m.querySelector('#hsPlat').value,
      category: m.querySelector('#hsCat').value, heat: +m.querySelector('#hsHeat').value || 0,
      trend: m.querySelector('#hsTrend').value, valid_until: m.querySelector('#hsValid').value,
      relevance: m.querySelector('#hsRel').value || null, url: m.querySelector('#hsUrl').value,
      tags: m.querySelector('#hsTags').value, description: m.querySelector('#hsDesc').value,
      risk_note: m.querySelector('#hsRisk').value, source: '手动录入', created_by: getUser()
    } });
    closeModals(); toast('已录入，系统已自动筛查宣发适配'); go('today');
  };
};

/* ================= 页面：营销任务 ================= */
/* ================= 营销任务：业务背景与推荐规则中心 ================= */
let campTab = 'base';
let campSelId = null;
const GOAL_OPTS = ['新版本曝光', '角色认知', '联动传播', '用户拉新', '老玩家回流', '内容生态建设', 'KOC内容扩散'];
const PLATFORMS = ['B站', '抖音', '微博', '小红书', '其他'];
const RISK_ITEMS = [
  ['opinion', '舆情风险'], ['copyright', '版权风险'], ['char_error', '角色设定错误'],
  ['ip_unauth', '未授权IP使用'], ['exaggerate', '过度夸大宣传'], ['platform_rule', '不符合平台规则'],
  ['real_person', '过度依赖真人拍摄'], ['outdated', '已经过时的热点'], ['koc_mismatch', '不适合KOC能力的玩法']
];
function jparse(s) { if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }
function val(s) { const el = document.querySelector(s); return el ? el.value : ''; }
function checkedVals(sel) { return Array.from(document.querySelectorAll(sel + ':checked')).map(e => e.value); }

pages.campaigns = async function () {
  const list = await api('/campaigns');
  if (!campSelId) { const cur = list.find(c => c.is_current) || list[0]; campSelId = cur ? cur.id : null; }
  window.__campList = list;
  const sel = list.find(c => c.id === campSelId) || null;
  const listHtml = list.length ? `<table class="tbl">
    <tr><th>任务名称</th><th>当前版本/活动</th><th>执行周期</th><th>项目状态</th><th>是否当前任务</th><th>最后更新</th><th>操作</th></tr>
    ${list.map(c => `<tr class="${c.is_current ? 'cur-row' : ''}">
      <td><span class="title-link" onclick="campSelect(${c.id})">${esc(c.name)}</span>${c.is_current ? ' <span class="tag blue">当前</span>' : ''}</td>
      <td>${esc(c.version_event || '—')}</td>
      <td style="font-size:12px">${esc(c.start_date || '')} ~ ${esc(c.end_date || '')}</td>
      <td>${statusTag(c.status)}</td>
      <td>${c.is_current ? '<span class="tag green">是</span>' : `<button class="btn small" onclick="campSetCurrent(${c.id})">设为当前</button>`}</td>
      <td style="font-size:12px;color:var(--ink2)">${esc((c.updated_at || '').slice(0, 10)) || '—'}</td>
      <td><button class="btn small" onclick="campSelect(${c.id})">查看/配置</button>
          <button class="btn small danger" onclick="delRow('campaigns',${c.id})">删除</button></td>
    </tr>`).join('')}
  </table>` : '<div class="empty">暂无营销任务，点击右上角新建</div>';

  main.innerHTML = `
  <div class="page-head">
    <div><h2>营销任务</h2><div class="sub">业务背景与推荐规则中心：热点判断、机会推荐、创作者匹配、周期复盘都读取这里</div></div>
    <div class="head-actions"><button class="btn primary" onclick="openCampaignForm()">＋ 新建任务</button></div>
  </div>
  <div class="section-title">① 营销任务列表</div>
  <div class="card">${listHtml}</div>
  <div class="section-title">②~⑦ 任务配置${sel ? '：' + esc(sel.name) : ''}</div>
  <div id="campDetail"></div>`;
  window.campRenderDetail();
};

window.campRenderDetail = function () {
  const list = window.__campList || [];
  const c = list.find(x => x.id === campSelId) || null;
  const el = document.getElementById('campDetail');
  if (!el) return;
  el.innerHTML = c ? campDetailHtml(c, campTab) : '<div class="card"><div class="empty">请选择或新建一个营销任务</div></div>';
};

function campDetailHtml(c, tab) {
  const tabs = [['base', '项目基础信息'], ['goals', '传播目标'], ['focus', '营销重点'], ['prefs', '推荐偏好'], ['risks', '风险规则'], ['summary', '规则摘要']];
  const nav = `<div class="subnav">` + tabs.map(([k, l]) => `<span class="subnav-item ${tab === k ? 'active' : ''}" onclick="campTabSwitch('${k}')">${l}</span>`).join('') + `</div>`;
  let body = '';
  if (tab === 'base') body = campBaseHtml(c);
  else if (tab === 'goals') body = campGoalsHtml(c);
  else if (tab === 'focus') body = campFocusHtml(c);
  else if (tab === 'prefs') body = campPrefsHtml(c);
  else if (tab === 'risks') body = campRisksHtml(c);
  else if (tab === 'summary') body = campSummaryHtml(c);
  return `<div class="card detail-card">
    <div class="detail-head">
      <div><div class="game-name">《杖剑传说》</div>
      <div class="sum-title">${esc(c.name)} ${c.is_current ? '<span class="tag blue">当前任务</span>' : ''}</div></div>
      <div class="sum-actions"><button class="btn" onclick="campSetCurrent(${c.id})">${c.is_current ? '已是当前任务' : '设为当前任务'}</button></div>
    </div>
    ${nav}${body}
  </div>`;
}

function campBaseHtml(c) {
  const stOpts = ['草稿', '执行中', '已结束', '已归档'];
  const priOpts = ['高', '中', '低'];
  return `<div class="form-grid">
    <div class="form-row"><label>任务名称 *</label><input id="bName" value="${esc(c.name || '')}"></div>
    <div class="form-row"><label>版本/活动名称</label><input id="bVer" value="${esc(c.version_event || '')}"></div>
    <div class="form-row"><label>目标平台（可多选）</label>${platMulti(c.target_platform)}</div>
    <div class="form-row"><label>开始时间</label><input id="bStart" type="date" value="${esc(c.start_date || '')}"></div>
    <div class="form-row"><label>结束时间</label><input id="bEnd" type="date" value="${esc(c.end_date || '')}"></div>
    <div class="form-row"><label>合作机构/代理</label><input id="bAgency" value="${esc(c.agency || '')}"></div>
    <div class="form-row"><label>优先级</label><select id="bPri">${priOpts.map(p => `<option ${c.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="form-row"><label>状态</label><select id="bSt">${stOpts.map(s => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="form-row full"><label>营销目标（总述）</label><textarea id="bGoal">${esc(c.goal || '')}</textarea></div>
    <div class="form-row full"><label>目标人群</label><input id="bAud" value="${esc(c.target_audience || '')}"></div>
    <div class="form-row full"><label>机会判断标准（AI/规则评估依据）</label><textarea id="bCri" placeholder="如：1.选题与新版本强相关；2.创作者均播≥5万">${esc(c.criteria || '')}</textarea></div>
    <div class="form-row full"><label>关键词（逗号分隔，用于热点匹配）</label><input id="bKw" value="${esc(c.keywords || '')}"></div>
    <div class="form-row full"><label>期望内容方向</label><textarea id="bDir">${esc(c.content_directions || '')}</textarea></div>
    <div class="form-foot"><button class="btn primary" onclick="campSaveBase(${c.id})">保存基础信息</button></div>
  </div>`;
}

function campGoalsHtml(c) {
  const g = jparse(c.goals) || { primary: [], secondary: [] };
  const opts = GOAL_OPTS.map(o => {
    const lvl = (g.primary || []).includes(o) ? 'primary' : (g.secondary || []).includes(o) ? 'secondary' : 'none';
    return `<div class="goal-row"><span class="goal-name">${o}</span>
      <select class="goal-sel" data-goal="${o}">
        <option value="none" ${lvl === 'none' ? 'selected' : ''}>不选</option>
        <option value="primary" ${lvl === 'primary' ? 'selected' : ''}>主要目标</option>
        <option value="secondary" ${lvl === 'secondary' ? 'selected' : ''}>次要目标</option>
      </select></div>`;
  }).join('');
  return `<div class="hint">可多选，但请区分「主要目标」与「次要目标」，避免系统给出过于分散的建议。</div>
    <div class="goal-list">${opts}</div>
    <div class="form-foot"><button class="btn primary" onclick="campSaveGoals(${c.id})">保存传播目标</button></div>`;
}

function campFocusHtml(c) {
  const f = jparse(c.focus_detail) || {};
  return `<div class="hint">支持用自然语言填写本期营销重点，点击「AI提取」自动拆分为结构化标签，确认后可修改再保存。</div>
    <div class="form-row full"><label>自然语言描述（本期营销重点）</label><textarea id="fNL" placeholder="例如：重点角色是新职业星术师，玩法是秘境速通和整活，版本卖点是星陨秘境资料片，暑期节点，希望强化杖剑传说=新职业养老首选的认知，目前缺少剧情向二创">${esc(c.focus_content || '')}</textarea></div>
    <div class="form-foot"><button class="btn" onclick="campExtractFocus(${c.id})">✨ AI提取为结构化标签</button></div>
    <div class="form-grid" style="margin-top:10px">
      <div class="form-row"><label>重点角色</label><input id="fRole" value="${esc(f.role || '')}"></div>
      <div class="form-row"><label>重点玩法</label><input id="fPlay" value="${esc(f.play || '')}"></div>
      <div class="form-row"><label>版本卖点</label><input id="fSell" value="${esc(f.selling_point || '')}"></div>
      <div class="form-row"><label>联动信息</label><input id="fLink" value="${esc(f.linkage || '')}"></div>
      <div class="form-row"><label>节日/营销节点</label><input id="fNode" value="${esc(f.node || '')}"></div>
      <div class="form-row"><label>希望强化的用户认知</label><input id="fCog" value="${esc(f.cognition || '')}"></div>
      <div class="form-row full"><label>当前内容缺口</label><input id="fGap" value="${esc(f.gap || '')}"></div>
    </div>
    <div class="form-foot"><button class="btn primary" onclick="campSaveFocus(${c.id})">保存营销重点</button></div>`;
}

function campPrefsHtml(c) {
  const p = jparse(c.prefs) || {};
  const plat = p.platform || [];
  const platChk = PLATFORMS.map(pl => `<label class="chk"><input type="checkbox" class="prefPlat" value="${pl}" ${plat.includes(pl) ? 'checked' : ''}>${pl}</label>`).join('');
  return `<div class="form-grid">
    <div class="form-row full"><label>优先平台</label><div class="chk-group">${platChk}</div></div>
    <div class="form-row full"><label>优先创作者类型（逗号分隔）</label><input id="pCT" value="${esc((p.creator_type || []).join(','))}"></div>
    <div class="form-row full"><label>优先内容形式（逗号分隔）</label><input id="pCF" value="${esc((p.content_form || []).join(','))}"></div>
    <div class="form-row full"><label>优先玩法（逗号分隔）</label><input id="pPM" value="${esc((p.play_method || []).join(','))}"></div>
    <div class="form-row"><label>可接受制作周期</label><input id="pCycle" value="${esc(p.cycle || '')}" placeholder="如：7天"></div>
    <div class="form-row"><label>优先当天可发布</label><input type="checkbox" id="pSame" ${p.same_day ? 'checked' : ''}></div>
    <div class="form-row"><label>要求存在成功案例</label><input type="checkbox" id="pCase" ${p.require_case ? 'checked' : ''}></div>
    <div class="form-foot"><button class="btn primary" onclick="campSavePrefs(${c.id})">保存推荐偏好</button></div>
  </div>`;
}

function campRisksHtml(c) {
  const r = jparse(c.risk_rules) || {};
  const rows = RISK_ITEMS.map(([k, label]) => {
    const v = r[k] || 'off';
    return `<div class="risk-row"><span class="risk-name">${label}</span>
      <select class="risk-sel" data-risk="${k}">
        <option value="off" ${v === 'off' ? 'selected' : ''}>忽略</option>
        <option value="caution" ${v === 'caution' ? 'selected' : ''}>谨慎(降权)</option>
        <option value="forbid" ${v === 'forbid' ? 'selected' : ''}>禁止(不推荐)</option>
      </select></div>`;
  }).join('');
  return `<div class="hint">系统生成热点判断、机会推荐与创作者匹配时读取这里：标记为「禁止」的维度一旦命中，相关内容不进入推荐；「谨慎」将降权。</div>
    <div class="risk-list">${rows}</div>
    <div class="form-foot"><button class="btn primary" onclick="campSaveRisks(${c.id})">保存风险规则</button></div>`;
}

function campSummaryHtml(c) {
  return `<div class="hint">系统根据上方配置自动生成的"本期推荐逻辑"。可确认、手动修改，或点击「重新解析」基于最新配置重算。</div>
    <div class="form-row full"><textarea id="rSum" style="min-height:140px">${esc(c.rule_summary || '')}</textarea></div>
    <div class="form-foot">
      <button class="btn primary" onclick="campSaveSummary(${c.id})">保存摘要</button>
      <button class="btn" onclick="campRegenSummary(${c.id})">✨ 重新解析</button>
    </div>`;
}

/* ---- 交互 ---- */
window.campSelect = function (id) { campSelId = id; campTab = 'base'; go('campaigns'); };
window.campTabSwitch = function (tab) { campTab = tab; go('campaigns'); };
window.campSetCurrent = async function (id) {
  await api(`/campaigns/${id}/set-current`, { method: 'POST', body: {} });
  toast('已设为当前任务'); go('campaigns');
};
window.campSaveBase = async function (id) {
  const body = {
    name: val('#bName').trim(), version_event: val('#bVer'),
    target_platform: readPlatMulti(), start_date: val('#bStart'), end_date: val('#bEnd'),
    agency: val('#bAgency'), priority: val('#bPri'), status: val('#bSt'),
    goal: val('#bGoal'), target_audience: val('#bAud'), criteria: val('#bCri'),
    keywords: val('#bKw'), content_directions: val('#bDir')
  };
  if (!body.name) return toast('请输入任务名称', true);
  await api(`/campaigns/${id}`, { method: 'PUT', body });
  toast('已保存'); go('campaigns');
};
window.campSaveGoals = async function (id) {
  const obj = { primary: [], secondary: [] };
  document.querySelectorAll('.goal-sel').forEach(e => { if (e.value === 'primary') obj.primary.push(e.dataset.goal); else if (e.value === 'secondary') obj.secondary.push(e.dataset.goal); });
  await api(`/campaigns/${id}`, { method: 'PUT', body: { goals: JSON.stringify(obj) } });
  toast('已保存'); go('campaigns');
};
window.campExtractFocus = async function (id) {
  const text = val('#fNL').trim();
  if (!text) return toast('请先填写自然语言描述', true);
  try {
    const r = await api(`/campaigns/${id}/extract-focus`, { method: 'POST', body: { text } });
    const d = r.detail || {};
    ['role', 'play', 'selling_point', 'linkage', 'node', 'cognition', 'gap'].forEach(k => {
      const el = document.querySelector('#f' + k[0].toUpperCase() + k.slice(1));
      if (el && d[k] != null) el.value = d[k];
    });
    toast(r.message || (r.mode === 'ai' ? 'AI提取完成' : '已用规则提取'), r.mode === 'rule');
  } catch (e) { toast(e.message, true); }
};
window.campSaveFocus = async function (id) {
  const detail = {
    role: val('#fRole'), play: val('#fPlay'), selling_point: val('#fSell'),
    linkage: val('#fLink'), node: val('#fNode'), cognition: val('#fCog'), gap: val('#fGap')
  };
  await api(`/campaigns/${id}`, { method: 'PUT', body: { focus_content: val('#fNL'), focus_detail: JSON.stringify(detail) } });
  toast('已保存'); go('campaigns');
};
window.campSavePrefs = async function (id) {
  const prefs = {
    platform: checkedVals('.prefPlat'),
    creator_type: val('#pCT').split(/[,，]/).map(s => s.trim()).filter(Boolean),
    content_form: val('#pCF').split(/[,，]/).map(s => s.trim()).filter(Boolean),
    play_method: val('#pPM').split(/[,，]/).map(s => s.trim()).filter(Boolean),
    cycle: val('#pCycle'),
    same_day: document.querySelector('#pSame') ? (document.querySelector('#pSame').checked ? 1 : 0) : 0,
    require_case: document.querySelector('#pCase') ? (document.querySelector('#pCase').checked ? 1 : 0) : 0
  };
  await api(`/campaigns/${id}`, { method: 'PUT', body: { prefs: JSON.stringify(prefs) } });
  toast('已保存'); go('campaigns');
};
window.campSaveRisks = async function (id) {
  const obj = {};
  document.querySelectorAll('.risk-sel').forEach(e => { obj[e.dataset.risk] = e.value; });
  await api(`/campaigns/${id}`, { method: 'PUT', body: { risk_rules: JSON.stringify(obj) } });
  toast('已保存'); go('campaigns');
};
window.campSaveSummary = async function (id) {
  await api(`/campaigns/${id}`, { method: 'PUT', body: { rule_summary: val('#rSum') } });
  toast('已保存'); go('campaigns');
};
window.campRegenSummary = async function (id) {
  try {
    const r = await api(`/campaigns/${id}/rule-summary`, { method: 'POST', body: {} });
    if (r.summary != null && document.querySelector('#rSum')) document.querySelector('#rSum').value = r.summary;
    toast(r.message || (r.mode === 'ai' ? '已重新解析' : '已用规则生成'), r.mode === 'rule');
  } catch (e) { toast(e.message, true); }
};

function platMulti(selected) {
  const sel = String(selected || '').split(',').map(s => s.trim()).filter(Boolean);
  const opts = ['B站', '抖音', '微博', '小红书', '快手', '视频号', '其他'];
  return `<div class="chk-group">${opts.map(p => `<label class="chk"><input type="checkbox" class="platMChk" value="${p}" ${sel.includes(p) ? 'checked' : ''}>${p}</label>`).join('')}</div>`;
}
function readPlatMulti() {
  return Array.from(document.querySelectorAll('.platMChk:checked')).map(e => e.value).join(',');
}

window.openCampaignForm = async function (id) {
  const isNew = !id;
  const c = isNew ? {} : await api(`/campaigns/${id}`);
  const stOpts = ['草稿', '执行中', '已结束', '已归档'];
  const priOpts = ['高', '中', '低'];
  const platOpts = ['B站', '抖音', '微博', '小红书', '快手', '视频号', '多平台'];
  const m = openModal(`
    <div class="modal-head"><h3>${isNew ? '新建' : '编辑'}营销任务</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body"><div class="form-grid">
      <div class="form-row full"><label>任务名称 *</label><input id="cName" value="${esc(c.name)}" placeholder="如：V3版本KOC种草"></div>
      <div class="form-row full"><label>当前版本 / 活动</label><input id="cVer" value="${esc(c.version_event)}" placeholder="如：v3.0 剑影新章 / 周年庆联动"></div>
      <div class="form-row full"><label>目标平台（可多选）</label>${platMulti(c.target_platform)}</div>
      <div class="form-row"><label>开始日期</label><input id="cStart" type="date" value="${esc(c.start_date)}"></div>
      <div class="form-row"><label>结束日期</label><input id="cEnd" type="date" value="${esc(c.end_date)}"></div>
      <div class="form-row"><label>优先级</label><select id="cPri">${priOpts.map(p => `<option ${c.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="form-row"><label>状态</label><select id="cSt">${stOpts.map(s => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="form-row full"><label>合作机构 / 代理</label><input id="cAgency" value="${esc(c.agency)}"></div>
      <div class="form-row full"><label>营销目标（一句话概述，详细目标可在保存后于「本期传播目标」配置）</label><textarea id="cGoal">${esc(c.goal)}</textarea></div>
    </div></div>
    <div class="modal-foot"><button class="btn primary" id="cOk">保存</button></div>`, true);
  m.querySelector('#cOk').onclick = async () => {
    const body = {
      name: m.querySelector('#cName').value.trim(),
      version_event: m.querySelector('#cVer').value.trim(),
      target_platform: readPlatMulti(),
      start_date: m.querySelector('#cStart').value,
      end_date: m.querySelector('#cEnd').value,
      priority: m.querySelector('#cPri').value,
      status: m.querySelector('#cSt').value,
      agency: m.querySelector('#cAgency').value.trim(),
      goal: m.querySelector('#cGoal').value
    };
    if (!body.name) return toast('请输入任务名称', true);
    try {
      if (!isNew) await api(`/campaigns/${id}`, { method: 'PUT', body });
      else { body.created_by = getUser(); await api('/campaigns', { method: 'POST', body }); }
      closeModals(); toast('已保存'); go('campaigns');
    } catch (e) { toast(e.message, true); }
  };
};

window.delRow = async function (table, id) {
  if (!confirm('确定删除？此操作不可撤销')) return;
  await api(`/${table}/${id}`, { method: 'DELETE' });
  toast('已删除'); go(currentPage);
};

/* ================= 页面：机会中心 ================= */
let oppTab = 'current';   // current | generate | history | templates
let oppFilters = { status: '全部', platform: '', risk: '', due: '', q: '' };
window.__cands = [];

function oppMatches(o) {
  if (oppTab === 'current' && !OPP_CURRENT.includes(o.status)) return false;
  if (oppTab === 'history' && !OPP_HISTORY.includes(o.status)) return false;
  const f = oppFilters;
  if (f.status !== '全部' && o.status !== f.status) return false;
  if (f.platform && (o.platform || '') !== f.platform) return false;
  if (f.risk && (o.risk_level || '中') !== f.risk) return false;
  if (f.due) {
    if (!o.deadline) return f.due === 'none';
    const now = new Date(), dl = new Date(o.deadline);
    const wk = new Date(now.getTime() + 7 * 864e5), mo = new Date(now.getTime() + 30 * 864e5);
    if (f.due === 'week' && !(dl <= wk)) return false;
    if (f.due === 'month' && !(dl <= mo)) return false;
    if (f.due === 'overdue' && !(dl < now)) return false;
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [o.title, o.hotspot_title, o.play_method, o.direction, o.decision].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
window.oppTabSwitch = function (t) { oppTab = t; go('opportunities'); };
window.oppSetFilter = function (k, v) { oppFilters[k] = v; go('opportunities'); };

function oppFilterBar(list) {
  const plats = [...new Set(list.map(o => o.platform).filter(Boolean))];
  const sts = oppTab === 'current' ? OPP_CURRENT : OPP_HISTORY;
  return `<div class="filter-bar wrap">
    <select onchange="oppSetFilter('status', this.value)"><option>全部</option>${sts.map(s => `<option ${oppFilters.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select onchange="oppSetFilter('platform', this.value)"><option value="">平台-全部</option>${plats.map(p => `<option ${oppFilters.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select onchange="oppSetFilter('risk', this.value)"><option value="">风险-全部</option>${['高', '中', '低'].map(r => `<option ${oppFilters.risk === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
    <select onchange="oppSetFilter('due', this.value)"><option value="">时效-全部</option>${[['week', '本周截止'], ['month', '本月截止'], ['overdue', '已逾期'], ['none', '无截止']].map(([v, l]) => `<option value="${v}" ${oppFilters.due === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input class="q" placeholder="搜索：热点/玩法/标题" value="${esc(oppFilters.q)}" onchange="oppSetFilter('q', this.value)">
    <button class="btn small" onclick="oppFilters={status:'全部',platform:'',risk:'',due:'',q:''};go('opportunities')">重置</button>
  </div>`;
}

function oppTable(list) {
  if (!list.length) return '<div class="empty">没有符合条件的机会</div>';
  return `<table><tr><th>机会</th><th>来源热点/节点</th><th>关联任务</th><th>平台</th><th>评分</th><th>状态</th><th>更新</th><th></th></tr>
  ${list.map(o => `<tr>
    <td style="max-width:240px"><span class="title-link" onclick="openOppDrawer(${o.id})">${esc(o.title)}</span></td>
    <td style="max-width:170px;font-size:12px;color:var(--ink2)">${esc(o.hotspot_title || '—')}${o.node ? `<br><span class="hint">节点：${esc(o.node)}</span>` : ''}</td>
    <td style="font-size:12px">${esc(o.campaign_name || '—')}</td>
    <td>${esc(o.platform || '—')}</td>
    <td>${o.ai_score != null ? `<b style="color:var(--purple)">AI ${o.ai_score}</b>` : ''} ${o.rule_score != null ? `<span style="color:var(--ink2);font-size:12px">规则 ${o.rule_score}</span>` : '—'}</td>
    <td>${statusTag(o.status)}</td>
    <td style="font-size:12px;color:var(--ink2)">${esc((o.updated_at || '').slice(5, 16))}</td>
    <td><button class="btn small danger" onclick="delRow('opportunities', ${o.id})">删除</button></td>
  </tr>`).join('')}</table>`;
}

pages.opportunities = async function () {
  const list = await api('/opportunities');
  const counts = { current: list.filter(o => OPP_CURRENT.includes(o.status)).length, history: list.filter(o => OPP_HISTORY.includes(o.status)).length };
  let body = '';
  if (oppTab === 'current' || oppTab === 'history') {
    const filtered = list.filter(oppMatches);
    body = `<div class="subnav">
      <div class="subnav-item ${oppTab === 'current' ? 'active' : ''}" onclick="oppTabSwitch('current')">当前机会<span class="cnt">${counts.current}</span></div>
      <div class="subnav-item ${oppTab === 'history' ? 'active' : ''}" onclick="oppTabSwitch('history')">历史机会<span class="cnt">${counts.history}</span></div>
    </div>${oppFilterBar(list)}<div class="card">${oppTable(filtered)}</div>`;
  } else if (oppTab === 'generate') {
    const hs = await api('/hotspots');
    const cands = hs.filter(h => h.status === '候选' && h.screen_result !== '不符合');
    body = `<div class="subnav">
      <div class="subnav-item ${oppTab === 'generate' ? 'active' : ''} onclick="oppTabSwitch('generate')">机会生成</div>
    </div>
    <div class="card">
      <div class="sec-title">从候选热点生成机会</div>
      <div class="hint">选择今日候选热点，系统会创建机会并自动生成完整方案（机会结论/推荐依据/风险判断/内容方向）。</div>
      ${cands.length ? `<div class="tmpl-list">${cands.map(h => `<div class="tmpl-card"><div class="t">${esc(h.title)}</div>
        <div class="meta"><span class="tag blue">${esc(h.platform)}</span><span class="tag ${h.trend === '上升' ? 'green' : h.trend === '下降' ? 'red' : 'orange'}">${esc(h.trend || '—')}</span><span class="tag gray">热度 ${h.heat || '—'}</span></div>
        <div class="acts"><button class="btn small primary" onclick="toOpportunity(${h.id})">生成机会</button></div></div>`).join('')}</div>`
        : '<div class="empty">当前没有可生成的候选热点</div>'}
      <div class="sec-title" style="margin-top:16px">根据当前营销任务主动生成机会</div>
      <div class="hint">系统综合「创意模板库 + 当前任务目标 + 历史案例 + 创作者能力」生成候选机会，供你确认采纳（仅候选，不自动落库）。</div>
      <button class="btn primary" id="btnGenCand" onclick="oppGenerateActive()">🤖 生成候选机会</button>
      <div id="candBox" style="margin-top:12px"></div>
    </div>`;
  } else if (oppTab === 'templates') {
    const tpls = await api('/creative_templates');
    body = `<div class="subnav"><div class="subnav-item ${oppTab === 'templates' ? 'active' : ''} onclick="oppTabSwitch('templates')">创意模板库</div></div>
    <div class="page-head"><div></div><div class="head-actions"><button class="btn primary" onclick="openTemplateForm()">＋ 新建模板</button></div></div>
    <div class="card">
      ${tpls.length ? `<div class="tmpl-list">${tpls.map(t => `<div class="tmpl-card">
        <div class="t">${esc(t.name)} <span class="tag gray">使用 ${t.usage_count || 0} 次</span></div>
        <div class="meta"><span class="tag blue">${esc(t.applicable_hotspot || '—')}</span><span class="tag orange">${esc(t.applicable_node || '—')}</span><span class="tag purple">${esc(t.creator_type || '—')}</span></div>
        <div class="line"><b>核心逻辑：</b>${esc(t.core_logic || '—')}</div>
        <div class="line"><b>历史案例：</b>${esc(t.cases || '—')}</div>
        <div class="line"><b>验证结果：</b>${esc(t.validation || '—')}</div>
        <div class="line"><b>风险与限制：</b>${esc(t.risks || '—')}</div>
        <div class="acts"><button class="btn small" onclick="openTemplateForm(${t.id})">编辑</button><button class="btn small danger" onclick="oppDeleteTemplate(${t.id})">删除</button></div>
      </div>`).join('')}</div>` : '<div class="empty">还没有创意模板。可在机会详情中点「沉淀为创意模板」。</div>'}
    </div>`;
  }
  main.innerHTML = `
  <div class="page-head">
    <div><h2>机会中心</h2><div class="sub">热点判断 → 内容方向 → 创作者匹配 → 执行验证 → 模板沉淀</div></div>
    <div class="head-actions"><button class="btn primary" onclick="openOppForm()">＋ 手动创建机会</button></div>
  </div>${body}`;
};

window.oppGenerateActive = async function () {
  const btn = document.querySelector('#btnGenCand');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const r = await api('/opportunities/generate-candidates', { method: 'POST', body: {} });
    window.__cands = r.candidates || [];
    const box = document.querySelector('#candBox');
    if (!box) return;
    const lvlOf = c => (c.risk_json && c.risk_json.opinion && c.risk_json.opinion.level) || '中';
    box.innerHTML = window.__cands.length ? window.__cands.map((c, i) => `
      <div class="tmpl-card">
        <div class="t">${esc(c.title)}</div>
        <div class="meta"><span class="tag blue">${esc(c.platform)}</span><span class="tag orange">${esc(c.node)}</span><span class="tag ${lvlOf(c) === '高' ? 'red' : lvlOf(c) === '低' ? 'green' : 'orange'}">风险${esc(lvlOf(c))}</span></div>
        <div class="line"><b>玩法：</b>${esc(c.play_method)}</div>
        <div class="line"><b>方向：</b>${esc(c.direction)}</div>
        <div class="line"><b>依据：</b>${esc((c.basis && c.basis.version_fit) || '')}｜${esc((c.basis && c.basis.cases) || '')}</div>
        <div class="acts"><button class="btn small primary" data-cand="${i}">采纳为机会</button></div>
      </div>`).join('') : '<div class="hint">暂无可生成的候选机会（需要有创意模板或当前任务）</div>';
    box.querySelectorAll('[data-cand]').forEach(b => b.onclick = () => adoptCandidate(window.__cands[+b.dataset.cand]));
  } catch (e) { toast(e.message, true); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🤖 生成候选机会'; } }
};

window.adoptCandidate = async function (c) {
  try {
    const camps = await api('/campaigns');
    const cur = camps.find(x => x.is_current) || camps.find(x => x.status === '执行中');
    const r = await api('/opportunities', { method: 'POST', body: {
      title: c.title, campaign_id: cur ? cur.id : null, status: '待判断', created_by: getUser(),
      platform: c.platform, node: c.node, play_method: c.play_method, game_combo: c.game_combo,
      direction: c.direction, basis: JSON.stringify(c.basis || {}), risk_json: JSON.stringify(c.risk_json || {}),
      direction_json: JSON.stringify(c.direction_json || {}), plan_generated: 1, suggested_time: c.suggested_time || null,
      risk_level: (c.risk_json && c.risk_json.opinion && c.risk_json.opinion.level) || '中',
      risk_note: (c.risk_json && c.risk_json.opinion && c.risk_json.opinion.note) || null
    } });
    toast('已采纳为机会（当前任务）'); oppTab = 'current'; go('opportunities');
  } catch (e) { toast(e.message, true); }
};

window.openTemplateForm = async function (id) {
  const t = id ? await api(`/creative_templates/${id}`) : {};
  const m = openModal(`
    <div class="modal-head"><h3>${id ? '编辑' : '新建'}创意模板</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body"><div class="form-grid">
      <div class="form-row full"><label>模板名称 *</label><input id="ctName" value="${esc(t.name)}"></div>
      <div class="form-row full"><label>核心逻辑</label><textarea id="ctCore">${esc(t.core_logic)}</textarea></div>
      <div class="form-row"><label>适用热点</label><input id="ctHot" value="${esc(t.applicable_hotspot)}"></div>
      <div class="form-row"><label>适用营销节点</label><input id="ctNode" value="${esc(t.applicable_node)}"></div>
      <div class="form-row"><label>适合创作者类型</label><input id="ctType" value="${esc(t.creator_type)}"></div>
      <div class="form-row full"><label>历史案例</label><input id="ctCases" value="${esc(t.cases)}"></div>
      <div class="form-row full"><label>验证结果</label><input id="ctVal" value="${esc(t.validation)}"></div>
      <div class="form-row full"><label>风险与限制</label><input id="ctRisk" value="${esc(t.risks)}"></div>
    </div></div>
    <div class="modal-foot"><button class="btn primary" id="ctOk">保存</button></div>`, true);
  m.querySelector('#ctOk').onclick = async () => {
    const name = m.querySelector('#ctName').value.trim();
    if (!name) return toast('请输入模板名称', true);
    const body = {
      name, core_logic: m.querySelector('#ctCore').value, applicable_hotspot: m.querySelector('#ctHot').value,
      applicable_node: m.querySelector('#ctNode').value,       creator_type: m.querySelector('#ctType').value,
      cases: m.querySelector('#ctCases').value, validation: m.querySelector('#ctVal').value, risks: m.querySelector('#ctRisk').value
    };
    if (id) await api(`/creative_templates/${id}`, { method: 'PUT', body });
    else await api('/creative_templates', { method: 'POST', body: { ...body, created_by: getUser() } });
    closeModals(); toast('已保存'); oppTab = 'templates'; go('opportunities');
  };
};

window.oppDeleteTemplate = async function (id) {
  if (!confirm('确认删除该创意模板？')) return;
  try { await api(`/creative_templates/${id}`, { method: 'DELETE' }); toast('已删除'); go('opportunities'); }
  catch (e) { toast(e.message, true); }
};

window.openOppForm = async function () {
  const camps = (await api('/campaigns')).filter(c => c.status === '执行中');
  const m = openModal(`
    <div class="modal-head"><h3>手动创建机会</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="form-row"><label>机会标题 *</label><input id="oTitle"></div>
      <div class="form-row"><label>关联营销任务</label><select id="oCid"><option value="">不关联</option>${camps.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="oOk">创建</button></div>`);
  m.querySelector('#oOk').onclick = async () => {
    const title = m.querySelector('#oTitle').value.trim();
    if (!title) return toast('请输入标题', true);
    const r = await api('/opportunities', { method: 'POST', body: { title, campaign_id: m.querySelector('#oCid').value || null, status: '待判断', created_by: getUser() } });
    closeModals();
    await genDirection(r.id, { silent: true }).catch(() => {});
    openOppDrawer(r.id);
  };
};

/* ---- 机会详情抽屉 ---- */

/* 自动/手动生成完整方案（机会结论补充 + 推荐依据 + 风险判断 + 内容方向建议，AI + 规则降级） */
window.genDirection = async function (id, opts = {}) {
  const silent = !!opts.silent;
  if (!silent) toast('正在生成完整方案…');
  try {
    const r = await api(`/opportunities/${id}/generate-plan`, { method: 'POST', body: { user: getUser() } });
    if (!silent) toast(r.message || (r.mode === 'ai' ? '已生成完整方案' : '已用规则生成完整方案'), r.mode === 'rule');
    return r;
  } catch (e) { if (!silent) toast(e.message, true); }
};

window.openOppDrawer = async function (id) {
  closeModals();
  const [o, logs, execs, creators] = await Promise.all([
    api(`/opportunities/${id}`), api(`/opportunities/${id}/logs`),
    api(`/opportunities/${id}/executions`), api('/creators')
  ]);
  if (!o) return toast('机会不存在', true);
  const matchedIds = (o.matched_creator_ids || '').split(',').filter(Boolean).map(Number);
  const matched = creators.filter(c => matchedIds.includes(c.id));
  const jp = s => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };
  const basis = jp(o.basis), riskJ = jp(o.risk_json), dirJ = jp(o.direction_json);
  const RISK_DIMS = [['opinion', '舆情风险'], ['copyright', '版权风险'], ['character', '角色设定风险'], ['difficulty', '执行难度'], ['expiry', '热点过期风险'], ['irreproducible', '不可复制风险']];
  const TERMINAL = ['不采用', '已过期'];
  const flowIdx = OPP_FLOW.indexOf(o.status);

  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="drawer-mask" onclick="this.parentElement.remove()"></div>
  <div class="drawer">
    <div class="drawer-head">
      <div>
        <div style="font-size:16px;font-weight:700">${esc(o.title)}</div>
        <div style="margin-top:6px">${statusTag(o.status)} ${o.assignee ? `<span class="tag gray">跟进:${esc(o.assignee)}</span>` : ''} ${o.deadline ? `<span class="tag orange">截止 ${esc(o.deadline)}</span>` : ''}</div>
      </div>
      <span style="display:flex;gap:8px;align-items:center">
        <button class="btn small" onclick="depositCase(${o.id})">💾 沉淀为案例</button>
        <span class="x" onclick="this.closest('.drawer').parentElement.remove()">✕</span>
      </span>
    </div>
    <div class="drawer-body">
      ${!TERMINAL.includes(o.status) ? `<div class="flow">${OPP_FLOW.map((s, i) => `<span class="step ${i < flowIdx ? 'done' : i === flowIdx ? 'cur' : ''}"><span class="dot">${i < flowIdx ? '✓' : i + 1}</span>${s}</span>${i < OPP_FLOW.length - 1 ? '<span class="arrow">→</span>' : ''}`).join('')}</div>` : '<div class="hint" style="color:var(--red)">该机会已结束（' + o.status + '），仅作历史查看</div>'}

      <div class="sec-title">① 机会判断
        <span><button class="btn small primary" id="btnEval">🤖 AI 评估</button></span>
      </div>
      <div id="evalArea">
        ${o.ai_analysis ? `<div class="ai-block"><div class="hd">AI 评估 · ${o.ai_score}分</div>${esc(o.ai_analysis)}</div>` : ''}
        ${o.rule_score != null ? `<div class="rule-block"><b>规则评分 ${o.rule_score} 分</b></div>` : ''}
        ${!o.ai_analysis && o.rule_score == null ? '<div class="hint">尚未评估，点击「AI 评估」获取判断建议（未配置Key时自动用规则打分）</div>' : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        ${o.status === '待判断' ? `<button class="btn small" style="color:var(--green);border-color:var(--green)" id="btnWorth">✓ 值得做（已采纳）</button>
        <button class="btn small danger" id="btnDrop">✕ 不采用</button>` : ''}
      </div>

      <div class="sec-title">② 机会结论
        <span class="hint">系统生成后可逐项调整</span>
      </div>
      <div class="grid2">
        <div class="fld"><label>机会名称</label><input id="ocTitle" value="${esc(o.title)}"></div>
        <div class="fld"><label>对应热点/节点</label><input id="ocNode" value="${esc(o.node || (o.hotspot_title || ''))}" placeholder="热点或营销节点"></div>
        <div class="fld"><label>推荐玩法</label><input id="ocPlay" value="${esc(o.play_method || '')}"></div>
        <div class="fld"><label>游戏结合方式</label><input id="ocCombo" value="${esc(o.game_combo || '')}"></div>
        <div class="fld"><label>适合平台</label><input id="ocPlat" value="${esc(o.platform || '')}"></div>
        <div class="fld"><label>建议时效</label><input id="ocTime" value="${esc(o.suggested_time || '')}"></div>
      </div>

      <div class="sec-title">③ 推荐依据</div>
      <div class="grid2">
        <div class="fld"><label>与版本契合点</label><input id="baFit" value="${esc(basis.version_fit || '')}"></div>
        <div class="fld"><label>热点发展情况</label><input id="baDev" value="${esc(basis.hotspot_dev || '')}"></div>
        <div class="fld"><label>其他游戏成功案例</label><input id="baCases" value="${esc(basis.cases || '')}"></div>
        <div class="fld"><label>历史项目表现</label><input id="baHist" value="${esc(basis.history_perf || '')}"></div>
        <div class="fld"><label>适配现有创作者</label><input id="baCr" value="${esc(basis.creators || '')}"></div>
        <div class="fld"><label>制作可行性</label><input id="baFea" value="${esc(basis.feasibility || '')}"></div>
      </div>

      <div class="sec-title">④ 风险判断</div>
      <div class="risk-grid">
        ${RISK_DIMS.map(([k, label]) => { const it = riskJ[k] || {}; const lv = it.level || '中'; return `
          <div class="risk-row">
            <div class="rk-name">${label}</div>
            <select class="rk-lvl" id="rkLvl_${k}">${['低', '中', '高'].map(l => `<option ${lv === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input class="rk-note" id="rkNote_${k}" value="${esc(it.note || '')}" placeholder="说明">
          </div>`;
        }).join('')}
      </div>

      <div class="sec-title">⑤ 内容方向建议
        <span><button class="btn small" id="btnGenPlan">🤖 生成/重生成方案</button></span>
      </div>
      <div class="hint">可直接用于对接代理或创作者：</div>
      <div class="grid2">
        <div class="fld full"><label>核心内容设定</label><textarea id="djCore">${esc(dirJ.core || '')}</textarea></div>
        <div class="fld"><label>建议切入角度</label><input id="djAngle" value="${esc(dirJ.angle || '')}"></div>
        <div class="fld"><label>参考结构</label><input id="djStruct" value="${esc(dirJ.structure || '')}"></div>
        <div class="fld"><label>必须体现的信息</label><input id="djMust" value="${esc(dirJ.must_show || '')}"></div>
        <div class="fld"><label>禁止出现的内容</label><input id="djForbid" value="${esc(dirJ.forbid || '')}"></div>
        <div class="fld"><label>可参考案例</label><input id="djRef" value="${esc(dirJ.ref_cases || '')}"></div>
        <div class="fld full"><label>方向摘要（一句话交代理工/创作者）</label><textarea id="ocDirSum">${esc(o.direction || '')}</textarea></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn small primary" id="btnSavePlan">保存方案信息</button>
        <button class="btn small" id="btnDeposit">📦 沉淀为创意模板</button>
      </div>

      <div class="sec-title">⑥ 创作者匹配
        <span><button class="btn small" id="btnMatch">🔍 智能推荐</button></span>
      </div>
      <div id="matchArea">
        ${matched.length ? matched.map(c => `<span class="tag purple" style="margin-right:6px">${esc(c.name)}（${esc(c.categories)}｜ROI7:${c.avg_roi7 ?? '—'}）</span>`).join('') : '<div class="hint">尚未匹配创作者</div>'}
      </div>

      <div class="sec-title">⑦ 执行记录
        <span><button class="btn small" id="btnAddExec">＋ 添加执行记录</button></span>
      </div>
      ${execs.length ? `<table><tr><th>创作者</th><th>阶段</th><th>计划发布</th><th>实际发布</th><th>播放</th><th>激活D1</th><th>ROI7</th><th></th></tr>
        ${execs.map(e => `<tr>
          <td>${esc(e.creator_name || '—')}</td><td>${statusTag(e.stage)}</td>
          <td>${esc(e.planned_date || '—')}</td><td>${esc(e.publish_date || '—')}</td>
          <td>${fmt(e.play_count)}</td><td>${pct(e.activation_d1)}</td>
          <td>${e.roi_d7 != null ? `<b style="color:${e.roi_d7 >= 0.8 ? 'var(--green)' : 'var(--red)'}">${e.roi_d7}</b>` : '—'}</td>
          <td><button class="btn small" data-exec="${e.id}">更新</button></td></tr>`).join('')}</table>` : '<div class="hint">暂无执行记录</div>'}

      <div class="sec-title">⑧ 状态与截止</div>
      <div class="form-grid">
        <div class="form-row"><label>状态</label><select id="oStatus">${[...OPP_CURRENT, ...OPP_HISTORY].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-row"><label>截止日期</label><input id="oDl" type="date" value="${esc(o.deadline)}"></div>
        <div class="form-row" style="display:flex;align-items:flex-end"><button class="btn primary" id="btnSaveState" style="width:100%">保存</button></div>
      </div>

      <div class="sec-title">💎 相关经营经验 <span class="hint">来自经验库（只读参考，不影响评分）</span></div>
      <div class="kn-rel" id="oppRelExp"><div class="hint">加载中…</div></div>

      <div class="sec-title">操作日志 <span><button class="btn small" id="btnAddNote">＋ 备注</button></span></div>
      <div>${logs.map(l => `<div class="log-item"><b>${esc(l.user || '系统')}</b> · ${esc(l.action)} · ${esc(l.note)} <span style="float:right">${esc((l.created_at || '').slice(5, 16))}</span></div>`).join('') || '<div class="hint">无日志</div>'}</div>
    </div>
  </div>`;
  $('#modals').appendChild(wrap);
  const reload = () => { wrap.remove(); openOppDrawer(id); };

  wrap.querySelector('#btnEval').onclick = async ev => {
    ev.target.disabled = true; ev.target.innerHTML = 'AI 分析中<span class="loading-dot"></span>';
    try {
      const r = await api(`/opportunities/${id}/evaluate`, { method: 'POST', body: { user: getUser() } });
      if (r.message) toast(r.message, r.mode === 'rule'); else toast('AI 评估完成');
      reload();
    } catch (e) { toast(e.message, true); ev.target.disabled = false; ev.target.textContent = '🤖 AI 评估'; }
  };
  const setStatus = async (status, decision) => {
    await api(`/opportunities/${id}`, { method: 'PUT', body: { status, decision, decision_by: getUser() } });
    await api(`/opportunities/${id}/logs`, { method: 'POST', body: { action: '状态变更', note: `${status}${decision ? '：' + decision : ''}`, user: getUser() } });
    toast('已更新'); reload();
  };
  const bw = wrap.querySelector('#btnWorth');
  if (bw) bw.onclick = () => { const reason = prompt('判断结论（为什么值得做）：') || ''; setStatus('已采纳', reason); };
  const bd = wrap.querySelector('#btnDrop');
  if (bd) bd.onclick = () => { const reason = prompt('不采用原因：') || ''; setStatus('不采用', reason); };
  wrap.querySelector('#btnGenPlan').onclick = async () => { await genDirection(id, { silent: true }); toast('已重新生成方案'); reload(); };
  wrap.querySelector('#btnSavePlan').onclick = async () => {
    const g = sel => wrap.querySelector(sel).value;
    const rj = {};
    RISK_DIMS.forEach(([k]) => { rj[k] = { level: g('#rkLvl_' + k), note: g('#rkNote_' + k) }; });
    const body = {
      title: g('#ocTitle'), node: g('#ocNode'), play_method: g('#ocPlay'), game_combo: g('#ocCombo'),
      platform: g('#ocPlat'), suggested_time: g('#ocTime'),
      direction: g('#ocDirSum'),
      basis: JSON.stringify({ version_fit: g('#baFit'), hotspot_dev: g('#baDev'), cases: g('#baCases'), history_perf: g('#baHist'), creators: g('#baCr'), feasibility: g('#baFea') }),
      risk_json: JSON.stringify(rj),
      direction_json: JSON.stringify({ core: g('#djCore'), angle: g('#djAngle'), structure: g('#djStruct'), must_show: g('#djMust'), forbid: g('#djForbid'), ref_cases: g('#djRef') })
    };
    await api(`/opportunities/${id}`, { method: 'PUT', body });
    toast('方案已保存'); reload();
  };
  wrap.querySelector('#btnDeposit').onclick = async () => {
    const name = prompt('创意模板名称：', o.title + ' 创意模板');
    if (!name) return;
    try { const r = await api(`/opportunities/${id}/deposit-template`, { method: 'POST', body: { name, user: getUser() } }); toast('已沉淀为创意模板'); }
    catch (e) { toast(e.message, true); }
  };
  wrap.querySelector('#btnMatch').onclick = async () => {
    const recs = await api(`/opportunities/${id}/match`);
    const area = wrap.querySelector('#matchArea');
    if (!recs.length) { area.innerHTML = '<div class="hint">没有匹配的可合作创作者，请先完善创作者库</div>'; return; }
    area.innerHTML = recs.map(r => `
      <div class="reco" style="margin-top:8px">
        <div class="score-ring" style="background:${scoreColor(r.score)};width:44px;height:44px;font-size:14px">${r.score}</div>
        <div class="body"><div class="t">${esc(r.creator.name)} <span class="tag gray">${esc(r.creator.platform)}</span></div>
          <div class="why">粉丝 ${fmt(r.creator.fans)}｜均播 ${fmt(r.creator.avg_play)}｜${esc(r.reason)}</div></div>
        <div class="acts"><button class="btn small primary" data-pick="${r.creator.id}" data-name="${esc(r.creator.name)}">选TA</button></div>
      </div>`).join('');
    area.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
      const ids = new Set(matchedIds); ids.add(+b.dataset.pick);
      const body = { matched_creator_ids: [...ids].join(',') };
      if (['待判断', '已采纳'].includes(o.status)) body.status = '待匹配创作者';
      await api(`/opportunities/${id}`, { method: 'PUT', body });
      await api(`/opportunities/${id}/logs`, { method: 'POST', body: { action: '匹配', note: `选定创作者「${b.dataset.name}」`, user: getUser() } });
      toast('已匹配 ' + b.dataset.name); reload();
    });
  };
  wrap.querySelector('#btnAddExec').onclick = () => openExecForm(id, null, matched.length ? matched : creators, reload);
  wrap.querySelectorAll('[data-exec]').forEach(b => b.onclick = () => {
    const e = execs.find(x => x.id === +b.dataset.exec);
    openExecForm(id, e, creators, reload);
  });
  wrap.querySelector('#btnSaveState').onclick = async () => {
    await api(`/opportunities/${id}`, { method: 'PUT', body: {
      status: wrap.querySelector('#oStatus').value, deadline: wrap.querySelector('#oDl').value
    } });
    toast('已保存'); reload();
  };
  wrap.querySelector('#btnAddNote').onclick = async () => {
    const note = prompt('备注内容：');
    if (!note) return;
    await api(`/opportunities/${id}/logs`, { method: 'POST', body: { action: '备注', note, user: getUser() } });
    reload();
  };
  // 模块8反哺：拉取与本机会方向/平台相关的有效经验（只读参考）
  (async () => {
    const box = wrap.querySelector('#oppRelExp');
    if (!box) return;
    try {
      const dir = o.play_method || o.direction || o.title || '';
      const exps = await api(`/experiences/effective?direction=${encodeURIComponent(dir)}&platform=${encodeURIComponent(o.platform || '')}`);
      box.innerHTML = (exps && exps.length) ? exps.slice(0, 5).map(e => `
        <div class="ins-card">
          <div class="ins-top">
            <span class="tag ${e.boost === -1 ? 'red' : 'green'}">${e.boost === -1 ? '避坑' : '正向'}</span>
            <span class="tag gray">${esc(e.category || '其他')}</span>
            ${e.target_direction ? `<span class="tag blue">${esc(e.target_direction)}</span>` : ''}
            ${e.platform ? `<span class="tag purple">${esc(e.platform)}</span>` : ''}
            <span class="tag ${({ '高': 'green', '中': 'blue', '低': 'orange' })[e.confidence] || 'gray'}">可信度 ${esc(e.confidence)}</span>
          </div>
          <div class="ins-body">${esc(e.content)}</div>
          ${e.data_basis ? `<div class="ins-basis"><b>数据依据：</b>${esc(e.data_basis)}</div>` : ''}
        </div>`).join('') : '<div class="hint">经验库中暂无与该机会方向/平台匹配的经验</div>';
    } catch (e) {
      box.innerHTML = '<div class="hint">经验加载失败</div>';
    }
  })();
};

function openExecForm(oppId, e, creators, onDone) {
  const m = openModal(`
    <div class="modal-head"><h3>${e ? '更新' : '添加'}执行记录</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body"><div class="form-grid">
      <div class="form-row"><label>创作者</label><select id="exCr">${creators.map(c => `<option value="${c.id}|${esc(c.name)}" ${e && e.creator_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="form-row"><label>阶段</label><select id="exStage">${['沟通中','脚本确认','制作中','待发布','已发布','数据回收'].map(s => `<option ${e && e.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="form-row full"><label>发布链接</label><input id="exUrl" value="${esc(e?.publish_url)}"></div>
      <div class="form-row"><label>计划发布时间</label><input id="exPlan" type="date" value="${esc(e?.planned_date)}"></div>
      <div class="form-row"><label>实际发布时间</label><input id="exDate" type="date" value="${esc(e?.publish_date)}"></div>
      <div class="form-row full"><label>实际采用玩法</label><input id="exPlayM" value="${esc(e?.exec_play_method)}" placeholder="实际最终采用的玩法"></div>
      <div class="form-row full"><label>内容调整情况</label><input id="exAdj" value="${esc(e?.adjustment)}" placeholder="相比方案做了哪些调整"></div>
      <div class="form-row full"><label>未执行 / 延期原因</label><input id="exFail" value="${esc(e?.fail_reason)}" placeholder="若未执行或延期，填写原因"></div>
      <div class="form-row"><label>播放量</label><input id="exPlay" type="number" value="${e?.play_count ?? ''}"></div>
      <div class="form-row"><label>点赞</label><input id="exLike" type="number" value="${e?.like_count ?? ''}"></div>
      <div class="form-row"><label>首日激活率 %</label><input id="exAct" type="number" step="0.1" value="${e?.activation_d1 ?? ''}"></div>
      <div class="form-row"><label>7日付费ROI</label><input id="exRoi" type="number" step="0.01" value="${e?.roi_d7 ?? ''}"></div>
      <div class="form-row full"><label>备注</label><input id="exNote" value="${esc(e?.note)}"></div>
      <div class="form-row"><label>内容修改次数</label><input id="exRev" type="number" value="${e?.revision_count ?? 0}"></div>
      <div class="form-row"><label>是否按时交付</label><select id="exOnTime">${[['1','是'],['0','否']].map(([v,l]) => `<option value="${v}" ${String(e?.on_time ?? 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="form-row"><label>配合度</label><select id="exCoop">${['高','中','低'].map(s => `<option ${e && e.coop_rating === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="form-row"><label>内容准确性</label><select id="exAcc">${['高','中','低'].map(s => `<option ${e && e.accuracy === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="form-row full"><label>代理反馈</label><input id="exAgency" value="${esc(e?.agency_feedback)}" placeholder="代理/内部对该次合作的反馈"></div>
    </div></div>
    <div class="modal-foot"><button class="btn primary" id="exOk">保存</button></div>`, true);
  m.querySelector('#exOk').onclick = async () => {
    const [cid, cname] = m.querySelector('#exCr').value.split('|');
    const body = {
      opportunity_id: oppId, creator_id: +cid, creator_name: cname,
      stage: m.querySelector('#exStage').value, publish_url: m.querySelector('#exUrl').value,
      publish_date: m.querySelector('#exDate').value, planned_date: m.querySelector('#exPlan').value,
      exec_play_method: m.querySelector('#exPlayM').value, adjustment: m.querySelector('#exAdj').value, fail_reason: m.querySelector('#exFail').value,
      play_count: +m.querySelector('#exPlay').value || 0, like_count: +m.querySelector('#exLike').value || 0,
      activation_d1: m.querySelector('#exAct').value ? +m.querySelector('#exAct').value : null,
      roi_d7: m.querySelector('#exRoi').value ? +m.querySelector('#exRoi').value : null,
      note: m.querySelector('#exNote').value,
      revision_count: +m.querySelector('#exRev').value || 0,
      on_time: +m.querySelector('#exOnTime').value,
      coop_rating: m.querySelector('#exCoop').value,
      accuracy: m.querySelector('#exAcc').value,
      agency_feedback: m.querySelector('#exAgency').value
    };
    if (e) await api(`/executions/${e.id}`, { method: 'PUT', body });
    else await api('/executions', { method: 'POST', body });
    closeModals(); toast('已保存'); onDone && onDone();
  };
}

/* ================= 页面：案例库 ================= */
let caseTab = 'all';   // all | system | add | project | favorite
let caseFilters = { source: '全部', platform: '', content_type: '', publish_date: '', creator_type: '', result: '全部', is_favorite: '', is_verified: '', is_reusable: '', q: '' };
window.__cases = [];
let caseSelected = new Set();
window.caseSelectToggle = function (id, ev) { if (ev) ev.stopPropagation(); if (caseSelected.has(id)) caseSelected.delete(id); else caseSelected.add(id); go('cases'); };
window.caseSelectAll = function () { window.__cases.filter(caseMatches).forEach(c => caseSelected.add(c.id)); go('cases'); };
window.caseClearSelection = function () { caseSelected.clear(); go('cases'); };
window.caseDeleteSelected = async function () {
  const ids = [...caseSelected]; if (!ids.length) return;
  if (!confirm(`确定删除选中的 ${ids.length} 条案例？删除后不可恢复。`)) return;
  try { await Promise.all(ids.map(id => api(`/cases/${id}`, { method: 'DELETE' }))); caseSelected.clear(); toast(`已删除 ${ids.length} 条案例`); go('cases'); }
  catch (e) { toast(e.message, true); }
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
function sourceLabel(s) { return s === '系统发现' ? '系统发现' : s === '人工新增' ? '人工新增' : s === '项目执行结果' ? '项目执行' : '其他'; }
function sourceTag(s) { const m = { '系统发现': 'purple', '人工新增': 'blue', '项目执行结果': 'teal' }; return `<span class="tag ${m[s] || 'gray'}">${sourceLabel(s)}</span>`; }

function caseMatches(c) {
  if (caseTab === 'all' && c.confirm_status === '待确认') return false; // 待确认不进全部案例
  if (caseTab === 'system' && c.source !== '系统发现') return false;
  if (caseTab === 'project' && c.source !== '项目执行结果') return false;
  if (caseTab === 'favorite' && !c.is_favorite) return false;
  const f = caseFilters;
  if (f.source !== '全部' && c.source !== f.source) return false;
  if (f.platform && (c.platform || '') !== f.platform) return false;
  if (f.content_type && (c.content_type || '') !== f.content_type) return false;
  if (f.publish_date && (c.publish_date || '').slice(0, 10) !== f.publish_date) return false;
  if (f.creator_type && (c.creator_type || '') !== f.creator_type) return false;
  if (f.result !== '全部' && (c.result || '一般') !== f.result) return false;
  if (f.is_favorite && (c.is_favorite ? '是' : '否') !== f.is_favorite) return false;
  if (f.is_verified && (c.is_verified ? '是' : '否') !== f.is_verified) return false;
  if (f.is_reusable && (c.is_reusable ? '是' : '否') !== f.is_reusable) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [c.title, c.topic_tags, c.creator_name, c.hotspot, c.play_method, c.summary].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
window.caseTabSwitch = function (t) { caseTab = t; caseSelected.clear(); go('cases'); };
window.caseSetFilter = function (k, v) { caseFilters[k] = v; go('cases'); };

function caseFilterBar(list) {
  const uniq = key => [...new Set(list.map(c => c[key]).filter(Boolean))];
  return `<div class="filter-bar wrap">
    <select onchange="caseSetFilter('source', this.value)"><option>全部</option>${['系统发现', '人工新增', '项目执行结果'].map(s => `<option ${caseFilters.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select onchange="caseSetFilter('platform', this.value)"><option value="">平台-全部</option>${uniq('platform').map(p => `<option ${caseFilters.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select onchange="caseSetFilter('content_type', this.value)"><option value="">内容类型-全部</option>${uniq('content_type').map(p => `<option ${caseFilters.content_type === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <span style="font-size:12px;color:var(--ink2)">节点</span><input type="date" title="按发布日期筛选" onchange="caseSetFilter('publish_date', this.value)">
    <select onchange="caseSetFilter('creator_type', this.value)"><option value="">创作者类型-全部</option>${uniq('creator_type').map(p => `<option ${caseFilters.creator_type === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select onchange="caseSetFilter('result', this.value)"><option>全部</option>${['爆款', '良好', '一般', '失败'].map(s => `<option ${caseFilters.result === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select onchange="caseSetFilter('is_favorite', this.value)"><option value="">收藏-全部</option>${[['是', '已收藏'], ['否', '未收藏']].map(([v, l]) => `<option value="${v}" ${caseFilters.is_favorite === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select onchange="caseSetFilter('is_verified', this.value)"><option value="">验证-全部</option>${[['是', '已验证'], ['否', '未验证']].map(([v, l]) => `<option value="${v}" ${caseFilters.is_verified === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select onchange="caseSetFilter('is_reusable', this.value)"><option value="">可复用-全部</option>${[['是', '可复用'], ['否', '不可复用']].map(([v, l]) => `<option value="${v}" ${caseFilters.is_reusable === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input class="q" placeholder="搜索标题/标签/创作者" value="${esc(caseFilters.q)}" onchange="caseSetFilter('q', this.value)">
    <button class="btn small" onclick="caseFilters={source:'全部',platform:'',content_type:'',publish_date:'',creator_type:'',result:'全部',is_favorite:'',is_verified:'',is_reusable:'',q:''};go('cases')">重置</button>
  </div>`;
}

function caseCard(c) {
  const isPending = c.confirm_status === '待确认';
  const checked = caseSelected.has(c.id) ? 'checked' : '';
  return `<div class="case-card ${isPending ? 'pending' : ''} ${checked ? 'selected' : ''}">
    <div class="cc-top"><input type="checkbox" class="cc-chk" ${checked} onclick="caseSelectToggle(${c.id}, event)"><span class="src-tag src-${c.source === '系统发现' ? 'sys' : c.source === '人工新增' ? 'manual' : 'proj'}">${sourceLabel(c.source)}</span>${c.is_favorite ? '<span class="star on">★</span>' : ''}${isPending ? '<span class="tag orange">待确认</span>' : ''}</div>
    <div class="cc-title" onclick="openCaseDrawer(${c.id})">${esc(c.title)}</div>
    <div class="cc-meta">
      <span class="tag blue">${esc(c.platform || '—')}</span>
      <span class="tag ${c.result === '爆款' ? 'red' : c.result === '良好' ? 'green' : c.result === '失败' ? 'red' : 'gray'}">${esc(c.result || '—')}</span>
    </div>
    <div class="cc-tags">${[c.content_type, c.marketing_node].filter(Boolean).map(t => `<span class="ch">${esc(t)}</span>`).join('')}</div>
    <div class="cc-data">播放 ${fmt(c.play_count)} ｜ 激活 ${pct(c.activation_d1)} ｜ ROI7 ${c.roi_d7 != null ? c.roi_d7 : '—'}</div>
    <div class="cc-acts">
      <button class="btn small" onclick="caseToggleFav(${c.id}, event)">${c.is_favorite ? '★ 已收藏' : '☆ 收藏'}</button>
      ${isPending ? `<button class="btn small primary" onclick="caseConfirm(${c.id}, 'confirm', event)">确认收录</button><button class="btn small danger" onclick="caseConfirm(${c.id}, 'reject', event)">退回</button>` : ''}
      ${c.source === '项目执行结果' ? `<span class="tag ${c.benchmark_met ? 'green' : 'gray'}">${c.benchmark_met ? '达基准' : '未达基准'}</span>` : ''}
    </div>
  </div>`;
}

pages.cases = async function () {
  const list = await api('/cases');
  window.__cases = list;
  const counts = {
    all: list.filter(c => c.confirm_status !== '待确认').length,
    system: list.filter(c => c.source === '系统发现').length,
    project: list.filter(c => c.source === '项目执行结果').length,
    favorite: list.filter(c => c.is_favorite).length
  };
  let body = '';
  if (caseTab === 'add') {
    body = `<div class="subnav"><div class="subnav-item active" onclick="caseTabSwitch('add')">人工新增</div></div>
      <div class="card">
        <div class="sec-title">人工新增案例（AI 辅助提取）</div>
        <div class="hint">粘贴链接 / 截图文字 / 案例描述 / 群聊或代理反馈，由 AI 辅助提取字段后确认保存，无需手动填写全部字段（演示环境无外网时自动用规则提取）。</div>
        <button class="btn primary" onclick="openCaseAdd()">＋ 开始新增</button>
      </div>`;
  } else {
    const filtered = list.filter(caseMatches);
    const bulk = caseSelected.size ? `<div class="bulk-bar">
      <span>已选 <b>${caseSelected.size}</b> 条</span>
      <button class="btn small" onclick="caseSelectAll()">全选本页</button>
      <button class="btn small danger" onclick="caseDeleteSelected()">删除选中</button>
      <button class="btn small" onclick="caseClearSelection()">取消选择</button>
    </div>` : '';
    body = `<div class="subnav">
      <div class="subnav-item ${caseTab === 'all' ? 'active' : ''}" onclick="caseTabSwitch('all')">全部案例<span class="cnt">${counts.all}</span></div>
      <div class="subnav-item ${caseTab === 'system' ? 'active' : ''}" onclick="caseTabSwitch('system')">系统发现<span class="cnt">${counts.system}</span></div>
      <div class="subnav-item ${caseTab === 'project' ? 'active' : ''}" onclick="caseTabSwitch('project')">项目执行<span class="cnt">${counts.project}</span></div>
      <div class="subnav-item ${caseTab === 'favorite' ? 'active' : ''}" onclick="caseTabSwitch('favorite')">收藏<span class="cnt">${counts.favorite}</span></div>
    </div>
    ${bulk}
    ${caseFilterBar(list)}
    <div class="card">${filtered.length ? `<div class="case-grid">${filtered.map(caseCard).join('')}</div>` : '<div class="empty">没有符合条件的案例</div>'}</div>`;
  }
  main.innerHTML = `
  <div class="page-head">
    <div><h2>案例库</h2><div class="sub">内容参考与历史执行资产中心 · 外部行业/竞品 + 本项目执行结果，为机会生成、创作者匹配、周期复盘提供依据</div></div>
    <div class="head-actions">
      <button class="btn" onclick="openImport('cases','案例')">📥 导入</button>
      <button class="btn primary" onclick="caseTabSwitch('add')">＋ 人工新增</button>
    </div>
  </div>${body}`;
};

/* ---- 案例：收藏 / 验证 / 确认 ---- */
window.caseToggleFav = async function (id, ev) {
  if (ev) ev.stopPropagation();
  try { const r = await api(`/cases/${id}/favorite`, { method: 'POST' }); toast(r.is_favorite ? '已收藏' : '已取消收藏'); go('cases'); }
  catch (e) { toast(e.message, true); }
};
window.caseToggleVerify = async function (id, ev) {
  if (ev) ev.stopPropagation();
  try {
    const c = await api(`/cases/${id}`);
    await api(`/cases/${id}`, { method: 'PUT', body: { is_verified: c.is_verified ? 0 : 1 } });
    toast('已更新验证状态'); go('cases');
  } catch (e) { toast(e.message, true); }
};
window.caseConfirm = async function (id, action, ev) {
  if (ev) ev.stopPropagation();
  try {
    const r = await api(`/cases/${id}/confirm`, { method: 'POST', body: { action } });
    toast(action === 'reject' ? '已退回' : '已确认收录'); go('cases');
  } catch (e) { toast(e.message, true); }
};

/* ---- 案例：人工新增（AI 辅助提取） ---- */
window.openCaseAdd = async function () {
  const m = openModal(`
    <div class="modal-head"><h3>人工新增案例</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="hint">粘贴链接 / 截图文字 / 案例描述 / 群聊反馈，系统辅助提取字段（AI优先，无Key时规则兜底）。截图或文件请将其文字内容粘贴到下方。</div>
      <div class="form-row full"><label>内容链接（可选）</label><input id="adLink" placeholder="https://..."></div>
      <div class="form-row full"><label>案例描述 / 截图文字 / 群聊反馈</label><textarea id="adText" placeholder="如：B站某UP主发了一条《杖剑传说》新职业强度测评，播放42万，首日激活4.1%，ROI1.32..."></textarea></div>
      <button class="btn small" id="adExtract">🤖 AI 辅助提取</button>
      <div id="adFields" style="margin-top:12px"></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="adSave">确认保存</button></div>`, true);
  const renderFields = (f = {}) => {
    m.querySelector('#adFields').innerHTML = `
      <div class="form-grid">
        <div class="form-row full"><label>标题 *</label><input id="afTitle" value="${esc(f.title || '')}"></div>
        <div class="form-row"><label>平台</label><select id="afPlat">${['B站', '抖音', '微博', '小红书', '快手', '视频号', '其他'].map(p => `<option ${f.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="form-row"><label>内容类型</label><input id="afType" value="${esc(f.content_type || '')}" placeholder="攻略/整活/测评"></div>
        <div class="form-row"><label>创作者类型</label><input id="afCtype" value="${esc(f.creator_type || '')}"></div>
        <div class="form-row"><label>发布日期</label><input id="afDate" type="date" value="${esc(f.publish_date || '')}"></div>
        <div class="form-row"><label>播放量</label><input id="afPlay2" type="number" value="${f.play_count ?? ''}"></div>
        <div class="form-row"><label>点赞</label><input id="afLike" type="number" value="${f.like_count ?? ''}"></div>
        <div class="form-row"><label>评论</label><input id="afComment" type="number" value="${f.comment_count ?? ''}"></div>
        <div class="form-row"><label>首日激活率 %</label><input id="afAct" type="number" step="0.1" value="${f.activation_d1 ?? ''}"></div>
        <div class="form-row"><label>7日ROI</label><input id="afRoi" type="number" step="0.01" value="${f.roi_d7 ?? ''}"></div>
        <div class="form-row full"><label>链接</label><input id="afUrl" value="${esc(f.url || '')}"></div>
        <div class="form-row full"><label>选题标签（逗号分隔）</label><input id="afTags" value="${esc(f.topic_tags || '')}"></div>
        <div class="form-row full"><label>可借鉴点</label><input id="afBorrow" value="${esc(f.borrowable || '')}"></div>
        <div class="form-row full"><label>风险信息</label><input id="afRisk" value="${esc(f.risk_info || '')}"></div>
        <div class="form-row full"><label>成败要点总结</label><textarea id="afSum">${esc(f.summary || '')}</textarea></div>
      </div>`;
  };
  renderFields();
  m.querySelector('#adExtract').onclick = async () => {
    const text = m.querySelector('#adText').value.trim();
    const link = m.querySelector('#adLink').value.trim();
    if (!text && !link) return toast('请先填写链接或描述', true);
    const btn = m.querySelector('#adExtract'); btn.disabled = true; btn.textContent = '提取中…';
    try {
      const r = await api('/cases/extract', { method: 'POST', body: { text, link } });
      renderFields(r.fields || {});
      toast(r.message || (r.mode === 'ai' ? 'AI 提取完成' : '规则提取完成'), r.mode === 'rule');
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.textContent = '🤖 AI 辅助提取'; }
  };
  m.querySelector('#adSave').onclick = async () => {
    const g = id => m.querySelector('#' + id);
    const title = g('afTitle').value.trim();
    if (!title) return toast('请填写标题（可点提取自动生成）', true);
    const analysis = { structure: '', why: '', borrowable: g('afBorrow').value.trim(), irreproducible: '', risk_tip: g('afRisk').value.trim(), scenario: '' };
    const body = {
      title, platform: g('afPlat').value, content_type: g('afType').value.trim(),
      creator_type: g('afCtype').value.trim(),
      publish_date: g('afDate').value, url: g('afUrl').value.trim(), topic_tags: g('afTags').value.trim(),
      play_count: g('afPlay2').value ? +g('afPlay2').value : 0, like_count: g('afLike').value ? +g('afLike').value : 0,
      comment_count: g('afComment').value ? +g('afComment').value : 0, activation_d1: g('afAct').value ? +g('afAct').value : null,
      roi_d7: g('afRoi').value ? +g('afRoi').value : null,
      summary: g('afSum').value.trim(), source: '人工新增', confirm_status: '已收录', created_by: getUser(),
      analysis_json: JSON.stringify(analysis)
    };
    try { await api('/cases', { method: 'POST', body }); closeModals(); toast('已保存'); go('cases'); }
    catch (e) { toast(e.message, true); }
  };
};

/* ---- 案例：详情抽屉（6段结构化） ---- */
window.openCaseDrawer = async function (id) {
  const c = await api(`/cases/${id}`);
  if (!c) return toast('案例不存在', true);
  const a = c.analysis_json ? safeParse(c.analysis_json) : {};
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="drawer-mask" onclick="this.parentElement.remove()"></div>
  <div class="drawer wide">
    <div class="drawer-head"><div>
      <div style="font-size:16px;font-weight:700">${esc(c.title)}</div>
      <div style="margin-top:6px">${sourceTag(c.source)} ${statusTag(c.result || '一般')} ${c.is_verified ? '<span class="tag green">已验证</span>' : ''} ${c.is_favorite ? '<span class="tag orange">★已收藏</span>' : ''} ${c.confirm_status ? `<span class="tag gray">${esc(c.confirm_status)}</span>` : ''}</div>
    </div><span class="x" onclick="this.closest('.drawer').parentElement.remove()">✕</span></div>
    <div class="drawer-body">
      <div class="sec-title">① 基础信息</div>
      <div class="grid2">
        <div class="fld"><label>平台</label><input id="csPlat" value="${esc(c.platform || '')}"></div>
        <div class="fld"><label>内容类型</label><input id="csType" value="${esc(c.content_type || '')}"></div>
        <div class="fld"><label>营销节点</label><input id="csNode" value="${esc(c.marketing_node || '')}"></div>
        <div class="fld"><label>创作者类型</label><input id="csCtype" value="${esc(c.creator_type || '')}"></div>
        <div class="fld"><label>发布日期</label><input id="csDate" value="${esc(c.publish_date || '')}"></div>
        <div class="fld"><label>营销任务</label><input id="csCamp" value="${esc(c.campaign_name || '')}"></div>
        <div class="fld"><label>结果（系统自动判定）</label>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="tag ${c.result==='爆款'?'red':c.result==='良好'?'green':c.result==='失败'?'red':'gray'}">${esc(c.result || '一般')}</span>
            <button class="btn small" type="button" onclick="caseRejudge(${c.id})">↻ 按数据重判</button>
          </div>
          <div class="hint" style="margin-top:4px">由播放量 / 粉丝数 / 互动数据自动判定，保存时自动刷新</div>
        </div>
      </div>
      <div class="fld full"><label>链接</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="csUrl" value="${esc(c.url || '')}" style="flex:1">
          <button class="btn small" type="button" onclick="if(document.getElementById('csUrl').value) window.open(document.getElementById('csUrl').value,'_blank')">↗ 打开链接</button>
        </div>
      </div>

      <div class="sec-title">② 数据表现</div>
      <div class="grid2">
        <div class="fld"><label>播放量</label><input id="csPlay2" type="number" value="${c.play_count ?? ''}"></div>
        <div class="fld"><label>点赞</label><input id="csLike" type="number" value="${c.like_count ?? ''}"></div>
        <div class="fld"><label>评论</label><input id="csComment" type="number" value="${c.comment_count ?? ''}"></div>
        <div class="fld"><label>首日激活率 %</label><input id="csAct" type="number" step="0.1" value="${c.activation_d1 ?? ''}"></div>
        <div class="fld"><label>7日ROI</label><input id="csRoi" type="number" step="0.01" value="${c.roi_d7 ?? ''}"></div>
        <div class="fld"><label>粉丝数</label><input id="csFans" type="number" value="${c.fans ?? ''}"></div>
        <div class="fld"><label>收藏数</label><input id="csFav" type="number" value="${c.favorite_count ?? ''}"></div>
        <div class="fld"><label>分享数</label><input id="csShare" type="number" value="${c.share_count ?? ''}"></div>
      </div>

      <div class="sec-title">③ 原始内容</div>
      <div class="fld full"><label>视频文案</label><input id="csCopy" value="${esc(c.copy || '')}"></div>
      <textarea id="csRaw" class="ta-lg" placeholder="粘贴原始文案/链接/截图描述">${esc(c.raw_content || '')}</textarea>

      <div class="sec-title">④ 内容结构分析</div>
      <textarea id="csStruct" class="ta">${esc(a.structure || '')}</textarea>
      <div class="sec-title">⑤ 成功或不足原因</div>
      <textarea id="csWhy" class="ta">${esc(a.why || '')}</textarea>
      <div class="sec-title">⑥ 可借鉴部分</div>
      <textarea id="csBorrow" class="ta">${esc(a.borrowable || '')}</textarea>
      <div class="sec-title">⑦ 不可复制部分</div>
      <textarea id="csIrrep" class="ta">${esc(a.irreproducible || '')}</textarea>
      <div class="sec-title">⑧ 风险提示</div>
      <textarea id="csRisk" class="ta">${esc(a.risk_tip || '')}</textarea>
      <div class="sec-title">⑨ 适用场景</div>
      <textarea id="csScen" class="ta">${esc(a.scenario || '')}</textarea>

      <div class="sec-title">⑩ 关联与备注</div>
      <div class="line">关联机会：${c.linked_opportunity_id ? `<span class="title-link" onclick="openOppDrawer(${c.linked_opportunity_id})">#${c.linked_opportunity_id}</span>` : '—'}</div>
      <div class="line">关联创作者：${c.creator_name ? esc(c.creator_name) : '—'}${c.creator_id ? `（ID ${c.creator_id}）` : ''}</div>
      <div class="line">达人平台ID：${c.creator_platform_id ? esc(c.creator_platform_id) : '—'}</div>
      <div class="line">达到项目基准：${c.benchmark_met ? '是' : '否'}${c.review_conclusion ? `｜复盘结论：${esc(c.review_conclusion)}` : ''}</div>
      <div class="fld full"><label>人工备注</label><textarea id="csNote" class="ta">${esc(c.note || '')}</textarea></div>

      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
        <button class="btn primary" id="csSave">保存修改</button>
        <button class="btn small" onclick="caseToggleVerify(${c.id}, event)">${c.is_verified ? '取消验证' : '标记为已验证'}</button>
        <button class="btn small" onclick="caseToggleFav(${c.id}, event)">${c.is_favorite ? '★ 取消收藏' : '☆ 收藏'}</button>
        ${c.analysis_edited ? '<span class="hint">（AI分析已人工修改，不会被自动分析覆盖）</span>' : ''}
      </div>
    </div>
  </div>`;
  document.querySelector('#modals').appendChild(wrap);
  wrap.querySelector('#csSave').onclick = async () => {
    const g = id => wrap.querySelector('#' + id);
    const analysis = {
      structure: g('csStruct').value, why: g('csWhy').value, borrowable: g('csBorrow').value,
      irreproducible: g('csIrrep').value, risk_tip: g('csRisk').value, scenario: g('csScen').value
    };
    const body = {
      platform: g('csPlat').value, content_type: g('csType').value,
      marketing_node: g('csNode').value,
      creator_type: g('csCtype').value, publish_date: g('csDate').value, campaign_name: g('csCamp').value,
      url: g('csUrl').value,
      play_count: g('csPlay2').value ? +g('csPlay2').value : 0, like_count: g('csLike').value ? +g('csLike').value : 0,
      comment_count: g('csComment').value ? +g('csComment').value : 0, activation_d1: g('csAct').value ? +g('csAct').value : null,
      roi_d7: g('csRoi').value ? +g('csRoi').value : null,
      fans: g('csFans').value ? +g('csFans').value : 0,
      favorite_count: g('csFav').value ? +g('csFav').value : 0,
      share_count: g('csShare').value ? +g('csShare').value : 0,
      copy: g('csCopy').value,
      raw_content: g('csRaw').value, analysis_json: JSON.stringify(analysis), analysis_edited: 1, note: g('csNote').value
    };
    try { await api(`/cases/${c.id}`, { method: 'PUT', body }); toast('已保存'); wrap.remove(); openCaseDrawer(c.id); }
    catch (e) { toast(e.message, true); }
  };
};

/* ---- 案例：按当前表单数据重新自动判定结果（系统判定，不手动选） ---- */
window.caseRejudge = async function (id) {
  const get = el => document.getElementById(el);
  const num = el => { const v = get(el) && get(el).value; return v ? +v : 0; };
  if (!get('csPlay2')) return toast('请先打开案例详情', true);
  const body = {
    play_count: num('csPlay2'), fans: num('csFans'), like_count: num('csLike'),
    comment_count: num('csComment'), favorite_count: num('csFav'), share_count: num('csShare')
  };
  try { await api(`/cases/${id}`, { method: 'PUT', body }); toast('已按当前数据重新判定'); openCaseDrawer(id); }
  catch (e) { toast(e.message, true); }
};

/* ---- 机会：手动沉淀为项目案例（机会详情抽屉按钮） ---- */
window.depositCase = async function (oppId) {
  if (!confirm('将该机会的执行内容沉淀为项目案例？')) return;
  try {
    const r = await api(`/opportunities/${oppId}/deposit-case`, { method: 'POST', body: { user: getUser() } });
    toast('已沉淀为项目案例'); openCaseDrawer(r.id);
  } catch (e) { toast(e.message, true); }
};

/* ================= 页面：创作者库 ================= */
let creatorTab = 'all';
let creatorFilters = { q: '', platform: '', good_play: '', status: '', trend: '', is_new: '' };
let creatorList = [];
let creatorSelected = new Set();
window.creatorSelectToggle = function (id, ev) { if (ev) ev.stopPropagation(); if (creatorSelected.has(id)) creatorSelected.delete(id); else creatorSelected.add(id); go('creators'); };
window.creatorSelectAll = function () { creatorList.filter(creatorMatches).forEach(c => creatorSelected.add(c.id)); go('creators'); };
window.creatorClearSelection = function () { creatorSelected.clear(); go('creators'); };
window.creatorDeleteSelected = async function () {
  const ids = [...creatorSelected]; if (!ids.length) return;
  if (!confirm(`确定删除选中的 ${ids.length} 位创作者？关联的执行记录将保留但不再归属该创作者。`)) return;
  try { await Promise.all(ids.map(id => api(`/creators/${id}`, { method: 'DELETE' }))); creatorSelected.clear(); toast(`已删除 ${ids.length} 位创作者`); go('creators'); }
  catch (e) { toast(e.message, true); }
};
window.creatorTabSwitch = function (t) { creatorTab = t; creatorSelected.clear(); go('creators'); };
window.creatorSetFilter = function (k, v) { creatorFilters[k] = v; go('creators'); };

function uniqV(a) { return [...new Set(a.map(String).filter(Boolean))]; }
function trendCls(t) { return t === '上升' ? 'green' : t === '下降' ? 'red' : 'gray'; }
function verdictCls(v) { return v === '适合继续合作' ? 'green' : (v === '建议继续观察' || v === '适合测试新方向') ? 'orange' : v === '需要调整内容要求' ? 'orange' : 'red'; }

function creatorMatches(c) {
  const f = creatorFilters;
  if (f.q && !c.name.includes(f.q)) return false;
  if (f.platform && !(c.platforms || []).includes(f.platform)) return false;
  if (f.status && c.status !== f.status) return false;
  if (f.is_new && String(c.is_new) !== f.is_new) return false;
  if (f.trend && (c.recentTrend || '') !== f.trend) return false;
  if (f.good_play) { const gp = uniqV((c.good_play || '').split(/[,，]/)); if (!gp.includes(f.good_play)) return false; }
  return true;
}

// 账号标签：平台 + 角色徽标（创作=蓝 / 分发=橙）
function accountTagsHtml(c) {
  const accs = c.accounts || [];
  if (!accs.length) return '<span class="hint">未配置平台账号</span>';
  return accs.map(a => `<span class="tag ${a.role === '分发' ? 'orange' : 'blue'}">${esc(a.platform)}${a.role === '分发' ? '·分发' : ''}</span>`).join(' ');
}

function creatorCard(c) {
  const tags = uniqV(((c.categories || '') + ',' + (c.content_type || '')).split(/[,，]/));
  const checked = creatorSelected.has(c.id) ? 'checked' : '';
  return `<div class="case-card ${checked ? 'selected' : ''}" onclick="openCreatorDrawer(${c.id})" style="cursor:pointer">
    <div class="cc-top">
      <input type="checkbox" class="cc-chk" ${checked} onclick="creatorSelectToggle(${c.id}, event)">
      <div class="cc-name">${esc(c.name)} ${c.is_new ? '<span class="tag purple">新增</span>' : ''}</div>
      <div class="cc-meta">${accountTagsHtml(c)}${c.agency ? ` · ${esc(c.agency)}` : ''}</div>
    </div>
    <div class="cc-line">合作状态：${statusTag(c.status)} ｜ 当前周期发布：<b>${c.currentCyclePublish}</b></div>
    <div class="cc-line">近期表现：<span class="trend ${trendCls(c.recentTrend)}">${esc(c.recentTrend)}</span> ｜ 创作意愿：<span class="tag gray">${esc(c.willingness || '中')}</span></div>
    <div class="cc-line">推荐方向：<span class="hint">${esc(c.recommendedDir || c.verdict || '—')}</span></div>
  </div>`;
}

pages.creators = async function () {
  main.innerHTML = '<div class="empty">加载中…</div>';
  creatorList = await api('/creators/insight-all');
  const all = creatorList;
  const view = all.filter(creatorMatches).filter(c => creatorTab === 'all' ? true : creatorTab === 'new' ? !!c.is_new : true);
  const types = uniqV(all.flatMap(c => ((c.categories || '') + ',' + (c.content_type || '')).split(/[,，]/)));
  const plays = uniqV(all.flatMap(c => (c.good_play || '').split(/[,，]/)));
  const platforms = uniqV(all.flatMap(c => c.platforms || []));
  const f = creatorFilters;
  const subnav = `<div class="subnav">
    <div class="subnav-item ${creatorTab === 'all' ? 'active' : ''}" onclick="creatorTabSwitch('all')">全部创作者<span class="cnt">${all.length}</span></div>
    <div class="subnav-item ${creatorTab === 'new' ? 'active' : ''}" onclick="creatorTabSwitch('new')">新增创作者<span class="cnt">${all.filter(c => c.is_new).length}</span></div>
  </div>`;
  const filterBar = `<div class="filter-bar">
    <input class="q" placeholder="搜索创作者" value="${esc(f.q || '')}" oninput="creatorSetFilter('q', this.value)">
    <select onchange="creatorSetFilter('platform', this.value)"><option value="">平台-全部</option>${platforms.map(p => `<option ${f.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select onchange="creatorSetFilter('good_play', this.value)"><option value="">擅长玩法-全部</option>${plays.map(p => `<option ${f.good_play === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select onchange="creatorSetFilter('status', this.value)"><option value="">合作状态-全部</option>${['可合作', '合作中', '暂停', '黑名单'].map(p => `<option ${f.status === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select onchange="creatorSetFilter('trend', this.value)"><option value="">表现趋势-全部</option>${['上升', '平稳', '下降', '样本不足'].map(p => `<option ${f.trend === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select onchange="creatorSetFilter('is_new', this.value)"><option value="">新增-全部</option>${[['1', '是'], ['0', '否']].map(([v, l]) => `<option ${f.is_new === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn small" onclick="creatorFilters={q:'',platform:'',good_play:'',status:'',trend:'',is_new:''};go('creators')">重置</button>
  </div>`;
  const grid = view.length ? `<div class="case-grid">${view.map(creatorCard).join('')}</div>` : '<div class="empty">没有符合条件的创作者</div>';
  const bulk = creatorSelected.size ? `<div class="bulk-bar">
    <span>已选 <b>${creatorSelected.size}</b> 位</span>
    <button class="btn small" onclick="creatorSelectAll()">全选本页</button>
    <button class="btn small danger" onclick="creatorDeleteSelected()">删除选中</button>
    <button class="btn small" onclick="creatorClearSelection()">取消选择</button>
  </div>` : '';
  main.innerHTML = `
    <div class="page-head">
      <div><h2>创作者库</h2><div class="sub">内部合作 KOC 的内容能力与合作表现管理中心</div></div>
      <div class="head-actions">
        <button class="btn" onclick="openImport('creators','创作者')">📥 导入</button>
        <button class="btn" onclick="syncCreatorFans()">↻ 同步粉丝量</button>
        <button class="btn primary" onclick="openCreatorForm()">＋ 录入创作者</button>
      </div>
    </div>
    ${subnav}${bulk}${filterBar}${grid}
  `;
};

function perfTable(title, arr, key) {
  if (!arr || !arr.length) return '';
  const label = title === '按平台' ? '平台' : title === '按玩法' ? '玩法' : '项目';
  return `<div class="mini-wrap"><div class="mini-title">${esc(title)}</div><table class="mini"><tr><th>${label}</th><th>数</th><th>均播</th><th>均ROI</th></tr>${arr.map(r => `<tr><td>${esc(r[key])}</td><td>${r.count}</td><td>${fmt(r.avgPlay)}</td><td>${r.avgRoi != null ? r.avgRoi : '—'}</td></tr>`).join('')}</table></div>`;
}
function execTable(rows) {
  if (!rows || !rows.length) return '<div class="hint">暂无合作执行记录</div>';
  return `<div class="exec-list">${rows.map(e => {
    const roiCls = e.roi_d7 != null ? (e.roi_d7 >= 1 ? 'green' : e.roi_d7 >= 0.5 ? 'orange' : 'red') : 'gray';
    const actCls = e.activation_d1 != null ? (e.activation_d1 >= 3 ? 'green' : e.activation_d1 >= 1 ? 'orange' : 'red') : 'gray';
    const titleClick = e.opportunity_id ? `onclick="openOppDrawer(${e.opportunity_id})"` : '';
    return `<div class="exec-card">
      <div class="exec-head">
        <div class="exec-title" ${titleClick}>${esc(e.opp_title || ('机会#' + (e.opportunity_id || '?')))}</div>
        <div class="exec-badges">${statusTag(e.stage)}<span class="exec-date">${esc((e.publish_date || '').slice(0, 10))}</span></div>
      </div>
      <div class="exec-metrics">
        <div class="exec-chip"><span>玩法</span><b>${esc(e.exec_play_method || '—')}</b></div>
        <div class="exec-chip"><span>播放</span><b>${fmt(e.play_count)}</b></div>
        <div class="exec-chip"><span>激活</span><b class="${actCls}">${e.activation_d1 != null ? e.activation_d1 + '%' : '—'}</b></div>
        <div class="exec-chip"><span>ROI</span><b class="${roiCls}">${e.roi_d7 != null ? e.roi_d7 : '—'}</b></div>
        <div class="exec-chip"><span>按时</span><b>${e.on_time ? '是' : '否'}</b></div>
        <div class="exec-chip"><span>修改</span><b>${e.revision_count || 0}</b></div>
        <div class="exec-chip"><span>配合</span><b>${esc(e.coop_rating || '—')}</b></div>
        <div class="exec-chip"><span>准确</span><b>${esc(e.accuracy || '—')}</b></div>
        ${e.publish_url ? `<div class="exec-chip"><span>视频</span><a class="title-link" href="${esc(e.publish_url)}" target="_blank" onclick="event.stopPropagation()">查看 ↗</a></div>` : ''}
      </div>
      ${e.fail_reason ? `<div class="exec-foot"><span class="exec-label">未执行原因</span>${esc(e.fail_reason)}</div>` : ''}
      ${e.agency_feedback ? `<div class="exec-foot"><span class="exec-label">代理反馈</span>${esc(e.agency_feedback)}</div>` : ''}
      ${e.note ? `<div class="exec-foot"><span class="exec-label">备注</span>${esc(e.note)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

window.openCreatorDrawer = async function (id) {
  let d;
  try { d = await api('/creators/' + id + '/insight'); } catch (e) { return toast(e.message, true); }
  const c = d.creator, p = d.performance, tr = d.trend, sg = d.suggestion;
  let pub = { fromCases: [], fromManual: [] };
  try { pub = await api('/creators/' + id + '/published'); } catch (e) { pub = { fromCases: [], fromManual: [] }; }
  const vids = [...pub.fromCases, ...pub.fromManual];
  const vidHtml = vids.length ? vids.map(v => `
    <div class="vid-item">
      <div class="vid-main">
        ${v.url ? `<a class="title-link" href="${esc(v.url)}" target="_blank" onclick="event.stopPropagation()">${esc(v.title || v.url)}</a>` : `<span class="title-text">${esc(v.title || '未命名视频')}</span>`}
        <div class="vid-meta">
          ${v.platform ? `<span class="tag gray">${esc(v.platform)}</span>` : ''}
          ${v.result ? `<span class="tag ${v.resultTag || 'gray'}">${esc(v.result)}</span>` : ''}
          ${v.publish_date ? `<span class="hint">${esc(String(v.publish_date).slice(0, 10))}</span>` : ''}
          ${v.play_count != null ? `<span class="hint">播放 ${fmt(v.play_count)}</span>` : ''}
          <span class="tag ${v.source === '案例库' ? 'blue' : 'orange'}">${esc(v.source)}</span>
          ${v.created_by ? `<span class="hint">导入：${esc(v.created_by)}</span>` : ''}
        </div>
      </div>
      ${v.deletable ? `<button class="btn small danger" onclick="delRow('creator_videos',${v.id});openCreatorDrawer(${id})">删除</button>` : ''}
    </div>`).join('') : '<div class="hint">暂无已发布视频记录</div>';
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="drawer-mask" onclick="this.parentElement.remove()"></div>
  <div class="drawer wide">
    <div class="drawer-head"><div class="creator-header">
      <div class="creator-avatar">${esc((c.name || '?')[0])}</div>
      <div class="creator-info">
        <div class="creator-name">${esc(c.name)} ${c.is_new ? '<span class="tag purple">新增</span>' : ''}</div>
        <div class="creator-meta">${statusTag(c.status)} ${accountTagsHtml(c)} ${c.agency ? `<span class="tag gray">${esc(c.agency)}</span>` : ''}</div>
      </div>
    </div><span class="x" onclick="this.closest('.drawer').parentElement.remove()">✕</span></div>
    <div class="drawer-body">
      <div class="sec-title">基础信息</div>
      <div class="grid2">
        <div class="fld"><label>所属机构/MCN</label><div>${esc(c.agency || '—')}</div></div>
      </div>

      <div class="sec-title">平台账号 <span class="hint">主平台创作，副平台仅分发；不同平台可用不同账号名</span></div>
      <div class="acc-list">
        ${(d.accounts && d.accounts.length) ? d.accounts.map(a => `
          <div class="acc-item">
            <div class="acc-head">
              <span class="tag ${a.role === '分发' ? 'orange' : 'blue'}">${esc(a.platform)}</span>
              <b>${esc(a.account_name || a.platform)}</b>
              ${a.is_primary ? '<span class="tag purple">主账号</span>' : ''}
              <span class="tag ${a.role === '分发' ? 'orange' : 'blue'}">${a.role === '分发' ? '仅分发' : '创作'}</span>
            </div>
            <div class="acc-meta">粉丝 ${fmt(a.fans)}${a.avg_play ? ` ｜ 均播 ${fmt(a.avg_play)}` : ''}${a.avg_roi7 != null ? ` ｜ ROI7 ${a.avg_roi7}` : ''}</div>
            ${a.home_url ? `<a class="title-link" href="${esc(a.home_url)}" target="_blank">${esc(a.home_url)}</a>` : ''}
          </div>`).join('') : '<div class="hint">尚未配置平台账号</div>'}
      </div>

      <div class="sec-title">创作能力画像</div>
      <div class="grid2">
        <div class="fld"><label>擅长玩法</label><div>${esc(c.good_play || '—')}</div></div>
        <div class="fld"><label>内容风格</label><div>${esc(c.style || '—')}</div></div>
        <div class="fld"><label>可接受制作形式</label><div>${esc(c.forms || '—')}</div></div>
        <div class="fld"><label>创作意愿</label><div>${esc(c.willingness || '中')}</div></div>
        <div class="fld"><label>内容稳定性</label><div>${esc(c.stability || '中')}</div></div>
      </div>

      <div class="sec-title">历史发布与表现 <span class="hint">仅本项目合作内容（执行记录 + 项目执行案例），不同平台单独分析</span></div>
      <div class="perf-chips">
        <div class="pc"><b>${p.publishCount}</b><span>发布内容</span></div>
        <div class="pc"><b>${fmt(p.avgPlay)}</b><span>平均播放</span></div>
        <div class="pc"><b>${fmt(p.medianPlay)}</b><span>中位播放</span></div>
        <div class="pc"><b>${p.avgActivation != null ? p.avgActivation + '%' : '—'}</b><span>平均激活</span></div>
        <div class="pc"><b>${p.avgRoi7 != null ? p.avgRoi7 : '—'}</b><span>平均ROI7</span></div>
        <div class="pc"><b>${fmt(p.naturalAvg)}</b><span>自然均播</span></div>
        <div class="pc"><b>${fmt(p.paidAvg)}</b><span>投流/制作均播</span></div>
      </div>
      ${p.highPerf && p.highPerf.length ? `<div class="line"><b>高表现：</b>${p.highPerf.map(h => `<span class="tag green">${esc(h.title || '')} · ${fmt(h.play)}播放 · ROI${h.roi != null ? h.roi : '—'}</span>`).join(' ')}</div>` : ''}
      ${p.lowPerf && p.lowPerf.length ? `<div class="line"><b>低表现：</b>${p.lowPerf.map(h => `<span class="tag red">${esc(h.title || '')} · ${fmt(h.play)}播放 · ROI${h.roi != null ? h.roi : '—'}</span>`).join(' ')}</div>` : ''}
      <div class="perf-tables">${perfTable('按平台', p.byPlatform, 'platform')}${perfTable('按玩法', p.byPlay, 'type')}${perfTable('按项目', p.byCampaign, 'campaign')}</div>

      <div class="sec-title">创作趋势 <span class="hint">${esc(tr.summary)}</span></div>
      ${tr.signals && tr.signals.length ? `<div class="trend-list">${tr.signals.map(s => `<div class="trend-item ${s.level}"><div class="ti-head"><b>${esc(s.label)}</b><span class="tag ${s.level === 'warn' ? 'red' : s.level === 'good' ? 'green' : 'blue'}">已识别</span></div><div class="ti-ev">${esc(s.evidence)}</div></div>`).join('')}</div>` : '<div class="hint">暂无足够数据识别趋势变化</div>'}

      <div class="sec-title">合作执行记录（${d.execRecords.length}）</div>
      <div class="exec-scroll">${execTable(d.execRecords)}</div>

      <div class="sec-title">已发布视频 <span class="hint">案例库 ${pub.fromCases.length} 条 · 人工导入 ${pub.fromManual.length} 条</span> <button class="btn small" onclick="openVideoImport(${c.id})" style="margin-left:6px">＋ 导入视频链接</button></div>
      <div class="vid-list">${vidHtml}</div>

      <div class="sec-title">系统合作建议 <span class="hint">实时计算·附依据·系统不自动决定去留</span></div>
      <div class="suggest-box ${verdictCls(sg.verdict)}">
        <div class="sv"><b>${esc(sg.verdict)}</b> <span class="hint">推荐方向：${esc(sg.recommendedDir || '—')}</span></div>
        <div class="sv-sub">${sg.matchedOpps && sg.matchedOpps.length ? `当前可承接机会：${sg.matchedOpps.map(o => '#' + o.id).join('、')}` : ''}</div>
        <ul class="basis">${sg.basis.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      </div>

      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn primary" onclick="openCreatorForm(${c.id})">编辑资料</button>
      </div>
    </div>
  </div>`;
  document.querySelector('#modals').appendChild(wrap);
};

window.openVideoImport = async function (creatorId) {
  const m = openModal(`
    <div class="modal-head"><h3>＋ 导入已发布视频</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="hint">手动录入创作者发过的视频链接（非 AI 抓取）。操作人：${esc(getUser() || '未设置')}</div>
      <div class="form-grid">
        <div class="form-row full"><label>视频标题 *</label><input id="viTitle" placeholder="如：杖剑传说×攻略整活"></div>
        <div class="form-row full"><label>视频链接 *</label><input id="viUrl" placeholder="https://..."></div>
        <div class="form-row"><label>平台</label><select id="viPlat">${['B站', '抖音', '快手', '小红书', '其他'].map(p => `<option>${p}</option>`).join('')}</select></div>
        <div class="form-row"><label>发布日期</label><input id="viDate" type="date"></div>
        <div class="form-row"><label>播放量</label><input id="viPlay" type="number" placeholder="可选"></div>
        <div class="form-row full"><label>备注</label><input id="viNote" placeholder="可选，如：自然流量 / 投流 / 合作项目"></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="viOk">保存</button></div>`, true);
  m.querySelector('#viOk').onclick = async () => {
    const title = m.querySelector('#viTitle').value.trim();
    const url = m.querySelector('#viUrl').value.trim();
    if (!title || !url) return toast('请填写视频标题和链接', true);
    try {
      await api('/creator_videos', { method: 'POST', body: {
        creator_id: creatorId,
        title, url,
        platform: m.querySelector('#viPlat').value,
        publish_date: m.querySelector('#viDate').value || null,
        play_count: m.querySelector('#viPlay').value ? +m.querySelector('#viPlay').value : null,
        note: m.querySelector('#viNote').value.trim(),
        created_by: getUser()
      } });
      closeModals();
      toast('已导入视频链接');
      openCreatorDrawer(creatorId);
    } catch (e) { toast(e.message, true); }
  };
};

// 平台账号编辑行（一个作者可挂多个平台账号，主平台创作、副平台仅分发）
function accRowHtml(a) {
  a = a || {};
  const plats = ['B站', '抖音', '快手', '小红书', '其他'];
  return `<div class="acc-row" data-id="${a.id || ''}">
    <div class="acc-row-head">
      <select class="acc-plat">${plats.map(p => `<option ${a.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <input class="acc-name" placeholder="平台账号名（可与人名不同）" value="${esc(a.account_name)}">
      <select class="acc-role">${['创作', '分发'].map(p => `<option ${a.role === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <label class="acc-pri"><input type="checkbox" class="acc-primary" ${a.is_primary ? 'checked' : ''}> 主账号</label>
      <button class="btn small danger" type="button" onclick="this.closest('.acc-row').remove()">删除</button>
    </div>
    <div class="acc-row-grid">
      <input class="acc-url" placeholder="主页链接" value="${esc(a.home_url)}">
      <input class="acc-fans" type="number" placeholder="粉丝数" value="${a.fans ?? ''}">
      <input class="acc-play" type="number" placeholder="近期均播" value="${a.avg_play ?? ''}">
      <input class="acc-act" type="number" step="0.1" placeholder="均激活%" value="${a.avg_activation ?? ''}">
      <input class="acc-roi" type="number" step="0.01" placeholder="均ROI7" value="${a.avg_roi7 ?? ''}">
    </div>
  </div>`;
}
window.addAccRow = function () {
  const ed = document.getElementById('accEditor');
  if (ed) ed.insertAdjacentHTML('beforeend', accRowHtml({}));
};

// 批量按主页链接同步创作者各平台粉丝量/昵称（联网抓取，B站较稳/抖音尽力）
window.syncCreatorFans = async function () {
  if (!confirm('将按各平台主页链接联网抓取粉丝量与昵称并回填（B站较稳，抖音可能受反爬限制）。继续？')) return;
  toast('正在同步，请稍候…');
  try {
    const r = await api('/creator-accounts/sync-fans', { method: 'POST' });
    const d = r || {};
    toast(`同步完成：联网抓取 ${d.liveOk || 0} · 案例库匹配 ${d.caseOk || 0} · 失败 ${d.failCount || 0} / 共 ${d.total || 0}`, (d.failCount || 0) > 0);
    if ((d.errors || []).length) console.warn('同步失败明细', d.errors);
    pages.creators && pages.creators();
  } catch (e) { toast('同步失败：' + (e.message || e), true); }
};

window.openCreatorForm = async function (id) {
  const c = id ? await api(`/creators/${id}`) : {};
  const accInit = (c.accounts && c.accounts.length) ? c.accounts.map(accRowHtml).join('') : accRowHtml({});
  const m = openModal(`
    <div class="modal-head"><h3>${id ? '编辑' : '录入'}创作者</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body"><div class="form-grid">
      <div class="form-row"><label>名称 *</label><input id="crName" value="${esc(c.name)}"></div>
      <div class="form-row"><label>账号类型</label><select id="crAt">${['个人', '机构', 'MCN'].map(p => `<option ${c.account_type === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="form-row"><label>所属机构/MCN</label><input id="crAgency" value="${esc(c.agency)}"></div>
      <div class="form-row full"><label>擅长内容类型（逗号分隔）</label><input id="crCats" value="${esc(c.categories)}" placeholder="攻略,测评,整活"></div>
      <div class="form-row full"><label>内容类型（擅长大类）</label><input id="crCtype" value="${esc(c.content_type)}"></div>
      <div class="form-row"><label>创作意愿</label><select id="crWill">${['高', '中', '低'].map(p => `<option ${c.willingness === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="form-row"><label>内容稳定性</label><select id="crStab">${['高', '中', '低'].map(p => `<option ${c.stability === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="form-row"><label>是否新增创作者</label><select id="crNew">${[['1', '是'], ['0', '否']].map(([v, l]) => `<option value="${v}" ${String(c.is_new || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="form-row full"><label>擅长玩法（逗号分隔）</label><input id="crGp" value="${esc(c.good_play)}"></div>
      <div class="form-row full"><label>内容风格</label><input id="crStyle" value="${esc(c.style)}"></div>
      <div class="form-row full"><label>可接受制作形式（逗号分隔）</label><input id="crForms" value="${esc(c.forms)}"></div>
      <div class="form-row"><label>合作状态</label><select id="crSt">${['可合作', '合作中', '暂停', '黑名单'].map(p => `<option ${c.status === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="form-row full"><label>备注</label><textarea id="crNote">${esc(c.notes)}</textarea></div>
    </div>
    <div class="sec-title" style="margin-top:14px">平台账号 <span class="hint">主平台创作，副平台仅分发；不同平台可用不同账号名</span></div>
    <div id="accEditor">${accInit}</div>
    <button class="btn small" type="button" onclick="addAccRow()">＋ 添加平台账号</button>
    </div>
    <div class="modal-foot">${id ? `<button class="btn danger" onclick="delRow('creators',${id});closeModals()">删除</button>` : ''}<button class="btn primary" id="crOk">保存</button></div>`, true);
  m.querySelector('#crOk').onclick = async () => {
    const name = m.querySelector('#crName').value.trim();
    if (!name) return toast('请输入名称', true);
    const body = {
      name,
      account_type: m.querySelector('#crAt').value, agency: m.querySelector('#crAgency').value,
      categories: m.querySelector('#crCats').value, content_type: m.querySelector('#crCtype').value,
      willingness: m.querySelector('#crWill').value, stability: m.querySelector('#crStab').value,
      is_new: +m.querySelector('#crNew').value,
      good_play: m.querySelector('#crGp').value,
      style: m.querySelector('#crStyle').value, forms: m.querySelector('#crForms').value,
      status: m.querySelector('#crSt').value, notes: m.querySelector('#crNote').value
    };
    // 收集平台账号
    const accounts = [];
    m.querySelectorAll('.acc-row').forEach(row => {
      const platform = row.querySelector('.acc-plat').value;
      if (!platform) return;
      accounts.push({
        id: row.dataset.id ? +row.dataset.id : null,
        platform,
        account_name: row.querySelector('.acc-name').value.trim(),
        home_url: row.querySelector('.acc-url').value.trim(),
        fans: +row.querySelector('.acc-fans').value || 0,
        avg_play: +row.querySelector('.acc-play').value || 0,
        avg_activation: row.querySelector('.acc-act').value ? +row.querySelector('.acc-act').value : null,
        avg_roi7: row.querySelector('.acc-roi').value ? +row.querySelector('.acc-roi').value : null,
        role: row.querySelector('.acc-role').value,
        is_primary: row.querySelector('.acc-primary').checked ? 1 : 0
      });
    });
    if (!accounts.length) return toast('请至少添加一个平台账号', true);
    if (!accounts.some(a => a.is_primary)) accounts[0].is_primary = 1;
    try {
      let cid;
      if (id) { await api(`/creators/${id}`, { method: 'PUT', body }); cid = id; }
      else { const r = await api('/creators', { method: 'POST', body }); cid = r.id; }
      // 同步平台账号（删除已移除的、更新已有的、新增没有的）
      const existingIds = (c.accounts || []).map(a => a.id);
      const newIds = accounts.filter(a => a.id).map(a => a.id);
      for (const delId of existingIds.filter(x => !newIds.includes(x))) await api(`/creator_accounts/${delId}`, { method: 'DELETE' });
      for (const a of accounts) {
        if (a.id) await api(`/creator_accounts/${a.id}`, { method: 'PUT', body: { ...a, creator_id: cid } });
        else await api('/creator_accounts', { method: 'POST', body: { ...a, creator_id: cid } });
      }
      closeModals(); toast('已保存'); go('creators');
    } catch (e) { toast(e.message, true); }
  };
};

/* ================= 页面：内容经营分析（原周期复盘重做） ================= */
let opsState = { campaignId: null, cycleMode: 'task', start: '2026-07-01', end: '2026-08-31', dim: 'content_type', result: null };

pages.ops = async function () {
  const camps = await api('/campaigns');
  const list = Array.isArray(camps) ? camps : (camps.data || camps || []);
  // 默认全量分析：campaignId 保持 null（不按任务过滤），任务下拉仅作可选细化
  main.innerHTML = `
  <div class="page-head">
    <div><h2>内容经营分析</h2><div class="sub">数据→经验→下一次决策的中心：自动分析内容方向表现、机会验证、创作者成长与资源建议</div></div>
    <div class="head-actions">
      <button class="btn" onclick="opsArchive()" title="将当前分析结果存为周期快照，供下周期环比与历史平均对照">📦 归档本周期</button>
      <button class="btn primary" onclick="opsRun()">▶ 开始分析</button>
    </div>
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="grid2" style="gap:12px 18px;align-items:end">
      <div class="fld"><label>营销任务</label><select id="opsCamp" onchange="opsSetCampaign(this.value)">
        <option value="">全部任务（默认）</option>
        ${list.map(c => `<option value="${c.id}" ${String(c.id) === String(opsState.campaignId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></div>
      <div class="fld"><label>周期模式</label>
        <div class="seg">
          <span class="seg-item ${opsState.cycleMode === 'task' ? 'active' : ''}" onclick="opsSetMode('task')">按任务</span>
          <span class="seg-item ${opsState.cycleMode === 'period' ? 'active' : ''}" onclick="opsSetMode('period')">按档期</span>
        </div>
      </div>
      <div class="fld"><label>开始日期</label><input id="opsStart" type="date" value="${opsState.start}" onchange="opsState.start=this.value"></div>
      <div class="fld"><label>结束日期</label><input id="opsEnd" type="date" value="${opsState.end}" onchange="opsState.end=this.value"></div>
    </div>
  </div>
  <div id="opsResult">${opsState.result ? opsRenderResult(opsState.result) : '<div class="empty">正在自动分析全量数据<span class="loading-dot"></span></div>'}</div>`;
  if (!opsState.result) opsRun();
};

window.opsSetCampaign = function (v) { opsState.campaignId = v ? Number(v) : null; };
window.opsSetMode = function (m) { opsState.cycleMode = m; go('ops'); };
window.opsSetDim = function (d) { opsState.dim = d; if (opsState.result) document.getElementById('opsResult').innerHTML = opsRenderResult(opsState.result); };

// 周期归档：当前分析结果存为 reviews 快照（下周期环比/历史平均的数据来源）
window.opsArchive = async function () {
  if (!opsState.result) return toast('请先点击「开始分析」，确认分析结果无误后再归档', true);
  const body = {
    campaignId: opsState.campaignId, cycleMode: opsState.cycleMode,
    start: opsState.start, end: opsState.end, user: getUser()
  };
  try {
    let r = await api('/ops/archive', { method: 'POST', body });
    if (r && r.exists) {
      if (!confirm(`该周期（${opsState.start} ~ ${opsState.end}）已有归档「${r.title}」。\n\n确定＝覆盖更新快照\n取消＝放弃本次归档`)) return;
      r = await api('/ops/archive', { method: 'POST', body: { ...body, force: 1 } });
    }
    toast(r.updated ? '已覆盖更新本周期快照' : '已归档本周期，下周期分析时将自动作为环比基准');
  } catch (e) { toast('归档失败：' + e.message, true); }
};

window.opsRun = async function () {
  const box = document.getElementById('opsResult');
  box.innerHTML = '<div class="empty">分析中<span class="loading-dot"></span></div>';
  try {
    const q = `campaignId=${opsState.campaignId || ''}&cycleMode=${opsState.cycleMode}&start=${opsState.start}&end=${opsState.end}`;
    const r = await api('/ops/analyze?' + q);
    opsState.result = r;
    box.innerHTML = opsRenderResult(r);
  } catch (e) { box.innerHTML = '<div class="empty">分析失败：' + esc(e.message) + '</div>'; }
};

function opsKpi(label, val) {
  return `<div class="rule-block" style="text-align:center;margin:0"><div class="hint">${esc(label)}</div><b style="font-size:20px">${val}</b></div>`;
}
function fmtW(n) { if (n == null) return '—'; if (n >= 10000) return (n / 10000).toFixed(1) + '万'; return String(Math.round(n)); }
function dCls(d) { return d == null ? '' : (d >= 0 ? 'up' : 'down'); }
function dTxt(d) { return d == null ? '—' : (d > 0 ? '+' + d + '%' : d + '%'); }
function lvlCls(l) { return { '优秀': 'green', '稳定': 'blue', '值得测试': 'orange', '应停止': 'red', '观察': 'gray' }[l] || 'gray'; }
function verdictCls(v) { return { 'verified': 'green', 'partial': 'orange', 'failed': 'red', 'none': 'gray' }[v] || 'gray'; }

function opsRenderResult(r) {
  const c = r.dataCenter, o = r.overview, m = o.metrics, cmp = o.compare;
  // ① 数据中心
  const dc = `
  <div class="card sec">
    <div class="sec-title">① 周期数据中心 <span class="hint">自动识别异常，仅需处理异常项</span></div>
    <div class="grid grid-4 ops-kpi">
      ${opsKpi('内容总数', c.total)}
      ${opsKpi('已匹配', c.matched)}
      ${opsKpi('数据完成度', c.dataCompleteness + '%')}
      ${opsKpi('异常项', (c.missing + c.duplicates))}
    </div>
    ${c.issues.length ? `<div class="issue-list">${c.issues.map(i => `<div class="issue"><span class="tag red">${esc(i.type)}</span> ${esc(i.detail)}</div>`).join('')}</div>` : '<div class="hint" style="margin-top:8px">✓ 未识别到数据缺失/重复/异常，数据质量良好</div>'}
  </div>`;
  // ② 业务总览
  const cmpBlock = (b, key) => b ? `<div class="cmp"><div class="cmp-h">${esc(b.label)}</div>
      <div class="cmp-row"><span>总播放</span><b>${fmtW(b.metrics.totalPlay)}</b><span class="delta ${dCls(b.deltas.totalPlay)}">${dTxt(b.deltas.totalPlay)}</span></div>
      <div class="cmp-row"><span>平均ROI7</span><b>${b.metrics.avgRoi7}</b><span class="delta ${dCls(b.deltas.avgRoi7)}">${dTxt(b.deltas.avgRoi7)}</span></div>
      <div class="cmp-row"><span>完成率</span><b>${Math.round(b.metrics.completion * 100)}%</b><span class="delta ${dCls(b.deltas.completion)}">${dTxt(b.deltas.completion)}</span></div>
      <div class="cmp-row"><span>百赞内容</span><b>${b.metrics.baiZan}</b><span class="delta ${dCls(b.deltas.baiZan)}">${dTxt(b.deltas.baiZan)}</span></div></div>` : `<div class="cmp"><div class="cmp-h">${esc(key)}</div><div class="hint">暂无对照数据</div></div>`;
  const ov = `
  <div class="card sec">
    <div class="sec-title">② 业务结果总览 <span class="hint">本周期发生了什么</span></div>
    <div class="grid grid-4 ops-kpi">
      ${opsKpi('发布内容', m.published)}
      ${opsKpi('合作创作者', m.creators)}
      ${opsKpi('内容完成率', m.completion + '%')}
      ${opsKpi('总播放', fmtW(m.totalPlay))}
      ${opsKpi('总互动', fmtW(m.totalInteraction))}
      ${opsKpi('百赞内容', m.baiZan)}
      ${opsKpi('高潜内容', m.gaoQian)}
      ${opsKpi('新测试玩法', m.newPlays)}
    </div>
    <div class="grid grid-3" style="margin-top:12px">
      ${cmpBlock(cmp.prev, '上周期')}
      ${cmpBlock(cmp.avg, '历史平均')}
      <div class="cmp"><div class="cmp-h">${esc(cmp.target.label)}</div>
        <div class="cmp-row"><span>平均ROI7≥0.8</span><b>${cmp.target.reach.avgRoi7 ? '✓达标' : '✗未达'}</b></div>
        <div class="cmp-row"><span>平均激活≥3%</span><b>${cmp.target.reach.avgActivation ? '✓达标' : '✗未达'}</b></div>
        <div class="cmp-row"><span>完成率100%</span><b>${cmp.target.reach.completion ? '✓达标' : '✗未达'}</b></div>
      </div>
    </div>
    <div class="hint" style="margin-top:10px">平台分布：${Object.entries(m.platforms).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
  </div>`;
  // ③ 内容分层
  const dim = opsState.dim, groups = r.layers[dim] || [];
  const seg = `<div class="seg" style="margin-bottom:10px">
    <span class="seg-item ${dim === 'content_type' ? 'active' : ''}" onclick="opsSetDim('content_type')">内容类型</span>
    <span class="seg-item ${dim === 'play_method' ? 'active' : ''}" onclick="opsSetDim('play_method')">内容玩法</span>
    <span class="seg-item ${dim === 'marketing_goal' ? 'active' : ''}" onclick="opsSetDim('marketing_goal')">营销目标</span>
  </div>`;
  const layerTbl = `
  <table class="ops-tbl">
    <tr><th>方向</th><th>发布</th><th>创作者</th><th>均播</th><th>中位播</th><th>百赞率</th><th>爆款</th><th>ROI7</th><th>稳定性</th><th>趋势</th><th>判断</th></tr>
    ${groups.map(g => `<tr>
      <td><b>${esc(g.key)}</b></td><td>${g.n}</td><td>${g.creators}</td>
      <td>${fmtW(g.avgPlay)}</td><td>${fmtW(g.medianPlay)}</td>
      <td>${g.baiZanRate}%</td><td>${g.baoKuan}</td><td>${g.avgRoi7}</td>
      <td>${esc(g.stability)}</td><td><span class="trend ${trendCls(g.trend)}">${esc(g.trend)}</span></td>
      <td><span class="tag ${lvlCls(g.level)}">${esc(g.level)}</span></td>
    </tr>`).join('')}
  </table>`;
  const la = `
  <div class="card sec">
    <div class="sec-title">③ 内容分层分析 <span class="hint">按内容方向做经营分析，而非平台/达人</span></div>
    ${seg}${layerTbl}
    <div class="hint" style="margin-top:8px">判断依据：${groups.filter(g => g.level !== '观察').map(g => `${esc(g.key)}→${esc(g.level)}（${esc(g.reason)}）`).join('；') || '样本不足，暂不下结论'}</div>
  </div>`;
  // ④ 机会验证分析
  const opp = r.opp || {};
  let oppBlock;
  if (opp.ready) {
    const s = opp.summary || {};
    const grpRender = (key, label) => {
      const arr = (opp.groups && opp.groups[key]) || [];
      if (!arr.length) return '';
      return `<div class="opp-grp">
        <div class="grp-h"><span class="tag ${verdictCls(key)}">${label}</span><b>${arr.length}</b></div>
        <div class="opp-cards">${arr.map(o => `<div class="opp-card">
          <div class="opp-top"><b>${esc(o.title)}</b><span class="tag ${verdictCls(key)}">${label}</span></div>
          <div class="opp-meta">${esc(o.platform)} · ${esc(o.node)} · ${esc(o.play_method)}</div>
          <div class="opp-kpis">
            <span>关联内容<b>${o.linkedCount}</b></span>
            <span>有效播放<b>${fmtW(o.totalPlay)}</b></span>
            <span>ROI7<b>${o.avgRoi ?? '—'}</b></span>
            <span>激活<b>${o.avgAct ?? '—'}</b></span>
            <span>百赞<b>${o.baiZan}</b></span>
            <span>高潜<b>${o.gaoQian}</b></span>
          </div>
          <div class="opp-reason">${esc(o.reason)}</div>
        </div>`).join('')}</div>
      </div>`;
    };
    oppBlock = `
    <div class="card sec">
      <div class="sec-title">④ 机会验证分析 <span class="hint">关联机会中心 · status 优先 + 规则兜底</span></div>
      <div class="grid grid-4 ops-kpi">
        ${opsKpi('已验证', s.verified ?? 0)}
        ${opsKpi('部分验证', s.partial ?? 0)}
        ${opsKpi('验证失败', s.failed ?? 0)}
        ${opsKpi('无内容/未验证', s.none ?? 0)}
      </div>
      <div class="hint" style="margin:10px 0 6px">本周期共 <b>${s.total ?? 0}</b> 个机会关联了内容，验证分布如下：</div>
      ${grpRender('verified', '已验证')}
      ${grpRender('partial', '部分验证')}
      ${grpRender('failed', '验证失败')}
      ${grpRender('none', '无内容/未验证')}
    </div>`;
  } else {
    oppBlock = `<div class="card sec"><div class="sec-title">④ 机会验证分析 <span class="hint">待实现</span></div><div class="empty">${esc(opp.note || '关联机会中心，验证推荐机会是否跑通（已验证 / 部分验证 / 验证失败）')}</div></div>`;
  }
  // ⑤ 创作者经营分析
  const creator = r.creator || {};
  let creatorBlock;
  if (creator.ready) {
    const cs = creator.summary || {};
    const clsMap = { growth: ['verified', '成长'], bottleneck: ['failed', '瓶颈'], cultivate: ['partial', '值得培养'], watch: ['none', '观察'] };
    const grpRenderC = (key) => {
      const arr = (creator.groups && creator.groups[key]) || [];
      if (!arr.length) return '';
      const [vk, label] = clsMap[key];
      return `<div class="opp-grp">
        <div class="grp-h"><span class="tag ${verdictCls(vk)}">${label}</span><b>${arr.length}</b></div>
        <div class="opp-cards">${arr.map(o => `<div class="opp-card">
          <div class="opp-top"><b>${esc(o.name || ('创作者#' + o.id))}</b><span class="tag ${verdictCls(vk)}">${label}</span></div>
          <div class="opp-meta">${esc(o.platform)} · ${esc(o.status)}${o.is_new ? ' · 新人' : ''} · 本周期发布 ${o.published} · 周期趋势 ${esc(o.periodTrend || '样本不足')}</div>
          <div class="opp-kpis">
            <span>有效播放<b>${fmtW(o.totalPlay)}</b></span>
            <span>ROI7<b>${o.avgRoi ?? '—'}</b></span>
            <span>激活<b>${o.avgAct ?? '—'}</b></span>
            <span>百赞<b>${o.baiZan}</b></span>
            <span>高潜<b>${o.gaoQian}</b></span>
          </div>
          <div class="opp-reason"><b>分类依据：</b>${esc(o.reason)}</div>
          <div class="opp-reason"><b>系统建议：</b>${esc((o.verdict || '') + (o.recommendedDir ? '（' + o.recommendedDir + '）' : ''))}</div>
          ${o.signals && o.signals.length ? `<div class="opp-reason"><b>趋势信号：</b>${o.signals.map(s => `<span class="tag ${s.level === 'warn' ? 'red' : 'blue'}">${esc(s.label)}</span>`).join(' ')}</div>` : ''}
        </div>`).join('')}</div>
      </div>`;
    };
    creatorBlock = `
    <div class="card sec">
      <div class="sec-title">⑤ 创作者经营分析 <span class="hint">成长/瓶颈/值得培养 · 非排名，复用创作者库分析引擎</span></div>
      <div class="grid grid-4 ops-kpi">
        ${opsKpi('成长', cs.growth ?? 0)}
        ${opsKpi('瓶颈', cs.bottleneck ?? 0)}
        ${opsKpi('值得培养', cs.cultivate ?? 0)}
        ${opsKpi('观察', cs.watch ?? 0)}
      </div>
      <div class="hint" style="margin:10px 0 6px">本周期共 <b>${cs.total ?? 0}</b> 位创作者参与内容，经营分布如下：</div>
      ${grpRenderC('growth')}
      ${grpRenderC('bottleneck')}
      ${grpRenderC('cultivate')}
      ${grpRenderC('watch')}
    </div>`;
  } else {
    creatorBlock = `<div class="card sec"><div class="sec-title">⑤ 创作者经营分析 <span class="hint">待实现</span></div><div class="empty">${esc(creator.note || '分析创作者成长与瓶颈，输出值得培养名单（非排名）')}</div></div>`;
  }
  // ⑥ AI经营洞察（规则即时 + AI按钮触发）
  const ins = r.insights || {};
  let insBlock;
  if (ins.ready) {
    const rules = ins.rules || [];
    window.__ruleIns = rules;
    insBlock = `
    <div class="card sec">
      <div class="sec-title">⑥ AI经营洞察 <span class="hint">发现规律而非写总结 · 规则引擎即时 + Gemini 深度洞察</span></div>
      ${rules.length ? `<div class="ins-list" id="opsRuleIns">${rules.map(insCard).join('')}</div>` : `<div class="empty">本周期数据未触发规则规律（样本或差异不足）</div>`}
      <div class="ins-ai-bar">
        <button class="btn primary" id="opsAiBtn" onclick="opsRunAiInsight(this)">🔮 AI 深度洞察</button>
        <span class="hint">${esc(ins.aiHint || '调用 Gemini 做跨维度规律发现，规则洞察不受影响')}</span>
      </div>
      <div class="ins-list" id="opsAiIns"></div>
    </div>`;
  } else {
    insBlock = `<div class="card sec"><div class="sec-title">⑥ AI经营洞察 <span class="hint">待实现</span></div><div class="empty">${esc(ins.note || '规则引擎 + Gemini 发现本周期规律，每条带数据依据与可信度')}</div></div>`;
  }
  // ⑦ 资源经营建议
  let resBlock;
  const res = r.resource || {};
  if (res.ready) {
    const DIMS = [
      { k: 'amplify', name: '🚀 继续放大', cls: 'green', desc: '已证明有效，追加投入' },
      { k: 'verify', name: '🧪 验证', cls: 'orange', desc: '有潜力但样本不足，小成本测试' },
      { k: 'optimize', name: '🔧 优化', cls: 'blue', desc: '有基础但存在短板，调整后维持' },
      { k: 'pause', name: '⏸️ 暂停', cls: 'red', desc: '低效或风险项，止损' }
    ];
    const stars = n => '★'.repeat(n) + '<span class="star-dim">' + '★'.repeat(5 - n) + '</span>';
    const cols = DIMS.map(d => {
      const arr = (res.groups && res.groups[d.k]) || [];
      const cards = arr.length ? arr.map(x => `
        <div class="res-card">
          <div class="res-top">
            <span class="tag ${x.line === 'creator' ? 'purple' : 'blue'}">${x.line === 'creator' ? '创作者' : '玩法'}</span>
            <b>${esc(x.target)}</b>
            <span class="res-stars">${stars(x.stars)}</span>
          </div>
          <div class="res-advice">${esc(x.advice)}</div>
          <div class="res-basis">依据：${esc(x.basis)}</div>
        </div>`).join('') : '<div class="empty" style="padding:12px">本周期无此类建议</div>';
      return `<div class="res-col">
        <div class="res-col-head ${d.cls}"><b>${d.name}</b><span class="hint">${arr.length} 条 · ${d.desc}</span></div>
        ${cards}
      </div>`;
    }).join('');
    resBlock = `<div class="card sec">
      <div class="sec-title">⑦ 资源经营建议 <span class="hint">星级 = 把握度 × 影响面（执行优先级）</span></div>
      <div class="res-grid">${cols}</div>
    </div>`;
  } else {
    resBlock = `<div class="card sec"><div class="sec-title">⑦ 资源经营建议 <span class="hint">待实现</span></div><div class="empty">${esc(res.note || '按 继续放大 / 验证 / 优化 / 暂停 输出下周期资源调度')}</div></div>`;
  }
  // ⑧ 经营经验库
  let knBlock;
  const kn = r.knowledge || {};
  if (kn.ready) {
    window.__knList = kn.list || [];
    const s = kn.summary || {};
    knBlock = `<div class="card sec">
      <div class="sec-title">⑧ 经营经验库 <span class="hint">已确认规律沉淀为长期资产 · 反哺机会推荐/创作者匹配（接口已就绪）</span>
        <span style="margin-left:auto"><button class="btn small primary" onclick="openExpEditor()">＋ 新建经验</button></span>
      </div>
      <div class="grid-3" style="margin-bottom:10px">
        ${opsKpi('经验总数', s.total ?? 0)}${opsKpi('生效中', s.effective ?? 0)}${opsKpi('高可信', s.highConfidence ?? 0)}
      </div>
      <div class="ins-ai-bar" style="margin-top:0;border-top:none;padding-top:0">
        <select id="knDirF" onchange="knRenderList()" class="sel-sm"><option value="">全部方向</option>${(kn.directions || []).map(d => `<option>${esc(d)}</option>`).join('')}</select>
        <select id="knPlatF" onchange="knRenderList()" class="sel-sm"><option value="">全部平台</option>${(kn.platforms || []).map(p => `<option>${esc(p)}</option>`).join('')}</select>
        <label class="hint" style="cursor:pointer"><input type="checkbox" id="knArcF" onchange="knRenderList()"> 显示已归档</label>
      </div>
      <div id="knList"></div>
    </div>`;
  } else {
    knBlock = `<div class="card sec"><div class="sec-title">⑧ 经营经验库 <span class="hint">待实现</span></div><div class="empty">${esc(kn.note || '已确认规律进入长期经验库，反哺机会推荐与创作者匹配')}</div></div>`;
  }
  setTimeout(() => { if (document.getElementById('knList')) knRenderList(); }, 0);
  return dc + ov + la + oppBlock + creatorBlock + insBlock + resBlock + knBlock;
}

// 模块6：单条洞察卡片（idx 供「存入经验库」定位）
function insCard(i, idx) {
  const confCls = { '高': 'green', '中': 'blue', '低': 'orange' }[i.confidence] || 'gray';
  const catCls = { '内容规律': 'blue', '平台规律': 'purple', '创作者规律': 'green', '机会验证': 'orange', '异常信号': 'red' }[i.category] || 'gray';
  return `<div class="ins-card${i.source === 'ai' ? ' ins-ai' : ''}">
    <div class="ins-top">
      <span class="tag ${catCls}">${esc(i.category)}</span>
      <b>${esc(i.title)}</b>
      ${i.source === 'ai' ? '<span class="tag purple">AI</span>' : '<span class="tag gray">规则</span>'}
    </div>
    <div class="ins-body">${esc(i.statement)}</div>
    <div class="ins-basis"><b>数据依据：</b>${esc(i.basis)}</div>
    ${i.suggestion ? `<div class="ins-basis"><b>下周期建议：</b>${esc(i.suggestion)}</div>` : ''}
    <div class="ins-foot">
      <span>覆盖内容 <b>${i.contentCount}</b> 条</span>
      <span>涉及创作者 <b>${i.creatorCount}</b> 位</span>
      <span class="tag ${confCls}">可信度 ${esc(i.confidence)}</span>
      ${i.needsVerify ? '<span class="tag red">需下周期验证</span>' : ''}
      <span style="margin-left:auto"><button class="btn small" onclick="opsSaveInsight('${i.source === 'ai' ? 'ai' : 'rule'}', ${idx})">📥 存入经验库</button></span>
    </div>
  </div>`;
}

// 模块8：洞察一键入库（预填弹窗，人工确认后才写入）
window.opsSaveInsight = function (src, idx) {
  const arr = src === 'ai' ? (window.__aiIns || []) : (window.__ruleIns || []);
  const i = arr[idx];
  if (!i) return toast('未找到该洞察');
  const CAT = { '内容规律': '选题', '平台规律': '形式', '创作者规律': '创作者', '机会验证': '选题', '异常信号': '其他' };
  openExpEditor({
    content: `${i.title}：${i.statement}`,
    category: CAT[i.category] || '其他',
    data_basis: i.basis || '',
    confidence: i.confidence || '中',
    boost: i.category === '异常信号' ? -1 : 1,
    source_cycle: `${opsState.start} ~ ${opsState.end}`,
    keywords: i.title || ''
  });
};

// 模块8：经验列表渲染（页内筛选）
window.knRenderList = function () {
  const box = document.getElementById('knList');
  if (!box) return;
  const dir = (document.getElementById('knDirF') || {}).value || '';
  const plat = (document.getElementById('knPlatF') || {}).value || '';
  const showArc = (document.getElementById('knArcF') || {}).checked;
  let list = window.__knList || [];
  if (!showArc) list = list.filter(e => e.is_effective);
  if (dir) list = list.filter(e => e.target_direction === dir);
  if (plat) list = list.filter(e => e.platform === plat);
  box.innerHTML = list.length ? `<div class="ins-list">${list.map(knExpCard).join('')}</div>` : '<div class="empty">暂无符合条件的经验，可从模块⑥洞察一键入库或手动新建</div>';
};

function knExpCard(e) {
  const confCls = { '高': 'green', '中': 'blue', '低': 'orange' }[e.confidence] || 'gray';
  return `<div class="ins-card${e.is_effective ? '' : ' kn-arc'}">
    <div class="ins-top">
      <span class="tag ${e.boost === -1 ? 'red' : 'green'}">${e.boost === -1 ? '避坑' : '正向'}</span>
      <span class="tag gray">${esc(e.category || '其他')}</span>
      ${e.target_direction ? `<span class="tag blue">${esc(e.target_direction)}</span>` : ''}
      ${e.platform ? `<span class="tag purple">${esc(e.platform)}</span>` : ''}
      ${e.is_effective ? '' : '<span class="tag gray">已归档</span>'}
    </div>
    <div class="ins-body">${esc(e.content)}</div>
    ${e.data_basis ? `<div class="ins-basis"><b>数据依据：</b>${esc(e.data_basis)}</div>` : ''}
    <div class="ins-foot">
      <span class="tag ${confCls}">可信度 ${esc(e.confidence)}</span>
      <span>验证 <b>${e.validation_count || 0}</b> 次</span>
      ${e.source_cycle ? `<span class="hint">来源：${esc(e.source_cycle)}</span>` : ''}
      ${e.applicable_creator ? `<span class="hint">适用：${esc(e.applicable_creator)}</span>` : ''}
      <span style="margin-left:auto">
        <button class="btn small" onclick="openExpEditor(window.__knList.find(x=>x.id===${e.id}))">编辑</button>
        <button class="btn small" onclick="knToggleEffective(${e.id}, ${e.is_effective ? 0 : 1})">${e.is_effective ? '归档' : '恢复'}</button>
      </span>
    </div>
  </div>`;
}

// 模块8：新建/编辑经验弹窗（人工确认入口）
window.openExpEditor = function (e) {
  e = e || {};
  const m = openModal(`
    <div class="modal-head"><h3>${e.id ? '编辑经验' : '新建经验'}</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-row full"><label>经验/规律描述 *</label><textarea id="keContent" class="ta">${esc(e.content || '')}</textarea></div>
        <div class="form-row"><label>类别</label><select id="keCat">${['选题', '创作者', '时机', '形式', '其他'].map(c => `<option ${e.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="form-row"><label>方向</label><select id="keBoost"><option value="1" ${e.boost !== -1 ? 'selected' : ''}>正向（值得复用）</option><option value="-1" ${e.boost === -1 ? 'selected' : ''}>避坑（应当规避）</option></select></div>
        <div class="form-row"><label>适用方向/玩法</label><input id="keDir" value="${esc(e.target_direction || '')}" placeholder="如：攻略、整活、月卡党养成"></div>
        <div class="form-row"><label>适用平台</label><input id="kePlat" value="${esc(e.platform || '')}" placeholder="如：B站、抖音；留空=全平台"></div>
        <div class="form-row"><label>适用创作者类型</label><input id="keCr" value="${esc(e.applicable_creator || '')}" placeholder="如：成长期垂类作者"></div>
        <div class="form-row"><label>可信度</label><select id="keConf">${['高', '中', '低'].map(c => `<option ${(e.confidence || '中') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="form-row"><label>关键词（反哺匹配用）</label><input id="keKw" value="${esc(e.keywords || '')}" placeholder="逗号分隔"></div>
        <div class="form-row"><label>来源周期</label><input id="keSrc" value="${esc(e.source_cycle || '')}"></div>
        <div class="form-row full"><label>数据依据</label><textarea id="keBasis" class="ta" style="min-height:56px">${esc(e.data_basis || '')}</textarea></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModals()">取消</button>
      <button class="btn primary" id="keSave">确认入库</button>
    </div>`);
  m.querySelector('#keSave').onclick = async () => {
    const g = id => (m.querySelector(id) || {}).value || '';
    const content = g('#keContent').trim();
    if (!content) return toast('请填写经验描述');
    const body = {
      content, category: g('#keCat'), boost: +g('#keBoost'),
      target_direction: g('#keDir'), platform: g('#kePlat'), applicable_creator: g('#keCr'),
      confidence: g('#keConf'), keywords: g('#keKw'), source_cycle: g('#keSrc'), data_basis: g('#keBasis'),
      status: '已确认', is_effective: e.is_effective == null ? 1 : e.is_effective,
      validation_count: e.validation_count || 0
    };
    try {
      if (e.id) await api(`/experiences/${e.id}`, { method: 'PUT', body });
      else await api('/experiences', { method: 'POST', body });
      closeModals();
      toast(e.id ? '经验已更新' : '已确认入库');
      await opsRun();
    } catch (err) { toast('保存失败：' + err.message); }
  };
};

// 模块8：归档/恢复
window.knToggleEffective = async function (id, val) {
  try {
    await api(`/experiences/${id}`, { method: 'PUT', body: { is_effective: val } });
    toast(val ? '已恢复生效' : '已归档');
    await opsRun();
  } catch (e) { toast('操作失败：' + e.message); }
};

// 模块6：按钮触发 AI 深度洞察（失败保留规则洞察）
window.opsRunAiInsight = async function (btn) {
  const box = document.getElementById('opsAiIns');
  if (!box) return;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'AI 分析中（约 5-10 秒）…';
  box.innerHTML = '<div class="hint" style="padding:8px 2px">正在调用 Gemini 做跨维度规律发现…</div>';
  try {
    const resp = await api('/ops/insight-ai', { method: 'POST', body: {
      campaignId: opsState.campaignId, cycleMode: opsState.cycleMode, start: opsState.start, end: opsState.end
    } });
    const arr = (resp && resp.insights) || [];
    window.__aiIns = arr;
    box.innerHTML = arr.length
      ? `<div class="hint" style="margin:6px 0 4px">AI 深度洞察（${arr.length} 条，已与规则洞察去重）：</div>` + arr.map(insCard).join('')
      : '<div class="empty">AI 未发现规则引擎之外的新规律</div>';
  } catch (e) {
    box.innerHTML = `<div class="issue">⚠ ${esc(e.message || 'AI 洞察生成失败')}（规则洞察不受影响）</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
};

window.openGenReview = function () {
  const end = new Date();
  const start = new Date(Date.now() - 13 * 86400000);
  const f = d => d.toISOString().slice(0, 10);
  const m = openModal(`
    <div class="modal-head"><h3>生成周期复盘</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-row"><label>周期开始</label><input id="rvS" type="date" value="${f(start)}"></div>
        <div class="form-row"><label>周期结束</label><input id="rvE" type="date" value="${f(end)}"></div>
      </div>
      <div class="hint">系统将汇总该周期内的机会、执行记录和回收数据，调用AI生成复盘报告（AI不可用时生成基础版）。</div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="rvOk">生成</button></div>`);
  m.querySelector('#rvOk').onclick = async ev => {
    ev.target.disabled = true; ev.target.innerHTML = '生成中<span class="loading-dot"></span>';
    try {
      const r = await api('/reviews/generate', { method: 'POST', body: { period_start: m.querySelector('#rvS').value, period_end: m.querySelector('#rvE').value, user: getUser() } });
      if (r.message) toast(r.message, true); else toast('复盘已生成');
      closeModals(); viewReview(r.id);
    } catch (e) { toast(e.message, true); ev.target.disabled = false; ev.target.textContent = '生成'; }
  };
};

window.viewReview = async function (id) {
  const r = await api(`/reviews/${id}`);
  const stats = r.stats_json ? JSON.parse(r.stats_json) : {};
  const m = openModal(`
    <div class="modal-head"><h3>${esc(r.title)} ${r.status === '已确认' ? '<span class="tag green">已确认</span>' : '<span class="tag orange">草稿</span>'}</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="grid grid-4" style="margin-bottom:14px">
        <div class="rule-block" style="margin:0;text-align:center"><div class="hint">机会数</div><b style="font-size:20px">${stats.opportunities_total ?? stats.opportunities_created ?? '—'}</b></div>
        <div class="rule-block" style="margin:0;text-align:center"><div class="hint">已发布</div><b style="font-size:20px">${stats.published ?? '—'}</b></div>
        <div class="rule-block" style="margin:0;text-align:center"><div class="hint">平均激活</div><b style="font-size:20px">${stats.avg_activation ?? '—'}%</b></div>
        <div class="rule-block" style="margin:0;text-align:center"><div class="hint">平均ROI7</div><b style="font-size:20px;color:${(stats.avg_roi7 || 0) >= 0.8 ? 'var(--green)' : 'var(--red)'}">${stats.avg_roi7 ?? '—'}</b></div>
      </div>
      ${md(r.content)}
    </div>
    <div class="modal-foot">
      ${r.status !== '已确认' ? `<button class="btn" onclick="confirmReview(${r.id})">✓ 确认复盘</button>` : ''}
      <button class="btn primary" onclick="openExpForm(${r.id})">💎 沉淀经验</button>
    </div>`, true);
};

window.confirmReview = async function (id) {
  await api(`/reviews/${id}/confirm`, { method: 'POST', body: { user: getUser() } });
  toast('复盘已确认'); closeModals(); go('ops');
};
window.confirmExp = async function (id) {
  await api(`/experiences/${id}`, { method: 'PUT', body: { status: '已确认' } });
  toast('经验已确认，将参与后续推荐'); go('ops');
};
window.openExpForm = function (reviewId) {
  const m = openModal(`
    <div class="modal-head"><h3>沉淀经验</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="form-row"><label>经验内容 *</label><textarea id="epC" placeholder="如：平民攻略类题材转化稳定，同类热点优先推荐"></textarea></div>
      <div class="form-grid">
        <div class="form-row"><label>类别</label><select id="epCat"><option>选题</option><option>创作者</option><option>时机</option><option>形式</option><option>其他</option></select></div>
        <div class="form-row"><label>方向</label><select id="epB"><option value="1">正向（加权推荐）</option><option value="-1">负向（降权提醒）</option></select></div>
      </div>
      <div class="form-row"><label>匹配关键词（逗号分隔，命中这些词的热点会被加/降权）</label><input id="epK" placeholder="如：平民,零氪,月卡"></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="epOk">保存并生效</button></div>`);
  m.querySelector('#epOk').onclick = async () => {
    const content = m.querySelector('#epC').value.trim();
    if (!content) return toast('请输入经验内容', true);
    await api('/experiences', { method: 'POST', body: {
      content, category: m.querySelector('#epCat').value, boost: +m.querySelector('#epB').value,
      keywords: m.querySelector('#epK').value, source_review_id: reviewId || null,
      status: '已确认', created_by: getUser()
    } });
    closeModals(); toast('经验已沉淀，将反哺机会推荐');
    if (currentPage === 'ops') go('ops');
  };
};

/* ================= 导入 ================= */
window.openImport = function (type, label) {
  const m = openModal(`
    <div class="modal-head"><h3>导入${label}（Excel/CSV）</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="form-row"><label>选择文件（第一行为表头）</label><input type="file" id="impFile" accept=".xlsx,.xls,.csv"></div>
      <div class="hint">首次使用请先 <a href="/api/import/${type}/template" style="color:var(--brand)">下载导入模板</a>，按模板列名填写后上传。</div>
      <div id="impResult"></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="impOk">开始导入</button></div>`);
  m.querySelector('#impOk').onclick = async ev => {
    const f = m.querySelector('#impFile').files[0];
    if (!f) return toast('请选择文件', true);
    ev.target.disabled = true;
    try {
      const r = await upload(`/import/${type}`, f);
      m.querySelector('#impResult').innerHTML = `<div class="ai-block" style="background:var(--green-weak);border-color:#bfe8d8"><b style="color:var(--green)">导入完成：</b>成功 ${r.inserted} 条，跳过 ${r.skipped} 条</div>`;
      toast(`导入成功 ${r.inserted} 条`);
      setTimeout(() => { closeModals(); go(currentPage); }, 1200);
    } catch (e) {
      toast(e.message, true); ev.target.disabled = false;
    }
  };
};

/* ================= 设置 ================= */
window.openSettings = async function () {
  const s = await api('/settings');
  const m = openModal(`
    <div class="modal-head"><h3>系统设置</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="form-row"><label>Gemini API Key（用于AI评估与复盘生成）</label><input id="stKey" value="${esc(s.gemini_api_key || '')}"></div>
      <div class="form-row"><label>模型</label><input id="stModel" value="${esc(s.gemini_model || 'gemini-2.0-flash')}"></div>
      <div style="display:flex;gap:8px;margin:8px 0 16px">
        <button class="btn" id="stTest">测试 AI 连通性</button>
        <span id="stTestR" class="hint" style="align-self:center"></span>
      </div>
      <hr style="border:none;border-top:1px solid var(--line);margin:12px 0">
      <div class="form-row"><label>数据管理</label>
        <button class="btn danger" id="stReset">清空全部数据（含演示数据）</button>
        <div class="hint">正式使用前可清空演示数据。此操作不可恢复，请先确认团队内没有需要保留的数据。</div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="stOk">保存</button></div>`);
  m.querySelector('#stOk').onclick = async () => {
    await api('/settings', { method: 'POST', body: { gemini_api_key: m.querySelector('#stKey').value.trim(), gemini_model: m.querySelector('#stModel').value.trim() } });
    closeModals(); toast('设置已保存');
  };
  m.querySelector('#stTest').onclick = async ev => {
    ev.target.disabled = true; m.querySelector('#stTestR').textContent = '测试中…';
    try {
      const r = await api('/settings/test-ai', { method: 'POST', body: {} });
      m.querySelector('#stTestR').textContent = '✓ AI 可用：' + r.reply;
      m.querySelector('#stTestR').style.color = 'var(--green)';
    } catch (e) {
      m.querySelector('#stTestR').textContent = '✕ ' + e.message;
      m.querySelector('#stTestR').style.color = 'var(--red)';
    }
    ev.target.disabled = false;
  };
  m.querySelector('#stReset').onclick = async () => {
    if (!confirm('⚠️ 确定清空全部业务数据？此操作不可恢复！')) return;
    if (!confirm('再次确认：清空后所有任务/热点/机会/案例/创作者/复盘数据都将删除')) return;
    await api('/reset-demo', { method: 'POST', body: {} });
    closeModals(); toast('已清空，可以开始正式使用'); go('today');
  };
};

/* ================= 使用指南 ================= */
pages.guide = async function () {
  const secs = [
    {
      icon: '📋', name: '今日工作', page: 'today',
      what: '每天打开工作台的第一站，相当于你的「早报 + 待办清单」。',
      how: [
        '<b>今日待办</b>：把执行中的事项按紧急程度排好队，照着做就行，不用自己想「今天干嘛」。',
        '<b>今日候选热点</b>：每天自动抓一次抖音热榜 + B站热门（放心，不会反复抓来烦你），点标题可直达原视频。',
        '<b>今日推荐机会</b>：AI 每天分析一次，从热点里挑出「能和《杖剑传说》扯上关系」的，还附上切入角度。AI 挑的不一定全对，但至少帮你过滤掉了明星八卦。'
      ],
      tip: '每天早上花 5 分钟看这页，基本就知道今天该忙什么了。'
    },
    {
      icon: '🎯', name: '营销任务', page: 'campaigns',
      what: '一切工作的「总纲」。所有热点、机会、内容最终都要为当前任务的目标服务。',
      how: [
        '<b>任务卡片</b>：记录每期任务的版本/活动、营销目标、重点内容方向。',
        '<b>内容偏好</b>：设置本期偏好的平台、内容类型、玩法方向——AI 推荐和创作者匹配都会参考这里。',
        '<b>切换当前任务</b>：标记哪个任务是「当前执行中」，全站的分析都会围绕它转。'
      ],
      tip: '任务目标写得越具体，后面 AI 给的建议就越靠谱。写「提升新增」不如写「测试期拉新 + 攻略向内容渗透」。'
    },
    {
      icon: '💡', name: '机会中心', page: 'opportunities',
      what: '热点变成内容的「加工车间」。看到一个好热点，从这里开始把它变成可执行的选题。',
      how: [
        '<b>机会列表</b>：每条机会 = 热点 + 结合角度 + 评分判级（S/A/B），支持筛选和排序。',
        '<b>宣发适配筛查</b>：发布前过一遍风险项（题材敏感、蹭得太硬……），别让内容白做。',
        '<b>创意模板</b>：把验证过的好角度沉淀成模板，下次直接套用。',
        '<b>执行跟踪</b>：机会推进到哪一步（待评估→制作中→已发布→数据回收）一目了然。'
      ],
      tip: '机会不在多，在于「结合角度」想清楚。硬蹭的热点，播放量会诚实地告诉你答案。'
    },
    {
      icon: '📁', name: '案例库', page: 'cases',
      what: '好内容的「博物馆」，也是失败内容的「反思角」。',
      how: [
        '<b>外部案例</b>：收藏别家游戏/别的创作者的优秀内容，标注可借鉴的点。',
        '<b>项目执行结果</b>：自己发过的内容自动归档，播放/互动数据都在。',
        '<b>星级与标签</b>：给案例打星、贴标签，之后找参考「按玩法筛一下」就出来了。'
      ],
      tip: '看到好内容随手存进来，三个月后的你会感谢现在的自己。'
    },
    {
      icon: '👥', name: '创作者库', page: 'creators',
      what: 'KOC 达人的「档案室 + 军师」。谁擅长什么、状态如何、适不适合当前任务，这里都有答案。',
      how: [
        '<b>达人档案</b>：平台、粉丝量、擅长玩法、历史合作记录。',
        '<b>实时分析</b>：点开任意达人，自动汇总 TA 的历史表现（高光作品、低谷作品、趋势信号）。',
        '<b>适配建议</b>：结合当前任务偏好和未关闭的机会，告诉你这位达人现在适合接什么活。'
      ],
      tip: '派活之前先看一眼趋势信号——正在上升期的达人，同样的内容能多跑 30% 的量。'
    },
    {
      icon: '📊', name: '经营分析', page: 'ops',
      what: '周期复盘的「体检报告」。这期内容做得怎么样、比上期强还是弱，数据说了算。',
      how: [
        '<b>核心大盘</b>：播放、互动、激活等核心指标，对比上周期 / 历史平均 / 目标值。',
        '<b>分层分析</b>：按内容类型、玩法、营销目标三个维度拆开看，谁在拉分谁在拖后腿。',
        '<b>周期归档</b>：一期结束点「归档」，数据封存成快照，成为下期对比的基线。'
      ],
      tip: '复盘不是为了追责，是为了下期少走弯路。归档前记得确认数据都回收完了。'
    }
  ];
  const flow = [
    ['① 早上', '打开「今日工作」，看待办 + 扫一眼今日热点和 AI 推荐'],
    ['② 发现机会', '看中的热点 → 采纳进「机会中心」，写清结合角度'],
    ['③ 评估派活', '机会评分判级 → 去「创作者库」找最合适的达人'],
    ['④ 发布跟踪', '在机会中心更新执行阶段，数据回收后自动进「案例库」'],
    ['⑤ 周期结束', '去「经营分析」看体检报告 → 确认归档，开启下一期']
  ];
  el('#main').innerHTML = `
  <div class="page-head">
    <div><h2>使用指南</h2><p class="sub">5 分钟看懂工作台 · 语言尽量说人话</p></div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <h3>🧭 这个工作台是干什么的？</h3>
    <p class="guide-intro">一句话：帮 KOC 运营把「追热点」这件玄学，变成一条看得见的流水线——
    <b>发现热点 → 变成机会 → 派给合适的达人 → 跟踪执行 → 复盘沉淀</b>。
    你负责判断，它负责记账、提醒和跑腿（包括让 AI 替你先筛一遍热点）。</p>
    <div class="guide-flow">
      ${flow.map(f => `<div class="gf-step"><div class="gf-t">${f[0]}</div><div class="gf-d">${f[1]}</div></div>`).join('<div class="gf-arrow">→</div>')}
    </div>
  </div>
  <div class="section-title">六大板块速览</div>
  <div class="guide-grid">
    ${secs.map(s => `
    <div class="card guide-card">
      <h3>${s.icon} ${s.name} <span class="link-btn" style="font-size:12px;font-weight:400" onclick="go('${s.page}')">去看看 →</span></h3>
      <p class="guide-what">${s.what}</p>
      <ul class="guide-list">${s.how.map(h => `<li>${h}</li>`).join('')}</ul>
      <div class="guide-tip">💡 ${s.tip}</div>
    </div>`).join('')}
  </div>
  <div class="card" style="margin-top:16px">
    <h3>❓ 三个常见问题</h3>
    <ul class="guide-list">
      <li><b>热点多久更新一次？</b> 每天自动抓取并分析一次，不会反复消耗。真有急事可以在「今日工作」手动点「重新抓取今日」。</li>
      <li><b>AI 推荐可信吗？</b> 当参谋可以，当司令不行。它负责把 50 条热点筛到 8 条，最后拍板的还是你。</li>
      <li><b>数据会丢吗？</b> 所有数据都存在本地数据库里，周期归档后的快照也会永久保留。当然，别手滑点「清空全部数据」。</li>
    </ul>
  </div>`;
};

/* ================= 游戏快讯 ================= */
let gameNewsData = { items: [] };

pages.gamenews = async function () {
  main.innerHTML = '<div class="empty">加载中…</div>';
  const html = `
  <div class="page-head">
    <div><h2>游戏快讯</h2><div class="sub">真实游戏行业资讯播报站 · 每日洞察一次，新内容自动置顶 · 点击条目看详情与原文</div></div>
    <div class="head-actions"><button class="btn small" id="gnRefresh">重新抓取今日</button></div>
  </div>
  <div class="news-wrap">
    <div class="news-list" id="gnList"><div class="loading">加载中…</div></div>
  </div>`;
  main.innerHTML = html;
  const btn = document.getElementById('gnRefresh');
  btn.onclick = refreshGameNews;
  await loadGameNews();
};

async function loadGameNews() {
  const list = document.getElementById('gnList');
  try {
    const r = await api('/game-news');
    gameNewsData.items = r.items || [];
    renderGameNewsList();
  } catch (e) {
    list.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

function catClass(c) { return ({ '公测': 'beta', '联动': 'link', '成绩': 'score', '其他': 'etc' })[c] || 'etc'; }

function renderGameNewsList() {
  const list = document.getElementById('gnList');
  const items = gameNewsData.items || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">暂无快讯。点右上角「重新抓取今日」拉取真实游戏资讯。</div>`;
    return;
  }
  list.innerHTML = items.map(n => `
    <div class="news-card" onclick="openGameNews(${n.id})">
      <div class="news-top">
        <span class="news-cat cat-${catClass(n.category)}">${esc(n.category || '其他')}</span>
        ${n.isNew ? '<span class="new-badge">NEW</span>' : ''}
        <span class="news-src">${esc(n.source || '')}</span>
        <span class="news-date">${esc(n.pub_date || n.batch_date || '')}</span>
      </div>
      <div class="news-title">${esc(n.title)}</div>
      <div class="news-sum">${esc((n.summary || '（无摘要）').slice(0, 80))}</div>
    </div>`).join('');
}

async function refreshGameNews() {
  const btn = document.getElementById('gnRefresh');
  btn.disabled = true; btn.textContent = '抓取中…';
  try {
    const r = await api('/game-news/refresh', { method: 'POST', body: {} });
    toast(`已抓取，今日新增 ${r.addedToday} 条`);
    await loadGameNews();
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = '重新抓取今日'; }
}

window.openGameNews = function (id) {
  const n = (gameNewsData.items || []).find(x => x.id === id);
  if (!n) return;
  openModal(`
    <div class="modal-head"><h3>游戏快讯</h3><span class="x" onclick="closeModals()">✕</span></div>
    <div class="modal-body">
      <div class="gn-detail-cat"><span class="news-cat cat-${catClass(n.category)}">${esc(n.category || '其他')}</span>${n.isNew ? '<span class="new-badge">NEW</span>' : ''}</div>
      <h4 class="gn-detail-title">${esc(n.title)}</h4>
      <div class="gn-detail-meta">来源：${esc(n.source || '—')} ｜ 发布：${esc(n.pub_date || n.batch_date || '—')} ｜ 入库：${esc(n.batch_date || '—')}</div>
      <p class="gn-detail-sum">${esc(n.summary || '（无摘要）')}</p>
      <a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">查看原文 ↗</a>
    </div>`, true);
};

/* ================= 启动 ================= */
window.go = go;
refreshUserChip();
if (!getUser()) askUsername(true);
go('today');
