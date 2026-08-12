<template>
  <n-tag
    class="status-tag"
    :bordered="false"
    :color="tagColor"
    round
    size="small"
  >
    {{ text }}
  </n-tag>
</template>

<script setup>
import { computed } from 'vue'

const STATUS_MAP = {
  '待判断': 'orange', '已采纳': 'blue', '待匹配创作者': 'purple',
  '创作中': 'blue', '待发布': 'orange', '已发布': 'teal',
  '已验证': 'green', '不采用': 'gray', '已过期': 'gray',
  '候选': 'orange', '已转机会': 'green', '已忽略': 'gray',
  '进行中': 'blue', '已结束': 'gray', '未开始': 'orange',
  '爆款': 'red', '良好': 'green', '一般': 'gray', '失败': 'gray',
  '可合作': 'green', '合作中': 'blue', '暂停': 'orange', '黑名单': 'red',
  '草稿': 'orange', '已归档': 'gray', '已确认': 'green', '待办': 'orange',
  '沟通中': 'orange', '脚本确认': 'purple', '制作中': 'blue', '数据回收': 'green',
  'B站': 'bilibili', '抖音': 'douyin', '微博': 'red', '小红书': 'red'
}
const TAG_COLORS = {
  green: { color: '#e7f7df', textColor: '#2f7c42', borderColor: '#cdeabd' },
  blue: { color: '#e8f5ff', textColor: '#226fa8', borderColor: '#c9e5fb' },
  teal: { color: '#e6f8f5', textColor: '#168275', borderColor: '#bcebe3' },
  purple: { color: '#f0ecff', textColor: '#6b4fd8', borderColor: '#dcd2ff' },
  orange: { color: '#fff3d7', textColor: '#a86412', borderColor: '#f5dc9c' },
  red: { color: '#ffe9e3', textColor: '#c5422a', borderColor: '#f4c2b8' },
  gray: { color: '#eef2ed', textColor: '#66736a', borderColor: '#dce4de' },
  bilibili: { color: '#e2f5ff', textColor: '#167aa8', borderColor: '#a9ddf4' },
  douyin: { color: '#f8e9f2', textColor: '#a53872', borderColor: '#edbfd7' }
}

const props = defineProps({
  text: { type: String, required: true }
})

const color = computed(() => STATUS_MAP[props.text] || 'gray')
const tagColor = computed(() => TAG_COLORS[color.value] || TAG_COLORS.gray)
</script>
