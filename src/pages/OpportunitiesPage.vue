<template>
  <div>
    <div class="page-head">
      <div>
        <h2>机会委托板</h2>
        <div class="sub">线索判断 → 内容方向 → 创作者匹配 → 执行验证 → 模板沉淀</div>
      </div>
      <div class="head-actions">
        <n-button secondary :loading="loading" @click="loadData">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button type="primary" @click="openOppForm">＋ 手动创建机会</n-button>
      </div>
    </div>

    <div v-if="loading" class="loading-card"><span>正在加载机会数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="loadData">重试</n-button>
    </div>

    <!-- 子导航 -->
    <n-tabs v-model:value="tab" type="segment" animated class="page-tabs">
      <n-tab-pane name="current" :tab="`当前机会 ${counts.current}`" />
      <n-tab-pane name="history" :tab="`历史机会 ${counts.history}`" />
      <n-tab-pane name="generate" tab="机会生成" />
      <n-tab-pane name="templates" tab="创意模板库" />
    </n-tabs>

    <!-- 筛选条（current/history tab）-->
    <div v-if="tab === 'current' || tab === 'history'" class="filter-bar wrap">
      <n-select v-model:value="filters.status" :options="statusFilterOptions" />
      <n-select v-model:value="filters.platform" :options="platformFilterOptions" placeholder="平台-全部" clearable />
      <n-select v-model:value="filters.risk" :options="riskOptions" placeholder="风险-全部" clearable />
      <n-select v-model:value="filters.due" :options="dueOptions" placeholder="时效-全部" clearable />
      <n-input class="q" v-model:value="filters.q" placeholder="搜索：热点/玩法/标题" clearable />
      <n-button size="small" secondary @click="filters = { status: '全部', platform: '', risk: '', due: '', q: '' }">重置</n-button>
    </div>

    <!-- 当前机会看板 -->
    <div v-if="!error && tab === 'current'" class="kanban-board">
      <div v-for="col in kanbanColumns" :key="col.status" class="kanban-col">
        <div class="kanban-head">
          <b>{{ col.status }}</b>
          <span>{{ col.items.length }}</span>
        </div>
        <div v-if="col.items.length" class="kanban-list">
          <button v-for="o in col.items" :key="o.id" type="button" class="opp-card" @click="openDrawer(o.id)">
            <span class="opp-title">{{ o.title }}</span>
            <span class="opp-meta">{{ o.campaign_name || '未关联任务' }}</span>
            <span class="opp-tags">
              <StatusTag :text="o.platform || '平台待定'" />
              <span v-if="o.deadline" class="tag orange">截止 {{ o.deadline }}</span>
              <span v-if="o.ai_score != null" class="tag purple">AI {{ o.ai_score }}</span>
              <span v-else-if="o.rule_score != null" class="tag gray">规则 {{ o.rule_score }}</span>
            </span>
            <span v-if="o.direction || o.play_method" class="opp-desc">{{ o.play_method || o.direction }}</span>
          </button>
        </div>
        <EmptyState v-else icon="check">暂无{{ col.status }}机会</EmptyState>
      </div>
    </div>

    <!-- 历史机会表格 -->
    <n-data-table v-if="!error && tab === 'history'" class="data-table-card" :columns="historyColumns" :data="filteredList" :bordered="false" :single-line="false" />

    <!-- 机会生成 tab -->
    <div class="card" v-if="tab === 'generate'">
      <div class="sec-title">从候选热点生成机会</div>
      <div class="hint">选择今日候选热点，系统会创建机会并自动生成完整方案。</div>
      <div v-if="candHotspots.length" class="tmpl-list">
        <div v-for="h in candHotspots" :key="h.id" class="tmpl-card">
          <div class="t">{{ h.title }}</div>
          <div class="meta">
            <StatusTag :text="h.platform" />
            <StatusTag :text="h.trend || '—'" />
            <span class="tag gray">热度 {{ h.heat || '—' }}</span>
          </div>
          <div class="acts"><n-button size="small" type="primary" @click="toOpportunity(h.id)">生成机会</n-button></div>
        </div>
      </div>
      <EmptyState v-else>当前没有可生成的候选热点</EmptyState>

      <div class="sec-title" style="margin-top:16px">根据当前营销任务主动生成机会</div>
      <div class="hint">系统综合创意模板库 + 当前任务目标 + 历史案例 + 创作者能力生成候选机会。</div>
      <n-button type="primary" :loading="genLoading" @click="generateCandidates">
        {{ genLoading ? '生成中…' : '🤖 生成候选机会' }}
      </n-button>
      <div v-if="genCands.length" style="margin-top:12px">
        <div v-for="(c, i) in genCands" :key="i" class="tmpl-card">
          <div class="t">{{ c.title }}</div>
          <div class="meta">
            <StatusTag :text="c.platform" />
            <StatusTag :text="c.node || '—'" />
            <StatusTag :text="'风险' + (riskLevel(c))" />
          </div>
          <div class="line"><b>玩法：</b>{{ c.play_method }}</div>
          <div class="line"><b>方向：</b>{{ c.direction }}</div>
          <div class="line"><b>依据：</b>{{ (c.basis?.version_fit || '') }} | {{ (c.basis?.cases || '') }}</div>
          <div class="acts"><n-button size="small" type="primary" @click="adoptCandidate(i)">采纳为机会</n-button></div>
        </div>
      </div>
    </div>

    <!-- 创意模板 tab -->
    <div v-if="tab === 'templates'">
      <div class="page-head" style="border-bottom:none;margin-bottom:0;padding-bottom:0">
        <div></div>
        <div class="head-actions"><n-button type="primary" @click="openTemplateForm()">＋ 新建模板</n-button></div>
      </div>
      <div class="card">
        <div v-if="templates.length" class="tmpl-list">
          <div v-for="t in templates" :key="t.id" class="tmpl-card">
            <div class="t">{{ t.name }} <span class="tag gray">使用 {{ t.usage_count || 0 }} 次</span></div>
            <div class="meta">
              <StatusTag :text="t.applicable_hotspot || '—'" />
              <StatusTag :text="t.creator_type || '—'" />
            </div>
            <div class="line"><b>核心逻辑：</b>{{ t.core_logic || '—' }}</div>
            <div class="line"><b>历史案例：</b>{{ t.cases || '—' }}</div>
            <div class="line"><b>验证结果：</b>{{ t.validation || '—' }}</div>
            <div class="acts">
              <n-button size="small" secondary @click="openTemplateForm(t)">编辑</n-button>
              <n-button size="small" type="error" secondary @click="deleteTemplate(t.id)">删除</n-button>
            </div>
          </div>
        </div>
        <EmptyState v-else>还没有创意模板。可在机会详情中点「沉淀为创意模板」。</EmptyState>
      </div>
    </div>

    <!-- 机会详情抽屉 -->
    <template v-if="drawerVisible">
      <div class="drawer-mask" @click="closeDrawer"></div>
      <div class="drawer">
        <div class="drawer-head">
          <div>
            <div style="font-size:16px;font-weight:700">{{ drawer?.title }}</div>
            <div style="margin-top:6px">
              <StatusTag :text="drawer?.status" />
              <span v-if="drawer?.assignee" class="tag gray">跟进:{{ drawer.assignee }}</span>
              <span v-if="drawer?.deadline" class="tag orange">截止 {{ drawer.deadline }}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <n-button size="small" secondary @click="depositCase">💾 沉淀为案例</n-button>
            <span class="x" @click="closeDrawer">&times;</span>
          </div>
        </div>
        <div class="drawer-body">
          <!-- 流程步骤 -->
          <div v-if="!isTerminal" class="flow">
            <template v-for="(s, i) in OPP_FLOW" :key="s">
              <div :class="['step', i < flowIdx ? 'done' : i === flowIdx ? 'cur' : '']">
                <span class="dot">{{ i < flowIdx ? '✓' : i + 1 }}</span>{{ s }}
              </div>
              <span v-if="i < OPP_FLOW.length - 1" class="arrow">&rarr;</span>
            </template>
          </div>

          <!-- ① 机会判断 -->
          <div class="sec-title">① 机会判断
            <span><n-button size="small" type="primary" :loading="evalLoading" @click="evalOpp">{{ evalLoading ? '分析并填充中…' : 'AI 评估并填充' }}</n-button></span>
          </div>
          <div v-if="drawer?.ai_analysis" class="ai-block">
            <div class="hd">AI 评估 · {{ drawer.ai_score }}分</div>{{ drawer.ai_analysis }}
          </div>
          <div v-if="drawer?.rule_score != null" class="rule-block"><b>规则评分 {{ drawer.rule_score }} 分</b></div>
          <div v-if="!drawer?.ai_analysis && drawer?.rule_score == null" class="hint">尚未评估</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <n-button v-if="drawer?.status === '待判断'" size="small" type="success" secondary @click="setStatus('已采纳')">✓ 值得做（已采纳）</n-button>
            <n-button v-if="drawer?.status === '待判断'" size="small" type="error" secondary @click="setStatus('不采用')">✕ 不采用</n-button>
          </div>

          <!-- ② 机会结论 -->
          <div class="sec-title">② 机会结论
            <span class="sec-actions">
              <n-button size="small" secondary :loading="planLoading" @click="generateOpportunityPlan">{{ planLoading ? '生成中…' : 'AI 填充结论' }}</n-button>
              <n-button size="small" type="primary" @click="saveOpportunityDetail">保存结论</n-button>
            </span>
          </div>
          <div class="grid2">
            <div class="fld"><label>机会名称</label><n-input v-model:value="drawer.title" /></div>
            <div class="fld"><label>对应热点/节点</label><n-input v-model:value="drawer.hotspot_title" /></div>
            <div class="fld"><label>推荐玩法</label><n-input v-model:value="drawer.play_method" /></div>
            <div class="fld"><label>结合方式</label><n-input v-model:value="drawer.game_combo" /></div>
            <div class="fld"><label>适合平台</label><n-input v-model:value="drawer.platform" /></div>
            <div class="fld"><label>建议时效</label><n-input v-model:value="drawer.suggested_time" /></div>
            <div class="fld"><label>预估成本</label><n-input-number v-model:value="drawer.cost" :min="0" style="width:100%" /></div>
            <div class="fld"><label>风险等级</label><n-select v-model:value="drawer.risk_level" :options="riskOptions" /></div>
            <div class="fld full"><label>一句话内容方向</label><n-input v-model:value="drawer.direction" type="textarea" :autosize="{ minRows: 2 }" /></div>
            <div class="fld full"><label>风险备注</label><n-input v-model:value="drawer.risk_note" type="textarea" :autosize="{ minRows: 2 }" /></div>
          </div>

          <div class="sec-title">③ 执行记录</div>
          <n-data-table v-if="executions.length" class="data-table-card inner" style="margin-bottom:14px" :columns="executionColumns" :data="executions" :bordered="false" :single-line="false" :pagination="false" />
          <div class="card card-flat" style="padding:0;margin-bottom:14px">
            <div class="form-grid">
              <div class="form-row"><label>创作者</label><n-input v-model:value="execForm.creator_name" /></div>
              <div class="form-row"><label>阶段</label><n-select v-model:value="execForm.stage" :options="stageOptions" /></div>
              <div class="form-row"><label>计划日期</label><n-date-picker v-model:value="execPlannedDateValue" type="date" clearable @update:value="setExecDate('planned_date', $event)" /></div>
              <div class="form-row"><label>发布日期</label><n-date-picker v-model:value="execPublishDateValue" type="date" clearable @update:value="setExecDate('publish_date', $event)" /></div>
              <div class="form-row full"><label>发布链接</label><n-input v-model:value="execForm.publish_url" /></div>
              <div class="form-row"><label>播放量</label><n-input-number v-model:value="execForm.play_count" :min="0" style="width:100%" /></div>
              <div class="form-row"><label>ROI7</label><n-input-number v-model:value="execForm.roi_d7" :step="0.01" style="width:100%" /></div>
              <div class="form-row full"><label>备注</label><n-input v-model:value="execForm.note" type="textarea" /></div>
            </div>
            <n-button type="primary" :loading="execSaving" @click="addExecution">{{ execSaving ? '添加中…' : '添加执行记录' }}</n-button>
          </div>

          <div class="sec-title">④ 状态与截止</div>
          <div class="form-grid">
            <div class="form-row">
              <label>状态</label>
              <n-select v-model:value="drawer.status" :options="allStatusOptions" @update:value="saveState" />
            </div>
            <div class="form-row">
              <label>截止日期</label>
              <n-date-picker v-model:value="drawerDeadlineValue" type="date" clearable @update:value="updateDeadline" />
            </div>
          </div>

          <!-- 操作日志 -->
          <div class="sec-title">操作日志
            <span><n-button size="small" secondary @click="addNote">＋ 备注</n-button></span>
          </div>
          <div v-if="logs.length">
            <div v-for="l in logs" :key="l.id || l.created_at" class="log-item">
              <b>{{ l.user || '系统' }}</b> · {{ l.action }} · {{ l.note }}
              <span style="float:right">{{ (l.created_at || '').slice(5, 16) }}</span>
            </div>
          </div>
          <div v-else class="hint">无日志</div>
        </div>
      </div>
    </template>

    <!-- 新建/编辑创意模板弹窗 -->
    <Modal :show="showTemplateForm" @close="showTemplateForm = false" wide>
      <template #head><h3>{{ templateEditing ? '编辑' : '新建' }}创意模板</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>模板名称 *</label><n-input v-model:value="templateForm.name" /></div>
        <div class="form-row full"><label>核心逻辑</label><n-input v-model:value="templateForm.core_logic" type="textarea" /></div>
        <div class="form-row"><label>适用热点</label><n-input v-model:value="templateForm.applicable_hotspot" /></div>
        <div class="form-row"><label>适用营销节点</label><n-input v-model:value="templateForm.applicable_node" /></div>
        <div class="form-row"><label>适合创作者类型</label><n-input v-model:value="templateForm.creator_type" /></div>
        <div class="form-row full"><label>历史案例</label><n-input v-model:value="templateForm.cases" /></div>
        <div class="form-row full"><label>验证结果</label><n-input v-model:value="templateForm.validation" /></div>
        <div class="form-row full"><label>风险与限制</label><n-input v-model:value="templateForm.risks" /></div>
      </div>
      <template #foot><n-button type="primary" @click="saveTemplate">保存</n-button></template>
    </Modal>

    <!-- 手动创建机会弹窗 -->
    <Modal :show="showOppForm" @close="showOppForm = false">
      <template #head><h3>手动创建机会</h3></template>
      <div class="form-row"><label>机会标题 *</label><n-input v-model:value="oppFormTitle" /></div>
      <div class="form-row"><label>关联营销任务</label>
        <n-select v-model:value="oppFormCampId" :options="campaignOptions" placeholder="不关联" clearable />
      </div>
      <template #foot><n-button type="primary" @click="createOpp">创建</n-button></template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, watch } from 'vue'
