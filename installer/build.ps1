$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $project 'dist\windows-x64'
New-Item -ItemType Directory -Force $bin | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$updateResource = "/resource:$project\agent\update-public.xml,update-public.xml"
$common = @('/nologo','/optimize+','/platform:x64','/r:System.Web.Extensions.dll','/r:System.ServiceProcess.dll','/r:System.Security.dll','/r:Microsoft.CSharp.dll','/r:System.Core.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll')
& $csc @common $updateResource "/out:$bin\ContourAgent.exe" "$project\agent\windows\Agent.cs" "$project\agent\windows\NvidiaCollector.cs" "$project\agent\windows\AgentLog.cs" "$project\agent\windows\DiagnosticExport.cs" "$project\agent\windows\DiagnosticReport.cs" "$project\agent\windows\SmartCollector.cs" "$project\agent\windows\AgentUpdater.cs" "$project\agent\windows\UpdateSecurity.cs"
if ($LASTEXITCODE) { throw 'Agent compilation failed' }
& $csc @common '/target:winexe' '/r:System.Windows.Forms.dll' '/r:System.Drawing.dll' "/r:$bin\ContourAgent.exe" "/out:$bin\ContourTray.exe" "$project\agent\windows\Tray.cs" "$project\agent\windows\DiagnosticWindow.cs" "$project\agent\windows\ThemedSaveDialog.cs" "$project\agent\windows\Theme.cs"
if ($LASTEXITCODE) { throw 'Tray compilation failed' }
$hardware = Join-Path $project 'vendor\LibreHardwareMonitor-0.9.6.zip'
if ((Get-FileHash -LiteralPath $hardware -Algorithm SHA256).Hash.ToLowerInvariant() -ne '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001') { throw 'Hardware archive checksum mismatch' }
$sensors = Join-Path $bin 'sensors'
Expand-Archive -LiteralPath $hardware -DestinationPath $sensors -Force
& $csc @common "/r:$sensors\LibreHardwareMonitorLib.dll" "/r:$bin\ContourAgent.exe" "/out:$bin\ContourSensorWorker.exe" "$project\agent\windows\SensorWorker.cs"
if ($LASTEXITCODE) { throw 'Sensor worker compilation failed' }
Copy-Item -LiteralPath "$sensors\LibreHardwareMonitor.exe.config" -Destination "$bin\ContourSensorWorker.exe.config" -Force
Copy-Item -LiteralPath $hardware -Destination "$bin\hardware.zip" -Force
Copy-Item -LiteralPath "$project\vendor\LibreHardwareMonitor-LICENSE.txt" -Destination "$bin\hardware-LICENSE.txt" -Force
Copy-Item -LiteralPath "$project\vendor\PawnIO-modules-COPYING.txt" -Destination "$bin\hardware-modules-COPYING.txt" -Force
Copy-Item -LiteralPath "$project\vendor\README.md" -Destination "$bin\hardware-NOTICE.md" -Force
Copy-Item -LiteralPath "$project\agent\windows\app.config" -Destination "$bin\ContourAgent.exe.config"
Copy-Item -LiteralPath "$project\agent\windows\app.config" -Destination "$bin\ContourTray.exe.config"
foreach ($smartFile in @('smartctl.exe','drivedb.h','COPYING.txt','AUTHORS.txt')) { Copy-Item -LiteralPath "$project\vendor\smartmontools-7.5\$smartFile" -Destination "$bin\$smartFile" -Force }
if ((Get-FileHash -LiteralPath "$bin\smartctl.exe" -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'b5db94e5082c042be44994b7a4fa8f7b5c8e713b2ab1c9a560d8f7a7995ea27d') { throw 'smartctl checksum mismatch' }
Copy-Item -LiteralPath "$project\vendor\smartmontools-7.5.tar.gz" -Destination "$bin\smartmontools-7.5.tar.gz" -Force
# Original icon: shield + pulse. Rendering preserves a transparent background.
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64,64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#61dfc1')),4
$points = [System.Drawing.Point[]]@((New-Object System.Drawing.Point 32,5),(New-Object System.Drawing.Point 54,15),(New-Object System.Drawing.Point 50,40),(New-Object System.Drawing.Point 32,59),(New-Object System.Drawing.Point 14,40),(New-Object System.Drawing.Point 10,15))
$g.DrawPolygon($pen,$points)
$pulse = [System.Drawing.Point[]]@((New-Object System.Drawing.Point 14,32),(New-Object System.Drawing.Point 25,32),(New-Object System.Drawing.Point 30,20),(New-Object System.Drawing.Point 37,44),(New-Object System.Drawing.Point 42,32),(New-Object System.Drawing.Point 51,32))
$g.DrawLines($pen,$pulse)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$fs = [System.IO.File]::Create("$bin\agent.ico")
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([byte]64); $bw.Write([byte]64); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22); $bw.Write($png)
$bw.Dispose(); $ms.Dispose(); $g.Dispose(); $pen.Dispose(); $bmp.Dispose()
& $csc @common '/target:winexe' $updateResource "/out:$bin\ContourUpdater.exe" "$project\agent\windows\WindowsUpdater.cs" "$project\agent\windows\UpdateSecurity.cs"
if ($LASTEXITCODE) { throw 'Updater compilation failed' }
$resources = @('ContourAgent.exe','ContourAgent.exe.config','ContourTray.exe','ContourTray.exe.config','agent.ico','ContourSensorWorker.exe','ContourSensorWorker.exe.config','hardware.zip','hardware-LICENSE.txt','hardware-modules-COPYING.txt','hardware-NOTICE.md','smartctl.exe','drivedb.h','COPYING.txt','AUTHORS.txt','smartmontools-7.5.tar.gz','ContourUpdater.exe') | ForEach-Object { "/resource:$bin\$_,$_" }
& $csc @common $updateResource '/target:winexe' '/main:Setup' '/r:System.Windows.Forms.dll' '/r:System.Drawing.dll' '/r:System.Configuration.Install.dll' '/r:System.IO.Compression.dll' '/r:System.IO.Compression.FileSystem.dll' "/win32manifest:$PSScriptRoot\admin.manifest" "/win32icon:$bin\agent.ico" "/out:$bin\ContourSetup.exe" @resources "$PSScriptRoot\Setup.cs" "$project\agent\windows\Theme.cs" "$project\agent\windows\Agent.cs" "$project\agent\windows\NvidiaCollector.cs" "$project\agent\windows\AgentLog.cs" "$project\agent\windows\DiagnosticExport.cs" "$project\agent\windows\DiagnosticReport.cs" "$project\agent\windows\SmartCollector.cs" "$project\agent\windows\AgentUpdater.cs" "$project\agent\windows\UpdateSecurity.cs"
if ($LASTEXITCODE) { throw 'Setup compilation failed' }
Write-Output "Built $bin\ContourSetup.exe"
