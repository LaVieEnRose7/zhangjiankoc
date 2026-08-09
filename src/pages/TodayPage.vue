<template>
  <div>
    <div class="page-head">
      <div class="page-head-left">
        <h2>今日冒险板</h2>
        <div class="sub">{{ today }} · 热点线索、机会任务与执行待办</div>
      </div>
      <div class="page-head-actions">
        <n-button size="small" secondary :loading="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button size="small" secondary @click="openHotspotForm">+ 录入热点</n-button>
        <n-button size="small" secondary @click="openTodoForm">+ 添加待办</n-button>
      </div>
    </div>

    <div v-if="loading" class="loading-card"><span>正在同步今日工作数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="load">重试</n-button>
    </div>

    <div class="workbench-hero">
      <div class="workbench-primary">
        <div class="hero-label">坎斯汀今日任务</div>
        <h3>{{ priorityHeadline }}</h3>
        <p>{{ prioritySubline }}</p>
        <div class="hero-actions">
          <n-button type="primary" @click="goPage('opportunities')">推进机会任务</n-button>
          <n-button secondary @click="goPage('ops')">查看内容运营分析</n-button>
        </div>
      </div>
      <div class="workbench-queue">
        <n-button text class="queue-item" @click="scrollTo('must')">
          <b>{{ expiring.length }}</b>
          <span>临期机会</span>
        </n-button>
        <n-button text class="queue-item" @click="scrollTo('recommend')">
          <b>{{ recos.length }}</b>
          <span>推荐机会</span>
        </n-button>
        <n-button text class="queue-item" @click="scrollTo('todos')">
          <b>{{ todoCount }}</b>
          <span>待办事项</span>
        </n-button>
      </div>
    </div>

    <!-- 营销任务摘要 -->
    <div v-if="summary" class="card card-highlight" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 24px;background:var(--brand);color:var(--brand-text)">
        <div>
          <div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px">
            {{ summary.game_name }}
            <span class="tag" style="color:var(--brand-text);background:rgba(255,255,255,.12)">{{ summary.priority }}优先级</span>
          </div>
          <div style="font-size:20px;font-weight:700;margin:8px 0 4px">{{ summary.name }}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.55)">当前版本/活动：{{ summary.version_event || '—' }}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <n-button size="small" quaternary style="color:#fff" @click="goPage('campaigns')">查看任务</n-button>
          <n-button size="small" secondary style="color:#fff" @click="openAdjustFocus">调整重点</n-button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border)">
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">本期传播目标</div><div style="font-size:14px;font-weight:500">{{ summary.goal || '—' }}</div></div>
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">当前重点角色/内容</div><div style="font-size:14px;font-weight:500">{{ summary.focus_content || '—' }}</div></div>
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">营销周期</div><div style="font-size:14px;font-weight:500">{{ summary.cycle_start || '—' }} ~ {{ summary.cycle_end || '—' }}</div></div>
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">剩余执行时间</div><div :style="{fontSize:'14px',fontWeight:700,color: summary.remain_days < 7 ? 'var(--red)' : 'inherit'}">{{ summary.remain_days != null ? summary.remain_days + ' 天' : '—' }}</div></div>
      </div>
    </div>

    <!-- Section: AI 推荐机会 -->
    <div id="recommend" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--purple);border-radius:2px"></span>
        AI 推荐机会
      </h3>
    </div>
    <div v-if="recos.length">
      <div v-for="(r, i) in recos" :key="i" class="card" style="padding:var(--sp-5)">
        <div style="display:flex;align-items:flex-start;gap:14px">
          <div :style="{width:'52px',height:'52px',borderRadius:'50%',background:scoreColor(r.score),display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:'16px',flexShrink:0}">
            {{ r.score }}<span style="font-size:9px;font-weight:400">{{ r.verdict }}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:15px;margin-bottom:4px;cursor:pointer" @click="openRealLink(r.url)">{{ r.title }}</div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
              <StatusTag :text="r.source" />
              <span v-if="r.heat" style="font-size:12px;color:var(--ink-faint)">&#x1F525; {{ fmt(r.heat) }}</span>
            </div>
            <div style="font-size:13px;color:var(--ink-dim);line-height:1.6"><b style="color:var(--ink)">结合角度：</b>{{ r.angle || '—' }}</div>
            <div style="font-size:13px;color:var(--ink-dim);line-height:1.6;margin-bottom:8px"><b style="color:var(--ink)">推荐理由：</b>{{ r.reason || '—' }}</div>
            <div style="display:flex;gap:8px">
              <n-button size="small" type="primary" @click="genCreative(i)">生成创意内容</n-button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <EmptyState v-else icon="sparkles">暂无可结合的热点（AI 今日分析无结果，或热点源不可用）</EmptyState>

    <!-- Section: 今日候选热点 -->
    <div id="hotspots" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--orange);border-radius:2px"></span>
        今日候选热点
      </h3>
    </div>
    <div v-if="hotspots.length" class="card-grid card-grid-2">
      <div v-for="h in hotspots" :key="h.id" class="card" style="padding:var(--sp-4) var(--sp-5)">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <StatusTag :text="h.source_label || h.source || h.platform || 'B站'" />
          <StatusTag v-if="h.screen_result" :text="h.screen_result" />
          <StatusTag v-if="h.relevance" :text="'相关性' + h.relevance" />
          <span v-if="h.rank" style="font-size:12px;color:var(--ink-faint)">#{{ h.rank }}</span>
          <span v-if="h.heat" style="font-size:12px;color:var(--ink-faint)">&#x1F525; {{ fmt(h.heat) }}</span>
        </div>
        <div class="hotspot-title-link" @click="openRealLink(h.url)">{{ h.title }}</div>
        <div style="font-size:12px;color:var(--ink-faint);margin-bottom:8px">
          {{ h.valid_until ? '有效期至 ' + h.valid_until : (h.up ? 'UP ' + h.up : '') }}
        </div>
        <div v-if="h.screen_reason || h.risk_note" style="font-size:12px;color:var(--ink-dim);line-height:1.6;margin-bottom:8px">
          {{ h.screen_reason || h.risk_note }}
        </div>
        <img v-if="h.pic" :src="h.pic" style="width:100%;max-height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;background:var(--gray-100)" @error="e => e.target.style.display='none'" />
        <n-button size="small" secondary :disabled="h.screen_result === '不符合'" @click="toOpportunity(h)">生成机会</n-button>
      </div>
    </div>
    <EmptyState v-else icon="trending">今日热点获取失败，请检查网络或 API 配置</EmptyState>

    <!-- Section: 即将过期 -->
    <div id="must" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--red);border-radius:2px"></span>
        即将过期 / 需处理
      </h3>
    </div>
    <div v-if="expiring.length" class="card" style="padding:0;overflow:hidden">
      <div v-for="e in expiring" :key="e.kind + '-' + e.id" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--gray-100);transition:background .15s" @mouseenter="h => h.currentTarget.style.background='var(--gray-50)'" @mouseleave="h => h.currentTarget.style.background=''">
        <span :class="['urgency-badge', e.urgency]">{{ urgencyLabel(e.urgency) }}</span>
        <span class="hotspot-title-link" style="flex:1" @click="openExpiring(e)">{{ e.title }}</span>
        <span style="font-size:12px;color:var(--ink-faint)">{{ e.deadline }} · {{ e.note }}</span>
      </div>
    </div>
    <EmptyState v-else icon="check">没有即将过期的机会</EmptyState>

    <!-- Section: 执行待办 -->
    <div id="todos" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--ink);border-radius:2px"></span>
        执行待办
      </h3>
      <span style="font-size:13px;color:var(--ink-faint)">{{ todoCount }} 项</span>
    </div>
    <div v-if="todoCount" class="card-grid card-grid-2">
      <div v-for="(arr, k) in todos" :key="k">
        <div v-if="arr.length" class="card" style="padding:var(--sp-4)">
          <div style="font-weight:600;font-size:13px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            {{ k }} <span class="tag gray">{{ arr.length }}</span>
          </div>
          <div v-for="t in arr.slice(0, 6)" :key="t.id" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--gray-100);font-size:13px;cursor:pointer" @click="handleTodoClick(t)">
            <span style="flex:1;font-weight:500">{{ t.title }}</span>
            <StatusTag :text="t.sub" v-if="t.sub" />
            <span v-if="t.due" style="font-size:11px;color:var(--ink-faint)">截止 {{ t.due }}</span>
          </div>
        </div>
      </div>
    </div>
    <EmptyState v-else icon="clipboard">暂无待办</EmptyState>

    <Modal :show="showCreative" @close="showCreative = false" wide>
      <template #head><h3>创意内容生成</h3></template>
      <div v-if="creativeR" style="margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">{{ creativeR.title }}</div>
        <div style="font-size:12px;color:var(--ink-faint)">{{ creativeR.angle || creativeR.reason || '—' }}</div>
      </div>
      <n-input v-model:value="creativeText" type="textarea" :autosize="{ minRows: 10 }" />
      <template #foot>
        <n-button secondary :disabled="!canCopyCreative" @click="copyCreative">复制内容</n-button>
        <n-button secondary :loading="creativeLoading" :disabled="!creativeR" @click="regenCreative">{{ creativeLoading ? '生成中...' : '重新生成' }}</n-button>
        <n-button secondary @click="showCreative = false">关闭</n-button>
        <n-button type="primary" :loading="savingCreative" @click="createOpportunityFromCreative">{{ savingCreative ? '创建中...' : '进入机会中心' }}</n-button>
      </template>
    </Modal>

    <Modal :show="showFocus" @close="showFocus = false" wide>
      <template #head><h3>调整当前营销重点</h3></template>
      <div class="form-row"><label>当前版本/活动</label><n-input v-model:value="focusVer" /></div>
      <div class="form-row"><label>重点角色/内容</label><n-input v-model:value="focusContent" type="textarea" /></div>
      <template #foot><n-button type="primary" :loading="savingFocus" @click="saveFocus">{{ savingFocus ? '保存中...' : '保存' }}</n-button></template>
    </Modal>

    <Modal :show="showHotspotForm" @close="showHotspotForm = false" wide>
      <template #head><h3>录入候选热点</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>热点标题 *</label><n-input v-model:value="hsTitle" /></div>
        <div class="form-row"><label>来源</label><n-input v-model:value="hsSource" /></div>
        <div class="form-row"><label>平台</label><n-select v-model:value="hsPlatform" :options="platformOptions" /></div>
        <div class="form-row"><label>分类</label><n-select v-model:value="hsCategory" :options="categoryOptions" /></div>
        <div class="form-row"><label>热度</label><n-input-number v-model:value="hsHeat" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>趋势</label><n-select v-model:value="hsTrend" :options="trendOptions" /></div>
        <div class="form-row"><label>有效期</label><n-input v-model:value="hsValid" type="date" /></div>
        <div class="form-row full"><label>链接</label><n-input v-model:value="hsUrl" /></div>
        <div class="form-row full"><label>标签</label><n-input v-model:value="hsTags" placeholder="逗号分隔" /></div>
        <div class="form-row full"><label>描述</label><n-input v-model:value="hsDesc" type="textarea" /></div>
        <div class="form-row full"><label>风险提示</label><n-input v-model:value="hsRisk" /></div>
      </div>
      <template #foot><n-button type="primary" :loading="savingHotspot" @click="saveHotspot">{{ savingHotspot ? '保存中...' : '保存热点' }}</n-button></template>
    </Modal>

    <Modal :show="showTodoForm" @close="showTodoForm = false">
      <template #head><h3>添加待办</h3></template>
      <div class="form-row"><label>待办内容 *</label><n-input v-model:value="tdTitle" /></div>
      <div class="form-row"><label>负责人</label><n-input v-model:value="tdAss" /></div>
      <div class="form-row"><label>截止日期</label><n-input v-model:value="tdDue" type="date" /></div>
      <template #foot><n-button type="primary" :loading="savingTodo" @click="saveTodo">{{ savingTodo ? '添加中...' : '添加' }}</n-button></template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { apiGet, apiPost, apiPut } from '../utils/api.js'
