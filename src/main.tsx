import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { gatewayEnabled, gatewayHealth, proxyUrl } from './lib/gateway'
import './styles.css'

type Tab = { id: string; title: string; history: string[]; index: number }
const STORAGE_KEY = 'lyrenthos-browser-state-v5'
const HOME = ''

const P = {
  back: 'M19 12H5m7 7-7-7 7-7', forward: 'M5 12h14m-7-7 7 7-7 7', reload: 'M20 11a8 8 0 1 0 1 4m-1-8v5h-5',
  home: 'M3 11.5 12 4l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-8zM9 21v-6h6v6',
  plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6 6 18',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-9-9h18M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-1.8 1.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V20h-2.6v-.1a1.8 1.8 0 0 0-1.1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-1.8-1.8.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1.1H6v-2.6h.1a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.4-2l-.1-.1 1.8-1.8.1.1a1.8 1.8 0 0 0 2 .4 1.8 1.8 0 0 0 1.1-1.7V4h2.6v.1a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1 1.8 1.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1.1h.1V13h-.1a1.8 1.8 0 0 0-1.7 2z',
  external: 'M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'
}
const I = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d}/></svg>

function normalize(v: string) {
  const s = v.trim()
  if (!s) return HOME
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (s.includes(' ') || !s.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(s)}`
  return `https://${s}`
}
function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'New tab' } }
function makeTab(): Tab { return { id: crypto.randomUUID(), title: 'New tab', history: [HOME], index: 0 } }
function loadTabs(): Tab[] { try { const x = JSON.parse(localStorage.getItem(STORAGE_KEY) || '') as { tabs?: Tab[] }; if (x.tabs?.length) return x.tabs } catch {} return [makeTab()] }

