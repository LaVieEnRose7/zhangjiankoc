<template>
  <n-config-provider :theme-overrides="naiveTheme">
    <n-message-provider>
      <div id="app-root">
        <!-- 侧边导航 -->
        <aside class="sidebar">
      <div class="sb-brand">
        <div class="sb-logo">
          <img src="/logo.png" alt="杖剑传说" />
        </div>
        <div class="sb-brand-text">
          <h1>杖剑传说</h1>
          <p>坎斯汀内容作战台</p>
        </div>
      </div>

      <nav class="sb-nav">
        <div class="sb-nav-group">
          <div class="sb-nav-label">日常冒险</div>
          <div class="sb-nav-item" v-for="item in mainNav" :key="item.key"
            :class="{ active: currentPage === item.key }"
            @click="goPage(item.key)">
            <n-icon class="nav-icon" :component="item.icon" />
            <span>{{ item.label }}</span>
          </div>
        </div>

        <div class="sb-nav-group">
          <div class="sb-nav-label">内容资产</div>
          <div class="sb-nav-item" v-for="item in assetNav" :key="item.key"
            :class="{ active: currentPage === item.key }"
            @click="goPage(item.key)">
            <n-icon class="nav-icon" :component="item.icon" />
            <span>{{ item.label }}</span>
          </div>
        </div>
      </nav>

      <div class="sb-bottom">
        <div class="user-chip" @click="askUsername(true)">
          <div class="user-avatar">{{ user ? user[0] : '?' }}</div>
          <span>{{ user || '未设置' }}</span>
        </div>
        <n-button secondary block size="small" style="justify-content:flex-start" @click="showSettings = true">
          系统设置
        </n-button>
      </div>
        </aside>

        <!-- 主区域 -->
        <div class="main-area">
      <!-- 顶栏 -->
      <header class="topbar">
        <div class="tb-left">
          <div class="tb-breadcrumb">
            <span>{{ pageTitle }}</span>
          </div>
        </div>
        <div class="tb-actions">
          <n-button
            :class="['api-health', apiOnline === false ? 'offline' : apiOnline === true ? 'online' : 'checking']"
            attr-type="button"
            :title="apiMessage"
            @click="checkApi"
          >
            <span class="health-dot"></span>{{ apiLabel }}
          </n-button>
          <n-button secondary size="small" @click="goPage('guide')">使用指南</n-button>
        </div>
      </header>

      <!-- 内容区 -->
      <main class="main-content">
        <TodayPage      v-if="currentPage === 'today'" />
        <CampaignsPage  v-else-if="currentPage === 'campaigns'" />
        <OpportunitiesPage v-else-if="currentPage === 'opportunities'" />
        <CasesPage      v-else-if="currentPage === 'cases'" />
        <CreatorsPage   v-else-if="currentPage === 'creators'" />
        <OpsPage        v-else-if="currentPage === 'ops'" />
        <GameNewsPage   v-else-if="currentPage === 'gamenews'" />
        <GuidePage      v-else-if="currentPage === 'guide'" />
      </main>
        </div>

        <!-- Toast -->
        <div :class="['toast', { show: toastVisible, err: toastErr }]">{{ toastMsg }}</div>

        <!-- 用户设置弹窗 -->
        <Modal :show="showUserModal" @close="showUserModal = false">
          <template #head><h3>你是谁？</h3></template>
          <div class="form-row">
            <label>输入你的名字（用于记录操作）</label>
            <n-input v-model:value="userInput" placeholder="如：李媒介" @keyup.enter="saveUser" />
          </div>
          <template #foot>
            <n-button type="primary" @click="saveUser">确定</n-button>
          </template>
        </Modal>

        <!-- 系统设置弹窗 -->
        <Modal :show="showSettings" @close="showSettings = false" wide>
          <template #head><h3>系统设置</h3></template>
          <SettingsPanel />
          <template #foot>
            <n-button secondary @click="showSettings = false">关闭</n-button>
          </template>
        </Modal>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { appState, setUser, getUser, goPage as setPage } from './stores/app.js'