import { appState, showToast, goPage } from '../stores/app.js'
import { fmt, scoreColor, getToday } from '../utils/helpers.js'
import Modal from '../components/Modal.vue'
import StatusTag from '../components/StatusTag.vue'
import EmptyState from '../components/EmptyState.vue'

const today = getToday()
const user = computed(() => appState.user)
const summary = ref(null)
const hotspots = ref([])
const recos = ref([])
const expiring = ref([])
const todos = ref({})
const loading = ref(false)
const error = ref('')
const savingCreative = ref(false)
const creativeLoading = ref(false)
const savingFocus = ref(false)
const savingHotspot = ref(false)
const savingTodo = ref(false)
const todoCount = computed(() => Object.values(todos.value).flat().length)
const priorityHeadline = computed(() => {
  if (expiring.value.length) return `先处理 ${expiring.value.length} 个临期机会`
  if (recos.value.length) return `从 ${recos.value.length} 个推荐机会里挑选`
  if (todoCount.value) return `完成 ${todoCount.value} 个执行待办`
  return '今天没有紧急事项'
})
const prioritySubline = computed(() => {
  if (summary.value?.name) return `当前任务：${summary.value.name}`
  return '先建立当前营销任务，再让热点、机会和复盘围绕同一个目标运转。'
})

