[CmdletBinding()]
param([string]$AgentPath = (Join-Path $env:ProgramFiles 'ContourWatch\ContourAgent.exe'))

$ErrorActionPreference = 'Stop'
$current = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$runtime = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
$summary = [ordered]@{
    build = $current.CurrentBuildNumber
    installationType = $current.InstallationType
    x64 = [Environment]::Is64BitOperatingSystem
    frameworkRelease = $runtime.Release
    agentVersion = $null
    collectors = @()
}
if ((Test-Path -LiteralPath $AgentPath -PathType Leaf) -and $summary.x64 -and $runtime.Release -ge 528040) {
    $file = Get-Item -LiteralPath $AgentPath
    $summary.agentVersion = $file.VersionInfo.FileVersion
    foreach ($kind in 'ram','volume','sensors','gpu','smart') {
        $entry = [ordered]@{ collector = $kind; status = 'error'; readings = @() }
        $process = New-Object System.Diagnostics.Process
        try {
            $process.StartInfo.FileName = $file.FullName
            $process.StartInfo.Arguments = "--collect $kind"
            $process.StartInfo.UseShellExecute = $false
            $process.StartInfo.CreateNoWindow = $true
            $process.StartInfo.RedirectStandardOutput = $true
            $process.StartInfo.RedirectStandardError = $true
            $process.StartInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
            $null = $process.Start()
            $output = $process.StandardOutput.ReadToEndAsync()
            $errors = $process.StandardError.ReadToEndAsync()
            if (!$process.WaitForExit(30000)) {
                $entry.status = 'timeout'
                $process.Kill()
            } elseif ($process.ExitCode -eq 0 -and $output.Wait(2000)) {
                $rows = ConvertFrom-Json -InputObject $output.Result
                $entry.status = 'completed'
                foreach ($group in ($rows | Group-Object kind,state)) {
                    $row = $group.Group[0]
                    $entry.readings += [ordered]@{kind = $row.kind; state = $row.state; count = $group.Count}
                }
            }
        } catch {
            $entry.status = 'error'
        } finally {
            $process.Dispose()
        }
        $summary.collectors += $entry
    }
}
[PSCustomObject]$summary | ConvertTo-Json -Depth 6
