<template>
  <div>
    <div class="page-head">
      <div class="page-head-left"><h2>案例库</h2><div class="sub">沉淀发布案例 · 积累内容资产</div></div>
      <div class="page-head-actions">
        <n-button secondary :loading="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button secondary :loading="rejudging" @click="rejudgeCases">{{ rejudging ? '判定中...' : '重新判定评级' }}</n-button>
        <n-button secondary :loading="analyzingCases" @click="analyzeMissingCases">{{ analyzingCases ? 'AI 分析中...' : 'AI 补全内容分类' }}</n-button>
        <n-button type="primary" @click="openForm()">+ 新增案例</n-button>
        <n-button secondary @click="showImport = true">导入 Excel/CSV</n-button>
      </div>
    </div>

    <div class="card rating-rules">
      <div>
        <b>效果评级标准</b>
        <span>系统会在新增、编辑、导入和重新判定时自动计算。</span>
        <n-button size="tiny" secondary style="margin-left:10px" @click="openRatingRules">修改标准</n-button>
      </div>
      <div class="rule-chips">
        <span class="tag red">爆款：播放≥{{ fmt(ratingRules.viral_play) }}</span>
        <span class="tag green">良好：播放≥{{ fmt(ratingRules.good_play) }}</span>
        <span class="tag blue">一般：播放≥{{ fmt(ratingRules.normal_play) }}</span>
        <span class="tag gray">失败：播放低于一般阈值</span>
      </div>
    </div>

    <n-tabs v-model:value="tab" type="segment" animated class="page-tabs">
      <n-tab-pane name="all" tab="全部" />
      <n-tab-pane name="high" tab="高表现" />
      <n-tab-pane name="favorite" tab="收藏" />
    </n-tabs>

    <div class="filter-bar">
      <n-select v-model:value="filters.platform" :options="platformFilterOptions" placeholder="平台-全部" clearable />
      <n-select v-model:value="filters.result" :options="resultFilterOptions" placeholder="效果-全部" clearable />
      <n-input class="q" v-model:value="filters.q" placeholder="搜索标题/创作者" clearable />
      <n-button size="small" secondary @click="resetFilters">重置</n-button>
      <n-button v-if="checkedCaseIds.length" size="small" type="error" secondary @click="batchDelete">
        批量删除 {{ checkedCaseIds.length }}
      </n-button>
    </div>
    <div class="time-range-filter" style="margin-bottom:14px">
      <div><label for="case-date-from">发布开始日期</label><input id="case-date-from" v-model="dateDraft.from" class="date-input" type="date" /></div>
      <div><label for="case-date-to">发布结束日期</label><input id="case-date-to" v-model="dateDraft.to" class="date-input" type="date" /></div>
      <n-button type="primary" @click="applyDateFilter">查询</n-button>
      <n-button secondary @click="clearDateFilter">清空时间</n-button>
      <span v-if="filters.date_from" class="hint">当前时间：{{ filters.date_from }} 至 {{ filters.date_to || '今天' }} · 共 {{ filtered.length }} 条</span>
    </div>

    <div v-if="loading" class="loading-card"><span>正在加载案例数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="load">重试</n-button>
    </div>

    <template v-else>
      <div v-if="isCompactCaseList" class="case-mobile-list">
        <n-card v-for="item in pagedCases" :key="item.id" class="case-mobile-card" :bordered="false" @click="openDetail(item)">
          <div class="case-mobile-head">
            <div class="row-link">{{ item.title }}</div>
            <StatusTag :text="item.result || '一般'" />
          </div>
          <div class="case-mobile-meta">
            <span>{{ item.platform || '平台待定' }}</span>
            <span>{{ item.creator_name || '创作者待定' }}</span>
            <span>{{ fmtDate(item.publish_date) }}</span>
          </div>
          <div class="case-mobile-metrics">
            <div><b>{{ fmt(item.play_count) }}</b><span>播放</span></div>
            <div><b>{{ fmt(item.like_count) }}</b><span>点赞</span></div>
            <div><b>{{ fmt(item.comment_count) }}</b><span>评论</span></div>
            <div><b>{{ fmt(item.favorite_count) }}</b><span>收藏</span></div>
            <div><b>{{ fmt(item.share_count) }}</b><span>分享</span></div>
          </div>
          <div class="case-mobile-actions" @click.stop>
            <n-button size="small" secondary :disabled="busyId === item.id" @click="toggleFavorite(item)">{{ item.is_favorite ? '取消收藏' : '收藏' }}</n-button>
            <n-button size="small" type="error" secondary :disabled="busyId === item.id" @click="del(item.id)">删除</n-button>
          </div>
        </n-card>
      </div>
      <n-data-table
        v-else
        v-model:checked-row-keys="checkedCaseIds"
        class="data-table-card cases-table"
        :columns="caseColumns"
        :data="pagedCases"
        :bordered="false"
        :single-line="false"
        :row-key="row => row.id"
        @update:sorter="handleCaseTableSort"
        table-layout="fixed"
      />
      <div v-if="filtered.length" class="list-pagination">
        <span>共 {{ filtered.length }} 条 · 每页 15 条</span>
        <div>
          <n-button size="small" secondary :disabled="casePage <= 1" @click="casePage--">上一页</n-button>
          <n-button v-for="page in casePageNumbers" :key="page" size="small" :type="page === casePage ? 'primary' : 'default'" :secondary="page !== casePage" @click="casePage = page">{{ page }}</n-button>
          <n-button size="small" secondary :disabled="casePage >= caseTotalPages" @click="casePage++">下一页</n-button>
        </div>
      </div>
    </template>

    <Modal :show="showImport" @close="showImport = false">
      <template #head><h3>导入案例数据</h3></template>
      <div class="form-row">
        <label>导入类型</label>
        <n-select v-model:value="importMode" :options="importModeOptions" />
      </div>
      <div class="hint" style="margin-bottom:12px">{{ importModeHint }}</div>
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

    <Modal :show="showRatingRules" @close="showRatingRules = false" wide>
      <template #head><h3>修改效果评级标准</h3></template>
      <div class="hint" style="margin-bottom:14px">保存后会立即按新标准重新判定案例库中的全部案例。</div>
      <div class="form-grid">
        <div class="form-row"><label>爆款最低播放量</label><n-input-number v-model:value="ratingForm.viral_play" :min="0" :step="10000" style="width:100%" /></div>
        <div class="form-row"><label>良好最低播放量</label><n-input-number v-model:value="ratingForm.good_play" :min="0" :step="10000" style="width:100%" /></div>
        <div class="form-row"><label>一般最低播放量</label><n-input-number v-model:value="ratingForm.normal_play" :min="0" :step="1000" style="width:100%" /></div>
      </div>
      <template #foot>
        <n-button secondary @click="resetRatingRules">恢复默认值</n-button>
        <n-button type="primary" :loading="savingRules" @click="saveRatingRules">{{ savingRules ? '保存并重算中...' : '保存并立即重算' }}</n-button>
      </template>
    </Modal>

    <Modal :show="showForm" @close="showForm = false" wide>
      <template #head><h3>{{ editing ? '编辑' : '新增' }}案例</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>标题 *</label><n-input v-model:value="form.title" /></div>
        <div class="form-row"><label>平台</label><n-select v-model:value="form.platform" :options="platformOptions" /></div>
        <div class="form-row"><label>创作者</label><n-input v-model:value="form.creator_name" /></div>
        <div class="form-row full"><label>链接</label><n-input v-model:value="form.url" /></div>
        <div class="form-row"><label>发布日期</label><n-input v-model:value="form.publish_date" type="date" /></div>
        <div class="form-row"><label>内容形式</label><n-input v-model:value="form.content_type" /></div>
        <div class="form-row"><label>播放量</label><n-input-number v-model:value="form.play_count" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>点赞</label><n-input-number v-model:value="form.like_count" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>评论</label><n-input-number v-model:value="form.comment_count" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>收藏</label><n-input-number v-model:value="form.favorite_count" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>分享</label><n-input-number v-model:value="form.share_count" :min="0" style="width:100%" /></div>
        <div class="form-row full"><label>总结</label><n-input v-model:value="form.summary" type="textarea" /></div>
      </div>
      <template #foot><n-button type="primary" :loading="saving" @click="saveCase">{{ saving ? '保存中...' : '保存' }}</n-button></template>
    </Modal>

    <template v-if="detailVisible">
      <div class="drawer-mask" @click="closeDetail"></div>
      <div class="drawer detail-drawer">
        <div class="drawer-head">
          <div>
            <div class="detail-title">{{ selectedCase?.title }}</div>
            <div class="detail-tags">
              <StatusTag :text="selectedCase?.result || '一般'" />
              <StatusTag :text="selectedCase?.platform || '平台待定'" />
              <span v-if="selectedCase?.benchmark_met" class="tag green">达到基准</span>
              <span v-if="selectedCase?.is_favorite" class="tag orange">已收藏</span>
            </div>
          </div>
          <span class="x" @click="closeDetail">&times;</span>
        </div>
        <div class="drawer-body">
          <div class="detail-metrics">
            <div><b>{{ fmt(selectedCase?.play_count) }}</b><span>播放</span></div>
            <div><b>{{ fmt(selectedCase?.comment_count) }}</b><span>评论</span></div>
            <div><b>{{ fmt(selectedCase?.favorite_count) }}</b><span>收藏</span></div>
            <div><b>{{ fmt(selectedCase?.like_count) }}</b><span>点赞</span></div>
            <div><b>{{ fmt(selectedCase?.share_count) }}</b><span>分享</span></div>
          </div>
          <div class="detail-section">
            <h3>内容信息</h3>
            <p><b>创作者：</b>{{ selectedCase?.creator_name || '—' }}</p>
            <p><b>发布时间：</b>{{ fmtDate(selectedCase?.publish_date) }}</p>
            <p><b>内容形式：</b>{{ selectedCase?.content_type || '—' }}</p>
            <p><b>链接：</b><n-button v-if="selectedCase?.url" size="small" secondary @click="openLink(selectedCase.url)">打开原文</n-button><span v-else>—</span></p>
          </div>
          <div class="detail-section">
            <h3>总结</h3>
            <p>{{ selectedCase?.summary || selectedCase?.review_conclusion || '暂无总结' }}</p>
          </div>
          <div class="detail-actions">
            <n-button secondary @click="openForm(selectedCase)">编辑</n-button>
            <n-button secondary @click="toggleFavorite(selectedCase)">{{ selectedCase?.is_favorite ? '取消收藏' : '收藏' }}</n-button>
            <n-button type="error" secondary @click="del(selectedCase.id)">删除</n-button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, onBeforeUnmount, watch } from 'vue'
