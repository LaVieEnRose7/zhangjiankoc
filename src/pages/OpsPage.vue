<template>
  <div>
    <div class="page-head">
      <div class="page-head-left">
        <h2>内容运营分析</h2>
        <div class="sub">运营看板 · 内容分层 · 创作者分析 · 运营建议</div>
      </div>
      <div class="page-head-actions">
        <n-button secondary @click="archiveCycle" :disabled="loading || !analysis">归档周期</n-button>
        <n-button type="primary" :loading="loading" @click="loadDashboard">{{ loading ? '刷新中…' : '刷新看板' }}</n-button>
      </div>
    </div>

    <div class="card stage-selector-card ops-period-selector">
      <div class="period-selector-head">
        <div><b>分析阶段（点击切换）</b><p>与创作者中心使用同一套营销任务阶段，共 {{ phases.length }} 个。</p></div>
        <span v-if="timeMode === 'phase' && selectedPhase" class="tag green">当前：{{ selectedPhase.name }}</span>
        <span v-else-if="timeMode === 'custom'" class="tag blue">当前：自定义时间</span>
      </div>
      <div class="period-stage-scroll">
        <n-button v-for="phase in phases" :key="phase.id" style="flex-shrink:0"
          :type="timeMode === 'phase' && Number(selectedPhaseId) === Number(phase.id) ? 'primary' : 'default'"
          :secondary="timeMode !== 'phase' || Number(selectedPhaseId) !== Number(phase.id)"
          @click="selectAnalysisPhase(phase)">
          {{ phaseMonth(phase.phase_start) }} · {{ phase.name }}
        </n-button>
        <span v-if="!phases.length" class="hint">暂无带开始日期的营销任务</span>
      </div>
      <div class="time-range-filter">
        <div><label for="ops-date-from">开始日期</label><input id="ops-date-from" v-model="dateDraft.from" class="date-input" type="date" /></div>
        <div><label for="ops-date-to">结束日期</label><input id="ops-date-to" v-model="dateDraft.to" class="date-input" type="date" /></div>
        <n-button type="primary" :loading="loading" @click="applyAnalysisTime">查询</n-button>
        <n-button secondary @click="clearAnalysisTime">清空</n-button>
        <span class="hint">分析范围：{{ filters.start }} 至 {{ filters.end }}</span>
      </div>
    </div>

    <n-tabs v-model:value="tab" type="segment" animated class="ops-tabs">
      <n-tab-pane name="dashboard" tab="运营看板" />
      <n-tab-pane name="layers" tab="内容分层" />
      <n-tab-pane name="creators" tab="创作者" />
      <n-tab-pane name="insights" tab="洞察建议" />
      <n-tab-pane name="experiences" tab="经验库" />
    </n-tabs>

    <EmptyState v-if="!analysis && !loading" icon="chart">暂无分析数据，点击「刷新看板」生成</EmptyState>

    <template v-if="analysis">
      <div v-if="tab === 'dashboard'">
        <div class="ops-overview-grid">
          <n-card
            v-for="s in totalStatCards"
            :key="s.key"
            :class="['ops-total-card', s.key]"
            :bordered="false"
          >
            <div class="ops-stat-head">
              <span :class="['ops-stat-icon', s.tone]">
                <n-icon :component="s.icon" />
              </span>
              <span>{{ s.label }}</span>
            </div>
            <div class="stat-num" :style="{ color: s.color }">{{ s.value }}</div>
            <div class="dash-note">{{ s.note }}</div>
          </n-card>
          <n-card v-for="p in platformStatCards" :key="p.key" :class="['ops-platform-card', p.key]" :bordered="false">
            <div class="ops-platform-head">
              <div><span class="ops-platform-dot"></span><b>{{ p.label }}</b></div>
              <span class="tag gray">本周期</span>
            </div>
            <div class="ops-platform-metrics">
              <div class="play-metric"><b :title="p.playExact">{{ p.play }}</b><span>总播放量</span></div>
              <div class="published-metric"><b>{{ p.published }}</b><span>发布条数</span></div>
            </div>
          </n-card>
        </div>

        <div class="ops-dashboard-lower">
          <div class="card ops-platform-distribution">
            <div class="sec-title">平台内容分布</div>
            <div v-if="platformRows.length" class="bar-list">
              <div v-for="p in platformRows" :key="p.name" class="bar-row">
                <div class="bar-head"><span>{{ p.name }}</span><b>{{ p.count }} 条</b></div>
                <div class="bar-track"><div class="bar-fill" :style="{ width: p.width + '%' }"></div></div>
              </div>
            </div>
            <EmptyState v-else icon="chart">暂无平台数据</EmptyState>
          </div>

          <div class="card ops-actions-card">
            <div class="sec-title">下周期 TOP 行动</div>
            <div v-if="topActions.length" class="action-grid">
              <div v-for="(a, index) in topActions" :key="a.target + a.advice" class="action-card">
                <span class="action-index">{{ index + 1 }}</span>
                <div>
                  <div class="action-title">{{ a.target }} <span class="tag gray">{{ a.line }}</span></div>
                  <div>{{ a.advice }}</div>
                </div>
              </div>
            </div>
            <EmptyState v-else icon="check">暂无明确行动建议</EmptyState>
          </div>
        </div>
      </div>

      <div v-if="tab === 'layers'">
        <LayerTable title="内容类型分层" :rows="analysis.layers?.content_type || []" />
        <LayerTable title="玩法分层" :rows="analysis.layers?.play_method || []" />
        <LayerTable title="营销目标分层" :rows="analysis.layers?.marketing_goal || []" />
      </div>

      <div v-if="tab === 'creators'">
        <div class="creator-summary-grid">
          <div class="creator-summary-card growth"><span>成长创作者</span><b>{{ creatorSummary.growth || 0 }}</b><small>表现成熟，可优先加码</small></div>
          <div class="creator-summary-card cultivate"><span>值得培养</span><b>{{ creatorSummary.cultivate || 0 }}</b><small>小样本潜力，继续测试</small></div>
          <div class="creator-summary-card bottleneck"><span>瓶颈创作者</span><b>{{ creatorSummary.bottleneck || 0 }}</b><small>成本或播放表现需改善</small></div>
          <div class="creator-summary-card watch"><span>观察名单</span><b>{{ creatorSummary.watch || 0 }}</b><small>表现中性，等待更多样本</small></div>
        </div>
        <div class="creator-segment-grid">
          <CreatorGroup title="成长创作者" tone="growth" subtitle="效率与播放体量领先，适合增加合作" :rows="analysis.creator?.groups?.growth || []" />
          <CreatorGroup title="值得培养" tone="cultivate" subtitle="已有潜力信号，建议控制成本继续测试" :rows="analysis.creator?.groups?.cultivate || []" />
          <CreatorGroup title="瓶颈创作者" tone="bottleneck" subtitle="CPM 偏高或发布后播放不足，优先优化" :rows="analysis.creator?.groups?.bottleneck || []" />
          <CreatorGroup title="观察名单" tone="watch" subtitle="当前结论不明确，继续积累发布样本" :rows="analysis.creator?.groups?.watch || []" />
        </div>
      </div>

      <div v-if="tab === 'insights'">
        <div class="card">
          <div class="sec-title">规则洞察
            <span class="sec-actions">
              <small class="last-ai-time">{{ lastAiInsightText }}</small>
              <n-button size="small" secondary :loading="aiLoading" @click="loadAiInsights">{{ aiLoading ? '生成中…' : 'AI 深度洞察' }}</n-button>
            </span>
          </div>
          <div v-if="ruleInsights.length" class="insight-list">
            <div v-for="i in ruleInsights" :key="i.title + i.statement" class="insight-card">
              <div>
                <StatusTag :text="i.category" />
                <span :class="['tag', i.confidence === '高' ? 'green' : i.confidence === '中' ? 'blue' : 'orange']">可信度 {{ i.confidence }}</span>
              </div>
              <h3>{{ i.title }}</h3>
              <p>{{ i.statement }}</p>
              <div class="dash-note">{{ i.basis }}</div>
            </div>
          </div>
          <EmptyState v-else icon="sparkles">暂无规则洞察</EmptyState>
        </div>

        <div v-if="aiInsights.length" class="card">
          <div class="sec-title">AI 深度洞察</div>
          <div class="insight-list">
            <div v-for="(i, idx) in aiInsights" :key="idx" class="insight-card">
              <h3>{{ i.title || i.category || 'AI 洞察' }}</h3>
              <p>{{ i.statement || i.content || i }}</p>
              <div v-if="i.basis" class="dash-note">{{ i.basis }}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="sec-title">资源运营建议</div>
          <div class="resource-grid">
            <ResourceColumn title="放大" :rows="analysis.resource?.groups?.amplify || []" />
            <ResourceColumn title="复测" :rows="analysis.resource?.groups?.verify || []" />
            <ResourceColumn title="优化" :rows="analysis.resource?.groups?.optimize || []" />
            <ResourceColumn title="暂停" :rows="analysis.resource?.groups?.pause || []" />
          </div>
        </div>
      </div>
    </template>

    <div v-if="tab === 'experiences'">
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <n-button type="primary" @click="openExpForm()">+ 添加经验</n-button>
      </div>
      <div v-if="experiences.length">
        <div v-for="e in experiences" :key="e.id" class="card">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
            <StatusTag :text="e.boost === -1 ? '避坑' : '正向'" />
            <span class="tag gray">{{ e.category || '其他' }}</span>
            <span v-if="e.platform" class="tag purple">{{ e.platform }}</span>
            <span :class="['tag', e.confidence === '高' ? 'green' : e.confidence === '中' ? 'blue' : 'orange']">可信度 {{ e.confidence }}</span>
          </div>
          <div style="font-size:13px;line-height:1.7;margin-bottom:8px">{{ e.content }}</div>
          <div v-if="e.data_basis" style="font-size:12px;color:var(--ink-dim);margin-bottom:8px"><b>数据依据：</b>{{ e.data_basis }}</div>
          <div style="display:flex;gap:6px">
            <n-button size="small" secondary @click="openExpForm(e)">编辑</n-button>
            <n-button size="small" type="error" secondary @click="del(e.id)">删除</n-button>
          </div>
        </div>
      </div>
      <EmptyState v-else icon="inbox">暂无经验</EmptyState>
    </div>

    <Modal :show="showExpForm" @close="showExpForm = false" wide>
      <template #head><h3>{{ expEditing ? '编辑' : '添加' }}经验</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>经验内容 *</label><n-input v-model:value="expForm.content" type="textarea" :autosize="{ minRows: 4 }" /></div>
        <div class="form-row"><label>类型</label><n-select v-model:value="expForm.boost" :options="boostOptions" /></div>
        <div class="form-row"><label>分类</label><n-select v-model:value="expForm.category" :options="categoryOptions" /></div>
        <div class="form-row"><label>平台</label><n-select v-model:value="expForm.platform" :options="platformOptions" placeholder="不限" clearable /></div>
        <div class="form-row"><label>可信度</label><n-select v-model:value="expForm.confidence" :options="confidenceOptions" /></div>
        <div class="form-row full"><label>数据依据</label><n-input v-model:value="expForm.data_basis" /></div>
      </div>
      <template #foot><n-button type="primary" @click="saveExp">保存</n-button></template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import { NCard, NDataTable } from 'naive-ui'
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api.js'
import { showToast, getUser } from '../stores/app.js'
import { fmt, pct } from '../utils/helpers.js'
import Modal from '../components/Modal.vue'
import StatusTag from '../components/StatusTag.vue'
import EmptyState from '../components/EmptyState.vue'
import {
  PlayCircleOutline,
  TrendingUpOutline
} from '@vicons/ionicons5'

