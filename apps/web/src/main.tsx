import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { account, appwriteConfigured } from './lib/appwrite'
import { gatewayEnabled, proxyUrl } from './lib/gateway'
import './styles.css'

type Tab = { id: string; title: string; url: string }

const DEFAULT_URL = 'https://example.com/'

function normalizeInput(value: string): string {
  const v = value.trim()
  if (!v) return DEFAULT_URL
  if (/^[a-z]+:\/\//i.test(v)) return v
  if (v.includes(' ') || !v.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(v)}`
  return `https://${v}`
}

function App() {
  const first = { id: crypto.randomUUID(), title: 'New Tab', url: DEFAULT_URL }
  const [tabs, setTabs] = useState<Tab[]>([first])
  const [activeId, setActiveId] = useState(first.id)
  const [address, setAddress] = useState(DEFAULT_URL)
  const [status, setStatus] = useState(gatewayEnabled() ? 'Gateway configured' : 'Gateway not configured')

  const active = useMemo(() => tabs.find(t => t.id === activeId)!, [tabs, activeId])
  const viewUrl = gatewayEnabled() ? proxyUrl(active.url) : ''

  function navigate(value: string) {
    const url = normalizeInput(value)
    setAddress(url)
    setStatus(gatewayEnabled() ? 'Loading through gateway…' : 'Preview mode — configure the gateway')
    setTabs(current => current.map(t => t.id === activeId
      ? { ...t, url, title: safeTitle(url) }
      : t))
  }

  function addTab() {
    const tab = { id: crypto.randomUUID(), title: 'New Tab', url: DEFAULT_URL }
    setTabs(current => [...current, tab])
    setActiveId(tab.id)
    setAddress(DEFAULT_URL)
  }

  function closeTab(id: string) {
    if (tabs.length === 1) return
    const index = tabs.findIndex(t => t.id === id)
    const next = tabs.filter(t => t.id !== id)
    setTabs(next)
    if (id === activeId) {
      const replacement = next[Math.max(0, index - 1)]
      setActiveId(replacement.id)
      setAddress(replacement.url)
    }
  }

  async function loginHint() {
    if (!appwriteConfigured) {
      setStatus('Configure Appwrite environment variables first')
      return
    }
    try {
      const user = await account.get()
      setStatus(`Signed in as ${user.name || user.email}`)
    } catch {
      setStatus('No Appwrite session — add your auth flow next')
    }
  }

  return (
    <main className="app-shell">
      <header className="chrome">
        <div className="brand">LYRENTHOS</div>
        <div className="window-actions"><span>–</span><span>□</span><span>×</span></div>
      </header>

      <nav className="tabs" aria-label="Browser tabs">
        {tabs.map(tab => (
          <button key={tab.id} className={`tab ${tab.id === activeId ? 'active' : ''}`} onClick={() => { setActiveId(tab.id); setAddress(tab.url) }}>
            <span className="tab-dot" />
            <span className="tab-title">{tab.title}</span>
            {tabs.length > 1 && <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}>×</span>}
          </button>
        ))}
        <button className="new-tab" onClick={addTab}>+</button>
      </nav>

      <section className="toolbar">
        <button className="icon-btn" aria-label="Back">←</button>
        <button className="icon-btn" aria-label="Forward">→</button>
        <button className="icon-btn" aria-label="Reload" onClick={() => navigate(active.url)}>↻</button>
        <form className="address-form" onSubmit={e => { e.preventDefault(); navigate(address) }}>
          <span className="lock">⌁</span>
          <input value={address} onChange={e => setAddress(e.target.value)} aria-label="Address" />
          <button type="submit" className="go">Go</button>
        </form>
        <button className="icon-btn" onClick={loginHint}>◎</button>
      </section>

      <section className="workspace">
        {gatewayEnabled() ? (
          <iframe
            title="Lyrenthos web viewport"
            className="web-viewport"
            src={viewUrl}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="page-card">
            <div className="hero-orb" />
            <div className="hero-content">
              <div className="eyebrow">LYRENTHOS BROWSER</div>
              <h1>Your web.<br /><span>Your interface.</span></h1>
              <p>The frontend is ready for Appwrite Sites. Set the gateway URL to enable the streaming HTTP browser viewport, then add persistent session and Chromium fallback services.</p>
              <div className="actions">
                <button className="primary" onClick={() => navigate('https://example.com')}>Open a site</button>
                <button className="secondary" onClick={loginHint}>Check Appwrite</button>
              </div>
            </div>
            <aside className="session-card">
              <div className="session-title">SESSION</div>
              <div className="session-value">{status}</div>
              <div className="session-row"><span>Render</span><b>Local browser</b></div>
              <div className="session-row"><span>Transport</span><b>Streaming HTTP</b></div>
              <div className="session-row"><span>Fallback</span><b>Chromium</b></div>
            </aside>
          </div>
        )}
      </section>

      <footer className="statusbar"><span>●</span> {status}</footer>
    </main>
  )
}

function safeTitle(value: string): string {
  try { return new URL(value).hostname || 'Page' } catch { return 'Page' }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
