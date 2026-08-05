<template>
  <div>
    <div class="page-head">
      <div class="page-head-left"><h2>案例库</h2><div class="sub">沉淀发布案例 · 积累内容资产</div></div>
      <div class="page-head-actions">
        <n-button secondary :loading="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button secondary :loading="rejudging" @click="rejudgeCases">{{ rejudging ? '判定中...' : '重新判定评级' }}</n-button>
        <n-button type="primary" @click="openForm()">+ 新增案例</n-button>
        <n-button secondary @click="showImport = true">导入 Excel/CSV</n-button>
      </div>
    </div>

    <n-card class="rating-rules card" :bordered="false">
      <div>
        <b>效果评级标准</b>
        <span>系统会在新增、编辑、导入和重新判定时自动计算。</span>
      </div>
      <div class="rule-chips">
        <span class="tag red">爆款：播放≥30万，且 ROI7≥0.8 或激活率≥3%</span>
        <span class="tag green">良好：ROI7≥0.8，或激活率≥3%，或播放≥5万</span>
        <span class="tag blue">一般：播放≥5000，但转化未达良好</span>
        <span class="tag gray">失败：播放<5000，且 ROI7/激活率均未达标</span>
      </div>
    </n-card>

    <n-tabs v-model:value="tab" type="segment" animated class="page-tabs">
      <n-tab-pane name="all" tab="全部" />
      <n-tab-pane name="high" tab="高表现" />
      <n-tab-pane name="favorite" tab="收藏" />
    </n-tabs>

    <div class="filter-bar">
      <n-select v-model:value="filters.platform" :options="platformFilterOptions" placeholder="平台-全部" clearable />
      <n-select v-model:value="filters.result" :options="resultFilterOptions" placeholder="效果-全部" clearable />
      <n-input class="q" v-model:value="filters.q" placeholder="搜索标题/创作者" clearable />
      <n-button size="small" secondary @click="filters = { platform: '', result: '', q: '' }">重置</n-button>
      <n-button v-if="checkedCaseIds.length" size="small" type="error" secondary @click="batchDelete">
        批量删除 {{ checkedCaseIds.length }}
      </n-button>
    </div>

    <div v-if="loading" class="loading-card"><span>正在加载案例数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="load">重试</n-button>
    </div>

    <template v-else>
      <div v-if="isCompactCaseList" class="case-mobile-list">
        <n-card v-for="item in filtered" :key="item.id" class="case-mobile-card" :bordered="false" @click="openDetail(item)">
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
            <div><b>{{ pct(item.activation_d1) }}</b><span>激活率</span></div>
            <div><b>{{ item.roi_d7 ?? '—' }}</b><span>ROI7</span></div>
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
        :data="filtered"
        :bordered="false"
        :single-line="false"
        :row-key="row => row.id"
        table-layout="fixed"
      />
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
        <div class="form-row"><label>激活率</label><n-input-number v-model:value="form.activation_d1" :step="0.01" style="width:100%" /></div>
        <div class="form-row"><label>ROI7</label><n-input-number v-model:value="form.roi_d7" :step="0.01" style="width:100%" /></div>
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
            <div><b>{{ pct(selectedCase?.activation_d1) }}</b><span>激活率</span></div>
            <div><b>{{ selectedCase?.roi_d7 ?? '—' }}</b><span>ROI7</span></div>
            <div><b>{{ fmt(selectedCase?.like_count) }}</b><span>点赞</span></div>
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
import { ref, computed, h, onMounted, onBeforeUnmount } from 'vue'
import { NButton, NSpace } from 'naive-ui'
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from '../utils/api.js'
import { showToast } from '../stores/app.js'
import { getUser } from '../stores/app.js'
import { fmt, pct } from '../utils/helpers.js'
import Modal from '../components/Modal.vue'; import StatusTag from '../components/StatusTag.vue'; import EmptyState from '../components/EmptyState.vue'

const tab = ref('all'), filters = ref({ platform: '', result: '', q: '' }), cases = ref([]), showImport = ref(false), importFile = ref(null), importMode = ref('cases')
const loading = ref(false), error = ref(''), saving = ref(false), importing = ref(false), rejudging = ref(false), busyId = ref(null)
const showForm = ref(false), editing = ref(null), form = ref({})
const detailVisible = ref(false), selectedCase = ref(null)
const checkedCaseIds = ref([])
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
  if (filters.value.q) { const q = filters.value.q.toLowerCase(); l = l.filter(c => (c.title + ' ' + (c.creator_name || '')).toLowerCase().includes(q)) }
  return l
})
const isCompactCaseList = computed(() => viewportWidth.value < 760)
const isMediumCaseTable = computed(() => viewportWidth.value < 1120)
const caseActions = row => h(NSpace, { size: 6, wrap: false, class: 'case-action-group' }, () => [
  h(NButton, { size: 'tiny', secondary: true, disabled: busyId.value === row.id, onClick: () => toggleFavorite(row) }, () => row.is_favorite ? '取消收藏' : '收藏'),
  h(NButton, { size: 'tiny', type: 'error', secondary: true, disabled: busyId.value === row.id, onClick: () => del(row.id) }, () => '删除')
])
const caseColumns = computed(() => {
  const columns = [
  { type: 'selection', width: 44 },
  {
    title: '标题',
    key: 'title',
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
  { title: '发布日', key: 'publish_date', width: 98, render: row => fmtDate(row.publish_date) },
  { title: '播放量', key: 'play_count', width: 94, render: row => fmt(row.play_count) },
  { title: '激活率', key: 'activation_d1', width: 82, render: row => pct(row.activation_d1) },
  {
    title: 'ROI7',
    key: 'roi_d7',
    width: 70,
    render: row => h('b', { style: { color: row.roi_d7 >= 0.8 ? 'var(--green)' : 'var(--red)' } }, row.roi_d7 != null ? row.roi_d7 : '—')
  },
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
    cases.value = await apiGet('/cases')
  } catch (e) {
    error.value = e.message
    showToast(e.message, true)
  } finally {
    loading.value = false
  }
}
function openForm(c = null) {
  editing.value = c
  form.value = c ? { ...c } : { title: '', platform: 'B站', creator_name: '', url: '', publish_date: '', content_type: '', play_count: 0, like_count: 0, comment_count: 0, activation_d1: null, roi_d7: null, summary: '' }
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
