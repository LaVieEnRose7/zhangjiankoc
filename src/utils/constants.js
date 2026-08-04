export const OPP_FLOW = ['待判断', '已采纳', '待匹配创作者', '创作中', '待发布', '已发布', '已验证']
export const OPP_CURRENT = ['待判断', '已采纳', '待匹配创作者', '创作中', '待发布', '已发布']
export const OPP_HISTORY = ['已验证', '不采用', '已过期']
export const OPP_ALL = [...OPP_FLOW, ...OPP_HISTORY]
export const OPP_TERMINAL = ['不采用', '已过期']

export const STATUS_MAP = {
  '待判断': 'orange', '已采纳': 'blue', '待匹配创作者': 'purple',
  '创作中': 'blue', '待发布': 'orange', '已发布': 'teal',
  '已验证': 'green', '不采用': 'gray', '已过期': 'gray',
  '候选': 'orange', '已转机会': 'green', '已忽略': 'gray',
  '进行中': 'blue', '已结束': 'gray', '未开始': 'orange',
  '爆款': 'red', '良好': 'green', '一般': 'gray', '失败': 'gray',
  '可合作': 'green', '合作中': 'blue', '暂停': 'orange', '黑名单': 'red',
  '草稿': 'orange', '已归档': 'gray', '已确认': 'green', '待办': 'orange',
  '沟通中': 'orange', '脚本确认': 'purple', '制作中': 'blue', '数据回收': 'green'
}

export const RISK_DIMS = [
  ['opinion', '舆情风险'],
  ['copyright', '版权风险'],
  ['character', '角色设定风险'],
  ['difficulty', '执行难度'],
  ['expiry', '热点过期风险'],
  ['irreproducible', '不可复制风险']
]

export const RISK_LEVELS = ['低', '中', '高']

export const PLATFORMS = ['B站', '抖音', '微博', '小红书', '其他']

export const EXEC_STAGES = ['沟通中', '脚本确认', '制作中', '待发布', '已发布', '数据回收']

export const GOAL_OPTS = [
  '新版本曝光', '角色认知', '联动传播', '用户拉新',
  '老玩家回流', '内容生态建设', 'KOC内容扩散'
]
