$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $project 'dist\windows-x64'
$published = Join-Path $project 'downloads\windows-x64\ContourSetup.exe'
$setupPath = Join-Path $bin 'ContourSetup.exe'
if (Test-Path -LiteralPath $published) {
    $expected = ((Get-Content (Join-Path $project 'downloads\windows-x64\SHA256SUMS.txt') -Raw).Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $published -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Published installer checksum mismatch' }
}
if (Get-Service ContourWatch -ErrorAction SilentlyContinue) { throw 'Use a clean disposable Windows VM: service already exists' }
$tokenPath = Join-Path $env:RUNNER_TEMP 'contour-ci-enrollment.txt'
[IO.File]::WriteAllText($tokenPath, 'CI-ONLY-UNUSED-REGISTRATION-TOKEN-0000000000000000')
function Invoke-Setup([string[]]$Arguments) {
    $process = Start-Process -FilePath $setupPath -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode) { throw "Setup failed with exit code $($process.ExitCode)" }
}
try {
    $newSetupPath = $setupPath
    $oldArchive = Join-Path $env:RUNNER_TEMP 'contour-old-fixture.zip'
    $oldRoot = Join-Path $env:RUNNER_TEMP 'contour-old-fixture'
    git -C $project archive --format=zip --output=$oldArchive e95787c975ea381eac8f023eaadc5636e2ba48c1 downloads/windows-x64/ContourSetup.exe
    if ($LASTEXITCODE) { throw 'Old installer fixture unavailable' }
    Expand-Archive -LiteralPath $oldArchive -DestinationPath $oldRoot -Force
    $setupPath = Join-Path $oldRoot 'downloads\windows-x64\ContourSetup.exe'
    Invoke-Setup @('--silent', '--server=https://127.0.0.1:9', "--token-file=`"$tokenPath`"", '--name=CI-WINDOWS-SERVICE', '--group=CI')
    $trayPath = Join-Path $env:ProgramFiles 'ContourWatch\ContourTray.exe'
    $oldTray = Start-Process -FilePath $trayPath -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    if ($oldTray.HasExited) { throw 'Old tray fixture did not remain running' }
    $setupPath = $newSetupPath
    Invoke-Setup @('--silent', '--server=https://127.0.0.1:9', "--token-file=`"$tokenPath`"", '--name=CI-WINDOWS-SERVICE', '--group=CI')
    if (!$oldTray.HasExited) { throw 'Upgrade did not stop locked old tray' }
    if (([Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $env:ProgramFiles 'ContourWatch\ContourAgent.exe'))).FileVersion -ne '0.2.3.0') { throw 'Upgrade did not install expected agent version' }
    $tray = Start-Process -FilePath $trayPath -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    if ($tray.HasExited) { throw 'New tray did not remain running' }
    Invoke-Setup @('--silent', '--server=https://127.0.0.1:9', "--token-file=`"$tokenPath`"", '--name=CI-WINDOWS-SERVICE', '--group=CI', '--reregister')
    if ($tray.HasExited) { throw 'Config-only registration unnecessarily terminated tray' }
    Write-Output 'PASS upgrade from 0.1.1 with running old tray and re-registration while new tray remains running'
    $service = Get-Service ContourWatch
    if ($service.Status -ne 'Running') { throw 'Service did not reach Running' }
    $imagePath = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\ContourWatch').ImagePath
    if ($imagePath -notmatch 'ContourAgent.exe') { throw 'Unexpected service image path' }
    $deadline = (Get-Date).AddSeconds(45)
    do {
        $statusFile = Join-Path $env:ProgramData 'ContourWatch\public\status.json'
        if (Test-Path -LiteralPath $statusFile) { break }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    if (!(Test-Path -LiteralPath $statusFile)) { throw 'Service worker did not write status' }
    if ((Get-Service ContourWatch).Status -ne 'Running') { throw 'Service stopped after startup' }
    $config = Join-Path $env:ProgramData 'ContourWatch\config.json'
    $before = [IO.File]::ReadAllText($config)
    Restart-Service ContourWatch
    (Get-Service ContourWatch).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    if ([IO.File]::ReadAllText($config) -ne $before) { throw 'Restart changed identity/config' }
    Stop-Service ContourWatch
    Invoke-Setup @('--silent', '--server=https://127.0.0.1:9', "--token-file=`"$tokenPath`"", '--name=CI-WINDOWS-SERVICE', '--group=CI')
    if ((Get-Service ContourWatch).Status -ne 'Running') { throw 'Reinstall did not start service' }
    Write-Output 'PASS real SCM install, no-console service startup, worker status, restart, config persistence and reinstall'
} finally {
    $log = Join-Path $env:ProgramData 'ContourWatch\agent.log'
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 10 }
    if (Get-Service ContourWatch -ErrorAction SilentlyContinue) { Invoke-Setup @('--silent', '--uninstall') }
    Remove-Item -LiteralPath $tokenPath -ErrorAction SilentlyContinue
}
if (Get-Service ContourWatch -ErrorAction SilentlyContinue) { throw 'Uninstall did not remove service' }
Write-Output 'PASS silent service uninstall'
