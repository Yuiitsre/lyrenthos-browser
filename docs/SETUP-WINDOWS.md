# Windows bootstrap

The repository includes `scripts/bootstrap.ps1`. It clones or updates the repo, installs frontend dependencies, builds the Vite app, configures the Appwrite CLI in non-interactive mode, creates the Appwrite Site when missing, creates/deploys the Go gateway as a separate Heroku app, injects the public Vite variables, pushes the Site, prints the launch URLs, and opens the Appwrite Site.

## Prerequisites

- Git for Windows
- Node.js LTS
- Heroku CLI
- A Heroku login
- An Appwrite project
- An Appwrite API key with `sites.write`

The script installs the Appwrite CLI through npm when it is missing.

## One-line launcher

In PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass; irm https://raw.githubusercontent.com/Yuiitsre/lyrenthos-browser/main/scripts/bootstrap.ps1 | iex
```

The script will prompt for the Appwrite project ID, regional project endpoint, and API key. The API key is used only by the local deployment process and is not written into the repository or the public frontend.

## Important

The frontend is deployed to Appwrite Sites. The network gateway is a separate Heroku service because it is a long-running server. The browser UI is therefore available on the Appwrite-generated Site URL even if the gateway is temporarily offline.

The gateway is an MVP web gateway, not a universal browser implementation. Modern applications that depend on POST requests, WebSockets, service workers, strict frame policies, complex cross-origin APIs, browser-only execution, DRM, or other site-specific mechanisms may require dedicated adapters or the planned Chromium fallback.
