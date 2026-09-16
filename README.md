# Lyrenthos Browser

Lyrenthos is a browser-style web workspace built to keep the user's browser doing the rendering. The Appwrite project is the entire managed platform: Site for the UI, Functions for the gateway, and Storage for durable session state.

## Appwrite-only architecture

```text
User browser
    |
    v
Appwrite Site (Lyrenthos UI)
    |
    v
Appwrite Function: lyrenthos-gateway
    |
    +-- fast HTTP/HTTPS fetch
    +-- per-session cookie jar
    +-- redirects + HTML/CSS URL rewriting
    +-- GET/HEAD/POST/PUT/PATCH/DELETE forwarding
    +-- SSRF/private-address protections
    |
    v
Target website

Appwrite Storage
    |
    +-- encrypted-at-rest session state
    +-- one session file per browser workspace
```

No Heroku, VPS, Redis, or external gateway is required for this architecture.

## What the browser is

The Lyrenthos Site is the browser chrome: tabs, address bar, navigation history, reload, home, and the web viewport. It does not ask the user to create a separate Lyrenthos account just to browse.

The target site is loaded through the Appwrite Function domain and rendered by the user's local browser. The function handles the network path and stores the target site's cookies in Appwrite Storage so the same Lyrenthos workspace can reuse that state later.

## Appwrite Function

Function ID:

```text
lyrenthos-gateway
```

Runtime:

```text
node-22
```

Entrypoint:

```text
index.js
```

Root directory:

```text
functions/lyrenthos-gateway
```

Build command:

```text
npm install
```

Execute access:

```text
Any
```

The function needs these dynamic-key scopes:

```text
buckets.read
buckets.write
files.read
files.write
```

On the first request it creates the private encrypted Appwrite Storage bucket `lyrenthos-browser-sessions` when it is missing. Session files are keyed by a high-entropy browser workspace ID and contain only the target-site cookie jar and update timestamp.

## Site deployment

Appwrite Site configuration:

```text
Framework: Vite
Root directory: ./
Install: npm install
Build: npm run build
Output: dist
Fallback: index.html
```

Set the Site environment variable after the Function has a generated domain:

```text
VITE_GATEWAY_URL=https://<function-id>.<region>.appwrite.run
```

Appwrite Functions provide generated HTTPS domains and can be deployed directly from Git. Commits to the configured production branch can automatically build and activate new deployments. Appwrite documents a 30-second hard limit for synchronous function executions and a configurable function timeout up to 15 minutes, so this Appwrite-only version is designed around short HTTP requests rather than an always-open remote desktop stream.

## Session model

The browser creates a random workspace ID and keeps it in local storage. Every gateway navigation carries that ID to the Function. The Function reads the corresponding session file from Appwrite Storage, applies matching cookies to the upstream request, captures new `Set-Cookie` headers, and saves the updated jar back to Storage.

The session identifier is a bearer-style workspace token; do not share it publicly. A later production hardening step can bind sessions to Appwrite user identities or device authorization without changing the network architecture.

## Development

Frontend:

```bash
npm install
npm run dev
```

Function:

```bash
cd functions/lyrenthos-gateway
npm install
```

Appwrite supports Git-connected Function deployments and automatic activation from the production branch. See the official Appwrite Functions deployment documentation for configuring the repository, root directory, entrypoint, runtime, permissions, and build commands.
