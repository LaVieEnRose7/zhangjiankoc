<template>
  <div>
    <div class="settings-block">
      <div class="settings-title">AI 服务配置</div>
      <div class="settings-hint">
        支持 Gemini 官方接口，也支持 OpenAI 兼容格式的中转站。中转站一般填写 Base URL、API Key 和模型名即可。
      </div>

      <div class="form-row">
        <label>接口类型</label>
        <n-select v-model:value="provider" :options="providerOptions" />
      </div>
      <div class="form-row">
        <label>Base URL</label>
        <n-input v-model:value="baseUrl" :placeholder="baseUrlPlaceholder" clearable />
      </div>
      <div class="form-row">
        <label>API Key</label>
        <n-input v-model:value="apiKey" type="password" placeholder="请输入你的中转站或 Gemini API Key" show-password-on="click" />
      </div>
      <div class="form-row">
        <label>模型</label>
        <n-input v-model:value="model" :placeholder="modelPlaceholder" clearable />
        <div class="field-hint">常见示例：{{ modelExamples }}</div>
      </div>
      <div class="form-row">
        <label>AI 深度洞察模型</label>
        <n-input v-model:value="insightModel" placeholder="例如：gpt-5.4-mini" clearable />
        <div class="field-hint">运营分析建议使用响应快、稳定输出 JSON 的模型。当前中转站实测 gpt-5.4-mini 更稳定。</div>
      </div>

      <n-space>
        <n-button type="primary" :loading="saving" @click="saveKey">{{ saving ? '保存中...' : '保存 AI 配置' }}</n-button>
        <n-button secondary :loading="testing" @click="testAi">{{ testing ? '测试中...' : '测试 AI 连通性' }}</n-button>
      </n-space>
    </div>

    <div class="settings-block divided">
      <div class="settings-title">后台自动任务</div>
      <div class="settings-hint">
        每天固定抓取一次今日热点和游戏快讯；热点抓取完成后会立即生成 AI 推荐分析，并写入数据库快照。
      </div>

      <div class="form-row">
        <label>任务状态</label>
        <n-select v-model:value="autoEnabled" :options="autoEnabledOptions" />
      </div>
      <div class="form-row">
        <label>每日执行时间（Asia/Shanghai）</label>
        <n-input v-model:value="autoRunTime" placeholder="07:00" maxlength="5" />
        <div class="field-hint">默认每天早晨 07:00 抓取。格式为 HH:mm，例如 07:00 或 18:30。</div>
      </div>

      <div class="automation-panel">
        <div><span>当前状态</span><b>{{ autoStateLabel }}</b></div>
        <div><span>下次执行</span><b>{{ autoStatus.nextRunLocal || '未计划' }}</b></div>
        <div><span>上次完成</span><b>{{ fmtTime(autoStatus.lastFinishedAt) }}</b></div>
        <div><span>热点/推荐</span><b>{{ autoStatus.lastHotspotCount ?? '—' }} / {{ autoStatus.lastRecommendationCount ?? '—' }}</b></div>
        <div><span>游戏快讯</span><b>{{ autoStatus.lastNewsTotal ?? '—' }} 条</b></div>
        <div><span>最近结果</span><b :class="{ danger: autoStatus.lastSuccess === false }">{{ autoResultLabel }}</b></div>
      </div>
      <div v-if="autoStatus.lastError" class="field-hint danger">{{ autoStatus.lastError }}</div>

      <n-space class="automation-actions">
        <n-button type="primary" :loading="autoRunning" @click="runAutomation">{{ autoRunning ? '执行中...' : '立即抓取并分析' }}</n-button>
        <n-button secondary :loading="autoSaving" @click="saveAutomation">{{ autoSaving ? '保存中...' : '保存自动任务设置' }}</n-button>
        <n-button secondary :loading="autoLoading" @click="loadAutomation">刷新状态</n-button>
      </n-space>
    </div>

    <div class="settings-block divided">
      <div class="settings-title">数据管理</div>
      <n-space>
        <n-button secondary @click="exportData">导出数据（Excel）</n-button>
        <n-button type="error" secondary @click="resetData">清空业务数据</n-button>
      </n-space>
    </div>

    <div class="settings-footer">
      杖剑传说 KOC 内容机会决策与复盘工作台 V3.0.0<br />Node.js + Express + sql.js + Vue 3 + Vite
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { apiGet, apiPost } from '../utils/api.js'
import { showToast } from '../stores/app.js'

const provider = ref('openai_compatible')
const apiKey = ref('')
const baseUrl = ref('https://api.openai.com/v1')
const model = ref('gpt-4o-mini')
const insightModel = ref('gpt-5.4-mini')
const testing = ref(false)
const saving = ref(false)
const autoLoading = ref(false)
const autoSaving = ref(false)
const autoRunning = ref(false)
const autoEnabled = ref(true)
const autoRunTime = ref('07:00')
const autoStatus = ref({})

const providerOptions = [
  { label: 'OpenAI 兼容中转站', value: 'openai_compatible' },
  { label: 'Gemini 官方 / Gemini 兼容', value: 'gemini' }
]
const autoEnabledOptions = [
  { label: '开启', value: true },
  { label: '关闭', value: false }
]

const baseUrlPlaceholder = computed(() => provider.value === 'openai_compatible'
  ? '例如：https://你的中转站域名/v1'
  : '默认：https://generativelanguage.googleapis.com/v1beta')
const modelPlaceholder = computed(() => provider.value === 'openai_compatible'
  ? '例如：gpt-4o-mini / deepseek-chat'
  : '例如：gemini-2.0-flash')
