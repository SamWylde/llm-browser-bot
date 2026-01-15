$ErrorActionPreference = "Stop"
$repo = "SamWylde/llm-browser-bot"
$branch = "master"
$localVersionFile = ".last_commit_sha"
$userAgent = "LLM-Browser-Bot-Updater"

Write-Host "[Update] Checking for updates..."

$updatePerformed = $false

# Method 1: Try Git
# We check for .git directory to ensure it's a git repo, and git command availability
if ((Test-Path ".git") -and (Get-Command "git" -ErrorAction SilentlyContinue)) {
    Write-Host "[Update] Git detected. Attempting git pull..."
    try {
        $gitOutput = git pull 2>&1
        if ($LASTEXITCODE -eq 0) { 
            Write-Host "[Update] Git update successful."
            $updatePerformed = $true
        } else {
            Write-Warning "[Update] Git pull failed. Output: $gitOutput"
            Write-Warning "[Update] Falling back to direct download..."
        }
    } catch {
        Write-Warning "[Update] Git execution failed. Falling back to direct download."
    }
} else {
    Write-Host "[Update] Git not found or not a git repo. Using direct download mode."
}

# Method 2: Direct Download from GitHub
if (-not $updatePerformed) {
    try {

    # 1. Get latest commit SHA from GitHub API
    $apiUrl = "https://api.github.com/repos/$repo/commits/$branch"
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Headers @{"User-Agent"=$userAgent} -ErrorAction Stop
        $latestSha = $response.sha
    } catch {
        Write-Warning "[Update] Failed to check for updates (API check failed). Skipping update."
        Write-Warning "[Update] Error: $_"
    }

    # 2. Check local version
    $localSha = ""
    if (Test-Path $localVersionFile) {
        $localSha = Get-Content $localVersionFile
    }

    if ($latestSha -eq $localSha) {
        Write-Host "[Update] Already up to date (Version: $latestSha)."
    } else {

    Write-Host "[Update] New version found ($latestSha)."
    Write-Host "[Update] Downloading latest source..."
    
    # 3. Create Backup
    $backupDir = "backup_previous_version"
    
    # Remove old backup if it exists
    if (Test-Path $backupDir) {
        Write-Host "[Update] Removing old backup..."
        Remove-Item $backupDir -Recurse -Force
    }

    Write-Host "[Update] Creating backup at $backupDir..."
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    
    # Files to exclude from backup/copy (temp files, git, node_modules which we can reinstall)
    $excludeItems = @(".git", "node_modules", "dist", $backupDir, "update_temp.zip", "update_temp_dir", $localVersionFile, ".env")
    
    Get-ChildItem -Path "." | ForEach-Object {
        if ($excludeItems -notcontains $_.Name) {
            Copy-Item -Path $_.FullName -Destination $backupDir -Recurse -Force
        }
    }

    try {
        # 4. Download and Extract
        $zipUrl = "https://github.com/$repo/archive/refs/heads/$branch.zip"
        $zipPath = "update_temp.zip"
        $extractPath = "update_temp_dir"

        # Clean previous temp files
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
        if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }

        Write-Host "[Update] Downloading latest source..."
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

        Write-Host "[Update] Extracting files..."
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

        $innerFolder = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
        if ($null -eq $innerFolder) { throw "Could not find extracted folder structure." }

        # 5. Apply Updates (Smart Sync)
        Write-Host "[Update] Applying updates (Smart Sync)..."
        $sourceDir = $innerFolder.FullName
        
        # Get all files in source recursively
        $files = Get-ChildItem -Path $sourceDir -Recurse | Where-Object { !$_.PSIsContainer }
        
        $updatedCount = 0
        $skippedCount = 0
        $startupScriptUpdated = $false

        foreach ($file in $files) {
            # Calculate relative path
            # We use substring to remove the temp folder prefix
            $relativePath = $file.FullName.Substring($sourceDir.Length + 1)
            
            # Safety: Skip .git folder or .env file explicitly
            if ($relativePath -match "^(\.git|node_modules|dist|\.env)") { continue }
            
            $destPath = Join-Path "." $relativePath
            
            # Ensure destination parent directory exists
            $parentDir = Split-Path $destPath -Parent
            if ($parentDir -and -not (Test-Path $parentDir)) {
                New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
            }
            
            $shouldCopy = $true
            
            # Compare hash if file exists locally
            if (Test-Path $destPath) {
                try {
                    $localHash = (Get-FileHash -Path $destPath -Algorithm MD5).Hash
                    $newHash = (Get-FileHash -Path $file.FullName -Algorithm MD5).Hash
                    if ($localHash -eq $newHash) {
                        $shouldCopy = $false
                        $skippedCount++
                    }
                } catch {
                    # If we can't read the file (locked?), default to overwrite attempt
                    Write-Warning "[Update] Could not read $destPath for comparison. Will attempt overwrite."
                }
            }
            
            if ($shouldCopy) {
                Write-Host "[Update] Updating: $relativePath"
                try {
                    Copy-Item -Path $file.FullName -Destination $destPath -Force
                    $updatedCount++

                    # Track if startup scripts were updated
                    if ($relativePath -eq "start_server.ps1" -or $relativePath -eq "update_and_start.bat") {
                        $startupScriptUpdated = $true
                    }
                } catch {
                    # File might be locked (especially the running script)
                    Write-Warning "[Update] Could not update $relativePath (file may be in use)"
                    if ($relativePath -eq "start_server.ps1") {
                        # Save as .new file for manual update
                        Copy-Item -Path $file.FullName -Destination "$destPath.new" -Force
                        $startupScriptUpdated = $true
                    }
                }
            }
        }

        # Update version file
        Set-Content -Path $localVersionFile -Value $latestSha
        
        Write-Host "[Update] Complete. Updated $updatedCount files. Skipped $skippedCount unchanged files."

        # Cleanup Backup if successful
        # Remove-Item $backupDir -Recurse -Force
        Write-Host "[Update] Backup kept at $backupDir"

        # Check if startup script has a pending update
        if (Test-Path "start_server.ps1.new") {
            Write-Host ""
            Write-Host "[Update] ================================================" -ForegroundColor Yellow
            Write-Host "[Update] STARTUP SCRIPT UPDATE PENDING" -ForegroundColor Yellow
            Write-Host "[Update] A new version of start_server.ps1 is available." -ForegroundColor Yellow
            Write-Host "[Update] Please close this window and:" -ForegroundColor Yellow
            Write-Host "[Update]   1. Delete 'start_server.ps1'" -ForegroundColor Yellow
            Write-Host "[Update]   2. Rename 'start_server.ps1.new' to 'start_server.ps1'" -ForegroundColor Yellow
            Write-Host "[Update]   3. Run update_and_start.bat again" -ForegroundColor Yellow
            Write-Host "[Update] ================================================" -ForegroundColor Yellow
            Write-Host ""
            Read-Host "Press Enter to continue with current version..."
        } elseif ($startupScriptUpdated) {
            Write-Host ""
            Write-Host "[Update] Startup scripts were updated. Changes will apply on next run." -ForegroundColor Cyan
        }

    } catch {
        Write-Error "[Update] Update failed! Restoring from backup..."
        # Restore logic
        Get-ChildItem -Path $backupDir | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination "." -Recurse -Force
        }
        Write-Host "[Update] Restore complete."
        throw $_
    } finally {
        # Cleanup Temp Files
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
        if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
    }

    }
} catch {
    Write-Warning "[Update] Update check failed or encountered an error: $_"
    Write-Warning "[Update] Continuing with existing version..."
}
}

