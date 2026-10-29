<#
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
#>

param(
    [ValidateSet("desktop", "web", "all")]
    [string]$Target = "desktop"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:CLIENT_DIR) {
    $ClientDir = $env:CLIENT_DIR
} elseif ($env:EQUICORD_DIR) {
    $ClientDir = $env:EQUICORD_DIR
} else {
    $ClientDir = Join-Path $ScriptDir "..\Equicord"
    if (-not (Test-Path -LiteralPath $ClientDir)) {
        $ClientDir = Join-Path $ScriptDir "..\Vencord"
    }
}

$resolved = Resolve-Path -LiteralPath $ClientDir -ErrorAction SilentlyContinue
if (-not $resolved) {
    Write-Error "Equicord or Vencord source checkout not found at $ClientDir. Set CLIENT_DIR to its path."
    exit 1
}
$ClientDir = $resolved.Path

$packageJson = Join-Path $ClientDir "package.json"
$srcDir = Join-Path $ClientDir "src"
if (-not (Test-Path -LiteralPath $packageJson) -or -not (Test-Path -LiteralPath $srcDir)) {
    Write-Error "Equicord or Vencord source checkout not found at $ClientDir. Set CLIENT_DIR to its path."
    exit 1
}

$PluginDir = Join-Path $ClientDir "src\userplugins\catgifs"
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
Get-ChildItem -LiteralPath (Join-Path $ScriptDir "src") -File | Copy-Item -Destination $PluginDir -Force
Write-Host "Copied CatGIFs into $PluginDir"

Set-Location -LiteralPath $ClientDir
if ($Target -ne "web") {
    corepack pnpm --config.verify-deps-before-run=false build --dev
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if ($Target -ne "desktop") {
    node (Join-Path $ScriptDir "scripts\patch-web-client.mjs") $ClientDir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    corepack pnpm --config.verify-deps-before-run=false buildWeb --dev
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
