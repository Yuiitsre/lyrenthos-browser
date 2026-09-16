import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { account, appwriteConfigured } from './lib/appwrite'
import { gatewayEnabled, gatewayHealth, proxyUrl } from './lib/gateway'
import './styles.css'

type Tab = { id: string; title: string; url: string }

const DEFAULT_URL = 'https://example.com/'
const STORAGE_KEY = 'lyrenthos-browser-state-v1'

function normalise(value: string): string {
  const v = value.trim()
  if (!v) return DEFAULT_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v
  if (v.includes(' ') || !v.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(v)}`
  return `https://${v}`
}

function loadTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('missing')
    const parsed = JSON.parse(raw) as { tabs?: Tab[] }
    if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) return parsed.tabs
  } catch {
    // Use the default tab below.
  }
  return [{ id: crypto.randomUUID(), title: 'New Tab', url: DEFAULT_URL }]
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>(loadTabs)
  const [activeId, setActiveId] = useState(() => loadTabs()[0]?.id ?? '')
  const [address, setAddress] = useState(DEFAULT_URL)
  const [signedIn, setSignedIn] = useState(false)
  const [health, setHealth] = useState<'unknown' | 'online' | 'offline'>('unknown')

  const active = useMemo(() => tabs.find(tab => tab.id === activeId) ?? tabs[0], [tabs, activeId])

  useEffect(() => {
    if (active) setAddress(active.url)
  }, [active?.id])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs }))
  }, [tabs])

  useEffect(() => {
    let alive = true
    const check = async () => {
      if (!gatewayEnabled()) {
        if (alive) setHealth('offline')
        return
      }
      const ok = await gatewayHealth()
      if (alive) setHealth(ok ? 'online' : 'offline')
    }
    void check()
    const timer = window.setInterval(check, 30_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let alive = true
    if (!appwriteConfigured) return
    account.get().then(() => alive && setSignedIn(true)).catch(() => alive && setSignedIn(false))
    return () => { alive = false }
  }, [])

  function navigate(value: string) {
    const url = normalise(value)
    setAddress(url)
    setTabs(current => current.map(tab => tab.id === active.id
      ? { ...tab, url, title: new URL(url).hostname }
      : tab))
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

  const frameUrl = gatewayEnabled() ? proxyUrl(active?.url ?? DEFAULT_URL) : ''
  const canEmbed = Boolean(frameUrl)

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span className="brand-glyph">L</span><span>LYRENTHOS</span></div>
        <div className="topbar-right">
          <span className={`signal ${health}`}><i />{health === 'online' ? 'Gateway online' : health === 'offline' ? 'Gateway offline' : 'Checking'}</span>
          <span className="session-pill"><span className={signedIn ? 'dot live' : 'dot'} />{signedIn ? 'Account' : 'Local mode'}</span>
        </div>
      </header>

      <nav className="tabs" aria-label="Browser tabs">
        {tabs.map(tab => (
          <button key={tab.id} className={`tab ${tab.id === activeId ? 'active' : ''}`} onClick={() => { setActiveId(tab.id); setAddress(tab.url) }}>
            <span className="tab-icon" />
            <span className="tab-title">{tab.title}</span>
            {tabs.length > 1 && <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }}>×</span>}
          </button>
        ))}
        <button className="new-tab" onClick={addTab} aria-label="New tab">+</button>
      </nav>

      <section className="toolbar">
        <button className="nav-btn" onClick={() => history.back()} aria-label="Back">←</button>
        <button className="nav-btn" onClick={() => history.forward()} aria-label="Forward">→</button>
        <button className="nav-btn" onClick={() => navigate(active.url)} aria-label="Reload">↻</button>
        <form className="address-shell" onSubmit={event => { event.preventDefault(); navigate(address) }}>
          <span className="shield">⌁</span>
          <input value={address} onChange={event => setAddress(event.target.value)} aria-label="Address" spellCheck={false} />
          <button className="go-btn" type="submit">Go</button>
        </form>
        <button className="nav-btn" aria-label="Menu">⋯</button>
      </section>

      <section className="viewport">
        {canEmbed ? (
          <iframe
            title="Lyrenthos web viewport"
            className="site-frame"
            src={frameUrl}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="welcome">
            <div className="orb" />
            <div className="welcome-copy">
              <div className="eyebrow">PERSONAL WEB GATEWAY</div>
              <h1>Fast web access.<br /><em>Your interface.</em></h1>
              <p>Enter a public website above. The production gateway streams resources directly to your browser instead of sending a remote desktop video feed.</p>
              <div className="quick-actions">
                <button className="primary" onClick={() => navigate('https://example.com')}>Open example.com</button>
                <button className="secondary" onClick={() => setAddress('https://example.com/')}>Set address</button>
              </div>
            </div>
            <div className="architecture-card">
              <div className="card-kicker">CURRENT MODE</div>
              <div className="mode">{gatewayEnabled() ? 'Gateway configured' : 'Gateway not configured'}</div>
              <div className="metric"><span>Render</span><strong>Local browser</strong></div>
              <div className="metric"><span>Transport</span><strong>HTTP streaming</strong></div>
              <div className="metric"><span>Fallback</span><strong>Chromium</strong></div>
              <div className="hint">{gatewayEnabled() ? 'Gateway is configured. If this panel remains visible, open a target URL.' : 'Add VITE_GATEWAY_URL in the Appwrite Site environment variables.'}</div>
            </div>
          </div>
        )}
      </section>

      <footer className="statusbar">
        <span className="status-dot" />
        <span>{gatewayEnabled() ? (health === 'online' ? 'Secure gateway connected' : 'Gateway unavailable') : 'Frontend ready · gateway not configured'}</span>
        <span className="status-spacer" />
        <span>Appwrite {appwriteConfigured ? 'configured' : 'not configured'}</span>
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
