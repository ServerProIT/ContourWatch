#requires -Version 7.4
param([string]$Version='0.2.3',[string]$KeyFile,[ValidateSet('stable','pilot')][string]$Channel='stable',[int]$Pilot=1)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
if(!$KeyFile){$KeyFile=Join-Path $project 'work\release-signing\release-key.dpapi'}
if($Version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$'){throw 'Invalid version'}
$tag="agent-$Version";if($Channel -eq 'pilot'){$tag+="-pilot.$Pilot"}
$output=Join-Path $project ("dist\release\"+$tag);New-Item -ItemType Directory -Force $output | Out-Null
$msi=Join-Path $project "dist\windows-x64\ContourWatch-$Version-windows-x64.msi"
if(!(Test-Path -LiteralPath $msi)){throw 'Build the matching MSI first'}
Copy-Item -LiteralPath $msi -Destination $output -Force
$linuxName="ContourWatch-$Version-linux-any.tar.gz"
& tar -czf (Join-Path $output $linuxName) -C (Join-Path $project 'agent\linux') agent.py tray.py agent.svg update.py update-public.pem
if($LASTEXITCODE){throw 'Linux archive failed'}
$artifacts=[ordered]@{}
foreach($entry in @(@('windows-x64',(Split-Path $msi -Leaf)),@('linux',$linuxName))){$file=Join-Path $output $entry[1];$artifacts[$entry[0]]=[ordered]@{name=$entry[1];size=(Get-Item -LiteralPath $file).Length;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}}
$manifest=[ordered]@{version=$Version;tag=$tag;expires=[DateTime]::UtcNow.AddDays(35).ToString('yyyy-MM-ddTHH:mm:ssZ');artifacts=$artifacts}|ConvertTo-Json -Depth 5 -Compress
$utf8=New-Object Text.UTF8Encoding $false
$bytes=$utf8.GetBytes($manifest)
Add-Type -AssemblyName System.Security
$privateBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($KeyFile),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$rsa=[Security.Cryptography.RSA]::Create()
try{
 $read=0;$rsa.ImportPkcs8PrivateKey($privateBytes,[ref]$read)
 $public=[IO.File]::ReadAllText((Join-Path $project 'agent\update-public.xml'))
 $verify=New-Object Security.Cryptography.RSACryptoServiceProvider
 try{$verify.FromXmlString($public);$signature=$rsa.SignData($bytes,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1);if(!$verify.VerifyData($bytes,[Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'),$signature)){throw 'Signing key does not match pinned public key'}}finally{$verify.Dispose()}
 $linuxVerify=[Security.Cryptography.RSA]::Create()
 try{$linuxVerify.ImportFromPem([IO.File]::ReadAllText((Join-Path $project 'agent\linux\update-public.pem')));if(!$linuxVerify.VerifyData($bytes,$signature,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)){throw 'Linux public key mismatch'}}finally{$linuxVerify.Dispose()}
 [IO.File]::WriteAllBytes((Join-Path $output 'manifest.json'),$bytes)
 [IO.File]::WriteAllText((Join-Path $output 'manifest.sig'),[Convert]::ToBase64String($signature),$utf8)
}finally{[Array]::Clear($privateBytes,0,$privateBytes.Length);$rsa.Dispose()}
$sums=Get-ChildItem -LiteralPath $output -File|Where-Object Name -ne 'SHA256SUMS.txt'|Sort-Object Name|ForEach-Object{(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.Name}
[IO.File]::WriteAllLines((Join-Path $output 'SHA256SUMS.txt'),$sums,$utf8)
Write-Output "Release prepared: $tag in $output (not published)"
