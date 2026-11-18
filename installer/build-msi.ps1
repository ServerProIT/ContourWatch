param([string]$Version='0.2.1',[string]$Output)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$bin=Join-Path $project 'dist\windows-x64'
if(!(Test-Path -LiteralPath "$bin\ContourSetup.exe")){throw 'Run installer/build.ps1 first'}
if(!$Output){$Output=Join-Path $bin "ContourWatch-$Version-windows-x64.msi"}
$Output=[IO.Path]::GetFullPath($Output)
if(Test-Path -LiteralPath $Output){Remove-Item -LiteralPath $Output}
$stage=Join-Path $project ('work\msi-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $stage -Force | Out-Null
function Id([string]$name){$hash=[Security.Cryptography.SHA256]::Create();try{$bytes=$hash.ComputeHash([Text.Encoding]::UTF8.GetBytes('ContourWatch:'+ $name));$guidBytes=New-Object byte[] 16;[Array]::Copy($bytes,$guidBytes,16);return [guid]::new($guidBytes).ToString('B').ToUpperInvariant()}finally{$hash.Dispose()}}
function Call($object,[string]$method,[object[]]$values=@()){return $object.GetType().InvokeMember($method,[Reflection.BindingFlags]::InvokeMethod,$null,$object,$values)}
function SetProperty($object,[string]$name,[object[]]$values){$null=$object.GetType().InvokeMember($name,[Reflection.BindingFlags]::SetProperty,$null,$object,$values)}
$installer=New-Object -ComObject WindowsInstaller.Installer
$database=Call $installer 'OpenDatabase' @($Output,3)
function Sql([string]$query){try{$view=Call $database 'OpenView' @($query);try{$null=Call $view 'Execute'}finally{$null=Call $view 'Close'}}catch{throw ("MSI SQL: "+$query+" : "+$_.Exception.Message)}}
$tableColumns=@{}
function Table([string]$name,[string]$columns){Sql ('CREATE TABLE `'+$name+'` ('+$columns+')');$tableColumns[$name]=@([regex]::Matches($columns,'(?:^|,\s*)`([^`]+)`\s+(?:CHAR|SHORT|LONG)') | ForEach-Object {'`'+$_.Groups[1].Value+'`'})}
function Row([string]$name,[object[]]$values){$record=Call $installer 'CreateRecord' @([int]$values.Count);for($i=0;$i -lt $values.Count;$i++){if($null -eq $values[$i]){continue};if($values[$i] -is [int] -or $values[$i] -is [long]){SetProperty $record 'IntegerData' @([int]($i+1),[int]$values[$i])}else{SetProperty $record 'StringData' @([int]($i+1),[string]$values[$i])}};$marks=(@('?')*$values.Count)-join ',';$view=Call $database 'OpenView' @('INSERT INTO `'+$name+'` ('+($tableColumns[$name]-join ',')+') VALUES ('+$marks+')');try{$null=Call $view 'Execute' @($record)}finally{$null=Call $view 'Close'}}
Table 'Property' '`Property` CHAR(72) NOT NULL, `Value` CHAR(0) NOT NULL PRIMARY KEY `Property`'
Table 'Directory' '`Directory` CHAR(72) NOT NULL, `Directory_Parent` CHAR(72), `DefaultDir` CHAR(255) NOT NULL LOCALIZABLE PRIMARY KEY `Directory`'
Table 'Component' '`Component` CHAR(72) NOT NULL, `ComponentId` CHAR(38), `Directory_` CHAR(72) NOT NULL, `Attributes` SHORT NOT NULL, `Condition` CHAR(255), `KeyPath` CHAR(72) PRIMARY KEY `Component`'
Table 'Feature' '`Feature` CHAR(38) NOT NULL, `Feature_Parent` CHAR(38), `Title` CHAR(64) LOCALIZABLE, `Description` CHAR(255) LOCALIZABLE, `Display` SHORT, `Level` SHORT NOT NULL, `Directory_` CHAR(72), `Attributes` SHORT NOT NULL PRIMARY KEY `Feature`'
Table 'FeatureComponents' '`Feature_` CHAR(38) NOT NULL, `Component_` CHAR(72) NOT NULL PRIMARY KEY `Feature_`, `Component_`'
Table 'File' '`File` CHAR(72) NOT NULL, `Component_` CHAR(72) NOT NULL, `FileName` CHAR(255) NOT NULL LOCALIZABLE, `FileSize` LONG NOT NULL, `Version` CHAR(72), `Language` CHAR(20), `Attributes` SHORT, `Sequence` SHORT NOT NULL PRIMARY KEY `File`'
Table 'Media' '`DiskId` SHORT NOT NULL, `LastSequence` SHORT NOT NULL, `DiskPrompt` CHAR(64) LOCALIZABLE, `Cabinet` CHAR(255), `VolumeLabel` CHAR(32), `Source` CHAR(72) PRIMARY KEY `DiskId`'
Table 'Registry' '`Registry` CHAR(72) NOT NULL, `Root` SHORT NOT NULL, `Key` CHAR(255) NOT NULL LOCALIZABLE, `Name` CHAR(255) LOCALIZABLE, `Value` CHAR(0) LOCALIZABLE, `Component_` CHAR(72) NOT NULL PRIMARY KEY `Registry`'
Table 'ServiceInstall' '`ServiceInstall` CHAR(72) NOT NULL, `Name` CHAR(255) NOT NULL, `DisplayName` CHAR(255) LOCALIZABLE, `ServiceType` LONG NOT NULL, `StartType` LONG NOT NULL, `ErrorControl` LONG NOT NULL, `LoadOrderGroup` CHAR(255), `Dependencies` CHAR(255), `StartName` CHAR(255), `Password` CHAR(255), `Arguments` CHAR(255), `Component_` CHAR(72) NOT NULL, `Description` CHAR(255) LOCALIZABLE PRIMARY KEY `ServiceInstall`'
Table 'ServiceControl' '`ServiceControl` CHAR(72) NOT NULL, `Name` CHAR(255) NOT NULL, `Event` SHORT NOT NULL, `Arguments` CHAR(255), `Wait` SHORT, `Component_` CHAR(72) NOT NULL PRIMARY KEY `ServiceControl`'
Table 'CreateFolder' '`Directory_` CHAR(72) NOT NULL, `Component_` CHAR(72) NOT NULL PRIMARY KEY `Directory_`, `Component_`'
Table 'MsiLockPermissionsEx' '`MsiLockPermissionsEx` CHAR(72) NOT NULL, `LockObject` CHAR(72) NOT NULL, `Table` CHAR(32) NOT NULL, `SDDLText` CHAR(0) NOT NULL, `Condition` CHAR(255) PRIMARY KEY `MsiLockPermissionsEx`'
Table 'Upgrade' '`UpgradeCode` CHAR(38) NOT NULL, `VersionMin` CHAR(20), `VersionMax` CHAR(20), `Language` CHAR(255), `Attributes` LONG NOT NULL, `Remove` CHAR(255), `ActionProperty` CHAR(72) NOT NULL PRIMARY KEY `UpgradeCode`, `VersionMin`, `VersionMax`, `Language`, `Attributes`'
Table 'LaunchCondition' '`Condition` CHAR(255) NOT NULL, `Description` CHAR(255) NOT NULL LOCALIZABLE PRIMARY KEY `Condition`'
Table 'AppSearch' '`Property` CHAR(72) NOT NULL, `Signature_` CHAR(72) NOT NULL PRIMARY KEY `Property`, `Signature_`'
Table 'Signature' '`Signature` CHAR(72) NOT NULL, `FileName` CHAR(255) NOT NULL LOCALIZABLE, `MinVersion` CHAR(20), `MaxVersion` CHAR(20), `MinSize` LONG, `MaxSize` LONG, `MinDate` LONG, `MaxDate` LONG, `Languages` CHAR(255) PRIMARY KEY `Signature`'
Table 'RegLocator' '`Signature_` CHAR(72) NOT NULL, `Root` SHORT NOT NULL, `Key` CHAR(255) NOT NULL, `Name` CHAR(255), `Type` SHORT PRIMARY KEY `Signature_`'
Table 'Shortcut' '`Shortcut` CHAR(72) NOT NULL, `Directory_` CHAR(72) NOT NULL, `Name` CHAR(128) NOT NULL LOCALIZABLE, `Component_` CHAR(72) NOT NULL, `Target` CHAR(255) NOT NULL, `Arguments` CHAR(255), `Description` CHAR(255) LOCALIZABLE, `Hotkey` SHORT, `Icon_` CHAR(72), `IconIndex` SHORT, `ShowCmd` SHORT, `WkDir` CHAR(72) PRIMARY KEY `Shortcut`'
foreach($name in @('InstallExecuteSequence','InstallUISequence','AdminExecuteSequence','AdminUISequence')){Table $name '`Action` CHAR(72) NOT NULL, `Condition` CHAR(255), `Sequence` SHORT PRIMARY KEY `Action`'}
$upgrade='{D23A703B-74EC-49A8-8D4D-142F98968502}'
foreach($entry in @{ProductCode=(Id "product-$Version");ProductName='ContourWatch Agent';ProductVersion=$Version;ProductLanguage='1033';Manufacturer='ContourWatch';UpgradeCode=$upgrade;ALLUSERS='1';INSTALLLEVEL='1';ARPNOMODIFY='1';SecureCustomProperties='OLDERPRODUCTS;NEWERPRODUCTS';ARPCOMMENTS='Hardware monitoring. Configure after installation using ContourWatch Setup.'}.GetEnumerator()){Row 'Property' @($entry.Key,$entry.Value)}
Row 'Feature' @('Agent',$null,'ContourWatch','Windows hardware monitoring',1,1,'INSTALLDIR',0)
foreach($directory in @(@('TARGETDIR',$null,'SourceDir'),@('ProgramFiles64Folder','TARGETDIR','.'),@('INSTALLDIR','ProgramFiles64Folder','ContourWatch'),@('SENSORS','INSTALLDIR','sensors'),@('CommonAppDataFolder','TARGETDIR','.'),@('DATADIR','CommonAppDataFolder','ContourWatch'),@('PUBLICDATA','DATADIR','public'),@('ProgramMenuFolder','TARGETDIR','.'),@('MENUDIR','ProgramMenuFolder','ContourWatch'))){Row 'Directory' $directory}
Row 'Component' @('Data',(Id 'data'),'DATADIR',276,$null,'DataRegistry')
Row 'FeatureComponents' @('Agent','Data')
Row 'Registry' @('DataRegistry',2,'Software\ContourWatch','DataDirectory','[DATADIR]','Data')
Row 'CreateFolder' @('DATADIR','Data');Row 'CreateFolder' @('PUBLICDATA','Data')
Row 'MsiLockPermissionsEx' @('PrivateData','DATADIR','CreateFolder','D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)',$null)
Row 'MsiLockPermissionsEx' @('PublicData','PUBLICDATA','CreateFolder','D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;GRGX;;;BU)',$null)
$files=@('ContourAgent.exe','ContourAgent.exe.config','ContourTray.exe','ContourTray.exe.config','ContourSensorWorker.exe','ContourSensorWorker.exe.config','ContourSetup.exe','ContourUpdater.exe','agent.ico','hardware.zip','hardware-LICENSE.txt','hardware-modules-COPYING.txt','hardware-NOTICE.md','smartctl.exe','drivedb.h','COPYING.txt','AUTHORS.txt','smartmontools-7.5.tar.gz') | ForEach-Object {Get-Item -LiteralPath (Join-Path $bin $_)}
$files+=Get-ChildItem -LiteralPath "$bin\sensors" -File -Filter '*.dll'
$ddf=@('.OPTION EXPLICIT','.Set Cabinet=on','.Set Compress=on','.Set CompressionType=LZX','.Set MaxDiskSize=0','.Set CabinetNameTemplate=payload.cab',('.Set DiskDirectoryTemplate="'+$stage+'"'))
$sequence=0;$agentComponent=$null;$setupComponent=$null;$trayComponent=$null
foreach($file in $files){$sequence++;$fileId='F'+$sequence.ToString('D4');$component='C'+$sequence.ToString('D4');$relative=$file.FullName.Substring($bin.Length+1);$directory=if($relative.StartsWith('sensors\')){'SENSORS'}else{'INSTALLDIR'};Row 'Component' @($component,(Id $relative),$directory,256,$null,$fileId);Row 'FeatureComponents' @('Agent',$component);$versionInfo=[Diagnostics.FileVersionInfo]::GetVersionInfo($file.FullName);$fileVersion=if($versionInfo.FileVersion -match '^\d+\.\d+\.\d+\.\d+$'){$versionInfo.FileVersion}else{$null};Row 'File' @($fileId,$component,$file.Name,[int]$file.Length,$fileVersion,$null,16384,$sequence);$ddf+=('"'+$file.FullName+'" '+$fileId);if($file.Name -eq 'ContourAgent.exe'){$agentComponent=$component};if($file.Name -eq 'ContourSetup.exe'){$setupComponent=$component};if($file.Name -eq 'ContourTray.exe'){$trayComponent=$component}}
Row 'ServiceInstall' @('AgentService','ContourWatch','ContourWatch monitoring agent',16,2,1,$null,$null,'LocalSystem',$null,$null,$agentComponent,'Outbound hardware metrics. No inbound listener.')
Row 'Registry' @('MsiManaged',2,'Software\ContourWatch','MsiManaged','#1',$agentComponent)
Row 'ServiceControl' @('AgentControl','ContourWatch',163,$null,1,$agentComponent)
Row 'Registry' @('TrayRun',2,'Software\Microsoft\Windows\CurrentVersion\Run','ContourWatchTray','"[INSTALLDIR]ContourTray.exe"',$trayComponent)
Row 'Shortcut' @('Configure','MENUDIR','Configure ContourWatch',$setupComponent,'[INSTALLDIR]ContourSetup.exe',$null,'Configure server and registration',$null,$null,$null,1,'INSTALLDIR')
Row 'Shortcut' @('Tray','MENUDIR','ContourWatch status',$trayComponent,'[INSTALLDIR]ContourTray.exe',$null,'Agent status',$null,$null,$null,1,'INSTALLDIR')
Row 'Shortcut' @('Logs','MENUDIR','ContourWatch logs and diagnostics',$trayComponent,'[INSTALLDIR]ContourTray.exe','--logs','View and export local diagnostics',$null,$null,$null,1,'INSTALLDIR')
Row 'Upgrade' @($upgrade,$null,$Version,$null,512,$null,'OLDERPRODUCTS');Row 'Upgrade' @($upgrade,$Version,$null,$null,2,$null,'NEWERPRODUCTS')
Row 'LaunchCondition' @('Installed OR VersionNT64','Requires 64-bit Windows.')
Row 'LaunchCondition' @('Installed OR NOT NEWERPRODUCTS','A newer ContourWatch version is already installed.')
Row 'AppSearch' @('FRAMEWORK48','FrameworkRelease');Row 'RegLocator' @('FrameworkRelease',2,'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full','Release',18)
Row 'LaunchCondition' @('Installed OR FRAMEWORK48 >= "#528040"','Microsoft .NET Framework 4.8 is required.')
$actions=@{FindRelatedProducts=25;AppSearch=50;LaunchConditions=100;ValidateProductID=700;CostInitialize=800;FileCost=900;CostFinalize=1000;InstallValidate=1400;InstallInitialize=1500;RemoveExistingProducts=1550;ProcessComponents=1600;UnpublishFeatures=1800;StopServices=1900;DeleteServices=2000;RemoveRegistryValues=2600;RemoveShortcuts=3200;RemoveFiles=3500;RemoveFolders=3600;CreateFolders=3700;InstallFiles=4000;CreateShortcuts=4500;WriteRegistryValues=5000;InstallServices=5800;StartServices=5900;RegisterUser=6000;RegisterProduct=6100;PublishFeatures=6300;PublishProduct=6400;InstallFinalize=6600}
foreach($entry in $actions.GetEnumerator()){Row 'InstallExecuteSequence' @($entry.Key,$null,[int]$entry.Value)}
foreach($entry in @{FindRelatedProducts=25;AppSearch=50;LaunchConditions=100;CostInitialize=800;FileCost=900;CostFinalize=1000;ExecuteAction=1300}.GetEnumerator()){Row 'InstallUISequence' @($entry.Key,$null,[int]$entry.Value)}
foreach($entry in @{CostInitialize=800;FileCost=900;CostFinalize=1000;InstallValidate=1400;InstallInitialize=1500;InstallAdminPackage=3900;InstallFiles=4000;InstallFinalize=6600}.GetEnumerator()){Row 'AdminExecuteSequence' @($entry.Key,$null,[int]$entry.Value)}
foreach($entry in @{CostInitialize=800;FileCost=900;CostFinalize=1000;ExecuteAction=1300}.GetEnumerator()){Row 'AdminUISequence' @($entry.Key,$null,[int]$entry.Value)}
[IO.File]::WriteAllLines((Join-Path $stage 'payload.ddf'),$ddf,[Text.Encoding]::ASCII)
& "$env:WINDIR\System32\makecab.exe" /F (Join-Path $stage 'payload.ddf') | Out-Null
if($LASTEXITCODE){throw 'Cabinet build failed'}
Row 'Media' @(1,$sequence,$null,'#payload.cab',$null,$null)
$stream=Call $installer 'CreateRecord' @(2);SetProperty $stream 'StringData' @(1,'payload.cab');$null=Call $stream 'SetStream' @([int]2,[string](Join-Path $stage 'payload.cab'));$view=Call $database 'OpenView' @('INSERT INTO `_Streams` (`Name`,`Data`) VALUES (?,?)');$null=Call $view 'Execute' @($stream);$null=Call $view 'Close';$null=Call $database 'Commit'
$summary=$database.GetType().InvokeMember('SummaryInformation',[Reflection.BindingFlags]::GetProperty,$null,$database,@(20));foreach($entry in @{1=1252;2='Installation Database';3='ContourWatch Agent';4='ContourWatch';7='x64;1033';9=([guid]::NewGuid().ToString('B').ToUpperInvariant());14=500;15=2;18='ContourWatch native MSI builder'}.GetEnumerator()){SetProperty $summary 'Property' @([int]$entry.Key,$entry.Value)};$null=Call $summary 'Persist';$null=Call $database 'Commit'
foreach($item in @($view,$stream,$summary,$database,$installer)){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)}
[GC]::Collect();[GC]::WaitForPendingFinalizers();Write-Output "Built $Output ($sequence files)"