import { NButton } from 'naive-ui'
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api.js'
import { showToast, getUser, appState } from '../stores/app.js'
import { OPP_FLOW, OPP_CURRENT, OPP_HISTORY, OPP_ALL, OPP_TERMINAL } from '../utils/constants.js'
import Modal from '../components/Modal.vue'
import StatusTag from '../components/StatusTag.vue'
import EmptyState from '../components/EmptyState.vue'

const tab = ref('current')
const filters = ref({ status: '全部', platform: '', risk: '', due: '', q: '' })
const opportunities = ref([])
const creatives = ref([]) // legacy alias for creators
const templates = ref([])
const campaigns = ref([])
const genCands = ref([])
const genLoading = ref(false)
const loading = ref(false)
const error = ref('')

// Drawer state
const drawerVisible = ref(false)
const drawer = ref(null)
const logs = ref([])
const executions = ref([])
const execSaving = ref(false)
const execForm = ref({})
const drawerDeadlineValue = ref(null)
const execPlannedDateValue = ref(null)
const execPublishDateValue = ref(null)

// Template form
const showTemplateForm = ref(false)
const templateEditing = ref(null)
const templateForm = ref({})

// New opp form
const showOppForm = ref(false)
const oppFormTitle = ref('')
const oppFormCampId = ref('')

