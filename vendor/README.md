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
