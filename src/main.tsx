import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { account, appwriteConfigured } from './lib/appwrite'
import { gatewayEnabled, gatewayHealth, proxyUrl } from './lib/gateway'
import './styles.css'

type Tab = { id: string; title: string; history: string[]; index: number }

const HOME_URL = 'https://example.com/'
const STORAGE_KEY = 'lyrenthos-browser-state-v3'

const icon = (name: string) => {
  const paths: Record<string, string> = {
    back: 'M19 12H5m7 7-7-7 7-7', forward: 'M5 12h14m-7-7 7 7-7 7',
    reload: 'M20 11a8 8 0 1 0 1 4m-1-8v5h-5', shield: 'M12 3l7 3v5c0 4.6-2.9 8.2-7 10-4.1-1.8-7-5.4-7-10V6l7-3z',
    plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6 6 18',
    home: 'M3 11.5 12 4l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-8zM9 21v-6h6v6',
    lock: 'M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-9-9h18M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3z',
    external: 'M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5',
    user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-1.8 1.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V20h-2.6v-.1a1.8 1.8 0 0 0-1.1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-1.8-1.8.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1.1H6v-2.6h.1a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.4-2l-.1-.1 1.8-1.8.1.1a1.8 1.8 0 0 0 2 .4 1.8 1.8 0 0 0 1.1-1.7V4h2.6v.1a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1 1.8 1.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1.1h.1V13h-.1a1.8 1.8 0 0 0-1.7 2z'
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.globe} /></svg>
}

function normalise(value: string): string {
  const v = value.trim()
  if (!v) return HOME_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v
  if (v.includes(' ') || !v.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(v)}`
  return `https://${v}`
}

function newTab(url = HOME_URL, title = 'New tab'): Tab {
  return { id: crypto.randomUUID(), title, history: [url], index: 0 }
}

