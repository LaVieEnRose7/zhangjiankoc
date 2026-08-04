const BASE = '/api'
const DEFAULT_TIMEOUT = 20000

function buildUrl(path) {
  return /^https?:\/\//i.test(path) ? path : BASE + path
}

async function request(path, options = {}) {
  const controller = new AbortController()
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const { timeout: _timeout, ...fetchOptions } = options
    const r = await fetch(buildUrl(path), {
      ...fetchOptions,
      signal: controller.signal
    })
    const text = await r.text()
    let j = null
    try { j = text ? JSON.parse(text) : null } catch (e) {}

    if (!r.ok) {
      throw new Error(j?.message || text || `请求失败（HTTP ${r.status}）`)
    }
    if (!j) throw new Error('服务端返回格式异常，请检查后端是否启动正确')
    if (!j.success) throw new Error(j.message || '请求失败')
    return j.data
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时，请检查后端服务或网络状态')
    if (e instanceof TypeError) throw new Error('无法连接后端服务，请确认 4567 端口已启动')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export async function apiGet(path, options = {}) {
  return request(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' }
  })
}

export async function apiPost(path, body = {}, options = {}) {
  return request(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify(body)
  })
}

export async function apiPut(path, body = {}) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export async function apiDelete(path) {
  return request(path, { method: 'DELETE' })
}

export async function apiUpload(path, file) {
  const fd = new FormData()
  fd.append('file', file)
  return request(path, { method: 'POST', body: fd })
}
