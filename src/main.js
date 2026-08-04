import { createApp } from 'vue'
import {
  create,
  NButton,
  NCard,
  NConfigProvider,
  NDataTable,
  NDatePicker,
  NEmpty,
  NIcon,
  NInput,
  NInputNumber,
  NMessageProvider,
  NModal,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NUpload,
  NUploadDragger
} from 'naive-ui'
import App from './App.vue'
import './assets/global.css'

const naive = create({
  components: [
    NButton,
    NCard,
    NConfigProvider,
    NDataTable,
    NDatePicker,
    NEmpty,
    NIcon,
    NInput,
    NInputNumber,
    NMessageProvider,
    NModal,
    NSpace,
    NTabPane,
    NTabs,
    NTag,
    NUpload,
    NUploadDragger
  ]
})

const app = createApp(App)
app.use(naive)
app.mount('#app')