const LayerTable = defineComponent({
  props: { title: String, rows: { type: Array, default: () => [] } },
  setup(props) {
    const columns = [
      { title: '分层', key: 'key', render: row => h('b', row.key) },
      { title: '样本', key: 'n' },
      { title: '创作者', key: 'creators' },
      { title: '均播', key: 'avgPlay', render: row => fmt(row.avgPlay) },
      { title: 'ROI7', key: 'avgRoi7', render: row => row.avgRoi7 ?? '—' },
      { title: '百赞率', key: 'baiZanRate', render: row => pct(row.baiZanRate) },
      { title: '趋势', key: 'trend', render: row => row.trend || '—' },
      { title: '判级', key: 'level', render: row => h(StatusTag, { text: row.level || '观察' }) }
    ]
    return () => h(NCard, { class: 'card', bordered: false }, () => [
      h('div', { class: 'sec-title' }, props.title),
      props.rows.length
        ? h(NDataTable, { class: 'data-table-card inner', columns, data: props.rows, bordered: false, singleLine: false, pagination: false })
        : h(EmptyState, { icon: 'chart' }, () => '暂无分层数据')
    ])
  }
})

const CreatorGroup = defineComponent({
  props: { title: String, subtitle: String, tone: String, rows: { type: Array, default: () => [] } },
  setup(props) {
    return () => h('section', { class: ['creator-segment-panel', props.tone] }, [
      h('div', { class: 'creator-segment-head' }, [
        h('div', [h('h3', props.title), h('p', props.subtitle || '')]),
        h('span', props.rows.length)
      ]),
      props.rows.length
        ? h('div', { class: 'creator-segment-list' }, props.rows.map((r, index) => h('div', { class: 'creator-segment-row', key: r.id }, [
            h('span', { class: 'creator-rank' }, index + 1),
            h('div', { class: 'creator-segment-info' }, [h('b', r.name), h('p', r.reason || '暂无归类说明')]),
            h('div', { class: 'creator-segment-metrics' }, [
              h('span', [h('b', r.cpm == null ? '—' : '¥' + fmt(r.cpm)), h('small', 'CPM')]),
              h('span', [h('b', r.published || 0), h('small', '发布')]),
              h('span', [h('b', fmt(r.totalPlay)), h('small', '总播放')])
            ])
          ])))
        : h('div', { class: 'creator-segment-empty' }, '当前分组暂无创作者')
    ])
  }
})

