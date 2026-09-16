import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
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
  const [tabs, setTabs] = useState<Tab[]>([
    { id: crypto.randomUUID(), title: 'New Tab', url: DEFAULT_URL },
  ])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [address, setAddress] = useState(DEFAULT_URL)
  const [status, setStatus] = useState('Ready')

  const active = useMemo(() => tabs.find(t => t.id === activeId)!, [tabs, activeId])

  function navigate(value: string) {
    const url = normalizeInput(value)
    setAddress(url)
    setStatus('Gateway connection pending')
    setTabs(current => current.map(t => t.id === activeId
      ? { ...t, url, title: new URL(url).hostname || 'Page' }
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
        <button className="icon-btn">⋯</button>
      </section>

      <section className="workspace">
        <div className="page-card">
          <div className="hero-orb" />
          <div className="hero-content">
            <div className="eyebrow">LYRENTHOS BROWSER</div>
            <h1>Your web.<br /><span>Your interface.</span></h1>
            <p>Fast browser gateway architecture with your own UI, persistent sessions, and an optional browser-engine fallback.</p>
            <div className="actions">
              <button className="primary" onClick={() => navigate('https://example.com')}>Open a site</button>
              <button className="secondary" onClick={() => setStatus('Gateway not configured yet')}>Connection status</button>
            </div>
          </div>
          <aside className="session-card">
            <div className="session-title">SESSION</div>
            <div className="session-value">{status}</div>
            <div className="session-row"><span>Render</span><b>Local browser</b></div>
            <div className="session-row"><span>Transport</span><b>Streaming HTTP</b></div>
            <div className="session-row"><span>Browser fallback</span><b>Chromium</b></div>
          </aside>
        </div>
      </section>

      <footer className="statusbar"><span>●</span> {status}</footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