// Eval loading
const evalLoading = ref(false)
const planLoading = ref(false)

const counts = computed(() => ({
  current: opportunities.value.filter(o => OPP_CURRENT.includes(o.status)).length,
  history: opportunities.value.filter(o => OPP_HISTORY.includes(o.status)).length
}))

const statusOptions = computed(() => tab.value === 'current' ? OPP_CURRENT : OPP_HISTORY)
const statusFilterOptions = computed(() => [
  { label: '全部', value: '全部' },
  ...statusOptions.value.map(v => ({ label: v, value: v }))
])
const allStatusOptions = OPP_ALL.map(v => ({ label: v, value: v }))
const riskOptions = ['高', '中', '低'].map(v => ({ label: v, value: v }))
const dueOptions = [
  { label: '本周截止', value: 'week' },
  { label: '本月截止', value: 'month' },
  { label: '已逾期', value: 'overdue' },
  { label: '无截止', value: 'none' }
]
const stageOptions = ['沟通中', '脚本确认', '制作中', '待发布', '已发布', '数据回收'].map(v => ({ label: v, value: v }))
const campaignOptions = computed(() => campaigns.value.map(c => ({ label: c.name, value: c.id })))

const platforms = computed(() => [...new Set(opportunities.value.map(o => o.platform).filter(Boolean))])
const platformFilterOptions = computed(() => platforms.value.map(v => ({ label: v, value: v })))

