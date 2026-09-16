# Appwrite Sites deployment

The deployable website is in `apps/web`.

Configure the Appwrite Site connected to this GitHub repository with:

- **Root directory:** `apps/web`
- **Build command:** `npm run build`
- **Output directory:** `dist`

Set these environment variables in the Appwrite Site:

```text
VITE_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=<your-project-id>
VITE_GATEWAY_URL=<your-gateway-url>
```

For the first UI-only deployment, `VITE_GATEWAY_URL` can be left empty. The site will show the browser shell and explain that the gateway is not configured.

Do not put Appwrite API keys, gateway secrets, third-party credentials, or browser profile secrets in `VITE_*` variables. Vite exposes these variables to the browser bundle.
