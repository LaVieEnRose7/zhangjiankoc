<template>
  <n-empty class="empty naive-empty" :description="null">
    <template #icon>
      <n-icon v-if="IconComp" :component="IconComp" />
    </template>
    <slot>暂无数据</slot>
  </n-empty>
</template>

<script setup>
import { computed } from 'vue'
import {
  BarChartOutline,
  CheckmarkDoneOutline,
  ClipboardOutline,
  FileTrayOutline,
  SparklesOutline,
  TrendingUpOutline
} from '@vicons/ionicons5'

const props = defineProps({
  icon: { type: String, default: '' }
})

const ICONS = {
  chart: BarChartOutline,
  check: CheckmarkDoneOutline,
  clipboard: ClipboardOutline,
  inbox: FileTrayOutline,
  sparkles: SparklesOutline,
  trending: TrendingUpOutline
}
const IconComp = computed(() => ICONS[props.icon] || FileTrayOutline)
</script>