# ==============================================================================
# 2. Install, Build, and Start
# ==============================================================================

$serverDir = "server"
if (-not (Test-Path $serverDir)) {
    Write-Error "Error: '$serverDir' directory not found!"
    exit 1
}

Push-Location $serverDir

try {
    Write-Host "`n[Startup] [1/3] Installing dependencies..." -ForegroundColor Cyan
    # Use cmd /c specifically for npm to ensure it runs correctly in all PS environments
    cmd /c "npm install"
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    Write-Host "`n[Startup] [2/3] Building server..." -ForegroundColor Cyan
    cmd /c "npm run build"
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }

    Write-Host "`n[Startup] [3/3] Starting server..." -ForegroundColor Green
    Write-Host ""

    # Interactive platform selection
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "Which AI platform are you using?" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1) Claude Desktop / Cline / Continue / Cursor"
    Write-Host "  2) ChatGPT (requires public URL)"
    Write-Host "  3) Gemini CLI"
    Write-Host "  4) Just start the server"
    Write-Host ""

    $choice = Read-Host "Enter choice [1-4]"

    switch ($choice) {
        "2" {
            # ChatGPT setup - needs tunnel
            Write-Host ""
            Write-Host "ChatGPT requires a public HTTPS URL." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "Choose a tunnel provider:" -ForegroundColor Cyan
            Write-Host "  1) localtunnel (FREE - no signup!)"
            Write-Host "  2) ngrok (free tier - requires signup)"
            Write-Host "  3) I'll set up my own tunnel"
            Write-Host ""

            $tunnelChoice = Read-Host "Enter choice [1-3]"

            # Start server in background
            Write-Host "`nStarting server in background..." -ForegroundColor Yellow
            $serverJob = Start-Job -ScriptBlock {
                Set-Location $using:PWD
                cmd /c "npm start"
            }
            Start-Sleep -Seconds 3

            switch ($tunnelChoice) {
                "1" {
                    Write-Host "Starting localtunnel (free, no signup)..." -ForegroundColor Yellow
                    Write-Host "This may take a moment on first run..." -ForegroundColor Gray
                    Write-Host ""
                    cmd /c "npx -y localtunnel --port 61822"
                }
                "2" {
                    # Check if ngrok exists, auto-install if not
                    if (-not (Get-Command "ngrok" -ErrorAction SilentlyContinue)) {
                        Write-Host "ngrok is not installed. Attempting auto-install..." -ForegroundColor Yellow

                        $installed = $false

                        # Try winget first (Windows 10/11 built-in)
                        if (Get-Command "winget" -ErrorAction SilentlyContinue) {
                            Write-Host "Installing ngrok via winget..." -ForegroundColor Cyan
                            try {
                                winget install ngrok.ngrok --accept-package-agreements --accept-source-agreements
                                if ($LASTEXITCODE -eq 0) { $installed = $true }
                            } catch {
                                Write-Warning "winget install failed: $_"
                            }
                        }

                        # Try chocolatey as fallback
                        if (-not $installed -and (Get-Command "choco" -ErrorAction SilentlyContinue)) {
                            Write-Host "Installing ngrok via chocolatey..." -ForegroundColor Cyan
                            try {
                                choco install ngrok -y
                                if ($LASTEXITCODE -eq 0) { $installed = $true }
                            } catch {
                                Write-Warning "choco install failed: $_"
                            }
                        }

                        if (-not $installed) {
                            Write-Host "Could not auto-install ngrok." -ForegroundColor Red
                            Write-Host ""
                            Write-Host "Please install manually:" -ForegroundColor Cyan
                            Write-Host "  1. Visit: https://ngrok.com/download"
                            Write-Host "  2. Sign up for a free account"
                            Write-Host "  3. Install and run: ngrok config add-authtoken YOUR_TOKEN"
                            Write-Host ""
                            Write-Host "Or use localtunnel (option 1) - no signup required!" -ForegroundColor Green
                            Read-Host "Press Enter to exit..."
                            Stop-Job $serverJob
                            exit 1
                        }

                        # Refresh PATH to find newly installed ngrok
                        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

                        Write-Host ""
                        Write-Host "ngrok installed! You'll need to set up your auth token:" -ForegroundColor Yellow
                        Write-Host "  1. Sign up at https://ngrok.com (free)" -ForegroundColor Cyan
                        Write-Host "  2. Copy your auth token from https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Cyan
                        Write-Host "  3. Run: ngrok config add-authtoken YOUR_TOKEN" -ForegroundColor Cyan
                        Write-Host ""
                        Read-Host "Press Enter after setting up your token..."
                    }

                    Write-Host "Starting ngrok tunnel..." -ForegroundColor Yellow
                    cmd /c "ngrok http 61822"
                }
                default {
                    Write-Host ""
                    Write-Host "Server is running on:" -ForegroundColor Cyan
                    Write-Host "  Local: http://localhost:61822" -ForegroundColor Green
                    Write-Host "  WebSocket: ws://localhost:61822/mcp" -ForegroundColor Green
                    Write-Host ""
                    Write-Host "Set up your own tunnel to expose port 61822, then use:" -ForegroundColor Cyan
                    Write-Host "  https://YOUR-TUNNEL-URL/mcp" -ForegroundColor Yellow
                    Write-Host ""
                    Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Gray
                    Wait-Job $serverJob
                }
            }
        }
        "1" {
            # Claude Desktop
            Write-Host ""
            Write-Host "============================================" -ForegroundColor Cyan
            Write-Host "Claude Desktop Configuration" -ForegroundColor Cyan
            Write-Host "============================================" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Add this to your Claude Desktop config file:" -ForegroundColor White
            Write-Host ""
            Write-Host "  Windows: %APPDATA%\Claude\claude_desktop_config.json" -ForegroundColor Gray
            Write-Host "  macOS: ~/Library/Application Support/Claude/claude_desktop_config.json" -ForegroundColor Gray
            Write-Host ""
            Write-Host '{
  "mcpServers": {
    "llm-browser-bot": {
      "command": "npx",
      "args": ["-y", "llm-browser-bot", "bridge"]
    }
  }
}' -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Local Server: http://localhost:61822" -ForegroundColor Green
            Write-Host "MCP WebSocket: ws://localhost:61822/mcp" -ForegroundColor Green
            Write-Host ""
            Write-Host "Server is running. Press Ctrl+C to stop." -ForegroundColor Gray
            Write-Host ""
            cmd /c "npm start"
        }
        "3" {
            # Gemini CLI
            Write-Host ""
            Write-Host "============================================" -ForegroundColor Cyan
            Write-Host "Gemini CLI Configuration" -ForegroundColor Cyan
            Write-Host "============================================" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Configure Gemini CLI to use this MCP server:" -ForegroundColor White
            Write-Host "  MCP WebSocket: ws://localhost:61822/mcp" -ForegroundColor Green
            Write-Host ""
            Write-Host "See: https://geminicli.com/docs/tools/mcp-server/" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Server is running. Press Ctrl+C to stop." -ForegroundColor Gray
            Write-Host ""
            cmd /c "npm start"
        }
        default {
            # Just start the server
            Write-Host ""
            Write-Host "Server: http://localhost:61822" -ForegroundColor Green
            Write-Host "MCP WebSocket: ws://localhost:61822/mcp" -ForegroundColor Green
            Write-Host ""
            Write-Host "Server is running. Press Ctrl+C to stop." -ForegroundColor Gray
            Write-Host ""
            cmd /c "npm start"
        }
    }

    if ($LASTEXITCODE -ne 0) { throw "Server exited with error code $LASTEXITCODE" }

} catch {
    Write-Error "`n[Startup] Error: $_"
    Read-Host "Press Enter to exit..."
    exit 1
} finally {
    Pop-Location
}
