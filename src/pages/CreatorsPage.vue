<template>
  <div>
    <div class="page-head">
      <div class="page-head-left"><h2>创作者库</h2><div class="sub">管理合作创作者 · 追踪表现数据</div></div>
      <div class="page-head-actions">
        <n-button secondary :loading="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button secondary :loading="syncingFans" @click="syncAllFans">{{ syncingFans ? `同步中 ${syncProgress.done}/${syncProgress.total || '…'}` : '同步全部粉丝' }}</n-button>
        <n-button type="primary" @click="openForm()">+ 添加创作者</n-button>
        <n-button secondary @click="openCreatorImport">导入名单及付费</n-button>
      </div>
    </div>

    <div class="card stage-selector-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:15px;margin-bottom:4px">营销任务阶段（点击切换）</div>
          <div class="hint">共 {{ phases.length }} 个阶段 · 按开始日期倒序，下一任务开始时上一阶段自动结束。</div>
        </div>
        <n-button size="small" secondary @click="openPhaseForm">+ 新增历史阶段</n-button>
      </div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding:12px 2px 4px;margin-top:8px">
          <n-button
            v-for="phase in phases"
            :key="phase.id"
            style="flex-shrink:0"
            :type="Number(selectedPhaseId) === Number(phase.id) ? 'primary' : 'default'"
            :secondary="Number(selectedPhaseId) !== Number(phase.id)"
            @click="selectPhase(phase.id)"
          >
            {{ phaseMonth(phase.phase_start) }} · {{ phase.name }}
          </n-button>
          <span v-if="!phases.length" class="hint">暂无带开始日期的营销任务</span>
      </div>
      <div class="time-range-filter">
        <div><label for="creator-date-from">开始日期</label><input id="creator-date-from" v-model="customDateFrom" class="date-input" type="date" /></div>
        <div><label for="creator-date-to">结束日期</label><input id="creator-date-to" v-model="customDateTo" class="date-input" type="date" /></div>
        <n-button type="primary" @click="applyCustomTime">查询</n-button>
        <n-button secondary @click="clearCustomTime">清空</n-button>
      </div>
      <div v-if="timeMode === 'custom'" style="margin-top:12px;font-size:13px">
        当前查看：<b>自定义时间段</b><span style="color:var(--ink-faint);margin-left:8px">{{ customDateFrom }} 至 {{ customDateTo || '今天' }}</span>
      </div>
      <div v-else-if="selectedPhase" style="margin-top:12px;font-size:13px">
        当前查看：<b>{{ selectedPhase.name }}</b>
        <span style="color:var(--ink-faint);margin-left:8px">{{ selectedPhase.phase_start }} 至 {{ selectedPhase.phase_end_exclusive ? selectedPhase.phase_end_exclusive + ' 前' : '下一任务开始前' }}</span>
      </div>
    </div>

    <Modal :show="showPhaseForm" @close="showPhaseForm = false">
      <template #head><h3>新增营销任务阶段</h3></template>
      <div class="hint" style="margin-bottom:14px">用于补录第十五期、第十六期等历史阶段。结束日期无需填写。</div>
      <div class="form-row"><label>阶段名称 *</label><n-input v-model:value="phaseForm.name" placeholder="例如：第十五期" /></div>
      <div class="form-row"><label>开始日期 *</label><n-input v-model:value="phaseForm.start_date" type="date" /></div>
      <template #foot>
        <n-button type="primary" :loading="savingPhase" @click="savePhase">{{ savingPhase ? '保存中...' : '保存阶段' }}</n-button>
      </template>
    </Modal>

    <div class="filter-bar">
      <n-select v-model:value="filters.platform" :options="platformFilterOptions" placeholder="平台-全部" clearable />
      <n-input class="q" v-model:value="filters.q" placeholder="搜索名称/标签" clearable />
      <n-button size="small" secondary @click="resetCreatorFilters">重置</n-button>
      <n-button v-if="checkedCreatorIds.length" size="small" type="error" secondary @click="batchDelete">
        批量删除 {{ checkedCreatorIds.length }}
      </n-button>
    </div>

    <div v-if="loading" class="loading-card"><span>正在加载创作者数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="load">重试</n-button>
    </div>

    <n-data-table
      v-else
      v-model:checked-row-keys="checkedCreatorIds"
      class="data-table-card"
      :columns="creatorColumns"
      :data="pagedCreators"
      :bordered="false"
      :single-line="false"
      :row-key="row => row.id"
      @update:sorter="handleCreatorTableSort"
    />
    <div v-if="filtered.length" class="list-pagination">
      <span>共 {{ filtered.length }} 位 · 每页 15 位</span>
      <div>
        <n-button size="small" secondary :disabled="creatorPage <= 1" @click="creatorPage--">上一页</n-button>
        <n-button v-for="page in creatorPageNumbers" :key="page" size="small" :type="page === creatorPage ? 'primary' : 'default'" :secondary="page !== creatorPage" @click="creatorPage = page">{{ page }}</n-button>
        <n-button size="small" secondary :disabled="creatorPage >= creatorTotalPages" @click="creatorPage++">下一页</n-button>
      </div>
    </div>

    <Modal :show="showForm" @close="showForm = false" wide>
      <template #head><h3>{{ editing ? '编辑' : '添加' }}创作者</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>名称 *</label><n-input v-model:value="form.name" /></div>
        <div class="form-row">
          <label for="creator-platform">平台</label>
          <select id="creator-platform" v-model="form.platform" class="creator-platform-select">
            <option v-for="option in platformOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <div class="form-row"><label>粉丝量（主页实时获取）</label><n-input-number v-model:value="form.fans" :min="0" :show-button="false" readonly style="width:100%" placeholder="填写主页链接后自动获取" /></div>
        <div class="form-row"><label>均播放量（案例自动统计）</label><n-input-number v-model:value="form.avg_play" :min="0" :show-button="false" readonly style="width:100%" placeholder="导入案例后自动计算" /></div>
        <div class="form-row full"><label>擅长方向/标签</label><n-input v-model:value="form.categories" placeholder="逗号分隔" /></div>
        <div class="form-row full">
          <label>主页链接</label>
          <div style="display:flex;gap:8px">
            <n-input v-model:value="form.home_url" placeholder="支持 B站、抖音创作者主页" @blur="fetchProfile" @keyup.enter="fetchProfile" />
            <n-button secondary :loading="fetchingProfile" :disabled="!form.home_url" @click="fetchProfile">{{ fetchingProfile ? '获取中...' : '获取粉丝' }}</n-button>
          </div>
          <div class="hint" style="margin-top:6px">保存前会使用最近一次从主页获取的粉丝数据，无需手动填写。</div>
        </div>
      </div>
      <template #foot><n-button type="primary" :loading="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</n-button></template>
    </Modal>

    <Modal :show="showImport" @close="showImport = false">
      <template #head><h3>导入创作者名单</h3></template>
      <div class="import-phase-notice">
        <span>付费归属阶段</span>
        <b>{{ selectedPhase?.name || '未选择阶段' }}</b>
        <small>{{ selectedPhase?.phase_start || '—' }} 开始 · 模板填写“阶段付费金额（元）”后自动计算 CPM</small>
      </div>
      <div class="form-row">
        <label>选择 Excel (.xlsx) 或 CSV 文件</label>
        <n-upload :default-upload="false" accept=".xlsx,.csv" :max="1" @change="handleImportChange">
          <n-button secondary>选择文件</n-button>
        </n-upload>
      </div>
      <template #foot>
        <n-button secondary @click="downloadTemplate">下载模板</n-button>
        <n-button type="primary" :loading="importing" @click="doImport" :disabled="!importFile">{{ importing ? '导入中...' : '导入' }}</n-button>
      </template>
    </Modal>

    <template v-if="detailVisible">
      <div class="drawer-mask" @click="closeDetail"></div>
      <div class="drawer detail-drawer">
        <div class="drawer-head">
          <div>
            <div class="detail-title">{{ selectedCreator?.name }}</div>
            <div class="detail-tags">
              <StatusTag :text="selectedCreator?.platform || '平台待定'" />
            </div>
          </div>
          <span class="x" @click="closeDetail">&times;</span>
        </div>
        <div class="drawer-body">
          <div class="detail-metrics">
            <div><b>{{ fmt(selectedCreator?.fans) }}</b><span>粉丝</span></div>
            <div><b>{{ fmt(publishedData ? pubSummary.avg_play : selectedCreator?.avg_play) }}</b><span>均播</span></div>
            <div><b>{{ phaseCpm(selectedCreator) }}</b><span>阶段 CPM</span></div>
          </div>
          <div class="detail-section">
            <div class="section-title-row">
              <h3>发布数据总览</h3>
              <n-button size="small" secondary :loading="rematching" @click="fixCaseLinks" :disabled="publishedLoading">
                {{ rematching ? '修复中...' : '修复案例关联' }}
              </n-button>
            </div>
            <div v-if="publishedLoading" class="loading-card compact"><span>正在汇总发布数据...</span><span class="spinner"></span></div>
            <div v-else-if="publishedError" class="error-card compact">
              <span>{{ publishedError }}</span>
              <n-button size="small" secondary @click="loadPublished(selectedCreator.id)">重试</n-button>
            </div>
            <template v-else>
              <div class="detail-metrics creator-pub-metrics">
                <div><b>{{ fmt(pubSummary.content_count) }}</b><span>发布内容</span></div>
                <div><b>{{ fmt(pubSummary.total_play) }}</b><span>总播放</span></div>
                <div><b>{{ fmt(pubSummary.avg_play) }}</b><span>平均播放</span></div>
                <div><b>{{ pubSummary.cpm == null ? '—' : `¥${fmt(pubSummary.cpm)}` }}</b><span>阶段 CPM</span></div>
                <div><b>{{ pubSummary.paid_amount == null ? '—' : `¥${fmt(pubSummary.paid_amount)}` }}</b><span>阶段付费</span></div>
                <div><b>{{ fmt(pubSummary.high_count) }}</b><span>高表现</span></div>
                <div><b>{{ fmt(pubSummary.benchmark_count) }}</b><span>达标内容</span></div>
                <div><b>{{ fmtDate(pubSummary.latest_publish_date) }}</b><span>最近发布</span></div>
              </div>
              <div class="creator-feed" v-if="publishedItems.length">
                <div class="creator-feed-item" v-for="item in publishedItems.slice(0, 6)" :key="`${item.source}-${item.caseId || item.id}`">
                  <div>
                    <div class="feed-title">{{ item.title || '未命名内容' }}</div>
                    <div class="feed-meta">{{ item.platform || '平台待定' }} · {{ fmtDate(item.publish_date) }} · {{ item.source }}</div>
                  </div>
                  <div class="feed-stats">
                    <span>{{ fmt(item.play_count) }} 播放</span>
                    <span v-if="item.activation_d1 != null">激活 {{ item.activation_d1 }}%</span>
                    <span v-if="item.roi_d7 != null">ROI7 {{ item.roi_d7 }}</span>
                    <StatusTag v-if="item.result" :text="item.result" />
                    <n-button v-if="item.url" size="small" secondary @click="openLink(item.url)">原文</n-button>
                  </div>
                </div>
              </div>
              <EmptyState v-else icon="inbox">还没有关联到发布内容</EmptyState>
              <div class="creator-exec-strip" v-if="publishedData?.executions?.length">
                <b>执行记录</b>
                <span v-for="e in publishedData.executions.slice(0, 4)" :key="e.id">
                  {{ e.opportunity_title || '未命名机会' }} · {{ e.stage || '未开始' }}
                </span>
              </div>
            </template>
          </div>
          <div class="detail-section">
            <div class="section-title-row">
              <h3>合作画像</h3>
              <n-button size="small" type="primary" secondary :loading="analyzingStrengths" @click="analyzeStrengths">AI 分析擅长方向</n-button>
            </div>
            <p><b>擅长方向：</b>{{ selectedCreator?.categories || selectedCreator?.strengths || '—' }}</p>
            <p><b>内容类型：</b>{{ selectedCreator?.content_type || '—' }}</p>
            <p><b>主页：</b><n-button v-if="selectedCreator?.home_url" size="small" secondary @click="openLink(selectedCreator.home_url)">打开主页</n-button><span v-else>—</span></p>
          </div>
          <div class="detail-section">
            <h3>备注</h3>
            <p>{{ selectedCreator?.notes || selectedCreator?.bad_direction || '暂无备注' }}</p>
          </div>
          <div class="detail-actions">
            <n-button v-if="timeMode === 'phase' && selectedPhaseId" type="primary" secondary @click="openPhaseCost(selectedCreator)">填写阶段付费</n-button>
            <n-button secondary @click="openForm(selectedCreator)">编辑</n-button>
            <n-button type="error" secondary @click="del(selectedCreator.id)">删除</n-button>
          </div>
        </div>
      </div>
    </template>

    <Modal :show="showPhaseCost" @close="showPhaseCost = false">
      <template #head><h3>填写阶段付费</h3></template>
      <div class="phase-cost-summary">
        <div><span>创作者</span><b>{{ phaseCostCreator?.name || '—' }}</b></div>
        <div><span>营销阶段</span><b>{{ selectedPhase?.name || '—' }}</b></div>
        <div><span>阶段总播放</span><b>{{ fmt(phaseMetric(phaseCostCreator).total_play) }}</b></div>
      </div>
      <div class="form-row"><label>本阶段实际付费金额（元）*</label><n-input-number v-model:value="phaseCostForm.paid_amount" :min="0" :precision="2" style="width:100%" placeholder="例如：5000" /></div>
      <div class="phase-cpm-preview">
        <span>预计 CPM</span><b>{{ phaseCostPreview }}</b>
        <small>付费金额 ÷ 阶段总播放 × 1000</small>
      </div>
      <template #foot><n-button type="primary" :loading="savingPhaseCost" @click="savePhaseCost">保存并计算 CPM</n-button></template>
    </Modal>

    <Modal :show="showStrengthAnalysis" @close="showStrengthAnalysis = false" wide>
      <template #head><h3>AI 擅长方向分析</h3></template>
      <div class="strength-analysis-meta">
        <span class="tag blue">{{ strengthAnalysis.mode === 'ai' ? 'AI 分析' : '规则分析' }}</span>
        <span>分析样本 {{ strengthAnalysis.sample_count || 0 }} 条</span>
        <span>{{ strengthAnalysis.message }}</span>
      </div>
      <div class="form-row full"><label>建议擅长方向（可修改后保存）</label><n-input v-model:value="strengthCategoriesDraft" placeholder="多个方向用逗号分隔" /></div>
      <div class="strength-analysis-card"><b>核心优势</b><p>{{ strengthAnalysis.core_advantage || '—' }}</p></div>
      <div class="strength-analysis-card"><b>待验证方向</b><p>{{ strengthAnalysis.pending_direction || '暂无' }}</p></div>
      <div class="strength-evidence" v-if="strengthAnalysis.evidence?.length">
        <b>数据依据</b><p v-for="item in strengthAnalysis.evidence" :key="item">{{ item }}</p>
      </div>
      <template #foot>
        <n-button secondary @click="showStrengthAnalysis = false">暂不保存</n-button>
        <n-button type="primary" :loading="savingStrengths" @click="saveStrengthAnalysis">确认保存</n-button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, watch } from 'vue'
