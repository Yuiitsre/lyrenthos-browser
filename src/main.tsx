import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { gatewayEnabled, gatewayHealth, proxyUrl } from './lib/gateway'
import './styles.css'

type Tab = { id: string; title: string; history: string[]; index: number }
const STORAGE_KEY = 'lyrenthos-browser-state-v4'

const P = {
  back: 'M19 12H5m7 7-7-7 7-7', forward: 'M5 12h14m-7-7 7 7-7 7',
  reload: 'M20 11a8 8 0 1 0 1 4m-1-8v5h-5',
  home: 'M3 11.5 12 4l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-8zM9 21v-6h6v6',
  plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6 6 18',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-9-9h18M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-1.8 1.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V20h-2.6v-.1a1.8 1.8 0 0 0-1.1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-1.8-1.8.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1.1H6v-2.6h.1a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.4-2l-.1-.1 1.8-1.8.1.1a1.8 1.8 0 0 0 2 .4 1.8 1.8 0 0 0 1.1-1.7V4h2.6v.1a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1 1.8 1.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1.1h.1V13h-.1a1.8 1.8 0 0 0-1.7 2z',
  external: 'M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'
}

function Icon({ d }: { d: string }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg> }
function normalize(value: string) {
  const v = value.trim()
  if (!v) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v
  if (v.includes(' ') || !v.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(v)}`
  return `https://${v}`
}
function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'New tab' } }
function makeTab(url = ''): Tab { return { id: crypto.randomUUID(), title: 'New tab', history: [url], index: 0 } }
function readTabs(): Tab[] {
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as { tabs?: Tab[] }; if (parsed.tabs?.length) return parsed.tabs } catch {}
  return [makeTab()]
}

