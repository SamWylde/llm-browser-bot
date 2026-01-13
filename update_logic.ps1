$ErrorActionPreference = "Stop"
$repo = "SamWylde/llm-browser-bot"
$branch = "master"
$localVersionFile = ".last_commit_sha"
$userAgent = "LLM-Browser-Bot-Updater"

Write-Host "[Update] Checking for updates..."

# Method 1: Try Git
# We check for .git directory to ensure it's a git repo, and git command availability
if ((Test-Path ".git") -and (Get-Command "git" -ErrorAction SilentlyContinue)) {
    Write-Host "[Update] Git detected. Attempting git pull..."
    try {
        $gitOutput = git pull 2>&1
        if ($LASTEXITCODE -eq 0) { 
            Write-Host "[Update] Git update successful."
            exit 0 
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
try {
    # 1. Get latest commit SHA from GitHub API
    $apiUrl = "https://api.github.com/repos/$repo/commits/$branch"
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Headers @{"User-Agent"=$userAgent} -ErrorAction Stop
        $latestSha = $response.sha
    } catch {
        Write-Warning "[Update] Failed to check for updates (API check failed). Skipping update."
        Write-Warning "[Update] Error: $_"
        exit 0 
    }

    # 2. Check local version
    $localSha = ""
    if (Test-Path $localVersionFile) {
        $localSha = Get-Content $localVersionFile
    }

    if ($latestSha -eq $localSha) {
        Write-Host "[Update] Already up to date (Version: $latestSha)."
        exit 0
    }

    Write-Host "[Update] New version found ($latestSha)."
    Write-Host "[Update] Downloading latest source..."
    
    # 3. Create Backup
    $backupDir = "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
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

        # 5. Apply Updates (Overwrite)
        Write-Host "[Update] applying updates..."
        $sourceDir = $innerFolder.FullName
        
        Get-ChildItem -Path $sourceDir | ForEach-Object {
            # Skip .git to protect repo metadata if it exists
            # Skip .env to protect user secrets
            if ($_.Name -ne ".git" -and $_.Name -ne ".env") {
                Copy-Item -Path $_.FullName -Destination "." -Recurse -Force
            }
        }

        # Update version file
        Set-Content -Path $localVersionFile -Value $latestSha
        
        Write-Host "[Update] Update completed successfully."
        
        # Cleanup Backup (optional: consider keeping the last one?)
        # Remove-Item $backupDir -Recurse -Force 
        Write-Host "[Update] Backup kept at $backupDir in case of issues."

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

} catch {
    Write-Error "[Update] Update failed: $_"
    # We exit with 0 to allow the server to try starting anyway, 
    # as the current version might still be functional.
    exit 0 
}
