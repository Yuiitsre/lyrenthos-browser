$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/Yuiitsre/lyrenthos-browser.git'
$RepoName = 'lyrenthos-browser'
$Root = Join-Path $HOME $RepoName

function Need-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}
function Stop-Missing([string]$Name, [string]$Hint) {
  if (-not (Need-Command $Name)) { throw "$Name is required. $Hint" }
}

Write-Host '== Lyrenthos / Appwrite-only bootstrap ==' -ForegroundColor Green
Stop-Missing 'git' 'Install Git for Windows and rerun.'
Stop-Missing 'node' 'Install Node.js 22+ and rerun.'
Stop-Missing 'npm' 'Install Node.js 22+ and rerun.'

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

Write-Host 'Building the Vite site locally...' -ForegroundColor Cyan
npm install
npm run build

$ProjectId = Read-Host 'Appwrite PROJECT ID'
$Endpoint = Read-Host 'Appwrite project endpoint (example: https://fra.cloud.appwrite.io/v1)'
$ApiKeySecure = Read-Host 'Appwrite API key (site/function management permissions)' -AsSecureString
$ApiKeyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ApiKeySecure)
$ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ApiKeyPtr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ApiKeyPtr)

appwrite client --endpoint $Endpoint --project-id $ProjectId --key $ApiKey

Write-Host 'Pushing Appwrite Site and Function definitions from appwrite.config.json...' -ForegroundColor Cyan
appwrite push sites --all --force
appwrite push functions --all --force

Write-Host ''
Write-Host 'Bootstrap finished. Open Appwrite Console > Functions > Lyrenthos Gateway.' -ForegroundColor Green
Write-Host 'Set Function Execute access to Any and confirm scopes: buckets.read, buckets.write, files.read, files.write.' -ForegroundColor Yellow
Write-Host 'Copy the Function generated domain and set it as the Site variable VITE_GATEWAY_URL, then redeploy the Site.' -ForegroundColor Yellow