const ResourceColumn = defineComponent({
  props: { title: String, rows: { type: Array, default: () => [] } },
  setup(props) {
    return () => h('div', { class: 'resource-col' }, [
      h('h3', props.title),
      props.rows.length
        ? props.rows.map(r => h('div', { class: 'resource-item', key: r.target + r.advice }, [
            h('b', r.target),
            h('div', { class: 'dash-note' }, `优先级 ${'★'.repeat(r.stars || 1)}`),
            h('p', r.advice),
            h('small', r.basis)
          ]))
        : h('div', { class: 'hint' }, '暂无建议')
    ])
  }
})

const tab = ref('dashboard')
const loading = ref(false)
const aiLoading = ref(false)
const analysis = ref(null)
const campaigns = ref([])
const experiences = ref([])
const aiInsights = ref([])
const aiInsightMeta = ref({})
const showExpForm = ref(false)
const expEditing = ref(null)
const expForm = ref({})

const filters = ref({
  campaignId: '',
  start: dateOffset(-60),
  end: dateOffset(0),
  cycleMode: 'task'
})
const phases = ref([]), selectedPhaseId = ref(null), timeMode = ref('phase')
const dateDraft = ref({ from: '', to: '' })

const metrics = computed(() => analysis.value?.overview?.metrics || {})
const selectedPhase = computed(() => phases.value.find(p => Number(p.id) === Number(selectedPhaseId.value)) || null)
const boostOptions = [
  { label: '正向', value: 1 },
  { label: '避坑', value: -1 }
]
const categoryOptions = ['内容方向', '创作者合作', '发布时间', '平台策略', '其他'].map(v => ({ label: v, value: v }))
const platformOptions = ['B站', '抖音', '微博', '小红书'].map(v => ({ label: v, value: v }))
const confidenceOptions = ['高', '中', '低'].map(v => ({ label: v, value: v }))
const creatorSummary = computed(() => analysis.value?.creator?.summary || {})
const ruleInsights = computed(() => analysis.value?.insights?.rules || [])
const currentAiMeta = computed(() => aiInsightMeta.value.lastAt ? aiInsightMeta.value : (analysis.value?.insights?.aiMeta || {}))
const lastAiInsightText = computed(() => {
  const meta = currentAiMeta.value || {}
  if (!meta.lastAt) return '暂未生成 AI 洞察'
  return `上次 AI：${fmtDateTime(meta.lastAt)}${meta.lastModel ? ` · ${meta.lastModel}` : ''}`
})
const topActions = computed(() => analysis.value?.resource?.top3 || [])
const totalStatCards = computed(() => [
  {
    key: 'published',
    label: '已发布内容',
    value: metrics.value.published || 0,
    note: `完成率 ${pct(metrics.value.completion)}`,
    icon: PlayCircleOutline,
    tone: 'blue'
  },
  {
    key: 'play',
    label: '总播放',
    value: fmt(metrics.value.totalPlay),
    note: `互动 ${fmt(metrics.value.totalInteraction)}`,
    icon: TrendingUpOutline,
    tone: 'green'
  }
])
const platformStatCards = computed(() => [
  { key: 'bili', label: 'B站', published: metrics.value.platforms?.['B站'] || 0, play: fmt(metrics.value.platformPlays?.['B站'] || 0), playExact: `B站总播放：${fmt(metrics.value.platformPlays?.['B站'] || 0)}` },
  { key: 'douyin', label: '抖音', published: metrics.value.platforms?.['抖音'] || 0, play: fmt(metrics.value.platformPlays?.['抖音'] || 0), playExact: `抖音总播放：${fmt(metrics.value.platformPlays?.['抖音'] || 0)}` }
])