function App() {
  const initial = useMemo(readTabs, [])
  const [tabs, setTabs] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0].id)
  const [address, setAddress] = useState('')
  const [health, setHealth] = useState<'unknown'|'online'|'offline'>('unknown')
  const [menuOpen, setMenuOpen] = useState(false)

  const active = useMemo(() => tabs.find(t => t.id === activeId) ?? tabs[0], [tabs, activeId])
  const currentUrl = active.history[active.index] ?? ''
  const frameUrl = gatewayEnabled() && currentUrl ? proxyUrl(currentUrl) : ''

  useEffect(() => setAddress(currentUrl), [currentUrl])
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs })), [tabs])
  useEffect(() => {
    if (!gatewayEnabled()) { setHealth('offline'); return }
    let alive = true
    const check = async () => { const ok = await gatewayHealth(); if (alive) setHealth(ok ? 'online' : 'offline') }
    void check(); const timer = window.setInterval(check, 30000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  function navigate(raw: string) {
    const url = normalize(raw)
    if (!url) return
    setTabs(cur => cur.map(tab => {
      if (tab.id !== activeId) return tab
      const history = tab.history.slice(0, tab.index + 1)
      if (history.at(-1) === url) return tab
      history.push(url)
      return { ...tab, history, index: history.length - 1, title: host(url) }
    }))
    setAddress(url)
  }
  function move(delta: number) { setTabs(cur => cur.map(t => t.id === activeId ? { ...t, index: Math.max(0, Math.min(t.history.length - 1, t.index + delta)) } : t)) }
  function home() { setTabs(cur => cur.map(t => t.id === activeId ? { ...t, title: 'New tab', history: [''], index: 0 } : t)); setAddress('') }
  function reload() { const frame = document.querySelector<HTMLIFrameElement>('.site-frame'); if (frame) frame.src = frame.src }
  function addTab() { const tab = makeTab(); setTabs(cur => [...cur, tab]); setActiveId(tab.id); setAddress('') }
  function closeTab(id: string) {
    if (tabs.length === 1) return
    const i = tabs.findIndex(t => t.id === id), next = tabs.filter(t => t.id !== id)
    setTabs(next); if (id === activeId) setActiveId(next[Math.max(0, i - 1)].id)
  }

  return <div className="browser-app" onClick={() => menuOpen && setMenuOpen(false)}>
    <header className="app-header">
      <div className="brand"><div className="brand-symbol">LY</div><div><div className="brand-name">LYRENTHOS</div><div className="brand-sub">PERSISTENT WEB</div></div></div>
      <div className="header-status"><span className={`status-led ${health}`} />{health === 'online' ? 'Connected' : 'Persistent workspace'}</div>
    </header>

    <div className="tab-strip"><div className="tabs-scroll">{tabs.map(tab => <button key={tab.id} className={`tab ${tab.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(tab.id)}><span className="tab-favicon"><Icon d={P.globe}/></span><span>{tab.title}</span>{tabs.length > 1 && <span className="tab-x" onClick={e => { e.stopPropagation(); closeTab(tab.id) }}><Icon d={P.close}/></span>}</button>)}</div><button className="new-tab" onClick={addTab} aria-label="New tab"><Icon d={P.plus}/></button></div>

    <div className="navigation-bar">
      <div className="nav-controls"><button className="toolbar-button" disabled={active.index === 0} onClick={() => move(-1)}><Icon d={P.back}/></button><button className="toolbar-button" disabled={active.index === active.history.length - 1} onClick={() => move(1)}><Icon d={P.forward}/></button><button className="toolbar-button" disabled={!currentUrl} onClick={reload}><Icon d={P.reload}/></button><button className="toolbar-button" onClick={home}><Icon d={P.home}/></button></div>
      <form className="address-bar" onSubmit={(e: FormEvent) => { e.preventDefault(); navigate(address) }}><span className="address-security"><Icon d={frameUrl ? P.lock : P.globe}/></span><input value={address} onChange={e => setAddress(e.target.value)} placeholder="Enter a website address or search" spellCheck={false} aria-label="Website address"/><span className="address-chip">{gatewayEnabled() ? 'LYRENTHOS' : 'BROWSER'}</span><button type="submit" className="go-button">OPEN</button></form>
      <div className="nav-controls"><button className="toolbar-button" onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}><Icon d={P.settings}/></button></div>
      {menuOpen && <div className="quick-menu" onClick={e => e.stopPropagation()}><div className="menu-title">WORKSPACE</div><div className="menu-row"><span>Session</span><strong>Persistent</strong></div><div className="menu-row"><span>Rendering</span><strong>Your browser</strong></div><div className="menu-row"><span>Transport</span><strong>{gatewayEnabled() ? 'Gateway' : 'Not connected'}</strong></div></div>}
    </div>

    <main className="content">
      {frameUrl ? <div className="web-shell"><div className="web-topline"><span>{currentUrl}</span><button onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}><Icon d={P.external}/> Direct</button></div><iframe title="Lyrenthos web" className="site-frame" src={frameUrl} referrerPolicy="no-referrer" /></div> : <section className="newtab-page"><div className="newtab-glow"/><div className="newtab-content"><div className="eyebrow"><span/> PRIVATE WEB WORKSPACE</div><h1>Your browser.<br/><em>Your persistent web space.</em></h1><p>Type a URL into the address bar. The device browser renders the page; the gateway is responsible for the network path and persistent site session when connected.</p><div className="launch-bar" onClick={() => document.querySelector<HTMLInputElement>('.address-bar input')?.focus()}><Icon d={P.globe}/><span>Enter a website address</span><kbd>Ctrl L</kbd></div><div className="capabilities"><div><b>Persistent</b><span>session state</span></div><div><b>Local</b><span>page rendering</span></div><div><b>Direct</b><span>HTTP transport</span></div></div>{!gatewayEnabled() && <div className="backend-note">The interface is live. Connect the Lyrenthos gateway service to load sites inside this workspace.</div>}</div></section>}
    </main>
    <footer className="statusbar"><span className={`footer-light ${health}`}/>{health === 'online' ? 'Gateway connected · persistent session ready' : 'Persistent browser workspace'}<span className="footer-spacer"/><span>LYRENTHOS</span></footer>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
