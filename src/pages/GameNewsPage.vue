<template>
  <div>
    <div class="page-head">
      <div class="page-head-left"><h2>游戏快讯</h2><div class="sub">最新游戏行业动态与内容趋势</div></div>
      <div class="page-head-actions"><n-button type="primary" :loading="loading" @click="refreshNews">{{ loading ? '刷新中…' : '刷新资讯' }}</n-button></div>
    </div>

    <div v-if="error && !loading" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="loadNews">重试</n-button>
    </div>
    <div v-if="loading" class="loading-card"><span>正在加载游戏快讯...</span><span class="spinner"></span></div>

    <div v-else-if="news.length">
      <n-card v-for="item in news" :key="item.id" class="card news-card" :bordered="false">
        <div style="font-weight:600;font-size:15px;margin-bottom:8px">{{ item.title }}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
          <StatusTag :text="item.platform || '游戏快讯'" />
          <span style="font-size:12px;color:var(--ink-faint)">{{ fmtDate(item.pub_date || item.created_at) }}</span>
          <span v-if="item.source" class="tag gray">{{ item.source }}</span>
        </div>
        <div style="font-size:13px;color:var(--ink-dim);line-height:1.7;margin-bottom:8px">{{ item.summary || item.content || '暂无摘要' }}</div>
        <n-button v-if="item.url" size="small" secondary @click="openLink(item.url)">查看原文</n-button>
      </n-card>
    </div>
    <EmptyState v-else-if="!error" icon="sparkles">暂无游戏资讯，点击「刷新资讯」获取最新内容</EmptyState>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiGet, apiPost } from '../utils/api.js'
import { showToast } from '../stores/app.js'
import StatusTag from '../components/StatusTag.vue'; import EmptyState from '../components/EmptyState.vue'

const news = ref([]), loading = ref(false), error = ref('')
function fmtDate(d) { return d ? d.slice(0, 10) : '—' }
function openLink(url) { if (url) window.open(url, '_blank') }
async function loadNews() {
  loading.value = true
  error.value = ''
  try { news.value = (await apiGet('/game-news')).items || [] } catch (e) { error.value = e.message; showToast(e.message, true) }
  finally { loading.value = false }
}
async function refreshNews() {
  loading.value = true
  error.value = ''
  try {
    const data = await apiPost('/game-news/refresh')
    news.value = data.items || news.value
    showToast(`已刷新，今日新增 ${data.addedToday || 0} 条`)
  } catch (e) { error.value = e.message; showToast(e.message, true) }
  finally { loading.value = false }
}
onMounted(loadNews)
</script>
