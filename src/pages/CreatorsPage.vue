<template>
  <div>
    <div class="page-head">
      <div class="page-head-left"><h2>创作者库</h2><div class="sub">管理合作创作者 · 追踪表现数据</div></div>
      <div class="page-head-actions">
        <n-button secondary :loading="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button secondary :loading="syncingFans" @click="syncAllFans">{{ syncingFans ? '同步中...' : '同步全部粉丝' }}</n-button>
        <n-button type="primary" @click="openForm()">+ 添加创作者</n-button>
        <n-button secondary @click="showImport = true">导入名单</n-button>
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
      <n-button size="small" secondary @click="filters = { platform: '', q: '' }">重置</n-button>
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
        <div class="form-row"><label>平台</label><n-select v-model:value="form.platform" :options="platformOptions" /></div>
        <div class="form-row"><label>粉丝量（主页实时获取）</label><n-input-number v-model:value="form.fans" :min="0" :show-button="false" readonly style="width:100%" placeholder="填写主页链接后自动获取" /></div>
        <div class="form-row"><label>均播放量（案例自动统计）</label><n-input-number v-model:value="form.avg_play" :min="0" :show-button="false" readonly style="width:100%" placeholder="导入案例后自动计算" /></div>
        <div class="form-row"><label>单条报价</label><n-input-number v-model:value="form.price" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>预估 CPM（手动填写）</label><n-input-number v-model:value="form.manual_cpm" :min="0" :step="1" style="width:100%" placeholder="留空则按报价和均播计算" /></div>
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
            <div><b>{{ cpm(selectedCreator, publishedData ? pubSummary.avg_play : null) }}</b><span>预估 CPM</span></div>
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
                <div><b>{{ cpm(selectedCreator, pubSummary.avg_play) }}</b><span>预估 CPM</span></div>
                <div><b>{{ pubSummary.avg_activation ?? '—' }}</b><span>平均激活率</span></div>
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
            <h3>合作画像</h3>
            <p><b>擅长方向：</b>{{ selectedCreator?.categories || selectedCreator?.strengths || '—' }}</p>
            <p><b>内容类型：</b>{{ selectedCreator?.content_type || '—' }}</p>
            <p><b>报价：</b>{{ selectedCreator?.price ? fmt(selectedCreator.price) : '—' }}</p>
            <p><b>主页：</b><n-button v-if="selectedCreator?.home_url" size="small" secondary @click="openLink(selectedCreator.home_url)">打开主页</n-button><span v-else>—</span></p>
          </div>
          <div class="detail-section">
            <h3>备注</h3>
            <p>{{ selectedCreator?.notes || selectedCreator?.bad_direction || '暂无备注' }}</p>
          </div>
          <div class="detail-actions">
            <n-button secondary @click="openForm(selectedCreator)">编辑</n-button>
            <n-button type="error" secondary @click="del(selectedCreator.id)">删除</n-button>
          </div>
        </div>
      </div>
    </template>
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
const detailVisible = ref(false), selectedCreator = ref(null)
const checkedCreatorIds = ref([])
const creatorPage = ref(1), pageSize = 15
const publishedData = ref(null), publishedLoading = ref(false), publishedError = ref(''), rematching = ref(false)
const platformOptions = ['B站', '抖音', '微博', '小红书', '其他'].map(v => ({ label: v, value: v }))
const platformFilterOptions = platformOptions.filter(o => o.value !== '其他')
const selectedPhase = computed(() => phases.value.find(p => Number(p.id) === Number(selectedPhaseId.value)) || null)
const phaseMetric = row => phasePerformance.value.get(Number(row.id)) || { content_count: 0, total_play: 0, avg_play: 0, avg_activation: null, avg_roi7: null, high_count: 0 }

