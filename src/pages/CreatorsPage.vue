<template>
  <div>
    <div class="page-head">
      <div class="page-head-left"><h2>创作者库</h2><div class="sub">管理合作创作者 · 追踪表现数据</div></div>
      <div class="page-head-actions">
        <n-button secondary :loading="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button type="primary" @click="openForm()">+ 添加创作者</n-button>
        <n-button secondary @click="showImport = true">导入名单</n-button>
      </div>
    </div>

    <n-tabs v-model:value="tab" type="segment" animated class="page-tabs">
      <n-tab-pane name="all" tab="全部" />
      <n-tab-pane name="active" tab="可合作" />
      <n-tab-pane name="cooperating" tab="合作中" />
    </n-tabs>

    <div class="filter-bar">
      <n-select v-model:value="filters.platform" :options="platformFilterOptions" placeholder="平台-全部" clearable />
      <n-input class="q" v-model:value="filters.q" placeholder="搜索名称/标签" clearable />
      <n-button size="small" secondary @click="filters = { platform: '', q: '' }">重置</n-button>
    </div>

    <div v-if="loading" class="loading-card"><span>正在加载创作者数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="load">重试</n-button>
    </div>

    <n-data-table v-else class="data-table-card" :columns="creatorColumns" :data="filtered" :bordered="false" :single-line="false" />

    <Modal :show="showForm" @close="showForm = false" wide>
      <template #head><h3>{{ editing ? '编辑' : '添加' }}创作者</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>名称 *</label><n-input v-model:value="form.name" /></div>
        <div class="form-row"><label>平台</label><n-select v-model:value="form.platform" :options="platformOptions" /></div>
        <div class="form-row"><label>状态</label><n-select v-model:value="form.status" :options="statusOptions" /></div>
        <div class="form-row"><label>粉丝量</label><n-input-number v-model:value="form.fans" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>平均播放</label><n-input-number v-model:value="form.avg_play" :min="0" style="width:100%" /></div>
        <div class="form-row"><label>平均 ROI7</label><n-input-number v-model:value="form.avg_roi7" :step="0.01" style="width:100%" /></div>
        <div class="form-row"><label>合作次数</label><n-input-number v-model:value="form.coop_count" :min="0" style="width:100%" /></div>
        <div class="form-row full"><label>擅长方向/标签</label><n-input v-model:value="form.categories" placeholder="逗号分隔" /></div>
        <div class="form-row full"><label>主页链接</label><n-input v-model:value="form.home_url" /></div>
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
              <StatusTag :text="selectedCreator?.status || '可合作'" />
              <StatusTag :text="selectedCreator?.platform || '平台待定'" />
            </div>
          </div>
          <span class="x" @click="closeDetail">&times;</span>
        </div>
        <div class="drawer-body">
          <div class="detail-metrics">
            <div><b>{{ fmt(selectedCreator?.fans) }}</b><span>粉丝</span></div>
            <div><b>{{ fmt(selectedCreator?.avg_play) }}</b><span>均播</span></div>
            <div><b>{{ selectedCreator?.avg_roi7 ?? '—' }}</b><span>ROI7</span></div>
            <div><b>{{ selectedCreator?.coop_count ?? 0 }}</b><span>合作</span></div>
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
                <div><b>{{ pubSummary.avg_roi7 ?? '—' }}</b><span>平均 ROI7</span></div>
                <div><b>{{ pubSummary.avg_activation ?? '—' }}</b><span>平均激活率</span></div>
                <div><b>{{ fmt(pubSummary.high_count) }}</b><span>高表现</span></div>
                <div><b>{{ fmt(pubSummary.verified_count) }}</b><span>已验证</span></div>
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
                    <StatusTag v-if="Number(item.is_verified) === 1" text="已验证" />
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
import { ref, computed, h, onMounted } from 'vue'
import { NButton, NSpace } from 'naive-ui'
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from '../utils/api.js'
import { showToast, getUser } from '../stores/app.js'
import { fmt } from '../utils/helpers.js'
import Modal from '../components/Modal.vue'; import StatusTag from '../components/StatusTag.vue'; import EmptyState from '../components/EmptyState.vue'

const tab = ref('all'), filters = ref({ platform: '', q: '' }), creators = ref([]), showForm = ref(false), editing = ref(null), form = ref({}), showImport = ref(false), importFile = ref(null)
const loading = ref(false), error = ref(''), saving = ref(false), importing = ref(false), busyId = ref(null)
const detailVisible = ref(false), selectedCreator = ref(null)
const publishedData = ref(null), publishedLoading = ref(false), publishedError = ref(''), rematching = ref(false)
const platformOptions = ['B站', '抖音', '微博', '小红书', '其他'].map(v => ({ label: v, value: v }))
const platformFilterOptions = platformOptions.filter(o => o.value !== '其他')
const statusOptions = ['可合作', '合作中', '暂停', '黑名单'].map(v => ({ label: v, value: v }))

const filtered = computed(() => {
  let l = creators.value
  if (tab.value === 'active') l = l.filter(c => c.status === '可合作')
  if (tab.value === 'cooperating') l = l.filter(c => c.status === '合作中')
  if (filters.value.platform) l = l.filter(c => c.platform === filters.value.platform)
  if (filters.value.q) { const q = filters.value.q.toLowerCase(); l = l.filter(c => (c.name + ' ' + (c.categories || '')).toLowerCase().includes(q)) }
  return l
})
const pubSummary = computed(() => publishedData.value?.summary || {})
const publishedItems = computed(() => publishedData.value?.items || [])
const creatorColumns = computed(() => [
  {
    title: '创作者',
    key: 'name',
    minWidth: 140,
    render: row => h('span', { class: 'row-link', onClick: () => openDetail(row) }, row.name)
  },
  { title: '平台', key: 'platform', width: 92, render: row => row.platform || '—' },
  { title: '粉丝', key: 'fans', width: 110, render: row => fmt(row.fans) },
  { title: '均播放', key: 'avg_play', width: 110, render: row => fmt(row.avg_play) },
  { title: '擅长方向', key: 'categories', minWidth: 180, render: row => h('span', { class: 'muted-cell' }, row.categories || '—') },
  { title: 'ROI7均值', key: 'avg_roi7', width: 110, render: row => h('b', row.avg_roi7 != null ? row.avg_roi7 : '—') },
  { title: '状态', key: 'status', width: 96, render: row => h(StatusTag, { text: row.status || '可合作' }) },
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
    creators.value = await apiGet('/creators')
  } catch (e) {
    error.value = e.message
    showToast(e.message, true)
  } finally {
    loading.value = false
  }
}
function openForm(c = null) {
  editing.value = c
  form.value = c ? { ...c } : { name: '', platform: 'B站', status: '可合作', fans: 0, avg_play: 0, avg_roi7: null, coop_count: 0, categories: '', home_url: '' }
  showForm.value = true
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
async function loadPublished(id) {
  if (!id) return
  publishedLoading.value = true
  publishedError.value = ''
  try {
    publishedData.value = await apiGet(`/creators/${id}/published`)
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
    if (selectedCreator.value?.id === id) closeDetail()
    load()
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
