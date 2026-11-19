# Run only in a disposable, elevated Windows CI VM.
$ErrorActionPreference='Stop'
if(!$env:CI){throw 'This installation test requires a disposable CI VM'}
if(Get-Service ContourWatch -ErrorAction SilentlyContinue){throw 'Existing service: refusing to modify this machine'}
$project=Split-Path $PSScriptRoot -Parent
$bin=Join-Path $project 'dist\windows-x64'
$msi=Join-Path $bin 'ContourWatch-0.2.2-windows-x64.msi'
$root=Join-Path $env:ProgramData 'ContourWatch'
$dest=Join-Path $env:ProgramFiles 'ContourWatch'
$config=Join-Path $root 'config.json'
$before=if(Test-Path -LiteralPath $config){[IO.File]::ReadAllText($config)}else{$null}
function Msi([string[]]$Arguments){$process=Start-Process -FilePath "$env:WINDIR\System32\msiexec.exe" -ArgumentList $Arguments -WindowStyle Hidden -PassThru -Wait;if($process.ExitCode -notin @(0,3010)){throw "MSI failed: $($process.ExitCode)"}}
function Healthy {
 (Get-Service ContourWatch).WaitForStatus('Running',[TimeSpan]::FromSeconds(35))
 $deadline=(Get-Date).AddSeconds(35)
 do{Start-Sleep -Seconds 1;$file=Join-Path $root 'public\status.json';if((Test-Path -LiteralPath $file) -and ((Get-Content -LiteralPath $file -Raw|ConvertFrom-Json).version -eq '0.2.2')){$recovery=(& "$env:WINDIR\System32\sc.exe" qfailure ContourWatch) -join "`n";if($recovery -match 'RESTART'){return}}}while((Get-Date) -lt $deadline)
 throw 'MSI service did not write current status'
}
try{
 & "$project\installer\build-msi.ps1"
 Msi @('/i',"`"$msi`"",'/qn','/norestart','/l*v',"`"$env:RUNNER_TEMP\contour-msi-install.log`"")
 Healthy
 if(!(Test-Path -LiteralPath (Join-Path $dest 'smartctl.exe'))){throw 'SMART payload missing'}
 if($before -and [IO.File]::ReadAllText($config) -ne $before){throw 'MSI installation changed identity'}
 $denied=$false;try{$null=Get-Content -LiteralPath $config -ErrorAction Stop}catch{$denied=$true}
 $acl=Get-Acl -LiteralPath $root
 if($acl.Access|Where-Object{$_.IdentityReference.Value -match 'BUILTIN\\Users|S-1-5-32-545' -and $_.FileSystemRights -match 'Write|Modify|FullControl'}){throw 'Private data writable by ordinary users'}
 Msi @('/fa',"`"$msi`"",'/qn','/norestart');Healthy
 & "$project\installer\build-msi.ps1" -Version '0.2.3' -Output "$bin\ci-upgrade-0.2.3.msi"
 # Compile the unchanged updater with an ephemeral public test key. The 0.2.3
 # MSI intentionally carries the 0.2.2 executable, forcing failed-health rollback.
 $stage=Join-Path $root ('updates\stage-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Force $stage | Out-Null
 $rsa=New-Object Security.Cryptography.RSACryptoServiceProvider 2048
 $rsa.PersistKeyInCsp=$false
 try{
  $public=Join-Path $env:RUNNER_TEMP 'contour-ci-update-public.xml';[IO.File]::WriteAllText($public,$rsa.ToXmlString($false))
  $payload=Join-Path $stage 'ContourWatch-0.2.3-windows-x64.msi';Copy-Item -LiteralPath "$bin\ci-upgrade-0.2.3.msi" -Destination $payload
  $manifest=@{version='0.2.3';tag='agent-0.2.3';expires=[DateTime]::UtcNow.AddDays(1).ToString('o');artifacts=@{'windows-x64'=@{name=(Split-Path $payload -Leaf);size=(Get-Item -LiteralPath $payload).Length;sha256=(Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()}}}|ConvertTo-Json -Depth 5 -Compress
  $utf8=New-Object Text.UTF8Encoding $false;$bytes=$utf8.GetBytes($manifest)
  [IO.File]::WriteAllBytes((Join-Path $stage 'manifest.json'),$bytes)
  [IO.File]::WriteAllText((Join-Path $stage 'manifest.sig'),[Convert]::ToBase64String($rsa.SignData($bytes,[Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'))),$utf8)
  $csc="$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  & $csc /nologo /r:System.ServiceProcess.dll /r:System.Web.Extensions.dll "/resource:$public,update-public.xml" "/out:$stage\CIUpdater.exe" "$project\agent\windows\WindowsUpdater.cs" "$project\agent\windows\UpdateSecurity.cs"
  if($LASTEXITCODE){throw 'Updater integration compilation failed'}
  $process=Start-Process -FilePath "$stage\CIUpdater.exe" -ArgumentList "`"$stage`"" -WindowStyle Hidden -PassThru -Wait
  if($process.ExitCode -ne 1){throw 'Deliberately unhealthy update did not report rollback'}
  if((Get-Content -LiteralPath "$root\updates\updater.log" -Raw -Encoding UTF8) -notmatch ': (0|3010)\s*$'){throw 'Previous MSI could not be restored'}
  if((Get-Content -LiteralPath "$root\updates\blocked-release.txt" -Raw).Trim() -ne 'agent-0.2.3'){throw 'Failed release was not blocked'}
  Healthy
  if($before -and [IO.File]::ReadAllText($config) -ne $before){throw 'Rollback changed identity'}
  Write-Output 'PASS pinned-signature updater actual MSI install and failed-health rollback with identity preserved'
 }finally{$rsa.Dispose()}
 Msi @('/i',"`"$bin\ci-upgrade-0.2.3.msi`"",'/qn','/norestart');Healthy
 if($before -and [IO.File]::ReadAllText($config) -ne $before){throw 'MSI upgrade changed identity'}
 Msi @('/x',"`"$bin\ci-upgrade-0.2.3.msi`"",'/qn','/norestart')
 if(Get-Service ContourWatch -ErrorAction SilentlyContinue){throw 'MSI uninstall left service'}
 if($before -and [IO.File]::ReadAllText($config) -ne $before){throw 'MSI uninstall removed identity'}
 Write-Output 'PASS MSI install, SMART payload, private ACL, repair, major upgrade, service startup and uninstall with identity preserved'
}finally{
 if(Test-Path -LiteralPath "$root\updates\updater.log"){Get-Content -LiteralPath "$root\updates\updater.log" -Encoding UTF8}
 if(Get-Service ContourWatch -ErrorAction SilentlyContinue){Msi @('/x',"`"$msi`"",'/qn','/norestart')}
}