const filteredList = computed(() => {
  let list = opportunities.value
  if (tab.value === 'current') list = list.filter(o => OPP_CURRENT.includes(o.status))
  if (tab.value === 'history') list = list.filter(o => OPP_HISTORY.includes(o.status))
  const f = filters.value
  if (f.status !== '全部') list = list.filter(o => o.status === f.status)
  if (f.platform) list = list.filter(o => o.platform === f.platform)
  if (f.risk) list = list.filter(o => (o.risk_level || '中') === f.risk)
  if (f.due) {
    const today = new Date().toISOString().slice(0, 10)
    const now = new Date(today).getTime()
    const inDays = (days) => new Date(now + days * 86400000).toISOString().slice(0, 10)
    if (f.due === 'week') list = list.filter(o => o.deadline && o.deadline >= today && o.deadline <= inDays(7))
    if (f.due === 'month') list = list.filter(o => o.deadline && o.deadline >= today && o.deadline <= inDays(30))
    if (f.due === 'overdue') list = list.filter(o => o.deadline && o.deadline < today)
    if (f.due === 'none') list = list.filter(o => !o.deadline)
  }
  if (f.q) {
    const q = f.q.toLowerCase()
    list = list.filter(o => [o.title, o.hotspot_title, o.play_method, o.direction].filter(Boolean).join(' ').toLowerCase().includes(q))
  }
  return list
})
const historyColumns = computed(() => [
  {
    title: '机会',
    key: 'title',
    minWidth: 220,
    render: row => h('span', { class: 'title-link', onClick: () => openDrawer(row.id) }, row.title)
  },
  {
    title: '来源热点/节点',
    key: 'hotspot_title',
    minWidth: 160,
    render: row => h('span', { class: 'muted-cell' }, `${row.hotspot_title || '—'}${row.node ? ' / ' + row.node : ''}`)
  },
  { title: '关联任务', key: 'campaign_name', minWidth: 140, render: row => row.campaign_name || '—' },
  { title: '平台', key: 'platform', width: 90, render: row => row.platform || '—' },
  {
    title: '评分',
    key: 'score',
    width: 120,
    render: row => {
      const parts = []
      if (row.ai_score != null) parts.push(h('span', { style: { color: 'var(--purple)', fontWeight: 700 } }, `AI ${row.ai_score}`))
      if (row.rule_score != null) parts.push(h('span', { style: { color: 'var(--ink2)', fontSize: '12px', marginLeft: '4px' } }, `规则 ${row.rule_score}`))
      return parts.length ? h('span', parts) : '—'
    }
  },
  { title: '状态', key: 'status', width: 100, render: row => h(StatusTag, { text: row.status }) },
  { title: '更新', key: 'updated_at', width: 100, render: row => (row.updated_at || '').slice(5, 16) },
  {
    title: '操作',
    key: 'actions',
    width: 86,
    render: row => h(NButton, { size: 'small', type: 'error', secondary: true, onClick: () => deleteOpp(row.id) }, () => '删除')
  }
])
const executionColumns = [
  { title: '创作者', key: 'creator_name', render: row => row.creator_name || '—' },
  { title: '阶段', key: 'stage', render: row => h(StatusTag, { text: row.stage }) },
  { title: '计划/发布日', key: 'date', render: row => row.publish_date || row.planned_date || '—' },
  { title: '播放', key: 'play_count', render: row => row.play_count || '—' },
  { title: 'ROI7', key: 'roi_d7', render: row => row.roi_d7 ?? '—' },
  { title: '链接', key: 'publish_url', render: row => row.publish_url ? h(NButton, { size: 'small', secondary: true, onClick: () => openLink(row.publish_url) }, () => '打开') : '—' }
]

