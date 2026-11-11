# install.ps1 — 一键把 preset.json 里的 DSH 插件装到一个 profile 上
#
# 用法（在仓库根目录）：
#   pwsh -ExecutionPolicy Bypass -File .\install.ps1              # 装到 desktop profile
#   pwsh -ExecutionPolicy Bypass -File .\install.ps1 -ProfileName desktop
#   pwsh -ExecutionPolicy Bypass -File .\install.ps1 -DryRun       # 只打印将执行的命令
#
# 做的事：
#   1. 找到 dsh CLI（PATH 里没有就用 DSH 默认安装路径）
#   2. 逐个 `dsh plugin add`（npm 包用固定版本；本仓库自带的两个用 file: 绝对路径）
#   3. 把包名补进 profile package.json 的 dsh.profile.bundles（否则不会加载）
#   4. 打印需要重启的提示
#
param(
  [string]$ProfileName = "desktop",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-DshCli {
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "D:\Program Files\Deepseek\resources\runtime\cli\bin\dsh.cmd",
    "C:\Program Files\Deepseek\resources\runtime\cli\bin\dsh.cmd"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw "找不到 dsh 命令：请先安装 DeepSeek Harness，或把它加到 PATH。"
}

$dsh = Resolve-DshCli
Write-Host "dsh  : $dsh"
Write-Host "repo : $repoRoot"
Write-Host "profile: $ProfileName"

$preset = Get-Content (Join-Path $repoRoot "preset.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$names = @()

foreach ($p in $preset.plugins) {
  $spec = [string]$p.spec
  if ($spec.StartsWith("./")) {
    $abs = Join-Path $repoRoot ($spec.Substring(2) -replace "/", "\")
    if (-not (Test-Path $abs)) { throw "本地插件目录不存在: $abs" }
    $spec = "file:" + $abs
  }
  Write-Host ("  add {0}  ({1})" -f $spec, $p.version)
  if (-not $DryRun) {
    & $dsh plugin --profile $ProfileName add $spec
    if ($LASTEXITCODE -ne 0) { throw "安装失败: $spec" }
  }
  $names += [string]$p.name
}

# --- 把包名补进 bundles ---
$profileDir = Join-Path (Join-Path $env:USERPROFILE ".dsh\profiles") $ProfileName
$pkgPath = Join-Path $profileDir "package.json"
if (-not (Test-Path $pkgPath)) {
  Write-Warning "没找到 profile 的 package.json（$pkgPath），请手动把以下包名加进 dsh.profile.bundles：`n$($names -join "`n")"
  return
}

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
if (-not $pkg.dsh.profile.bundles) { $pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }

$bundles = @($pkg.dsh.profile.bundles)
$added = @()
foreach ($n in $names) {
  if ($bundles -notcontains $n) { $bundles += $n; $added += $n }
}
if ($added.Count -gt 0) {
  Write-Host ("bundles 新增: " + ($added -join ", "))
  if (-not $DryRun) {
    $pkg.dsh.profile.bundles = $bundles
    $json = $pkg | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($pkgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "已写回 $pkgPath"
  }
} else {
  Write-Host "bundles 已是最新，无需改动"
}

Write-Host ""
Write-Host "完成。重启 DeepSeek Harness 后插件才会加载。" -ForegroundColor Green
