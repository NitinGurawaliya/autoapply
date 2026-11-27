# Writes the WhatsApp values from Meta's dashboard into .env, asking for each one. Nothing is echoed or logged.
# Press Enter on a value to keep what is already in .env. Run from the repo root:  .\scripts\set-whatsapp-env.ps1
$envFile = Join-Path (Get-Location) ".env"
if (-not (Test-Path $envFile)) { throw ".env not found here; run this from the repo root" }

function Read-Secret($label) {
  $secure = Read-Host -Prompt $label -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
function Set-EnvLine($key, $value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return }
  $lines = @(Get-Content $envFile)
  $found = $false
  $lines = $lines | ForEach-Object { if ($_ -match "^$key=") { $found = $true; "$key=$value" } else { $_ } }
  if (-not $found) { $lines += "$key=$value" }
  Set-Content -Path $envFile -Value $lines -Encoding utf8
}

Write-Host "Meta dashboard > WhatsApp > API Setup (ids), App settings > Basic (secret)."
Set-EnvLine "WHATSAPP_PHONE_NUMBER_ID" (Read-Host "Phone number ID")
Set-EnvLine "WHATSAPP_BUSINESS_ACCOUNT_ID" (Read-Host "WhatsApp Business Account ID")
Set-EnvLine "WHATSAPP_APP_SECRET" (Read-Secret "App secret (hidden)")
Set-EnvLine "WHATSAPP_ACCESS_TOKEN" (Read-Secret "Access token (hidden)")
Set-EnvLine "WHATSAPP_NUMBER_E164" ((Read-Host "Test number, digits only with country code") -replace '\D', '')
Set-EnvLine "WHATSAPP_TEST_NUMBERS" ((Read-Host "Your own phone, digits only with country code") -replace '\D', '')
$url = Read-Host "Public base URL (https://your-domain or your tunnel), no trailing slash"
if ($url) { Set-EnvLine "APP_URL" $url.TrimEnd('/') }
Write-Host "Done. Callback URL for Meta: $($url.TrimEnd('/'))/api/whatsapp/webhook"
Write-Host "Left alone: WHATSAPP_ENABLED stays 0 until you turn the feature on."