const kanbanColumns = computed(() => {
  return OPP_CURRENT.map(status => ({
    status,
    items: filteredList.value.filter(o => o.status === status)
  }))
})

const candHotspots = computed(() => {
  return hotspotCandidates.value.filter(h => h.status === '候选' && h.screen_result !== '不符合')
})
const hotspotCandidates = ref([])

const isTerminal = computed(() => drawer.value && OPP_TERMINAL.includes(drawer.value.status))
const flowIdx = computed(() => drawer.value ? OPP_FLOW.indexOf(drawer.value.status) : 0)

function riskLevel(c) {
  if (c.risk_json?.opinion?.level) return c.risk_json.opinion.level
  if (c.risk_level) return c.risk_level
  return '中'
}

function dateStringToValue(value) {
  if (!value) return null
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day).getTime()
}

function dateValueToString(value) {
  if (!value) return ''
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function setExecDate(field, value) {
  execForm.value[field] = dateValueToString(value)
}

function syncDrawerDateValue() {
  drawerDeadlineValue.value = dateStringToValue(drawer.value?.deadline)
}

function updateDeadline(value) {
  if (!drawer.value) return
  drawer.value.deadline = dateValueToString(value)
  saveState()
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
  opportunities.value = await apiGet('/opportunities')
  try { templates.value = await apiGet('/creative_templates') } catch (e) { /* ignore */ }
  try { campaigns.value = await apiGet('/campaigns') } catch (e) { /* ignore */ }
  try {
    const hs = await apiGet('/hotspots')
    hotspotCandidates.value = hs
  } catch (e) { /* ignore */ }
  } catch (e) {
    error.value = e.message
    showToast(e.message, true)
  } finally {
    loading.value = false
  }
}

