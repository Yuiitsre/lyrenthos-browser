const gatewayBase = (import.meta.env.VITE_GATEWAY_URL ?? '').replace(/\/$/, '')

export function gatewayEnabled(): boolean {
  return gatewayBase.length > 0
}

export function proxyUrl(target: string): string {
  if (!gatewayBase) return target
  return `${gatewayBase}/proxy?url=${encodeURIComponent(target)}`
}

export async function gatewayHealth(): Promise<boolean> {
  if (!gatewayBase) return false
  try {
    const response = await fetch(`${gatewayBase}/health`, { cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}
