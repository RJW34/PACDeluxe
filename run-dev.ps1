$env:Path = "C:\Users\Ryan\.cargo\bin;" + $env:Path
Set-Location "D:\Projects with Claude\pacdeluxe"
Write-Host "Starting PACDeluxe (loading https://pokemon-auto-chess.com)..."
npx tauri dev
