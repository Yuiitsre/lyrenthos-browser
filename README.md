# Lyrenthos Browser

A browser-in-browser web gateway designed around a simple performance rule: **let the user's browser render the website whenever possible; do not turn ordinary web pages into remote-desktop video.**

## Architecture

```text
User browser
   |
   v
React + Vite browser UI (Appwrite Sites)
   |
   v
Go gateway (Heroku/container)
   |
   +-- streaming HTTP/HTTPS
   +-- per-session cookie jar
   +-- redirects + HTML URL rewriting
   +-- connection pooling / HTTP/2
   +-- DNS/SSRF protections
   |
   +-- optional future Chromium/Playwright fallback
```

Appwrite is the control plane. The Go service is the network data plane. The user's browser remains responsible for rendering the returned HTML/CSS/JS rather than receiving a remote desktop video stream.

## Current release

The current gateway supports safe GET/HEAD proxying, streaming non-HTML bodies, redirect rewriting, HTML resource/link rewriting, isolated in-memory cookie jars, connection reuse, request/response limits, and SSRF protections. It intentionally does not defeat DRM, CAPTCHA, authentication controls, frame policies, or other access controls.

Modern sites may still require additional protocol handling such as POST/form forwarding, WebSockets, service workers, complex cross-origin APIs, or browser-only execution. Those are planned adapters rather than pretending a simple HTTP proxy is a universal browser.

## Appwrite Sites

Appwrite Sites can host this frontend and automatically provides a generated HTTPS Site URL, so attaching `lyrenthos.tech` is optional. The repository is configured for:

- Repository: `Yuiitsre/lyrenthos-browser`
- Production branch: `main`
- Site ID: `lyrenthos-browser`
- Path: `apps/web`
- Install: `npm install`
- Build: `npm run build`
- Output: `dist`
- Build runtime: `node-22`
- Adapter: `static`

Public Vite variables:

```text
VITE_APPWRITE_ENDPOINT=https://<REGION>.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=<PROJECT_ID>
VITE_GATEWAY_URL=https://<HEROKU_GATEWAY>.herokuapp.com
```

## One-command Windows deployment

The repository contains `scripts/bootstrap.ps1`. It can clone/update the repo, install the frontend, build it, configure the current Appwrite project through the CLI, create the Site if missing, create/deploy the gateway on Heroku, set the public frontend variables, push the Appwrite Site, print the launch URLs, and open the Site.

Run in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass; irm https://raw.githubusercontent.com/Yuiitsre/lyrenthos-browser/main/scripts/bootstrap.ps1 | iex
```

The script asks for your Appwrite project ID, regional project endpoint, and an Appwrite API key with `sites.write`. The key is used only locally during deployment and is not written to the repository or frontend bundle.

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

The gateway can be deployed to Heroku by making `services/gateway` the Heroku application root (the bootstrap script uses `git subtree push` for this).

## Session model

The gateway uses an isolated in-memory cookie jar per Lyrenthos session. This is useful for the prototype, but sessions do not survive a Heroku dyno restart. Before a paid production service, replace the in-memory store with an encrypted, durable session store and bind sessions to authenticated Appwrite users.
