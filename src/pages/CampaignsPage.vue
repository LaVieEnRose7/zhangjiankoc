<template>
  <div>
    <div class="page-head">
      <div class="page-head-left">
        <h2>营销任务</h2>
        <div class="sub">管理营销 Campaign · 设定目标与推荐规则</div>
      </div>
      <div class="page-head-actions">
        <n-button secondary :loading="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button type="primary" @click="openForm()">+ 新建 Campaign</n-button>
      </div>
    </div>

    <div v-if="loading" class="loading-card"><span>正在加载营销任务...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="load">重试</n-button>
    </div>

    <div v-else-if="campaigns.length" style="display:flex;flex-direction:column;gap:14px">
      <n-card v-for="c in campaigns" :key="c.id" class="card card-highlight campaign-card" :bordered="false">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
          <div>
            <h3 style="font-size:16px;font-weight:700;margin-bottom:6px">{{ c.name }}</h3>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <StatusTag :text="c.status || '进行中'" />
              <StatusTag :text="c.priority || '中'" />
              <span style="font-size:13px;color:var(--ink-faint)">{{ c.game_name }}</span>
            </div>
          </div>
          <n-space size="small">
            <n-button size="small" secondary @click="openForm(c)">编辑</n-button>
            <n-button size="small" type="primary" v-if="!c.is_current" @click="setCurrent(c.id)" :disabled="busyId === c.id">设为当前</n-button>
            <n-button size="small" type="error" secondary @click="deleteOne(c.id)" :disabled="busyId === c.id">删除</n-button>
          </n-space>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px;font-size:13px">
          <div><span class="tag gray">目标</span><div style="margin-top:4px;font-weight:500">{{ c.goal || '—' }}</div></div>
          <div><span class="tag gray">周期</span><div style="margin-top:4px;font-weight:500">{{ c.start_date || '—' }} ~ {{ c.end_date || '—' }}</div></div>
          <div><span class="tag gray">重点内容</span><div style="margin-top:4px;font-weight:500">{{ c.focus_content || '—' }}</div></div>
          <div><span class="tag gray">版本/活动</span><div style="margin-top:4px;font-weight:500">{{ c.version_event || '—' }}</div></div>
        </div>
        <div style="margin-top:12px;font-size:12px;color:var(--ink-faint);padding-top:12px;border-top:1px solid var(--gray-100)">
          <b style="color:var(--ink-dim)">推荐规则：</b>目标平台 {{ c.target_platform || '—' }} | 内容方向 {{ c.content_directions || '—' }} | 判断标准 {{ c.criteria || '—' }}
        </div>
      </n-card>
    </div>
    <EmptyState v-else icon="inbox">暂无营销任务，点击「新建 Campaign」创建</EmptyState>

    <!-- Form Modal -->
    <Modal :show="showForm" @close="showForm = false" wide>
      <template #head><h3>{{ editing ? '编辑' : '新建' }} Campaign</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>Campaign 名称 *</label><n-input v-model:value="form.name" /></div>
        <div class="form-row"><label>游戏名称 *</label><n-input v-model:value="form.game_name" /></div>
        <div class="form-row"><label>优先级</label><n-select v-model:value="form.priority" :options="priorityOptions" /></div>
        <div class="form-row"><label>状态</label><n-select v-model:value="form.status" :options="statusOptions" /></div>
        <div class="form-row full"><label>传播目标</label><n-input v-model:value="form.goal" /></div>
        <div class="form-row"><label>周期开始</label><n-input v-model:value="form.start_date" type="date" /></div>
        <div class="form-row"><label>周期结束</label><n-input v-model:value="form.end_date" type="date" /></div>
        <div class="form-row"><label>当前版本/活动</label><n-input v-model:value="form.version_event" /></div>
        <div class="form-row"><label>重点角色/内容</label><n-input v-model:value="form.focus_content" /></div>
        <div class="form-row"><label>目标平台</label><n-input v-model:value="form.target_platform" placeholder="如：B站、抖音" /></div>
        <div class="form-row"><label>内容方向</label><n-input v-model:value="form.content_directions" /></div>
        <div class="form-row full"><label>判断标准</label><n-input v-model:value="form.criteria" type="textarea" /></div>
      </div>
      <template #foot><n-button type="primary" :loading="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</n-button></template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api.js'
import { showToast, getUser } from '../stores/app.js'
import Modal from '../components/Modal.vue'
import StatusTag from '../components/StatusTag.vue'
import EmptyState from '../components/EmptyState.vue'

const campaigns = ref([])
const loading = ref(false)
const error = ref('')
const saving = ref(false)
const busyId = ref(null)
const showForm = ref(false)
const editing = ref(null)
const form = ref({})
const priorityOptions = ['高', '中', '低'].map(v => ({ label: v, value: v }))
const statusOptions = ['执行中', '未开始', '已结束'].map(v => ({ label: v, value: v }))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const list = await apiGet('/campaigns')
    campaigns.value = [...list].sort((a, b) => {
      const dateCompare = String(b.start_date || '').localeCompare(String(a.start_date || ''))
      return dateCompare || (Number(b.id) || 0) - (Number(a.id) || 0)
    })
  } catch (e) {
    error.value = e.message
    showToast(e.message, true)
  } finally {
    loading.value = false
  }
}
function openForm(c = null) {
  editing.value = c
  form.value = c ? { ...c } : { name: '', game_name: '', priority: '中', status: '执行中', goal: '', start_date: '', end_date: '', version_event: '', focus_content: '', target_platform: '', content_directions: '', criteria: '' }
  showForm.value = true
}
async function save() {
  if (!form.value.name.trim()) return showToast('请输入名称', true)
  saving.value = true
  try {
    if (editing.value) await apiPut(`/campaigns/${editing.value.id}`, form.value)
    else await apiPost('/campaigns', { ...form.value, created_by: getUser() })
    showForm.value = false; showToast('已保存'); load()
  } catch (e) { showToast(e.message, true) }
  finally { saving.value = false }
}
async function deleteOne(id) {
  if (!confirm('确认删除？')) return
  busyId.value = id
  try {
    await apiDelete(`/campaigns/${id}`)
    showToast('已删除')
    load()
  } catch (e) { showToast(e.message, true) }
  finally { busyId.value = null }
}
async function setCurrent(id) {
  busyId.value = id
  try {
    await apiPost(`/campaigns/${id}/set-current`)
    showToast('已设为当前任务')
    load()
  } catch (e) { showToast(e.message, true) }
  finally { busyId.value = null }
}
onMounted(load)
</script>