import { NButton, NSpace } from 'naive-ui'
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from '../utils/api.js'
import { showToast, getUser } from '../stores/app.js'
import { fmt } from '../utils/helpers.js'
import Modal from '../components/Modal.vue'; import StatusTag from '../components/StatusTag.vue'; import EmptyState from '../components/EmptyState.vue'

const filters = ref({ platform: '', q: '' }), creators = ref([]), showForm = ref(false), editing = ref(null), form = ref({}), showImport = ref(false), importFile = ref(null)
const phases = ref([]), selectedPhaseId = ref(null), phasePerformance = ref(new Map())
const timeMode = ref('phase'), customDateFrom = ref(''), customDateTo = ref('')
const showPhaseForm = ref(false), savingPhase = ref(false), phaseForm = ref({ name: '', start_date: '' })
const loading = ref(false), error = ref(''), saving = ref(false), importing = ref(false), busyId = ref(null), fetchingProfile = ref(false), syncingFans = ref(false)
const syncProgress = ref({ done: 0, total: 0 })
const detailVisible = ref(false), selectedCreator = ref(null)
const checkedCreatorIds = ref([])
const creatorPage = ref(1), pageSize = 15
const creatorSort = ref({ key: 'total_play', order: 'desc' })
const publishedData = ref(null), publishedLoading = ref(false), publishedError = ref(''), rematching = ref(false)
const showPhaseCost = ref(false), savingPhaseCost = ref(false), phaseCostCreator = ref(null), phaseCostForm = ref({ paid_amount: null })
const showStrengthAnalysis = ref(false), analyzingStrengths = ref(false), savingStrengths = ref(false)
const strengthAnalysis = ref({}), strengthCategoriesDraft = ref('')
const platformOptions = ['B站', '抖音', '微博', '小红书', '其他'].map(v => ({ label: v, value: v }))
const platformFilterOptions = platformOptions.filter(o => o.value !== '其他')
const selectedPhase = computed(() => phases.value.find(p => Number(p.id) === Number(selectedPhaseId.value)) || null)
const phaseMetric = row => phasePerformance.value.get(Number(row?.id)) || { content_count: 0, total_play: 0, avg_play: 0, paid_amount: null, cpm: null, avg_activation: null, avg_roi7: null, high_count: 0 }