function loadTabs(): Tab[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as { tabs?: Tab[] }
    if (Array.isArray(parsed.tabs) && parsed.tabs.length) return parsed.tabs
  } catch {}
  return [newTab()]
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>(loadTabs)
  const [activeId, setActiveId] = useState(() => loadTabs()[0]?.id ?? '')
  const [address, setAddress] = useState(HOME_URL)
  const [health, setHealth] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [signedIn, setSignedIn] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const active = useMemo(() => tabs.find(t => t.id === activeId) ?? tabs[0], [tabs, activeId])
  const currentUrl = active?.history[active.index] ?? HOME_URL

  useEffect(() => setAddress(currentUrl), [activeId, currentUrl])
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs })), [tabs])

  useEffect(() => {
    if (!gatewayEnabled()) { setHealth('offline'); return }
    let alive = true
    const check = async () => { const ok = await gatewayHealth(); if (alive) setHealth(ok ? 'online' : 'offline') }
    void check()
    const timer = window.setInterval(check, 30000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!appwriteConfigured) return
    account.get().then(() => setSignedIn(true)).catch(() => setSignedIn(false))
  }, [])

  function navigate(raw: string) {
    const url = normalise(raw)
    setTabs(current => current.map(tab => {
      if (tab.id !== activeId) return tab
      const history = tab.history.slice(0, tab.index + 1)
      history.push(url)
      let title = 'New tab'
      try { title = new URL(url).hostname }
      catch {}
      return { ...tab, history, index: history.length - 1, title }
    }))
    setAddress(url)
  }

  function step(delta: number) {
    setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, index: Math.max(0, Math.min(tab.history.length - 1, tab.index + delta)) } : tab))
  }

  function addTab() {
    const tab = newTab()
    setTabs(current => [...current, tab])
    setActiveId(tab.id)
  }

  function closeTab(id: string) {
    if (tabs.length === 1) return
    const index = tabs.findIndex(t => t.id === id)
    const next = tabs.filter(t => t.id !== id)
    setTabs(next)
    if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id)
  }

  async function signIn(event: FormEvent) {
    event.preventDefault(); setAuthError('')
    try {
      await account.createEmailPasswordSession(email, password)
      setSignedIn(true); setAuthOpen(false); setPassword('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed')
    }
  }

  const targetFrame = gatewayEnabled() ? proxyUrl(currentUrl) : ''

  return (
    <div className="browser-app" onClick={() => menuOpen && setMenuOpen(false)}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-symbol">LY</div>
          <div><div className="brand-name">LYRENTHOS</div><div className="brand-sub">PRIVATE WEB</div></div>
        </div>
        <div className="header-actions">
          <div className={`connection ${health}`}><span />{health === 'online' ? 'CONNECTED' : 'GATEWAY OFFLINE'}</div>
          <button className="account-button" onClick={(e) => { e.stopPropagation(); setAuthOpen(true) }}><span className="avatar">{signedIn ? 'DS' : 'G'}</span>{signedIn ? 'Account' : 'Sign in'}</button>
        </div>
      </header>

      <div className="tab-strip">
        <div className="tabs-scroll">
          {tabs.map(tab => <button key={tab.id} className={`tab ${tab.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(tab.id)}>
            <span className="tab-favicon">{icon('globe')}</span><span>{tab.title}</span>
            {tabs.length > 1 && <span className="tab-x" onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}>{icon('close')}</span>}
          </button>)}
        </div>
        <button className="new-tab" onClick={addTab}>{icon('plus')}</button>
      </div>

      <div className="navigation-bar">
        <div className="nav-controls">
          <button className="toolbar-button" disabled={active?.index === 0} onClick={() => step(-1)}>{icon('back')}</button>
          <button className="toolbar-button" disabled={active?.index === active?.history.length - 1} onClick={() => step(1)}>{icon('forward')}</button>
          <button className="toolbar-button" onClick={() => navigate(currentUrl)}>{icon('reload')}</button>
          <button className="toolbar-button home-button" onClick={() => navigate(HOME_URL)}>{icon('home')}</button>
        </div>
        <form className="address-bar" onSubmit={(e) => { e.preventDefault(); navigate(address) }}>
          <span className="address-security">{icon(gatewayEnabled() ? 'lock' : 'globe')}</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} aria-label="Address" />
          <span className="address-domain">{gatewayEnabled() ? 'LYRENTHOS' : 'LOCAL'}</span>
          <button type="submit" className="go-button">OPEN</button>
        </form>
        <div className="nav-controls"><button className="toolbar-button" onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}>{icon('settings')}</button></div>
        {menuOpen && <div className="quick-menu" onClick={e => e.stopPropagation()}>
          <div className="menu-title">WORKSPACE</div>
          <div className="menu-row"><span>Gateway</span><strong>{health === 'online' ? 'Connected' : 'Not connected'}</strong></div>
          <div className="menu-row"><span>Account</span><strong>{signedIn ? 'Signed in' : 'Guest'}</strong></div>
          <button onClick={() => setAuthOpen(true)}>{icon('user')} Account</button>
        </div>}
      </div>

      <main className="content">
        {targetFrame ? <div className="web-shell"><div className="web-topline"><span>{currentUrl}</span><button onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}>{icon('external')} Direct</button></div><iframe title="Lyrenthos web" src={targetFrame} className="site-frame" referrerPolicy="no-referrer" /></div> :
        <section className="dashboard">
          <div className="hero-glow" />
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> PERSONAL WEB WORKSPACE</div>
            <h1>Your browser.<br /><span>Your interface.</span></h1>
            <p>Open a website through the Lyrenthos gateway. The page is rendered by your device browser; the gateway handles the network path and session layer.</p>
            <div className="hero-actions">
              <button className="primary-action" onClick={() => navigate(address || HOME_URL)}>Open address {icon('external')}</button>
              <button className="secondary-action" onClick={() => { setAddress('https://example.com/'); navigate('https://example.com/') }}>Use test site</button>
            </div>
          </div>
          <div className="feature-grid">
            <article><div className="feature-icon">{icon('shield')}</div><h3>Isolated sessions</h3><p>Session state is scoped to the workspace instead of being shared across users.</p></article>
            <article><div className="feature-icon">{icon('reload')}</div><h3>Local rendering</h3><p>Your own browser renders HTML, CSS and JavaScript rather than receiving a desktop video stream.</p></article>
            <article><div className="feature-icon">{icon('globe')}</div><h3>Gateway transport</h3><p>HTTP content is carried through the gateway when it is configured and online.</p></article>
          </div>
          <div className="status-card">
            <div className="status-card-head"><span>SYSTEM STATUS</span><span className={`mini-status ${health}`}><i />{health === 'online' ? 'READY' : 'SETUP'}</span></div>
            <div className="status-items">
              <div><span>Frontend</span><b>Appwrite Site</b></div><div><span>Workspace</span><b>Persistent locally</b></div>
              <div><span>Identity</span><b>{appwriteConfigured ? 'Appwrite' : 'Not configured'}</b></div><div><span>Gateway</span><b>{gatewayEnabled() ? 'Configured' : 'Endpoint required'}</b></div>
            </div>
          </div>
        </section>}
      </main>
      <footer className="statusbar"><span className={`footer-light ${health}`} /><span>{health === 'online' ? 'Gateway connected' : 'Frontend online · gateway not connected'}</span><span className="footer-spacer" /><span>LYRENTHOS</span></footer>

      {authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><form className="auth-modal" onSubmit={signIn} onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={() => setAuthOpen(false)}>{icon('close')}</button><div className="modal-symbol">{icon('user')}</div>
        <h2>Sign in to Lyrenthos</h2><p>Your Appwrite account identifies your browser workspace.</p>
        {!appwriteConfigured && <div className="notice">Add the Appwrite endpoint and project ID as Site environment variables before using account authentication.</div>}
        {authError && <div className="error">{authError}</div>}
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} /></label>
        <button className="primary-action full" type="submit" disabled={!appwriteConfigured}>Sign in</button>
      </form></div>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
