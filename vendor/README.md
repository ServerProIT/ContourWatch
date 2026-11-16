# Fixed hardware dependency

LibreHardwareMonitor 0.9.6, unchanged official .NET Framework release archive:
https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/tag/v0.9.6

SHA256 LibreHardwareMonitor-0.9.6.zip:
086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001

Corresponding source (unchanged upstream files, MPL-2.0):
https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6
https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/archive/refs/tags/v0.9.6.zip

The original archive is preserved, not repacked or modified. Upstream copyright,
assembly notices and included license resources are preserved. MPL text and PawnIO
module COPYING are supplied alongside. Refer to upstream source/project files for
dependency-specific license terms; this dependency is not covered by the project's
currently undecided license. Embedded signed PawnIO module bytes remain unchanged.

The PawnIO kernel driver/installer is NOT bundled or automatically installed.
CPU/motherboard access requires an independently installed official signed driver:
https://pawnio.eu/ . Do not choose an unrestricted/unsigned edition, or disable
Windows security to read sensors. No fan-control commands are issued by our worker.

Qualification on Server 2012 is not claimed. Modern Windows hardware still requires
an actual machine test; VM smoke tests cannot certify Ryzen/NVIDIA sensor readings.


## smartmontools 7.5

Official release: https://github.com/smartmontools/smartmontools/releases/tag/RELEASE_7_5

Unmodified x64 smartctl.exe SHA-256: `b5db94e5082c042be44994b7a4fa8f7b5c8e713b2ab1c9a560d8f7a7995ea27d`.
Original smartmontools-7.5.win32-setup.exe SHA-256: `896337fcc253220614cf8cdbd5cf2321c5aa326a37a04160a672a281e6104c70`.
Corresponding source smartmontools-7.5.tar.gz SHA-256: `690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e`.
The exact source archive, COPYING, AUTHORS and drivedb.h accompany the Windows installation. smartctl is a separate GPL-2.0-or-later executable; no smartmontools code is linked into the agent. Only read-only discovery/SMART reporting is requested. No third-party installer runs during our build or agent startup.