const modelExamples = computed(() => provider.value === 'openai_compatible'
  ? 'gpt-4o-mini、gpt-4o、deepseek-chat、deepseek-reasoner'
  : 'gemini-2.0-flash、gemini-2.0-flash-lite、gemini-1.5-flash')
const autoStateLabel = computed(() => {
  if (autoStatus.value.running || autoRunning.value) return '正在执行'
  return autoEnabled.value ? '已开启' : '已关闭'
})
const autoResultLabel = computed(() => {
  if (autoStatus.value.lastSuccess === true) return '成功'
  if (autoStatus.value.lastSuccess === false) return '失败'
  return '暂无记录'
})

function inferProvider(settings) {
  const savedProvider = settings.ai_provider || ''
  const savedBaseUrl = settings.ai_base_url || ''
  const savedModel = settings.ai_model || settings.gemini_model || ''
  if (/\/v1\/?$/i.test(savedBaseUrl) || /openai|deepseek|gpt|kimi|qwen|glm|claude/i.test(savedModel)) return 'openai_compatible'
  return savedProvider || 'gemini'
}

watch(provider, value => {
  if (value === 'openai_compatible') {
    if (!baseUrl.value || baseUrl.value.includes('generativelanguage.googleapis.com')) baseUrl.value = 'https://api.openai.com/v1'
    if (!model.value || model.value.startsWith('gemini-')) model.value = 'gpt-4o-mini'
    if (!insightModel.value || insightModel.value.startsWith('gemini-') || insightModel.value.startsWith('deepseek-')) insightModel.value = 'gpt-5.4-mini'
  } else {
    if (!baseUrl.value || baseUrl.value.includes('api.openai.com')) baseUrl.value = 'https://generativelanguage.googleapis.com/v1beta'
    if (!model.value || model.value.startsWith('gpt-') || model.value.startsWith('deepseek-')) model.value = 'gemini-2.0-flash'
    if (!insightModel.value || insightModel.value.startsWith('gpt-') || insightModel.value.startsWith('deepseek-')) insightModel.value = model.value
  }
})

onMounted(async () => {
  try {
    const s = await apiGet('/settings')
    provider.value = inferProvider(s)
    apiKey.value = s.ai_api_key || s.gemini_api_key || ''
    if (/^https?:\/\//i.test(apiKey.value)) apiKey.value = ''
    baseUrl.value = s.ai_base_url || (provider.value === 'openai_compatible' ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com/v1beta')
    model.value = s.ai_model || s.gemini_model || (provider.value === 'openai_compatible' ? 'gpt-4o-mini' : 'gemini-2.0-flash')
    insightModel.value = s.ai_insight_model || (provider.value === 'openai_compatible' ? 'gpt-5.4-mini' : model.value)
  } catch (e) {
    showToast(e.message, true)
  }
  loadAutomation()
})

function fmtTime(value) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '').trim())
}

async function loadAutomation() {
  autoLoading.value = true
  try {
    const status = await apiGet('/automation/status')
    autoStatus.value = status || {}
    autoEnabled.value = status.enabled !== false
    autoRunTime.value = status.runTime || '07:00'
  } catch (e) {
    showToast(e.message, true)
  } finally {
    autoLoading.value = false
  }
}

async function saveAutomation() {
  if (!isValidTime(autoRunTime.value)) {
    showToast('执行时间格式不正确，请填写 HH:mm，例如 07:00', true)
    return
  }
  autoSaving.value = true
  try {
    const status = await apiPost('/automation/config', {
      enabled: autoEnabled.value,
      runTime: autoRunTime.value.trim()
    })
    autoStatus.value = status || {}
    showToast('自动任务设置已保存')
  } catch (e) {
    showToast(e.message, true)
  } finally {
    autoSaving.value = false
  }
}

async function runAutomation() {
  autoRunning.value = true
  try {
    const status = await apiPost('/automation/run', { force: true }, { timeout: 120000 })
    autoStatus.value = status || {}
    showToast('已完成抓取与 AI 分析')
  } catch (e) {
    await loadAutomation()
    showToast(e.message, true)
  } finally {
    autoRunning.value = false
  }
}

async function saveKey() {
  if (/^https?:\/\//i.test(apiKey.value.trim())) {
    showToast('API Key 不能填写网址，请把中转站地址填到 Base URL', true)
    return
  }
  saving.value = true
  try {
    await apiPost('/settings', {
      ai_provider: provider.value,
      ai_base_url: baseUrl.value.trim(),
      ai_api_key: apiKey.value.trim(),
      ai_model: model.value.trim(),
      ai_insight_model: insightModel.value.trim(),
      gemini_api_key: provider.value === 'gemini' ? apiKey.value.trim() : '',
      gemini_model: provider.value === 'gemini' ? model.value.trim() : 'gemini-2.0-flash'
    })
    showToast('AI 配置已保存')
  } catch (e) {
    showToast(e.message, true)
  } finally {
    saving.value = false
  }
}

async function testAi() {
  testing.value = true
  try {
    const r = await apiPost('/settings/test-ai')
    const channel = r.provider === 'openai_compatible' ? '中转站' : 'Gemini'
    showToast(`AI 正常：${channel} / ${r.model || model.value} / ${r.reply || '已连通'}`)
  } catch (e) {
    showToast(e.message, true)
  } finally {
    testing.value = false
  }
}

async function exportData() {
  window.open('/api/export', '_blank')
}

async function resetData() {
  if (!confirm('确认清空业务数据？')) return
  try {
    await apiPost('/reset-demo')
    showToast('数据已清空')
  } catch (e) {
    showToast(e.message, true)
  }
}
</script>