async function openDrawer(id) {
  try {
    const [o, l, ex] = await Promise.all([
      apiGet(`/opportunities/${id}`),
      apiGet(`/opportunities/${id}/logs`),
      apiGet(`/opportunities/${id}/executions`)
    ])
    drawer.value = { ...o }
    syncDrawerDateValue()
    logs.value = l || []
    executions.value = ex || []
    resetExecForm()
    drawerVisible.value = true
  } catch (e) { showToast(e.message, true) }
}

function closeDrawer() {
  drawerVisible.value = false
  loadData()
}

async function deleteOpp(id) {
  if (!confirm('确认删除？')) return
  try {
    await apiDelete(`/opportunities/${id}`)
    showToast('已删除')
    loadData()
  } catch (e) { showToast(e.message, true) }
}

async function evalOpp() {
  if (!drawer.value) return
  evalLoading.value = true
  const id = drawer.value.id
  try {
    const evalResult = await apiPost(`/opportunities/${id}/evaluate`, { user: getUser() }, { timeout: 180000 })
    const planResult = await generateOpportunityPlan({ silent: true, refresh: false })
    const usedRule = evalResult.mode === 'rule' || planResult?.mode === 'rule'
    showToast(planResult?.message || evalResult.message || 'AI 评估与机会结论已生成', usedRule)
    await openDrawer(id)
    await loadData()
  } catch (e) { showToast(e.message, true) }
  finally { evalLoading.value = false }
}

