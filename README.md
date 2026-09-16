# Lyrenthos Browser

A fast browser-in-browser frontend and gateway architecture for user-authorized web access.

## Architecture

```text
User Browser
    |
    v
Lyrenthos Web UI (React + TypeScript)
    |
    +--> Appwrite Auth / user state
    |
    v
Gateway (Go)
    |
    +--> streaming HTTP/HTTPS proxy
    +--> URL/header/cookie rewriting
    +--> WebSocket pass-through
    +--> connection pooling
    |
    +--> optional Browser Worker (Chromium/Playwright)
              |
              +--> persistent per-user browser profile

Appwrite is the control plane. The gateway is the data plane.

The static frontend can be published on Appwrite Sites. The Go gateway runs separately (for example on Heroku or another container host).
```

## Important design decisions

- The normal path does **not** remote-stream screenshots. The user's own browser renders HTML/CSS/JS.
- Chromium is a fallback for sites that genuinely require browser execution.
- Authentication/session state is isolated per user. Raw third-party cookies are not stored in Appwrite's normal application database.
- The gateway must only be used with targets whose terms, robots rules, authentication model, and applicable law permit the requested access.
- DRM, CAPTCHA, authentication, or other access controls are not bypassed.

## Development

Frontend:

```bash
cd apps/web
npm install
npm run dev
```

Gateway:

```bash
cd services/gateway
go run .
```

The frontend currently contains the browser UI, session model, command bar, and gateway protocol client stub. The gateway package contains the production-oriented HTTP streaming skeleton.