const filtered = computed(() => {
  let l = creators.value
  if (selectedPhaseId.value) l = l.filter(c => phaseMetric(c).content_count > 0)
  if (filters.value.platform) l = l.filter(c => c.platform === filters.value.platform)
  if (filters.value.q) { const q = filters.value.q.toLowerCase(); l = l.filter(c => (c.name + ' ' + (c.categories || '')).toLowerCase().includes(q)) }
  return l
})
const creatorTotalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const pagedCreators = computed(() => filtered.value.slice((creatorPage.value - 1) * pageSize, creatorPage.value * pageSize))
const creatorPageNumbers = computed(() => {
  const start = Math.max(1, Math.min(creatorPage.value - 2, creatorTotalPages.value - 4))
  return Array.from({ length: Math.min(5, creatorTotalPages.value) }, (_, i) => start + i)
})
watch([filters, selectedPhaseId, timeMode, customDateFrom, customDateTo], () => { creatorPage.value = 1 }, { deep: true })
const pubSummary = computed(() => publishedData.value?.summary || {})
const publishedItems = computed(() => publishedData.value?.items || [])
const creatorColumns = computed(() => [
  { type: 'selection', width: 44 },
  {
    title: '创作者',
    key: 'name',
    minWidth: 140,
    render: row => h('span', { class: 'row-link', onClick: () => openDetail(row) }, row.name)
  },
  { title: '平台', key: 'platform', width: 92, render: row => row.platform || '—' },
  { title: '粉丝', key: 'fans', width: 110, render: row => fmt(row.fans) },
  { title: '发布数', key: 'phase_content_count', width: 76, render: row => phaseMetric(row).content_count },
  { title: '总播放', key: 'phase_total_play', width: 105, render: row => fmt(phaseMetric(row).total_play) },
  { title: '均播放', key: 'avg_play', width: 105, render: row => fmt(selectedPhaseId.value ? phaseMetric(row).avg_play : row.avg_play) },
  { title: '平均激活', key: 'phase_activation', width: 90, render: row => phaseMetric(row).avg_activation == null ? '—' : `${phaseMetric(row).avg_activation}%` },
  { title: '平均 ROI', key: 'phase_roi', width: 86, render: row => phaseMetric(row).avg_roi7 ?? '—' },
  { title: '高表现', key: 'phase_high', width: 76, render: row => phaseMetric(row).high_count },
  { title: '擅长方向', key: 'categories', minWidth: 180, render: row => h('span', { class: 'muted-cell' }, row.categories || '—') },
  { title: '预估 CPM', key: 'cpm', width: 110, render: row => h('b', cpm(row, selectedPhaseId.value ? phaseMetric(row).avg_play : null)) },
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
    const r = await apiPost('/creator-accounts/sync-fans', {})
    showToast(`同步完成：主页获取 ${r.liveOk || 0} 位，案例回填 ${r.caseOk || 0} 位，失败 ${r.failCount || 0} 位`, (r.failCount || 0) > 0)
    await load()
  } catch (e) { showToast(e.message, true) }
  finally { syncingFans.value = false }
}
function openForm(c = null) {
  editing.value = c
  form.value = c ? { ...c } : { name: '', platform: 'B站', fans: 0, avg_play: 0, price: null, manual_cpm: null, categories: '', home_url: '' }
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
function cpm(row, playOverride = null) {
  const manual = Number(row?.manual_cpm)
  if (Number.isFinite(manual) && manual > 0) return `¥${fmt(manual)}`
  const price = Number(row?.price || 0)
  const play = Number(playOverride ?? row?.avg_play ?? 0)
  if (!price || !play) return '—'
  return `¥${fmt(Math.round((price / play) * 1000))}`
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
  importing.value = true
  try {
    await apiUpload('/import/creators', importFile.value)
    showImport.value = false
    importFile.value = null
    showToast('导入成功')
    load()
  } catch (e) { showToast(e.message, true) }
  finally { importing.value = false }
}
function handleImportChange({ file }) {
  importFile.value = file?.file || null
}
function downloadTemplate() { window.open('/api/import/creators/template', '_blank') }
onMounted(load)
</script>
