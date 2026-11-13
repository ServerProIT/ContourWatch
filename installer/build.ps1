$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $project 'dist\windows-x64'
New-Item -ItemType Directory -Force $bin | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$common = @('/nologo','/optimize+','/platform:x64','/r:System.Web.Extensions.dll','/r:System.ServiceProcess.dll','/r:System.Security.dll','/r:Microsoft.CSharp.dll','/r:System.Core.dll')
& $csc @common "/out:$bin\ContourAgent.exe" "$project\agent\windows\Agent.cs"
if ($LASTEXITCODE) { throw 'Agent compilation failed' }
& $csc @common '/target:winexe' '/r:System.Windows.Forms.dll' '/r:System.Drawing.dll' "/out:$bin\ContourTray.exe" "$project\agent\windows\Tray.cs"
if ($LASTEXITCODE) { throw 'Tray compilation failed' }
Copy-Item -LiteralPath "$project\agent\windows\app.config" -Destination "$bin\ContourAgent.exe.config"
Copy-Item -LiteralPath "$project\agent\windows\app.config" -Destination "$bin\ContourTray.exe.config"
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
$resources = @('ContourAgent.exe','ContourAgent.exe.config','ContourTray.exe','ContourTray.exe.config','agent.ico') | ForEach-Object { "/resource:$bin\$_,$_" }
& $csc @common '/target:winexe' '/main:Setup' '/r:System.Windows.Forms.dll' '/r:System.Drawing.dll' '/r:System.Configuration.Install.dll' "/win32manifest:$PSScriptRoot\admin.manifest" "/win32icon:$bin\agent.ico" "/out:$bin\ContourSetup.exe" @resources "$PSScriptRoot\Setup.cs" "$project\agent\windows\Agent.cs"
if ($LASTEXITCODE) { throw 'Setup compilation failed' }
Write-Output "Built $bin\ContourSetup.exe"