async function generateOpportunityPlan({ silent = false, refresh = true } = {}) {
  if (!drawer.value) return null
  const id = drawer.value.id
  planLoading.value = true
  try {
    const r = await apiPost(`/opportunities/${id}/generate-plan`, { user: getUser() }, { timeout: 180000 })
    if (refresh) {
      await openDrawer(id)
      await loadData()
    }
    if (!silent) showToast(r.message || '机会结论已由 AI 填充', r.mode === 'rule')
    return r
  } catch (e) {
    if (!silent) showToast(e.message, true)
    throw e
  } finally {
    planLoading.value = false
  }
}

async function setStatus(status) {
  if (!drawer.value) return
  const reason = prompt(status === '已采纳' ? '判断结论（为什么值得做）：' : '不采用原因：') || ''
  await apiPut(`/opportunities/${drawer.value.id}`, { status, decision: reason, decision_by: getUser() })
  await apiPost(`/opportunities/${drawer.value.id}/logs`, { action: '状态变更', note: `${status}：${reason}`, user: getUser() })
  showToast('已更新')
  openDrawer(drawer.value.id)
}

async function saveState() {
  if (!drawer.value) return
  try {
    await apiPut(`/opportunities/${drawer.value.id}`, { status: drawer.value.status, deadline: drawer.value.deadline })
    showToast('已保存')
  } catch (e) { showToast(e.message, true) }
}

async function saveOpportunityDetail() {
  if (!drawer.value) return
  try {
    await apiPut(`/opportunities/${drawer.value.id}`, {
      title: drawer.value.title,
      direction: drawer.value.direction,
      play_method: drawer.value.play_method,
      game_combo: drawer.value.game_combo,
      platform: drawer.value.platform,
      suggested_time: drawer.value.suggested_time,
      cost: drawer.value.cost,
      risk_level: drawer.value.risk_level,
      risk_note: drawer.value.risk_note,
      deadline: drawer.value.deadline,
      status: drawer.value.status
    })
    await apiPost(`/opportunities/${drawer.value.id}/logs`, { action: '保存机会结论', note: '更新机会名称/玩法/平台/时效等字段', user: getUser() })
    showToast('机会结论已保存')
    openDrawer(drawer.value.id)
    loadData()
  } catch (e) { showToast(e.message, true) }
}

async function addNote() {
  if (!drawer.value) return
  const note = prompt('备注内容：')
  if (!note) return
  try {
    await apiPost(`/opportunities/${drawer.value.id}/logs`, { action: '备注', note, user: getUser() })
    openDrawer(drawer.value.id)
  } catch (e) { showToast(e.message, true) }
}

async function depositCase() {
  if (!drawer.value) return
  try {
    await apiPost(`/opportunities/${drawer.value.id}/deposit-case`, { is_verified: drawer.value.status === '已验证', note: drawer.value.decision || '', user: getUser() })
    showToast('已沉淀为案例')
  } catch (e) { showToast(e.message, true) }
}

function resetExecForm() {
  execForm.value = {
    creator_name: '',
    stage: '沟通中',
    planned_date: '',
    publish_date: '',
    publish_url: '',
    play_count: null,
    roi_d7: null,
    note: ''
  }
  execPlannedDateValue.value = null
  execPublishDateValue.value = null
}