function App() {
  const initial = useMemo(loadTabs, [])
  const [tabs, setTabs] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0].id)
  const [address, setAddress] = useState('')
  const [health, setHealth] = useState<'unknown'|'online'|'offline'>('unknown')
  const [menuOpen, setMenuOpen] = useState(false)
  const [loadError, setLoadError] = useState('')

  const active = useMemo(() => tabs.find(t => t.id === activeId) || tabs[0], [tabs, activeId])
  const currentUrl = active.history[active.index] || ''
  const frameUrl = gatewayEnabled() && currentUrl ? proxyUrl(currentUrl) : ''

  useEffect(() => setAddress(currentUrl), [currentUrl])
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs })), [tabs])
  useEffect(() => {
    if (!gatewayEnabled()) return
    let alive = true
    const check = async () => { const ok = await gatewayHealth(); if (alive) setHealth(ok ? 'online' : 'offline') }
    void check(); const timer = window.setInterval(check, 30000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  function navigate(raw: string) {
    const url = normalize(raw)
    if (!url) return
    setLoadError('')
    setTabs(cur => cur.map(t => {
      if (t.id !== activeId) return t
      const history = t.history.slice(0, t.index + 1)
      if (history.at(-1) === url) return t
      history.push(url)
      return { ...t, history, index: history.length - 1, title: host(url) }
    }))
    setAddress(url)
  }
  function home() { setTabs(cur => cur.map(t => t.id === activeId ? { ...t, history: [HOME], index: 0, title: 'New tab' } : t)); setAddress(''); setLoadError('') }
  function reload() { const frame = document.querySelector<HTMLIFrameElement>('.site-frame'); if (frame) frame.src = frame.src }
  function move(delta: number) { setTabs(cur => cur.map(t => t.id === activeId ? { ...t, index: Math.max(0, Math.min(t.history.length - 1, t.index + delta)) } : t)) }
  function addTab() { const t = makeTab(); setTabs(cur => [...cur, t]); setActiveId(t.id); setAddress(''); setLoadError('') }
  function closeTab(id: string) { if (tabs.length === 1) return; const i = tabs.findIndex(t => t.id === id), next = tabs.filter(t => t.id !== id); setTabs(next); if (id === activeId) setActiveId(next[Math.max(0, i - 1)].id) }

  return <div className="browser-app" onClick={() => menuOpen && setMenuOpen(false)}>
    <header className="app-header"><div className="brand"><div className="brand-symbol">LY</div><div><div className="brand-name">LYRENTHOS</div><div className="brand-sub">PERSISTENT WEB</div></div></div><div className="header-status"><span className={`status-led ${health}`} />Persistent workspace</div></header>
    <div className="tab-strip"><div className="tabs-scroll">{tabs.map(t => <button key={t.id} className={`tab ${t.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(t.id)}><span className="tab-favicon"><I d={P.globe}/></span><span>{t.title}</span>{tabs.length > 1 && <span className="tab-x" onClick={e => { e.stopPropagation(); closeTab(t.id) }}><I d={P.close}/></span>}</button>)}</div><button className="new-tab" onClick={addTab}><I d={P.plus}/></button></div>
    <div className="navigation-bar"><div className="nav-controls"><button className="toolbar-button" disabled={active.index === 0} onClick={() => move(-1)}><I d={P.back}/></button><button className="toolbar-button" disabled={active.index === active.history.length - 1} onClick={() => move(1)}><I d={P.forward}/></button><button className="toolbar-button" disabled={!currentUrl} onClick={reload}><I d={P.reload}/></button><button className="toolbar-button" onClick={home}><I d={P.home}/></button></div><form className="address-bar" onSubmit={(e: FormEvent) => { e.preventDefault(); navigate(address) }}><span className="address-security"><I d={frameUrl ? P.lock : P.globe}/></span><input autoFocus value={address} onChange={e => setAddress(e.target.value)} placeholder="Enter a website address or search" spellCheck={false} aria-label="Website address"/><span className="address-chip">{frameUrl ? 'LYRENTHOS' : 'URL'}</span><button className="go-button">OPEN</button></form><div className="nav-controls"><button className="toolbar-button" onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}><I d={P.settings}/></button></div>{menuOpen && <div className="quick-menu" onClick={e => e.stopPropagation()}><div className="menu-title">BROWSER</div><div className="menu-row"><span>Session</span><strong>Persistent</strong></div><div className="menu-row"><span>Renderer</span><strong>Device</strong></div><div className="menu-row"><span>Transport</span><strong>{gatewayEnabled() ? 'Gateway' : 'Pending'}</strong></div></div>}</div>
    <main className="content">{frameUrl ? <div className="web-shell"><div className="web-topline"><span>{currentUrl}</span><button onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}><I d={P.external}/> Direct</button></div><iframe title="Lyrenthos browser viewport" className="site-frame" src={frameUrl} referrerPolicy="no-referrer" onLoad={() => setLoadError('')} onError={() => setLoadError('Unable to load this page through the gateway.')}/>{loadError && <div className="load-error">{loadError}</div>}</div> : <section className="newtab-page"><div className="newtab-glow"/><div className="newtab-content"><div className="eyebrow"><span/> PRIVATE WEB WORKSPACE</div><h1>One URL.<br/><em>Your persistent web space.</em></h1><p>Enter a website address. Lyrenthos keeps the workspace persistent while your browser renders the returned page locally.</p><div className="launch-bar" onClick={() => document.querySelector<HTMLInputElement>('.address-bar input')?.focus()}><I d={P.globe}/><span>Type a URL to open a site</span><kbd>Ctrl L</kbd></div><div className="capabilities"><div><b>Persistent</b><span>workspace</span></div><div><b>Local</b><span>rendering</span></div><div><b>Fast</b><span>HTTP path</span></div></div></div></section>}</main>
    <footer className="statusbar"><span className={`footer-light ${health}`}/><span>{health === 'online' ? 'Persistent session ready' : 'Persistent workspace'}</span><span className="footer-spacer"/><span>LYRENTHOS</span></footer>
  </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