const filtered = computed(() => {
  let l = creators.value
  if (selectedPhaseId.value) l = l.filter(c => phaseMetric(c).content_count > 0)
  if (filters.value.platform) l = l.filter(c => c.platform === filters.value.platform)
  if (filters.value.q) { const q = filters.value.q.toLowerCase(); l = l.filter(c => (c.name + ' ' + (c.categories || '')).toLowerCase().includes(q)) }
  const direction = creatorSort.value.order === 'asc' ? 1 : -1
  const key = creatorSort.value.key
  return [...l].sort((a, b) => {
    if (key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN') * direction
    const value = row => {
      if (key === 'fans') return Number(row.fans) || 0
      const metric = phaseMetric(row)
      if (key === 'avg_play' && !selectedPhaseId.value) return Number(row.avg_play) || 0
      const metricKey = { total_play: 'total_play', avg_play: 'avg_play', content_count: 'content_count', cpm: 'cpm' }[key]
      return Number(metric[metricKey]) || 0
    }
    return (value(a) - value(b)) * direction
  })
})
const creatorTotalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const pagedCreators = computed(() => filtered.value.slice((creatorPage.value - 1) * pageSize, creatorPage.value * pageSize))
const creatorPageNumbers = computed(() => {
  const start = Math.max(1, Math.min(creatorPage.value - 2, creatorTotalPages.value - 4))
  return Array.from({ length: Math.min(5, creatorTotalPages.value) }, (_, i) => start + i)
})
watch([filters, creatorSort, selectedPhaseId, timeMode, customDateFrom, customDateTo], () => { creatorPage.value = 1 }, { deep: true })
function resetCreatorFilters() {
  filters.value = { platform: '', q: '' }
  creatorSort.value = { key: 'total_play', order: 'desc' }
}
const pubSummary = computed(() => publishedData.value?.summary || {})
const publishedItems = computed(() => publishedData.value?.items || [])
const creatorSortValue = (row, key) => {
  if (key === 'fans') return Number(row.fans) || 0
  const metric = phaseMetric(row)
  if (key === 'avg_play' && !selectedPhaseId.value) return Number(row.avg_play) || 0
  const metricKey = { total_play: 'total_play', avg_play: 'avg_play', content_count: 'content_count', cpm: 'cpm' }[key]
  return Number(metric[metricKey]) || 0
}
const creatorSortProps = key => ({
  sorter: key === 'name'
    ? (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    : (a, b) => creatorSortValue(a, key) - creatorSortValue(b, key),
  sortOrder: creatorSort.value.key === key ? (creatorSort.value.order === 'asc' ? 'ascend' : 'descend') : false
})
function handleCreatorTableSort(sorter) {
  if (!sorter || !sorter.order) creatorSort.value = { key: 'total_play', order: 'desc' }
  else creatorSort.value = { key: sorter.columnKey, order: sorter.order === 'ascend' ? 'asc' : 'desc' }
}
const creatorColumns = computed(() => [
  { type: 'selection', width: 44 },
  {
    title: '创作者',
    key: 'name',
    ...creatorSortProps('name'),
    minWidth: 140,
    render: row => h('span', { class: 'row-link', onClick: () => openDetail(row) }, row.name)
  },
  { title: '平台', key: 'platform', width: 92, render: row => row.platform || '—' },
  { title: '粉丝', key: 'fans', width: 120, ...creatorSortProps('fans'), render: row => fmt(row.fans) },
  { title: '发布数', key: 'content_count', width: 90, ...creatorSortProps('content_count'), render: row => phaseMetric(row).content_count },
  { title: '总播放', key: 'total_play', width: 115, ...creatorSortProps('total_play'), render: row => fmt(phaseMetric(row).total_play) },
  { title: '均播放', key: 'avg_play', width: 115, ...creatorSortProps('avg_play'), render: row => fmt(selectedPhaseId.value ? phaseMetric(row).avg_play : row.avg_play) },
  { title: '高表现', key: 'phase_high', width: 76, render: row => phaseMetric(row).high_count },
  { title: '擅长方向', key: 'categories', minWidth: 180, render: row => h('span', { class: 'muted-cell' }, row.categories || '—') },
  { title: '阶段 CPM', key: 'cpm', width: 135, ...creatorSortProps('cpm'), render: row => h(NButton, { size: 'small', text: true, type: 'primary', disabled: timeMode.value !== 'phase', onClick: () => openPhaseCost(row) }, () => phaseCpm(row)) },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render: row => h(NSpace, { size: 6, wrap: false }, () => [
      h(NButton, { size: 'small', secondary: true, onClick: () => openForm(row) }, () => '编辑'),
      h(NButton, { size: 'small', type: 'error', secondary: true, disabled: busyId.value === row.id, onClick: () => del(row.id) }, () => '删除')
    ])
  }
])
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [creatorList, phaseList] = await Promise.all([apiGet('/creators'), apiGet('/creators/phases')])
    creators.value = creatorList
    phases.value = phaseList || []
    if (!selectedPhaseId.value && phases.value.length) selectedPhaseId.value = phases.value[0].id
    await loadPhasePerformance()
  } catch (e) {
    error.value = e.message
    showToast(e.message, true)
  } finally {
    loading.value = false
  }
}
async function loadPhasePerformance() {
  if (timeMode.value === 'custom' && !customDateFrom.value) return
  if (timeMode.value !== 'custom' && !selectedPhaseId.value) {
    phasePerformance.value = new Map()
    return
  }
  try {
    const query = timeMode.value === 'custom'
      ? `date_from=${customDateFrom.value}&date_to=${customDateTo.value || ''}`
      : `campaign_id=${selectedPhaseId.value}`
    const r = await apiGet(`/creators/phase-performance?${query}`)
    phasePerformance.value = new Map((r.list || []).map(item => [Number(item.creator_id), item]))
  } catch (e) { showToast(e.message, true) }
}
function phaseMonth(date) {
  const value = String(date || '')
  return /^\d{4}-\d{2}/.test(value) ? `${Number(value.slice(5, 7))}月` : '未定期'
}
async function selectPhase(id) {
  timeMode.value = 'phase'
  selectedPhaseId.value = id
  await loadPhasePerformance()
  if (detailVisible.value && selectedCreator.value) await loadPublished(selectedCreator.value.id)
}
async function applyCustomTime() {
  if (!customDateFrom.value) return showToast('请选择开始日期', true)
  if (customDateTo.value && customDateTo.value < customDateFrom.value) return showToast('结束日期不能早于开始日期', true)
  timeMode.value = 'custom'
  await loadPhasePerformance()
  if (detailVisible.value && selectedCreator.value) await loadPublished(selectedCreator.value.id)
}
async function clearCustomTime() {
  customDateFrom.value = ''
  customDateTo.value = ''
  timeMode.value = 'phase'
  await loadPhasePerformance()
  if (detailVisible.value && selectedCreator.value) await loadPublished(selectedCreator.value.id)
}
function openPhaseForm() {
  phaseForm.value = { name: '', start_date: '' }
  showPhaseForm.value = true
}
async function savePhase() {
  const name = String(phaseForm.value.name || '').trim()
  const startDate = phaseForm.value.start_date
  if (!name || !startDate) return showToast('请填写阶段名称和开始日期', true)
  savingPhase.value = true
  try {
    const created = await apiPost('/campaigns', {
      name,
      game_name: '杖剑传说',
      start_date: startDate,
      status: '已归档',
      created_by: getUser()
    })
    phases.value = await apiGet('/creators/phases')
    showPhaseForm.value = false
    await selectPhase(created.id)
    showToast('阶段已新增，可以继续补录其他历史阶段')
  } catch (e) { showToast(e.message, true) }
  finally { savingPhase.value = false }
}
async function syncAllFans() {
  syncingFans.value = true
  try {
    let r = await apiPost('/creator-accounts/sync-fans', {})
    syncProgress.value = { done: r.done || 0, total: r.total || 0 }
    while (r.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 1200))
      r = await apiGet('/creator-accounts/sync-fans/status')
      syncProgress.value = { done: r.done || 0, total: r.total || 0 }
    }
    if (r.status === 'failed') throw new Error(r.error || '粉丝同步失败')
    showToast(`同步完成：主页获取 ${r.liveOk || 0} 位，案例回填 ${r.caseOk || 0} 位，失败 ${r.failCount || 0} 位`, false)
    await load()
  } catch (e) { showToast(e.message, true) }
  finally { syncingFans.value = false; syncProgress.value = { done: 0, total: 0 } }
}
function openForm(c = null) {
  editing.value = c
  form.value = c
    ? { ...c, platform: c.primary_platform || c.platform || 'B站' }
    : { name: '', platform: 'B站', fans: 0, avg_play: 0, categories: '', home_url: '' }
  showForm.value = true
}
async function fetchProfile() {
  const url = String(form.value.home_url || '').trim()
  if (!url || fetchingProfile.value) return
  fetchingProfile.value = true
  try {
    const profile = await apiPost('/creators/fetch-profile', { url })
    form.value.fans = profile.fans
    if (profile.platform) form.value.platform = profile.platform
    if (!form.value.name && profile.name) form.value.name = profile.name
    showToast(`已获取主页数据：${fmt(profile.fans)} 粉丝`)
  } catch (e) { showToast(`获取失败：${e.message}`, true) }
  finally { fetchingProfile.value = false }
}
function openDetail(c) {
  selectedCreator.value = c
  detailVisible.value = true
  loadPublished(c.id)
}
function closeDetail() {
  detailVisible.value = false
  selectedCreator.value = null
  publishedData.value = null
  publishedError.value = ''
}
function openLink(url) { if (url) window.open(url, '_blank') }
function fmtDate(d) { return d ? String(d).slice(0, 10) : '—' }
function dateBefore(value) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}
async function analyzeStrengths() {
  if (!selectedCreator.value) return
  analyzingStrengths.value = true
  try {
    const range = timeMode.value === 'custom'
      ? { start: customDateFrom.value, end: customDateTo.value }
      : { start: selectedPhase.value?.phase_start || '', end: selectedPhase.value?.phase_end_exclusive ? dateBefore(selectedPhase.value.phase_end_exclusive) : '' }
    const result = await apiPost(`/creators/${selectedCreator.value.id}/analyze-strengths`, range, { timeout: 120000 })
    strengthAnalysis.value = result
    strengthCategoriesDraft.value = (result.categories || []).join('，')
    showStrengthAnalysis.value = true
  } catch (e) { showToast(e.message, true) }
  finally { analyzingStrengths.value = false }
}
async function saveStrengthAnalysis() {
  const categories = String(strengthCategoriesDraft.value || '').trim()
  if (!categories) return showToast('请至少保留一个擅长方向', true)
  const creatorId = Number(selectedCreator.value?.id)
  if (!creatorId) return showToast('当前创作者信息已失效，请关闭抽屉后重试', true)
  savingStrengths.value = true
  try {
    await apiPut(`/creators/${creatorId}`, { categories })
    const listRow = creators.value.find(row => Number(row.id) === creatorId)
    if (listRow) listRow.categories = categories
    if (selectedCreator.value && Number(selectedCreator.value.id) === creatorId) {
      selectedCreator.value = { ...selectedCreator.value, categories }
    }
    showStrengthAnalysis.value = false
    showToast('擅长方向已确认保存')
  } catch (e) { showToast(e.message, true) }
  finally { savingStrengths.value = false }
}
function phaseCpm(row) {
  const value = phaseMetric(row).cpm
  return value == null ? '填写付费' : `¥${fmt(value)}`
}
const phaseCostPreview = computed(() => {
  const amount = Number(phaseCostForm.value.paid_amount)
  const play = Number(phaseMetric(phaseCostCreator.value).total_play)
  if (!Number.isFinite(amount) || amount < 0 || !play) return '等待播放数据'
  return `¥${fmt(Math.round(amount / play * 1000 * 100) / 100)}`
})
async function openPhaseCost(creator) {
  if (!creator || timeMode.value !== 'phase' || !selectedPhaseId.value) return showToast('请先选择营销任务阶段', true)
  phaseCostCreator.value = creator
  phaseCostForm.value = { paid_amount: phaseMetric(creator).paid_amount }
  try {
    const saved = await apiGet(`/creators/${creator.id}/phase-cost?campaign_id=${selectedPhaseId.value}`)
    phaseCostForm.value = { paid_amount: saved.paid_amount }
    showPhaseCost.value = true
  } catch (e) { showToast(e.message, true) }
}
async function savePhaseCost() {
  if (phaseCostForm.value.paid_amount == null || Number(phaseCostForm.value.paid_amount) < 0) return showToast('请填写阶段付费金额', true)
  savingPhaseCost.value = true
  try {
    await apiPut(`/creators/${phaseCostCreator.value.id}/phase-cost`, { ...phaseCostForm.value, campaign_id: selectedPhaseId.value })
    await loadPhasePerformance()
    if (detailVisible.value && selectedCreator.value) await loadPublished(selectedCreator.value.id)
    showPhaseCost.value = false
    showToast('阶段付费已保存，CPM 已重新计算')
  } catch (e) { showToast(e.message, true) }
  finally { savingPhaseCost.value = false }
}
async function loadPublished(id) {
  if (!id) return
  publishedLoading.value = true
  publishedError.value = ''
  try {
    const query = timeMode.value === 'custom'
      ? `?date_from=${customDateFrom.value}&date_to=${customDateTo.value || ''}`
      : (selectedPhaseId.value ? `?campaign_id=${selectedPhaseId.value}` : '')
    publishedData.value = await apiGet(`/creators/${id}/published${query}`)
  } catch (e) {
    publishedError.value = e.message
    showToast(e.message, true)
  } finally {
    publishedLoading.value = false
  }
}
async function fixCaseLinks() {
  if (!selectedCreator.value) return
  rematching.value = true
  try {
    const r = await apiPost('/cases/rematch', {})
    showToast(`已修复 ${r.updated || 0} 条案例关联`)
    await Promise.all([load(), loadPublished(selectedCreator.value.id)])
  } catch (e) {
    showToast(e.message, true)
  } finally {
    rematching.value = false
  }
}
async function save() {
  if (!form.value.name.trim()) return showToast('请输入名称', true)
  saving.value = true
  try {
    if (form.value.home_url) await fetchProfile()
    if (editing.value) await apiPut(`/creators/${editing.value.id}`, form.value)
    else await apiPost('/creators', { ...form.value, created_by: getUser() })
    showForm.value = false
    showToast('已保存')
    await load()
    if (selectedCreator.value) selectedCreator.value = creators.value.find(c => c.id === selectedCreator.value.id) || selectedCreator.value
    if (selectedCreator.value) await loadPublished(selectedCreator.value.id)
  } catch (e) { showToast(e.message, true) }
  finally { saving.value = false }
}
async function del(id) {
  if (!confirm('确认删除？')) return
  busyId.value = id
  try {
    await apiDelete(`/creators/${id}`)
    showToast('已删除')
    checkedCreatorIds.value = checkedCreatorIds.value.filter(rowId => rowId !== id)
    if (selectedCreator.value?.id === id) closeDetail()
    load()
  } catch (e) { showToast(e.message, true) }
  finally { busyId.value = null }
}
async function batchDelete() {
  const ids = [...checkedCreatorIds.value]
  if (!ids.length) return
  if (!confirm(`确认删除选中的 ${ids.length} 位创作者？`)) return
  busyId.value = 'batch'
  try {
    await Promise.all(ids.map(id => apiDelete(`/creators/${id}`)))
    showToast(`已删除 ${ids.length} 位创作者`)
    if (selectedCreator.value && ids.includes(selectedCreator.value.id)) closeDetail()
    checkedCreatorIds.value = []
    await load()
  } catch (e) { showToast(e.message, true) }
  finally { busyId.value = null }
}
async function doImport() {
  if (!importFile.value) return
  if (timeMode.value !== 'phase' || !selectedPhaseId.value) return showToast('请先选择付费对应的营销阶段', true)
  importing.value = true
  try {
    const result = await apiUpload(`/import/creators?campaign_id=${selectedPhaseId.value}`, importFile.value)
    showImport.value = false
    importFile.value = null
    showToast(`导入成功：新增 ${result.inserted || 0} 位，匹配已有 ${result.updated || 0} 位，录入阶段付费 ${result.paymentImported || 0} 位`)
    await load()
  } catch (e) { showToast(e.message, true) }
  finally { importing.value = false }
}
function openCreatorImport() {
  if (timeMode.value !== 'phase' || !selectedPhaseId.value) return showToast('请先点击选择付费对应的营销阶段', true)
  showImport.value = true
}
function handleImportChange({ file }) {
  importFile.value = file?.file || null
}
function downloadTemplate() { window.open('/api/import/creators/template', '_blank') }
onMounted(load)
</script>
