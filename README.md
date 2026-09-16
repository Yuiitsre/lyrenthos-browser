# Lyrenthos Browser

A browser-in-browser web gateway prototype designed around a simple performance rule: **let the user's browser render the website whenever possible; do not turn ordinary web pages into remote-desktop video.**

## What is in this repository

```text
lyrenthos-browser/
├── apps/web/                 # React + Vite browser UI for Appwrite Sites
├── services/gateway/         # Go HTTP gateway for public-web resources
├── docs/                     # Deployment and architecture notes
└── README.md
```

### Runtime architecture

```text
User browser
   │
   ▼
Lyrenthos Web UI (Appwrite Sites)
   │
   │ HTTPS
   ▼
Go Gateway (Heroku/container)
   │
   ├── streaming HTTP/HTTPS resources
   ├── per-session cookie jar
   ├── redirect handling
   ├── HTML URL rewriting
   ├── connection pooling / HTTP/2
   └── SSRF-resistant destination dialing
```

The current release is an **MVP public-web gateway**. It deliberately supports GET/HEAD first. POST/forms, WebSockets, browser-engine fallback, durable encrypted session storage and site-specific adapters are separate phases because each requires additional security and protocol work.

## Appwrite Sites deployment

Appwrite Sites automatically gives every deployed Site a generated HTTPS domain such as:

```text
https://<site-id>.appwrite.network
```

The generated domain is available immediately after deployment and does not require you to attach your own domain. Appwrite also supports branch and commit URLs. See the official Sites domain documentation.

For this repo, create an Appwrite Site from GitHub with:

- Repository: `Yuiitsre/lyrenthos-browser`
- Production branch: `main`
- Root directory: `apps/web`
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`
- Build runtime: Node.js

Environment variables:

```text
VITE_APPWRITE_ENDPOINT=https://<REGION>.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=<YOUR_PROJECT_ID>
VITE_GATEWAY_URL=https://<YOUR_GATEWAY_HOST>
```

Add your generated Site hostname as a Web platform in Appwrite so the browser client is allowed to use the project.

## Gateway deployment

The gateway is intentionally separate from Appwrite Sites because a Site is the frontend deployment, while the gateway is a long-running network service.

For Heroku/container deployment, use `services/gateway` as the application root and:

```bash
go build -o lyrenthos-gateway .
./lyrenthos-gateway
```

Required environment variable for browser requests:

```text
WEB_ORIGIN=https://<your-appwrite-site>.appwrite.network
```

Optional:

```text
LISTEN_ADDR=:8080
UPSTREAM_USER_AGENT=<custom user agent>
```

## Security model

The gateway accepts only `http` and `https`, rejects loopback/private/link-local/multicast/unspecified destinations, re-checks DNS at connection time, limits redirect depth, limits response sizes and keeps third-party cookies out of the user's browser origin.

The gateway is **not** intended to defeat DRM, authentication, CAPTCHA, CORS/security policy, or other access controls. Use it only for websites and access patterns that permit the requested gatewaying/proxying.

### Session persistence

The current gateway keeps each session's cookie jar in process memory for up to seven days of inactivity. This means it survives normal requests but **does not survive a Heroku dyno/container restart**. Durable session storage requires an encrypted external store and should be added before a paid production launch.

### HTML rewriting limitation

HTML links, resource URLs and redirects are rewritten to the gateway. Some modern applications use JavaScript-generated URLs, service workers, WebSockets, complex cross-origin APIs or frame policies that require dedicated handling. The current release intentionally does not strip target security headers or bypass frame restrictions.

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

## Current roadmap

1. GET/HEAD gateway + HTML rewriting (current)
2. Durable encrypted session store
3. POST/forms + safe request-body forwarding
4. WebSocket support
5. Optional Playwright/Chromium fallback
6. Browser session lifecycle and per-user authorization through Appwrite
7. Performance testing and regional gateway deployment
