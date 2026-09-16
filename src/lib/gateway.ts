const gatewayBase = (import.meta.env.VITE_GATEWAY_URL ?? '').replace(/\/$/, '')
const SESSION_KEY = 'lyrenthos-browser-session-v1'

function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing && /^[A-Za-z0-9_-]{24,128}$/.test(existing)) return existing
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    localStorage.setItem(SESSION_KEY, value)
    return value
  } catch {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  }
}

export function gatewayEnabled(): boolean {
  return gatewayBase.length > 0
}

export function proxyUrl(target: string): string {
  if (!gatewayBase) return ''
  return `${gatewayBase}/?sid=${encodeURIComponent(getSessionId())}&url=${encodeURIComponent(target)}`
}

export async function gatewayHealth(): Promise<boolean> {
  if (!gatewayBase) return false
  try {
    const response = await fetch(`${gatewayBase}/?health=1`, { cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}
