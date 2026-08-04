// 杖剑传说 KOC 工作台 V3 - 工具函数

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

export function fmt(n) {
  return n == null || n === '' ? '—' : Number(n).toLocaleString()
}

export function pct(n) {
  return n == null || n === '' ? '—' : n + '%'
}

export function scoreColor(s) {
  if (s >= 70) return 'var(--green)'
  if (s >= 45) return 'var(--orange)'
  return 'var(--red)'
}

// 极简 markdown 渲染
export function md(text) {
  if (!text) return ''
  let h = esc(text)
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
  return `<div class="md"><p>${h}</p></div>`
}

export function jsonParse(s, fallback = {}) {
  try { return JSON.parse(s) || fallback } catch (e) { return fallback }
}

export function getToday() {
  return new Date().toISOString().slice(0, 10)
}
