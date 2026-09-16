$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/Yuiitsre/lyrenthos-browser.git'
$RepoName = 'lyrenthos-browser'
$Root = Join-Path $HOME $RepoName
$SiteId = 'lyrenthos-browser'

function Need-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Stop-Missing([string]$Name, [string]$InstallHint) {
  if (-not (Need-Command $Name)) { throw "$Name is required. $InstallHint" }
}

Write-Host "== Lyrenthos Browser bootstrap ==" -ForegroundColor Green
Stop-Missing 'git' 'Install Git for Windows, then rerun this script.'
Stop-Missing 'node' 'Install Node.js LTS, then rerun this script.'
Stop-Missing 'npm' 'Install Node.js LTS, then rerun this script.'
Stop-Missing 'heroku' 'Install the Heroku CLI, run heroku login, then rerun this script.'

if (-not (Need-Command 'appwrite')) {
  Write-Host 'Installing latest Appwrite CLI...' -ForegroundColor Cyan
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

Write-Host 'Installing and building the frontend...' -ForegroundColor Cyan
Set-Location (Join-Path $Root 'apps/web')
npm install
npm run build
Set-Location $Root

$ProjectId = Read-Host 'Appwrite PROJECT ID'
$Endpoint = Read-Host 'Appwrite project endpoint (example: https://fra.cloud.appwrite.io/v1)'
$ApiKeySecure = Read-Host 'Appwrite API key (must have sites.write)' -AsSecureString
$ApiKeyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ApiKeySecure)
$ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ApiKeyPtr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ApiKeyPtr)

Write-Host 'Configuring Appwrite CLI...' -ForegroundColor Cyan
appwrite client --endpoint $Endpoint --project-id $ProjectId --key $ApiKey

$Config = @'
{
  "version": 1,
  "sites": [
    {
      "$id": "lyrenthos-browser",
      "name": "Lyrenthos Browser",
      "enabled": true,
      "logging": true,
      "framework": "vite",
      "timeout": 30,
      "installCommand": "npm install",
      "buildCommand": "npm run build",
      "outputDirectory": "dist",
      "buildRuntime": "node-22",
      "adapter": "static",
      "fallbackFile": "index.html",
      "path": "apps/web",
      "deploymentRetention": 7
    }
  ]
}
'@
Set-Content -Path (Join-Path $Root 'appwrite.config.json') -Value $Config -Encoding utf8

# Create the Site when it does not already exist.
$Headers = @{
  'X-Appwrite-Project' = $ProjectId
  'X-Appwrite-Key' = $ApiKey
  'Content-Type' = 'application/json'
}
try {
  Invoke-RestMethod -Uri ($Endpoint.TrimEnd('/') + '/sites/' + $SiteId) -Headers $Headers -Method Get | Out-Null
  Write-Host "Appwrite Site '$SiteId' already exists." -ForegroundColor Yellow
} catch {
  $CreateBody = @{
    siteId = $SiteId
    name = 'Lyrenthos Browser'
    enabled = $true
    logging = $true
    framework = 'vite'
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
  Invoke-RestMethod -Uri ($Endpoint.TrimEnd('/') + '/sites') -Headers $Headers -Method Post -Body $CreateBody | Out-Null
}

Write-Host 'Checking Heroku login...' -ForegroundColor Cyan
heroku whoami | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Run heroku login, then rerun this script.' }

$HerokuApp = Read-Host 'Heroku gateway app name (Enter for auto-generated)'
if ([string]::IsNullOrWhiteSpace($HerokuApp)) {
  $Created = heroku create
  $HerokuApp = [regex]::Match(($Created -join "`n"), 'https://([a-z0-9-]+)\.herokuapp\.com').Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($HerokuApp)) { throw 'Could not determine the created Heroku app name.' }
} else {
  & heroku apps:info -a $HerokuApp 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { heroku create $HerokuApp | Out-Null }
}

Write-Host "Deploying gateway to Heroku app '$HerokuApp'..." -ForegroundColor Cyan
heroku config:set WEB_ORIGIN='*' LISTEN_ADDR=':8080' -a $HerokuApp | Out-Null
heroku git:remote -a $HerokuApp | Out-Null
# Deploy only services/gateway as the Heroku application root.
git subtree push --prefix services/gateway heroku main

$GatewayInfo = heroku apps:info -a $HerokuApp -s
$GatewayUrl = ($GatewayInfo | Select-String '^web_url=').ToString().Split('=')[1].Trim()

# Vite public variables are local and ignored by git; never put the Appwrite API key here.
$EnvContent = @"
VITE_APPWRITE_ENDPOINT=$Endpoint
VITE_APPWRITE_PROJECT_ID=$ProjectId
VITE_GATEWAY_URL=$GatewayUrl
"@
Set-Content -Path (Join-Path $Root 'apps/web/.env') -Value $EnvContent -Encoding utf8

Write-Host 'Deploying the frontend to Appwrite Sites...' -ForegroundColor Cyan
appwrite push sites --site-id $SiteId --with-variables --force

$SiteInfo = appwrite sites get --site-id $SiteId --json | ConvertFrom-Json
$SiteUrl = $SiteInfo.domain
if ([string]::IsNullOrWhiteSpace($SiteUrl)) { $SiteUrl = $SiteInfo.url }
if ([string]::IsNullOrWhiteSpace($SiteUrl)) { $SiteUrl = "https://$SiteId.appwrite.network" }

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host 'LYRENTHOS BROWSER DEPLOYMENT COMPLETE' -ForegroundColor Green
Write-Host "Appwrite Site : $SiteUrl" -ForegroundColor Cyan
Write-Host "Gateway       : $GatewayUrl" -ForegroundColor Cyan
Write-Host "Repository    : $RepoUrl" -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Green
Start-Process $SiteUrl