const showCreative = ref(false)
const creativeR = ref(null), creativeText = ref('生成中…')
const __gc = ref({ r: null, creative: '' })
const canCopyCreative = computed(() => creativeText.value && !creativeText.value.startsWith('生成中'))
const showFocus = ref(false), focusVer = ref(''), focusContent = ref('')
const showHotspotForm = ref(false), showTodoForm = ref(false)

const hsTitle = ref(''), hsSource = ref('B站热门内容'), hsPlatform = ref('B站')
const hsCategory = ref('游戏内'), hsHeat = ref(60), hsTrend = ref('上升')
const hsValid = ref(''), hsUrl = ref(''), hsTags = ref(''), hsDesc = ref(''), hsRisk = ref('')

const tdTitle = ref(''), tdAss = ref(user.value), tdDue = ref('')
const platformOptions = ['B站', '抖音', '微博', '小红书', '其他'].map(v => ({ label: v, value: v }))
const categoryOptions = ['游戏内', '泛游戏', '泛娱乐', '社会热点'].map(v => ({ label: v, value: v }))
const trendOptions = ['上升', '平稳', '下降'].map(v => ({ label: v, value: v }))

function urgencyLabel(u) {
  return { missed: '已错过', today: '今天确认', '24h': '24h内' }[u] || ''
}