async function addExecution() {
  if (!drawer.value) return
  if (!execForm.value.creator_name.trim()) return showToast('请输入创作者名称', true)
  execSaving.value = true
  try {
    await apiPost('/executions', { ...execForm.value, opportunity_id: drawer.value.id, created_by: getUser() })
    await apiPost(`/opportunities/${drawer.value.id}/logs`, { action: '新增执行记录', note: `${execForm.value.creator_name}：${execForm.value.stage}`, user: getUser() })
    showToast('执行记录已添加')
    openDrawer(drawer.value.id)
  } catch (e) { showToast(e.message, true) }
  finally { execSaving.value = false }
}

function openLink(url) { if (url) window.open(url, '_blank') }

async function toOpportunity(hid) {
  try {
    const r = await apiPost(`/hotspots/${hid}/adopt`, { campaign_id: appState.activeCampId, user: getUser() })
    showToast('已采纳为正式机会')
    openDrawer(r.id)
    tab.value = 'current'
  } catch (e) { showToast(e.message, true) }
}

async function generateCandidates() {
  genLoading.value = true
  try {
    const r = await apiPost('/opportunities/generate-candidates', {})
    genCands.value = r.candidates || []
  } catch (e) { showToast(e.message, true) }
  finally { genLoading.value = false }
}

async function adoptCandidate(idx) {
  const c = genCands.value[idx]
  if (!c) return showToast('未找到候选机会', true)
  try {
    const r = await apiPost('/opportunities', {
      title: c.title,
      campaign_id: appState.activeCampId || null,
      status: '待判断',
      direction: c.direction || '',
      play_method: c.play_method || '',
      game_combo: c.game_combo || '',
      platform: c.platform || '',
      node: c.node || '',
      basis: JSON.stringify(c.basis || {}),
      risk_json: JSON.stringify(c.risk_json || {}),
      suggested_time: c.suggested_time || '',
      risk_level: riskLevel(c),
      created_by: getUser()
    })
    showToast('已采纳为正式机会')
    tab.value = 'current'
    await loadData()
    openDrawer(r.id)
  } catch (e) { showToast(e.message, true) }
}

function openTemplateForm(t = null) {
  templateEditing.value = t
  templateForm.value = t ? { ...t } : { name: '', core_logic: '', applicable_hotspot: '', applicable_node: '', creator_type: '', cases: '', validation: '', risks: '' }
  showTemplateForm.value = true
}

async function saveTemplate() {
  if (!templateForm.value.name.trim()) return showToast('请输入名称', true)
  try {
    if (templateEditing.value) {
      await apiPut(`/creative_templates/${templateEditing.value.id}`, templateForm.value)
    } else {
      await apiPost('/creative_templates', { ...templateForm.value, created_by: getUser() })
    }
    showTemplateForm.value = false
    showToast('已保存')
    tab.value = 'templates'
    loadData()
  } catch (e) { showToast(e.message, true) }
}

async function deleteTemplate(id) {
  if (!confirm('确认删除？')) return
  try {
    await apiDelete(`/creative_templates/${id}`)
    showToast('已删除')
    loadData()
  } catch (e) { showToast(e.message, true) }
}

function openOppForm() {
  oppFormTitle.value = ''
  oppFormCampId.value = ''
  showOppForm.value = true
}

async function createOpp() {
  const title = oppFormTitle.value.trim()
  if (!title) return showToast('请输入标题', true)
  try {
    const r = await apiPost('/opportunities', { title, campaign_id: oppFormCampId.value || null, status: '待判断', created_by: getUser() })
    showOppForm.value = false
    showToast('已创建')
    openDrawer(r.id)
    tab.value = 'current'
    loadData()
  } catch (e) { showToast(e.message, true) }
}

// Watch for drawer open trigger from TodayPage
watch(() => appState.pendingOpportunityId, (val) => {
  if (val) {
    openDrawer(val)
    appState.pendingOpportunityId = null
  }
}, { immediate: true })

onMounted(loadData)
</script>