import { NButton, NSpace } from 'naive-ui'
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from '../utils/api.js'
import { showToast } from '../stores/app.js'
import { getUser } from '../stores/app.js'
import { fmt } from '../utils/helpers.js'
import Modal from '../components/Modal.vue'; import StatusTag from '../components/StatusTag.vue'; import EmptyState from '../components/EmptyState.vue'

const tab = ref('all'), filters = ref({ platform: '', result: '', date_from: '', date_to: '', q: '' }), cases = ref([]), showImport = ref(false), importFile = ref(null), importMode = ref('cases')
const dateDraft = ref({ from: '', to: '' })
const loading = ref(false), error = ref(''), saving = ref(false), importing = ref(false), rejudging = ref(false), analyzingCases = ref(false), busyId = ref(null)
const showForm = ref(false), editing = ref(null), form = ref({})
const detailVisible = ref(false), selectedCase = ref(null)
const defaultRatingRules = { viral_play: 300000, good_play: 50000, normal_play: 5000, roi: 0.8, activation: 3 }
const ratingRules = ref({ ...defaultRatingRules })
const ratingForm = ref({ ...defaultRatingRules })
const showRatingRules = ref(false), savingRules = ref(false)
const checkedCaseIds = ref([])
const casePage = ref(1), pageSize = 15
const caseSort = ref({ key: 'publish_date', order: 'desc' })
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const platformOptions = ['B站', '抖音', '微博', '小红书', '其他'].map(v => ({ label: v, value: v }))
const platformFilterOptions = platformOptions.filter(o => o.value !== '其他')
const resultFilterOptions = ['爆款', '良好'].map(v => ({ label: v, value: v }))
const importModeOptions = [
  { label: '通用案例/发布数据', value: 'cases' },
  { label: 'B站跑量数据', value: 'cases_bilibili' },
  { label: '抖音跑量数据', value: 'cases_douyin' }
]
const importModeHint = computed(() => ({
  cases: '用于导入已整理好的案例/发布数据；如果表格有“平台”列，会按表格平台入库。',
  cases_bilibili: '用于导入 B站 跑量表；若表格缺少“平台”列，系统会自动按 B站 入库。',
  cases_douyin: '用于导入 抖音 跑量表；若表格缺少“平台”列，系统会自动按 抖音 入库。'
}[importMode.value] || ''))

