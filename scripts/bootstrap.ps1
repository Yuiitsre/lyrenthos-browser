$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/Yuiitsre/lyrenthos-browser.git'
$RepoName = 'lyrenthos-browser'
$Root = Join-Path $HOME $RepoName
$SiteId = 'lyrenthos-browser'

function Need-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-WingetPackage([string]$Id, [string]$Command) {
  if (Need-Command $Command) { return }
  if (-not (Need-Command 'winget')) {
    throw "'$Command' is missing and winget is not available. Install it, then rerun this script."
  }
  Write-Host "Installing $Command..." -ForegroundColor Cyan
  winget install --id $Id --exact --accept-source-agreements --accept-package-agreements
}

Write-Host "== Lyrenthos Browser bootstrap ==" -ForegroundColor Green

Ensure-WingetPackage 'Git.Git' 'git'
Ensure-WingetPackage 'OpenJS.NodeJS.LTS' 'node'
Ensure-WingetPackage 'GoLang.Go' 'go'

if (-not (Need-Command 'heroku')) {
  if (Need-Command 'winget') {
    Write-Host 'Installing Heroku CLI...' -ForegroundColor Cyan
    winget install --id Heroku.HerokuCLI --exact --accept-source-agreements --accept-package-agreements
  }
}

if (-not (Need-Command 'appwrite')) {
  Write-Host 'Installing Appwrite CLI...' -ForegroundColor Cyan
  npm install -g appwrite-cli
}

if (-not (Test-Path $Root)) {
  git clone $RepoUrl $Root
} else {
  Set-Location $Root
  git fetch origin
  git checkout main
  git pull --ff-only origin main
}
Set-Location $Root

Write-Host 'Installing frontend dependencies...' -ForegroundColor Cyan
Set-Location (Join-Path $Root 'apps/web')
npm install
npm run build
Set-Location $Root

$ProjectId = Read-Host 'Enter your Appwrite PROJECT ID'
$Endpoint = Read-Host 'Enter your Appwrite project endpoint (example: https://fra.cloud.appwrite.io/v1)'
$ApiKeySecure = Read-Host 'Enter an Appwrite API key with sites.write scope' -AsSecureString
$ApiKeyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ApiKeySecure)
$ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ApiKeyPtr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ApiKeyPtr)

Write-Host 'Configuring Appwrite CLI in non-interactive mode...' -ForegroundColor Cyan
appwrite client --endpoint $Endpoint --project-id $ProjectId --key $ApiKey

# Keep a CLI-friendly local config. Secrets are never committed.
$Config = @'
{
  "version": 1,
  "sites": [
    {
      "$id": "lyrenthos-browser",
      "name": "Lyrenthos Browser",
      "framework": "vite",
      "enabled": true,
      "logging": true,
      "timeout": 30,
      "installCommand": "npm install",
      "buildCommand": "npm run build",
      "outputDirectory": "dist",
      "buildRuntime": "node-22",
      "adapter": "static",
      "fallbackFile": "index.html",
      "path": "apps/web"
    }
  ]
}
'@
Set-Content -Path (Join-Path $Root 'appwrite.config.json') -Value $Config -Encoding utf8

# Create the Appwrite Site if it does not already exist.
$Headers = @{
  'X-Appwrite-Project' = $ProjectId
  'X-Appwrite-Key' = $ApiKey
  'Content-Type' = 'application/json'
}
$Site = $null
try {
  $Site = Invoke-RestMethod -Uri ($Endpoint.TrimEnd('/') + '/sites/' + $SiteId) -Headers $Headers -Method Get
  Write-Host "Appwrite Site '$SiteId' already exists." -ForegroundColor Yellow
} catch {
  $Body = @{
    siteId = $SiteId
    name = 'Lyrenthos Browser'
    framework = 'vite'
    enabled = $true
    logging = $true
    timeout = 30
    installCommand = 'npm install'
    buildCommand = 'npm run build'
    outputDirectory = 'dist'
    buildRuntime = 'node-22'
    adapter = 'static'
    fallbackFile = 'index.html'
    deploymentRetention = 7
  } | ConvertTo-Json -Depth 5
  Write-Host 'Creating Appwrite Site...' -ForegroundColor Cyan
  $Site = Invoke-RestMethod -Uri ($Endpoint.TrimEnd('/') + '/sites') -Headers $Headers -Method Post -Body $Body
}

# Deploy the gateway to Heroku if the CLI is available.
$GatewayUrl = ''
if (Need-Command 'heroku') {
  heroku whoami | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $HerokuApp = Read-Host 'Heroku app name (press Enter for auto-generated)'
    if ([string]::IsNullOrWhiteSpace($HerokuApp)) {
      $HerokuApp = (& heroku create | Select-Object -First 1).Split(' ')[0]
    } else {
      $existing = (& heroku apps:info -a $HerokuApp 2>$null | Out-String)
      if (-not $existing) { heroku create $HerokuApp | Out-Null }
    }

    Write-Host "Deploying gateway from services/gateway to Heroku app $HerokuApp..." -ForegroundColor Cyan
    heroku config:set WEB_ORIGIN='*' LISTEN_ADDR=':8080' -a $HerokuApp | Out-Null
    git remote remove heroku 2>$null
    heroku git:remote -a $HerokuApp | Out-Null
    git subtree push --prefix services/gateway heroku main
    $GatewayUrl = (& heroku info -a $HerokuApp -s | Select-String '^web_url=').ToString().Split('=')[1].Trim()
  } else {
    Write-Host 'Heroku CLI is installed but not logged in. Skipping gateway deployment.' -ForegroundColor Yellow
  }
} else {
  Write-Host 'Heroku CLI unavailable. The Appwrite frontend will still be deployed, but gateway features remain offline.' -ForegroundColor Yellow
}

if ([string]::IsNullOrWhiteSpace($GatewayUrl)) {
  $GatewayUrl = Read-Host 'Gateway URL (press Enter to leave it blank for now)'
}

# Vite public variables are safe to place in the Site environment. Do NOT put Appwrite API keys here.
$EnvPath = Join-Path $Root 'apps/web/.env'
@
"VITE_APPWRITE_ENDPOINT=$Endpoint"
"VITE_APPWRITE_PROJECT_ID=$ProjectId"
"VITE_GATEWAY_URL=$GatewayUrl"
@ | Set-Content -Path $EnvPath -Encoding utf8

Write-Host 'Building and pushing the Appwrite Site...' -ForegroundColor Cyan
appwrite push sites --site-id $SiteId --with-variables --force

try {
  $Live = appwrite sites get --site-id $SiteId --json | ConvertFrom-Json
  if ($Live.domain) {
    $SiteUrl = $Live.domain
  } elseif ($Live.url) {
    $SiteUrl = $Live.url
  } else {
    $SiteUrl = "https://$SiteId.appwrite.network"
  }
} catch {
  $SiteUrl = "https://$SiteId.appwrite.network"
}

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host 'Lyrenthos Browser deployment finished.' -ForegroundColor Green
Write-Host "Repository: $RepoUrl"
Write-Host "Appwrite Site ID: $SiteId"
Write-Host "Launch URL: $SiteUrl" -ForegroundColor Cyan
if ($GatewayUrl) { Write-Host "Gateway URL: $GatewayUrl" -ForegroundColor Cyan }
Write-Host '=============================================' -ForegroundColor Green
Write-Host 'Open the Launch URL in your browser.'
