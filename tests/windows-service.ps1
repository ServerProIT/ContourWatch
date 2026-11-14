$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $project 'dist\windows-x64'
if (Get-Service ContourWatch -ErrorAction SilentlyContinue) { throw 'Use a clean disposable Windows VM: service already exists' }
$tokenPath = Join-Path $env:RUNNER_TEMP 'contour-ci-enrollment.txt'
[IO.File]::WriteAllText($tokenPath, 'CI-ONLY-UNUSED-REGISTRATION-TOKEN-0000000000000000')
function Invoke-Setup([string[]]$Arguments) {
    $process = Start-Process -FilePath "$bin\ContourSetup.exe" -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode) { throw "Setup failed with exit code $($process.ExitCode)" }
}
try {
    Invoke-Setup @('--silent', '--server=https://127.0.0.1:9', "--token-file=`"$tokenPath`"", '--name=CI-WINDOWS-SERVICE', '--group=CI')
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
    if (Get-Service ContourWatch -ErrorAction SilentlyContinue) { Invoke-Setup @('--silent', '--uninstall') }
    Remove-Item -LiteralPath $tokenPath -ErrorAction SilentlyContinue
}
if (Get-Service ContourWatch -ErrorAction SilentlyContinue) { throw 'Uninstall did not remove service' }
Write-Output 'PASS silent service uninstall'