import { showToast } from './stores/app.js'
import { apiGet } from './utils/api.js'
import Modal from './components/Modal.vue'
import SettingsPanel from './pages/SettingsPanel.vue'
import TodayPage from './pages/TodayPage.vue'
import CampaignsPage from './pages/CampaignsPage.vue'
import OpportunitiesPage from './pages/OpportunitiesPage.vue'
import CasesPage from './pages/CasesPage.vue'
import CreatorsPage from './pages/CreatorsPage.vue'
import OpsPage from './pages/OpsPage.vue'
import GameNewsPage from './pages/GameNewsPage.vue'
import GuidePage from './pages/GuidePage.vue'
import {
  AnalyticsOutline,
  CalendarClearOutline,
  CompassOutline,
  FolderOpenOutline,
  GameControllerOutline,
  MegaphoneOutline,
  PeopleOutline
} from '@vicons/ionicons5'

const currentPage = computed(() => appState.currentPage)
const toastVisible = computed(() => appState.toastVisible)
const toastMsg = computed(() => appState.toastMsg)
const toastErr = computed(() => appState.toastErr)
const user = computed(() => appState.user)
const apiOnline = computed(() => appState.apiOnline)
const apiMessage = computed(() => appState.apiMessage || '正在检查后端服务')
const apiLabel = computed(() => {
  if (appState.apiOnline === true) return '后端正常'
  if (appState.apiOnline === false) return '连接异常'
  return '检查中'
})

const pageTitles = {
  today: '今日工作',
  campaigns: '营销任务',
  opportunities: '机会中心',
  cases: '案例库',
  creators: '创作者库',
  ops: '内容运营分析',
  gamenews: '游戏快讯',
  guide: '使用指南'
}
const pageTitle = computed(() => pageTitles[currentPage.value] || '')

const mainNav = [
  { key: 'today', label: '今日工作', icon: CalendarClearOutline },
  { key: 'campaigns', label: '营销任务', icon: MegaphoneOutline },
  { key: 'opportunities', label: '机会中心', icon: CompassOutline },
  { key: 'gamenews', label: '游戏快讯', icon: GameControllerOutline },
]
const assetNav = [
  { key: 'cases', label: '案例库', icon: FolderOpenOutline },
  { key: 'creators', label: '创作者库', icon: PeopleOutline },
  { key: 'ops', label: '内容运营分析', icon: AnalyticsOutline },
]

const naiveTheme = {
  common: {
    primaryColor: '#2f8fd7',
    primaryColorHover: '#247ec4',
    primaryColorPressed: '#1769a8',
    primaryColorSuppl: '#8bcf73',
    borderRadius: '8px',
    fontFamily: 'Inter, "Microsoft YaHei", system-ui, sans-serif'
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '7px',
    fontWeight: '700'
  },
  Card: {
    borderRadius: '8px',
    color: '#fff',
    borderColor: 'rgba(216,230,219,.95)'
  },
  Tag: {
    borderRadius: '999px'
  }
}

const showUserModal = ref(false)
const userInput = ref('')
const showSettings = ref(false)
let healthTimer = null

async function checkApi() {
  appState.apiOnline = null
  appState.apiMessage = '正在检查后端服务'
  try {
    await apiGet('/settings')
    appState.apiOnline = true
    appState.apiMessage = '后端服务连接正常'
  } catch (e) {
    appState.apiOnline = false
    appState.apiMessage = e.message
  }
}

function askUsername(force = false) {
  if (!force && getUser()) return
  userInput.value = getUser()
  showUserModal.value = true
}

function saveUser() {
  const v = userInput.value.trim()
  if (!v) return showToast('请输入名字', true)
  setUser(v)
  showUserModal.value = false
}

function goPage(page) {
  if (!page) return
  setPage(page)
}

onMounted(() => {
  checkApi()
  healthTimer = setInterval(checkApi, 30000)
})

onBeforeUnmount(() => {
  if (healthTimer) clearInterval(healthTimer)
})
</script>