const platformRows = computed(() => {
  const platforms = metrics.value.platforms || {}
  const max = Math.max(1, ...Object.values(platforms))
  return Object.entries(platforms)
    .map(([name, count]) => ({ name, count, width: Math.round(count / max * 100) }))
    .sort((a, b) => b.count - a.count)
})

function dateOffset(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function previousDate(date) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
function phaseMonth(date) {
  const value = String(date || '')
  return /^\d{4}-\d{2}/.test(value) ? `${Number(value.slice(5, 7))}月` : '未定期'
}
async function selectAnalysisPhase(phase) {
  timeMode.value = 'phase'
  selectedPhaseId.value = phase.id
  filters.value.campaignId = phase.id
  filters.value.start = phase.phase_start
  filters.value.end = phase.phase_end_exclusive ? previousDate(phase.phase_end_exclusive) : dateOffset(0)
  filters.value.cycleMode = 'task'
  dateDraft.value = { from: filters.value.start, to: filters.value.end }
  await loadDashboard()
}
async function applyAnalysisTime() {
  if (!dateDraft.value.from) return showToast('请选择开始日期', true)
  if (dateDraft.value.to && dateDraft.value.to < dateDraft.value.from) return showToast('结束日期不能早于开始日期', true)
  timeMode.value = 'custom'
  filters.value.campaignId = ''
  filters.value.start = dateDraft.value.from
  filters.value.end = dateDraft.value.to || dateOffset(0)
  filters.value.cycleMode = 'custom'
  await loadDashboard()
}
async function clearAnalysisTime() {
  dateDraft.value = { from: '', to: '' }
  if (selectedPhase.value) await selectAnalysisPhase(selectedPhase.value)
}

function fmtDateTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value || '—'
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function metricColor(value, target) {
  if (value == null || value === 0) return 'inherit'
  return value >= target ? 'var(--green)' : 'var(--red)'
}

function verdictText(v) {
  return { verified: '达标', partial: '待复测', failed: '未达标', none: '无数据' }[v] || v || '—'
}

function queryString() {
  const p = new URLSearchParams()
  if (filters.value.campaignId) p.set('campaignId', filters.value.campaignId)
  if (filters.value.start) p.set('start', filters.value.start)
  if (filters.value.end) p.set('end', filters.value.end)
  if (filters.value.cycleMode) p.set('cycleMode', filters.value.cycleMode)
  return p.toString()
}

async function loadCampaigns() {
  try {
    const [campaignList, phaseList] = await Promise.all([apiGet('/campaigns'), apiGet('/creators/phases')])
    campaigns.value = campaignList
    phases.value = phaseList || []
  } catch (e) { /* ignore */ }
}

async function loadDashboard() {
  loading.value = true
  try {
    analysis.value = await apiGet(`/ops/analyze?${queryString()}`)
  } catch (e) { showToast(e.message, true) }
  finally { loading.value = false }
}

async function loadExperiences() {
  try { experiences.value = await apiGet('/experiences') } catch (e) { showToast(e.message, true) }
}

async function loadAiInsights() {
  aiLoading.value = true
  try {
    const r = await apiPost('/ops/insight-ai', {
      campaignId: filters.value.campaignId || null,
      cycleMode: filters.value.cycleMode,
      start: filters.value.start,
      end: filters.value.end
    }, { timeout: 180000 })
    aiInsights.value = r.insights || []
    if (r.mode === 'ai' && r.generatedAt) {
      aiInsightMeta.value = { lastAt: r.generatedAt, lastMode: r.mode, lastModel: r.model || '' }
      if (analysis.value?.insights) analysis.value.insights.aiMeta = aiInsightMeta.value
    }
    showToast(r.message || 'AI 洞察已生成')
  } catch (e) { showToast(e.message, true) }
  finally { aiLoading.value = false }
}

async function archiveCycle() {
  if (!filters.value.start || !filters.value.end) return showToast('请先选择周期', true)
  try {
    const r = await apiPost('/ops/archive', {
      campaignId: filters.value.campaignId || null,
      cycleMode: filters.value.cycleMode,
      start: filters.value.start,
      end: filters.value.end,
      user: getUser(),
      force: false
    })
    if (r.exists) {
      if (!confirm('该周期已经归档过，是否覆盖？')) return
      await apiPost('/ops/archive', {
        campaignId: filters.value.campaignId || null,
        cycleMode: filters.value.cycleMode,
        start: filters.value.start,
        end: filters.value.end,
        user: getUser(),
        force: true
      })
    }
    showToast('周期已归档')
  } catch (e) { showToast(e.message, true) }
}

function openExpForm(e = null) {
  expEditing.value = e
  expForm.value = e ? { ...e } : { content: '', boost: 1, category: '内容方向', platform: '', confidence: '中', data_basis: '' }
  showExpForm.value = true
}

async function saveExp() {
  if (!expForm.value.content.trim()) return showToast('请输入经验内容', true)
  try {
    if (expEditing.value) await apiPut(`/experiences/${expEditing.value.id}`, expForm.value)
    else await apiPost('/experiences', { ...expForm.value, created_by: getUser() })
    showExpForm.value = false
    showToast('已保存')
    loadExperiences()
  } catch (e) { showToast(e.message, true) }
}

async function del(id) {
  if (!confirm('确认删除？')) return
  try { await apiDelete(`/experiences/${id}`); showToast('已删除'); loadExperiences() }
  catch (e) { showToast(e.message, true) }
}

onMounted(async () => {
  await Promise.all([loadCampaigns(), loadExperiences()])
  if (phases.value.length) await selectAnalysisPhase(phases.value[0])
  else loadDashboard()
})
</script>