function handleTodoClick(t) { t.ref === 'opportunity' ? goPage('opportunities') : t.ref === 'review' ? goPage('ops') : goPage('opportunities') }
function openRealLink(url) {
  if (!url) return showToast('该热点暂无有效来源链接', true)
  window.open(url, '_blank', 'noopener,noreferrer')
}
function isDirectContentLink(item) {
  const url = String(item?.url || '')
  return /bilibili\.com\/video\//i.test(url) || /douyin\.com\/(video|note)\//i.test(url)
}
function openExpiring(item) {
  if (item.url) return openRealLink(item.url)
  if (item.kind === 'opportunity') return openOppDrawer(item.id)
  showToast('该热点暂无有效来源链接', true)
}
function scrollTo(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

async function load() {
  loading.value = true
  error.value = ''
  const errors = []
  try {
    const d = await apiGet('/today')
    summary.value = d.campaignSummary || null
    appState.activeCampId = summary.value?.id || null
    expiring.value = d.expiring || []
    todos.value = d.execTodos || {}
  } catch (e) { errors.push(`今日概览：${e.message}`) }
  try {
    const live = (await apiGet('/today/hotspots?limit=100')).list || []
    // 热词搜索页不冒充发布内容，只展示能直达具体视频/作品的热点。
    hotspots.value = live.filter(isDirectContentLink).slice(0, 40)
  } catch (e) { errors.push(`今日热点：${e.message}`) }
  try { recos.value = (await apiGet('/today/recommendations?limit=8')).list || [] } catch (e) { errors.push(`推荐：${e.message}`) }
  if (errors.length) {
    error.value = errors.join('；')
    showToast(error.value, true)
  }
  loading.value = false
}

async function genCreative(idx) {
  const r = recos.value[idx]; if (!r) return showToast('未找到推荐机会', true)
  creativeR.value = r; creativeText.value = '生成中…'; showCreative.value = true
  await requestCreative(r)
}

async function regenCreative() {
  if (!creativeR.value) return showToast('缺少推荐机会内容', true)
  creativeText.value = '生成中…'
  await requestCreative(creativeR.value)
}

async function requestCreative(r) {
  creativeLoading.value = true
  try {
    const resp = await apiPost('/today/recommendations/creative', {
      title: r.title,
      angle: r.angle,
      reason: r.reason,
      user: user.value
    }, { timeout: 180000 })
    creativeText.value = resp.text || ''; __gc.value = { r, creative: creativeText.value }
    showToast(resp.ok === false ? 'AI 不稳定，已生成规则兜底版本' : '创意内容已生成', resp.ok === false)
  } catch (e) {
    creativeText.value = `生成失败：${e.message}\n\n你可以点击“重新生成”，或先进入机会中心后再补充结论。`
  } finally {
    creativeLoading.value = false
  }
}

async function copyCreative() {
  if (!canCopyCreative.value) return
  try {
    await navigator.clipboard.writeText(creativeText.value)
    showToast('已复制创意内容')
  } catch (e) {
    showToast('复制失败，请手动选中文本复制', true)
  }
}

async function openAdjustFocus() {
  const c = await apiGet(`/campaigns/${summary.value.id}`)
  focusVer.value = c.version_event || ''; focusContent.value = c.focus_content || ''; showFocus.value = true
}
async function saveFocus() {
  savingFocus.value = true
  try {
  await apiPut(`/campaigns/${summary.value.id}`, { version_event: focusVer.value, focus_content: focusContent.value })
  showFocus.value = false; showToast('重点已更新'); load()
  } catch (e) { showToast(e.message, true) }
  finally { savingFocus.value = false }
}
async function toOpportunity(h) {
  try {
    let hid = h.id
    // 每日真实热点来自抓取快照，先保存为候选热点，再沿用现有采纳流程。
    if (typeof hid !== 'number') {
      const saved = await apiPost('/hotspots', {
        title: h.title, source_label: h.source, platform: h.source,
        category: '泛娱乐', heat: Number(h.heat) || 0, trend: '上升',
        url: h.url, description: h.up ? `发布者：${h.up}` : '',
        source: '每日真实热点', status: '候选', created_by: user.value
      })
      hid = saved.id
    }
    const r = await apiPost(`/hotspots/${hid}/adopt`, { campaign_id: appState.activeCampId, user: user.value })
    appState.pendingOpportunityId = r.id
    goPage('opportunities')
    showToast('已采纳为正式机会')
  } catch (e) { showToast(e.message, true) }
}

async function createOpportunityFromCreative() {
  const payload = __gc.value || {}
  const r = payload.r
  if (!r) return showToast('缺少推荐机会内容', true)
  savingCreative.value = true
  try {
    const resp = await apiPost('/opportunities', {
      title: r.title,
      campaign_id: appState.activeCampId,
      status: '待判断',
      direction: r.angle || '',
      basis: JSON.stringify({ reason: r.reason || '', source: r.source || '', creative: payload.creative || creativeText.value }),
      created_by: user.value
    })
    showCreative.value = false
    appState.pendingOpportunityId = resp.id
    goPage('opportunities')
    showToast('已创建机会')
  } catch (e) { showToast(e.message, true) }
  finally { savingCreative.value = false }
}

function openOppDrawer(id) { appState.pendingOpportunityId = id; goPage('opportunities') }
function openHotspotForm() { showHotspotForm.value = true }
function openTodoForm() { showTodoForm.value = true }

async function saveHotspot() {
  const title = hsTitle.value.trim(); if (!title) return showToast('请输入标题', true)
  savingHotspot.value = true
  try {
  await apiPost('/hotspots', {
    title, source_label: hsSource.value, platform: hsPlatform.value, category: hsCategory.value,
    heat: +hsHeat.value || 0, trend: hsTrend.value, valid_until: hsValid.value,
    url: hsUrl.value, tags: hsTags.value, description: hsDesc.value, risk_note: hsRisk.value,
    source: '手动录入', created_by: user.value
  })
  hsTitle.value = ''; hsUrl.value = ''; hsTags.value = ''; hsDesc.value = ''; hsRisk.value = ''
  showHotspotForm.value = false; showToast('已录入'); load()
  } catch (e) { showToast(e.message, true) }
  finally { savingHotspot.value = false }
}
async function saveTodo() {
  const title = tdTitle.value.trim(); if (!title) return showToast('请输入内容', true)
  savingTodo.value = true
  try {
  await apiPost('/todos', { title, assignee: tdAss.value, due_date: tdDue.value, created_by: user.value })
  tdTitle.value = ''; tdDue.value = ''
  showTodoForm.value = false; showToast('已添加'); load()
  } catch (e) { showToast(e.message, true) }
  finally { savingTodo.value = false }
}

onMounted(load)
</script>

<style scoped>
.hotspot-title-link {
  font-weight: 600;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
  cursor: pointer;
  text-decoration: none;
}
.hotspot-title-link:hover {
  color: var(--brand);
  text-decoration: underline;
}
</style>