const filtered = computed(() => {
  let l = cases.value
  if (tab.value === 'high') l = l.filter(c => c.result === '爆款' || c.result === '良好')
  if (tab.value === 'favorite') l = l.filter(c => c.is_favorite)
  if (filters.value.platform) l = l.filter(c => c.platform === filters.value.platform)
  if (filters.value.result) l = l.filter(c => c.result === filters.value.result)
  if (filters.value.date_from) l = l.filter(c => c.publish_date && String(c.publish_date).slice(0, 10) >= filters.value.date_from)
  if (filters.value.date_to) l = l.filter(c => c.publish_date && String(c.publish_date).slice(0, 10) <= filters.value.date_to)
  if (filters.value.q) { const q = filters.value.q.toLowerCase(); l = l.filter(c => (c.title + ' ' + (c.creator_name || '')).toLowerCase().includes(q)) }
  const direction = caseSort.value.order === 'asc' ? 1 : -1
  const key = caseSort.value.key
  return [...l].sort((a, b) => {
    if (key === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN') * direction
    if (key === 'publish_date') return String(a.publish_date || '').localeCompare(String(b.publish_date || '')) * direction
    return ((Number(a[key]) || 0) - (Number(b[key]) || 0)) * direction
  })
})
const caseTotalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const pagedCases = computed(() => filtered.value.slice((casePage.value - 1) * pageSize, casePage.value * pageSize))
const casePageNumbers = computed(() => {
  const start = Math.max(1, Math.min(casePage.value - 2, caseTotalPages.value - 4))
  return Array.from({ length: Math.min(5, caseTotalPages.value) }, (_, i) => start + i)
})
watch([tab, filters, caseSort], () => { casePage.value = 1 }, { deep: true })
function applyDateFilter() {
  if (!dateDraft.value.from) return showToast('请选择开始日期', true)
  if (dateDraft.value.to && dateDraft.value.to < dateDraft.value.from) return showToast('结束日期不能早于开始日期', true)
  filters.value.date_from = dateDraft.value.from
  filters.value.date_to = dateDraft.value.to
}
function clearDateFilter() {
  dateDraft.value = { from: '', to: '' }
  filters.value.date_from = ''
  filters.value.date_to = ''
}
function resetFilters() {
  filters.value = { platform: '', result: '', date_from: '', date_to: '', q: '' }
  caseSort.value = { key: 'publish_date', order: 'desc' }
  dateDraft.value = { from: '', to: '' }
}
const isCompactCaseList = computed(() => viewportWidth.value < 760)
const isMediumCaseTable = computed(() => viewportWidth.value < 1120)
const caseActions = row => h(NSpace, { size: 6, wrap: false, class: 'case-action-group' }, () => [
  h(NButton, { size: 'tiny', secondary: true, disabled: busyId.value === row.id, onClick: () => toggleFavorite(row) }, () => row.is_favorite ? '取消收藏' : '收藏'),
  h(NButton, { size: 'tiny', type: 'error', secondary: true, disabled: busyId.value === row.id, onClick: () => del(row.id) }, () => '删除')
])
const caseSortProps = (key, compare) => ({
  sorter: compare,
  sortOrder: caseSort.value.key === key ? (caseSort.value.order === 'asc' ? 'ascend' : 'descend') : false
})
function handleCaseTableSort(sorter) {
  if (!sorter || !sorter.order) caseSort.value = { key: 'publish_date', order: 'desc' }
  else caseSort.value = { key: sorter.columnKey, order: sorter.order === 'ascend' ? 'asc' : 'desc' }
}
const caseColumns = computed(() => {
  const columns = [
  { type: 'selection', width: 44 },
  {
    title: '标题',
    key: 'title',
    ...caseSortProps('title', (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')),
    width: isMediumCaseTable.value ? 210 : 280,
    render: row => h('div', { class: 'case-title-cell' }, [
      h('span', { class: 'row-link', onClick: () => openDetail(row) }, row.title),
      isMediumCaseTable.value
        ? h('div', { class: 'muted-cell' }, `${row.creator_name || '创作者待定'} · ${fmtDate(row.publish_date)}`)
        : null
    ])
  },
  { title: '平台', key: 'platform', width: 76, render: row => row.platform || '—' },
  { title: '创作者', key: 'creator_name', width: 108, render: row => row.creator_name || '—' },
  { title: '发布日', key: 'publish_date', width: 108, ...caseSortProps('publish_date', (a, b) => String(a.publish_date || '').localeCompare(String(b.publish_date || ''))), render: row => fmtDate(row.publish_date) },
  { title: '播放量', key: 'play_count', width: 104, ...caseSortProps('play_count', (a, b) => (Number(a.play_count) || 0) - (Number(b.play_count) || 0)), render: row => fmt(row.play_count) },
  { title: '点赞', key: 'like_count', width: 88, ...caseSortProps('like_count', (a, b) => (Number(a.like_count) || 0) - (Number(b.like_count) || 0)), render: row => fmt(row.like_count) },
  { title: '评论', key: 'comment_count', width: 88, ...caseSortProps('comment_count', (a, b) => (Number(a.comment_count) || 0) - (Number(b.comment_count) || 0)), render: row => fmt(row.comment_count) },
  { title: '收藏', key: 'favorite_count', width: 88, ...caseSortProps('favorite_count', (a, b) => (Number(a.favorite_count) || 0) - (Number(b.favorite_count) || 0)), render: row => fmt(row.favorite_count) },
  { title: '分享', key: 'share_count', width: 88, ...caseSortProps('share_count', (a, b) => (Number(a.share_count) || 0) - (Number(b.share_count) || 0)), render: row => fmt(row.share_count) },
  { title: '效果', key: 'result', width: 74, render: row => h(StatusTag, { text: row.result || '一般' }) },
  {
    title: '操作',
    key: 'actions',
    width: 118,
    render: caseActions
  }
  ]
  return isMediumCaseTable.value
    ? columns.filter(column => !['creator_name', 'publish_date'].includes(column.key))
    : columns
})
function updateViewportWidth() {
  viewportWidth.value = window.innerWidth
}
function fmtDate(d) { return d ? d.slice(0, 10) : '—' }
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [caseList, rules] = await Promise.all([apiGet('/cases'), apiGet('/cases/rating-rules')])
    cases.value = caseList
    ratingRules.value = { ...defaultRatingRules, ...(rules || {}) }
  } catch (e) {
    error.value = e.message
    showToast(e.message, true)
  } finally {
    loading.value = false
  }
}
function openRatingRules() {
  ratingForm.value = { ...ratingRules.value }
  showRatingRules.value = true
}
function resetRatingRules() { ratingForm.value = { ...defaultRatingRules } }
async function saveRatingRules() {
  savingRules.value = true
  try {
    const r = await apiPut('/cases/rating-rules', ratingForm.value)
    ratingRules.value = { ...r.rules }
    showRatingRules.value = false
    showToast(`评级标准已更新，${r.updated || 0} 条案例评级发生变化`)
    await load()
  } catch (e) { showToast(e.message, true) }
  finally { savingRules.value = false }
}
function openForm(c = null) {
  editing.value = c
  form.value = c ? { ...c } : { title: '', platform: 'B站', creator_name: '', url: '', publish_date: '', content_type: '', play_count: 0, like_count: 0, comment_count: 0, favorite_count: 0, share_count: 0, summary: '' }
  showForm.value = true
}
function openDetail(c) {
  selectedCase.value = c
  detailVisible.value = true
}
function closeDetail() {
  detailVisible.value = false
  selectedCase.value = null
}
function openLink(url) { if (url) window.open(url, '_blank') }
async function saveCase() {
  if (!form.value.title.trim()) return showToast('请输入标题', true)
  saving.value = true
  try {
    if (editing.value) await apiPut(`/cases/${editing.value.id}`, form.value)
    else await apiPost('/cases', { ...form.value, created_by: getUser() })
    showForm.value = false
    showToast('已保存')
    await load()
    if (selectedCase.value) selectedCase.value = cases.value.find(c => c.id === selectedCase.value.id) || selectedCase.value
  } catch (e) { showToast(e.message, true) }
  finally { saving.value = false }
}
async function toggleFavorite(c) {
  busyId.value = c.id
  try {
    await apiPost(`/cases/${c.id}/favorite`)
    showToast(c.is_favorite ? '已取消收藏' : '已收藏')
    await load()
    if (selectedCase.value?.id === c.id) selectedCase.value = cases.value.find(row => row.id === c.id) || selectedCase.value
  } catch (e) { showToast(e.message, true) }
  finally { busyId.value = null }
}
async function rejudgeCases() {
  rejudging.value = true
  try {
    const r = await apiPost('/cases/rejudge')
    showToast(`已重新判定 ${r.updated || 0} 条案例`)
    await load()
    if (selectedCase.value) selectedCase.value = cases.value.find(row => row.id === selectedCase.value.id) || selectedCase.value
  } catch (e) { showToast(e.message, true) }
  finally { rejudging.value = false }
}
async function analyzeMissingCases() {
  analyzingCases.value = true
  try {
    const r = await apiPost('/cases/analyze-missing', {}, { timeout: 300000 })
    showToast(`已分析 ${r.updated || 0} 条案例，其中 AI 成功 ${r.aiUpdated || 0} 条`)
    await load()
  } catch (e) { showToast(e.message, true) }
  finally { analyzingCases.value = false }
}
async function del(id) {
  if (!confirm('确认删除？')) return
  busyId.value = id
  try {
    await apiDelete(`/cases/${id}`)
    showToast('已删除')
    checkedCaseIds.value = checkedCaseIds.value.filter(rowId => rowId !== id)
    if (selectedCase.value?.id === id) closeDetail()
    load()
  }
  catch (e) { showToast(e.message, true) }
  finally { busyId.value = null }
}
async function batchDelete() {
  const ids = [...checkedCaseIds.value]
  if (!ids.length) return
  if (!confirm(`确认删除选中的 ${ids.length} 条案例？`)) return
  busyId.value = 'batch'
  try {
    await Promise.all(ids.map(id => apiDelete(`/cases/${id}`)))
    showToast(`已删除 ${ids.length} 条案例`)
    if (selectedCase.value && ids.includes(selectedCase.value.id)) closeDetail()
    checkedCaseIds.value = []
    await load()
  } catch (e) { showToast(e.message, true) }
  finally { busyId.value = null }
}
async function doImport() {
  if (!importFile.value) return
  importing.value = true
  try {
    const platform = importMode.value === 'cases_bilibili' ? 'B站' : importMode.value === 'cases_douyin' ? '抖音' : ''
    const query = platform ? `?platform=${encodeURIComponent(platform)}` : ''
    await apiUpload(`/import/cases${query}`, importFile.value)
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
function downloadTemplate() { window.open('/api/import/cases/template', '_blank') }
onMounted(() => {
  updateViewportWidth()
  window.addEventListener('resize', updateViewportWidth)
  load()
})
onBeforeUnmount(() => window.removeEventListener('resize', updateViewportWidth))
</script>
