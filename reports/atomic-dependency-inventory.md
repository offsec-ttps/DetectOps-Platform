# Atomic Red Team — External Dependency Inventory

_Generated 2026-10-17T16:45:44 from `dev.db`._

External resources each atomic's `get_prereq_command` downloads from the internet. On an offline/air-gapped endpoint these must be staged locally before the atomic can run.

## Summary

| Metric | Count |
|---|---|
| Atomics in library | 1892 |
| Atomics declaring dependencies | 757 |
| Atomics that download a prereq (offline-blocking) | 309 |
| **Distinct external resources to stage** | **239** |

### Dependencies by platform

| Platform | Atomics |
|---|---|
| windows | 461 |
| linux | 187 |
| macos | 30 |
| containers | 18 |
| azure-ad | 18 |
| iaas:aws | 17 |
| iaas:azure | 13 |
| office-365 | 7 |
| iaas:gcp | 5 |
| google-workspace | 1 |

### Resources by file type

| Type | Distinct resources |
|---|---|
| exe | 53 |
| other | 51 |
| dll | 29 |
| zip | 26 |
| ps1 | 21 |
| msi | 9 |
| txt | 8 |
| js | 6 |
| vbs | 5 |
| xml | 4 |
| bat | 3 |
| html | 3 |
| bin | 3 |
| py | 3 |
| sh | 3 |
| iso | 3 |
| jpg | 2 |
| cmd | 2 |
| reg | 2 |
| tar | 1 |
| 7z | 1 |
| cpl | 1 |

## All external resources (most-used first)

| # atomics | Type | Resource |
|---|---|---|
| 16 | exe | https://the.earth.li/~sgtatham/putty/latest/w64/plink.exe |
| 15 | ps1 | https://raw.githubusercontent.com/redcanaryco/invoke-atomicredteam/master/Public/Invoke-FetchFromZip.ps1 |
| 11 | zip | https://download.sysinternals.com/files/PSTools.zip |
| 10 | other | https://api.github.com/repos/gentilkiwi/mimikatz/releases |
| 10 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1087.002/bin/AdFind.exe |
| 8 | ps1 | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.004/src/InstallUtilTestHarness.ps1 |
| 8 | zip | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1548.002/bin/uacme.zip |
| 6 | other | https://cloud.google.com/sdk/docs/install |
| 5 | exe | https://www.python.org/ftp/python/3.10.4/python-3.10.4-amd64.exe |
| 5 | other | https://api.github.com/repos/DataDog/stratus-red-team/releases/latest |
| 5 | zip | https://github.com/center-for-threat-informed-defense/adversary_emulation_library/raw/master/micro_emulation_plans/src/named_pipes/named_pipes.zip |
| 4 | exe | https://github.com/ropnop/kerbrute/releases/download/v1.0.3/kerbrute_windows_386.exe |
| 3 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1543.003/bin/AtomicService.exe |
| 3 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1574.012/bin/T1574.012x64.dll |
| 3 | html | https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html |
| 2 | zip | https://download.sysinternals.com/files/Procdump.zip |
| 2 | exe | https://github.com/fortra/nanodump/raw/2c0b3d5d59c56714312131de9665defb98551c27/dist/nanodump.x64.exe |
| 2 | ps1 | https://raw.githubusercontent.com/redcanaryco/invoke-atomicredteam/master/Public/Invoke-WebRequestVerifyHash.ps1 |
| 2 | zip | https://curl.se/windows/dl-8.4.0_6/curl-8.4.0_6-win64-mingw.zip |
| 2 | zip | https://downloads.rclone.org/rclone-current-windows-amd64.zip |
| 2 | js | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059.007/src/sys_info.js |
| 2 | sh | https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh |
| 2 | zip | https://curl.se/windows/dl-7.79.1/curl-7.79.1-win64-mingw.zip |
| 2 | other | https://aka.ms/installazurecliwindows |
| 2 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1137.006/bin/Addins/excelxll_x64.xll |
| 2 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1137.006/bin/Addins/excelxll_x86.xll |
| 2 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.001/src/T1218.001.chm |
| 2 | msi | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.007/bin/T1218.007_JScript.msi |
| 2 | msi | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.007/bin/T1218.007_VBScript.msi |
| 2 | msi | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.007/bin/T1218.007_DLL.msi |
| 2 | msi | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.007/bin/T1218.007_EXE.msi |
| 2 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.007/bin/MSIRunner.dll |
| 2 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.009/src/T1218.009.cs |
| 2 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.010/bin/AllTheThingsx86.dll |
| 2 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.011/src/T1218.011.inf |
| 2 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.011/src/T1218.011_DefaultInstall.inf |
| 2 | exe | https://web.archive.org/web/20200803205229if_/https://download.microsoft.com/download/f/2/6/f263ac46-1fe9-4ae9-8fd3-21102100ebf5/msxsl.exe |
| 2 | zip | https://www.sqlite.org/2022/sqlite-tools-win32-x86-3380200.zip |
| 2 | other | https://www.python.org/downloads/windows/ |
| 2 | other | https://kind.sigs.k8s.io/dl/v0.10.0/kind-linux-amd64 |
| 2 | other | https://dl.k8s.io/release/$(curl |
| 2 | txt | https://dl.k8s.io/release/stable.txt |
| 2 | dll | https://github.com/redcanaryco/atomicredteam/atomics/T1556.002/bin/AtomicRedTeamPWFilter.dll |
| 2 | exe | https://www.win-rar.com/fileadmin/winrar-versions/winrar/th/winrar-x64-580.exe |
| 2 | html | https://www.terraform.io/downloads.html |
| 2 | zip | https://download.sysinternals.com/files/Sysmon.zip |
| 1 | jpg | https://github.com/raghavsingh7/Pictures/raw/a9617d9fce289909441120a1e0366315c2c5e19d/lime.jpg |
| 1 | jpg | https://github.com/raghavsingh7/Pictures/raw/f73e7686cdd848ed06e63af07f6f1a5e72de6320/evil_kitten.jpg |
| 1 | ps1 | https://github.com/raghavsingh7/Extract-Invoke-PSImage/raw/7d8c165d2f9bfe9c3965181079b7c82e03168ce1/Extract-Invoke-PSImage.ps1 |
| 1 | exe | https://github.com/clr2of8/Dumpert/raw/5838c357224cc9bc69618c80c2b5b2d17a394b10/Dumpert/x64/Release/Outflank-Dumpert.exe |
| 1 | exe | https://github.com/audibleblink/xordump/releases/download/v0.0.1/xordump.exe |
| 1 | ps1 | https://raw.githubusercontent.com/BC-SECURITY/Empire/c1bdbd0fdafd5bf34760d5b158dfd0db2bb19556/data/module_source/credentials/Invoke-PowerDump.ps1 |
| 1 | tar | https://github.com/huntergregal/mimipenguin/releases/download/2.0-release/mimipenguin_2.0-release.tar.gz |
| 1 | dll | https://github.com/gtworek/PSBits/raw/f221a6db08cb3b52d5f8a2a210692ea8912501bf/PasswordStealing/NPPSpy/NPPSPY.dll |
| 1 | other | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1010/src/T1010.cs |
| 1 | bat | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1016/src/qakbot.bat |
| 1 | zip | https://www.softperfect.com/download/files/netscan_portable.zip |
| 1 | exe | https://github.com/oneclick/rubyinstaller2/releases/download/RubyInstaller-2.7.1-1/rubyinstaller-2.7.1-1-x64.exe |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1027.004/src/calc.cs |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1027.004/bin/T1027.004_DynamicCompile.exe |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1027.004/src/T1027-004-test.c |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1027.004/src/T1027-004-test.cc |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1027.004/src/T1027-004-test.go |
| 1 | html | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1027.006/bin/T1027_006_Remote.html |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1027.007/bin/ninja_syscall1.exe |
| 1 | vbs | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1036.003/src/T1036.003_masquerading.vbs |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1036.003/bin/T1036.003.exe |
| 1 | vbs | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1036.007/src/T1036.007_masquerading.vbs |
| 1 | ps1 | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1036.007/src/T1036.007_masquerading.ps1 |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1047/bin/calc.dll?raw=true |
| 1 | msi | https://www.tightvnc.com/download/2.8.63/tightvnc-2.8.63-gpl-setup-64bit.msi |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1048.002/src/artifact |
| 1 | ps1 | https://raw.githubusercontent.com/Arno0x/DNSExfiltrator/8faa972408b0384416fffd5b4d42a7aa00526ca8/Invoke-DNSExfiltrator.ps1 |
| 1 | xml | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1053.005/src/T1053_005_WMI.xml |
| 1 | xml | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1053.005/src/T1053_05_SCTASK_HIDDEN_ATTRIB.xml |
| 1 | exe | https://github.com/netero1010/GhostTask/releases/download/1.0/GhostTask.exe |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055.001/src/x64/T1055.001.dll |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055.002/bin/RedInjection.exe |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055.004/bin/T1055.exe |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055.011/bin/T1055.011_#{arch}.exe |
| 1 | bin | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055.011/bin/payload.exe_#{arch}.bin |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055.015/bin/ListPlanting.exe |
| 1 | txt | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055/src/x64/T1055-macrocode.txt |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055/bin/x64/vuln_dll/msys-2.0.dll |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1055/bin/x64/uuid_injection.exe |
| 1 | ps1 | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1056.001/src/Get-Keystrokes.ps1 |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1056.004/bin/T1056.004x64.dll |
| 1 | exe | https://versaweb.dl.sourceforge.net/project/processhacker/processhacker2/processhacker-2.39-setup.exe |
| 1 | zip | https://www.snapfiles.com/directdl/PCHunter_free.zip |
| 1 | ps1 | https://raw.githubusercontent.com/BloodHoundAD/BloodHound/804503962b6dc554ad7d324cfa7f2b4a566a14e2/Ingestors/SharpHound.ps1 |
| 1 | cmd | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1059.003/src/t1059.003_cmd.cmd |
| 1 | vbs | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059.005/src/sys_info.vbs |
| 1 | zip | https://www.autohotkey.com/download/ahk.zip |
| 1 | exe | https://www.autoitscript.com/cgi-bin/getfile.pl?autoit3/autoit-v3-setup.exe |
| 1 | exe | https://github.com/BloodHoundAD/BloodHound/blob/e062fe73d73c015dccb37fae5089342d009b84b8/Collectors/SharpHound.exe?raw=true |
| 1 | ps1 | https://raw.githubusercontent.com/mitre-attack/attack-arsenal/bc0ba1d88d026396939b6816de608cb279bfd489/adversary_emulation/APT29/CALDERA_DIY/evals/payloads/timestomp.ps1 |
| 1 | zip | https://curl.se/windows/dl-8.6.0_2/curl-8.6.0_2-win32-mingw.zip |
| 1 | msi | https://www.radmin.com/download/Radmin_Viewer_3.5.2.1_EN.msi |
| 1 | exe | https://download.pdq.com/release/19/Deploy_19.3.350.0.exe |
| 1 | ps1 | https://chocolatey.org/install.ps1 |
| 1 | other | https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli |
| 1 | other | https://aka.ms/installazurecliwindowsx64 |
| 1 | vbs | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1082/src/griffon_recon.vbs |
| 1 | ps1 | https://raw.githubusercontent.com/cyberark/SkyArk/3293ee145e95061a8980dd7b5da0030edc4da5c0/AzureStealth/AzureStealth.ps1 |
| 1 | zip | https://github.com/SanderSade/DirLister/releases/download/v2.beta4/DirLister.v2.beta4.zip |
| 1 | ps1 | https://raw.githubusercontent.com/sense-of-security/ADRecon/38e4abae3e26d0fa87281c1d0c65cabd4d3c6ebd/ADRecon.ps1 |
| 1 | txt | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1087.002/src/username.txt?raw=true |
| 1 | py | https://bootstrap.pypa.io/pip/3.6/get-pip.py |
| 1 | exe | https://s3.amazonaws.com/0ubz-2q11-gi9y/psiphon3.exe |
| 1 | bat | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1090.003/src/Psiphon.bat |
| 1 | zip | https://archive.torproject.org/tor-package-archive/torbrowser/11.0.6/tor-win32-0.4.6.9.zip |
| 1 | zip | https://nmap.org/dist/nmap-7.80-win32.zip |
| 1 | bat | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1105/src/T1105.bat |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1105/src/redcanary.cab |
| 1 | vbs | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1105/src/T1105-download-file.vbs |
| 1 | zip | https://nim-lang.org/download/nim-1.6.6_x64.zip |
| 1 | exe | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1105/bin/GUP.exe |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1106/src/CreateProcess.cs |
| 1 | txt | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1110.001/src/bruteuser.txt?raw=true |
| 1 | exe | https://www.7-zip.org/a/7z1900.exe |
| 1 | 7z | https://hashcat.net/files/hashcat-6.1.1.7z |
| 1 | other | https://github.com/ZoomerHulkHogan/Powershell-Domain-User-Enumeration |
| 1 | ps1 | https://raw.githubusercontent.com/dafthack/MSOLSpray/922f159104fb3ec77c9fc6507a6388a05c227b5f/MSOLSpray.ps1 |
| 1 | txt | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1110.003/src/passwordspray.txt?raw=true |
| 1 | sh | https://raw.githubusercontent.com/Homebrew/install/e8114640740938c20cc41ffdbf07816b428afc49/install.sh |
| 1 | txt | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1110.004/src/bruteforce.txt?raw=true |
| 1 | ps1 | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1114.001/src/Get-Inbox.ps1 |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1127.001/src/T1127.001.csproj |
| 1 | xml | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1127.001/src/vb.xml |
| 1 | js | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1127/src/hello.js |
| 1 | js | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1127/src/LibHello.js |
| 1 | exe | https://the.earth.li/~sgtatham/putty/latest/w64/pscp.exe |
| 1 | zip | https://github.com/M2Team/NSudo/releases/download/8.2/NSudo_8.2_All_Components.zip |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1134.001/bin/BadPotato.exe?raw=true |
| 1 | exe | https://github.com/ohpe/juicy-potato/releases/download/v0.1/JuicyPotato.exe |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1134.004/bin/calc.dll |
| 1 | ps1 | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1134.004/src/PPID-Spoof.ps1 |
| 1 | ps1 | https://raw.githubusercontent.com/darkoperator/Veil-PowerView/8784e33f17ee7543ba2f45e27dc5f08ea3a1b856/PowerView/powerview.ps1 |
| 1 | exe | https://github.com/mitchmoser/SharpShares/releases/download/v2.4/SharpShares.exe |
| 1 | exe | https://github.com/SnaffCon/Snaffler/releases/download/1.0.150/Snaffler.exe |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1137.002/bin/officetest_x64.dll |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1137.006/bin/Addins/wordwll_x64.wll |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1137.006/bin/Addins/wordwll_x86.wll |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1137.006/bin/Addins/ExcelVBAaddin.xlam |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1137.006/bin/Addins/PptVBAaddin.ppam |
| 1 | exe | https://github.com/topotam/PetitPotam/blob/2ae559f938e67d0cd59c5afcaac67672b9ef2981/PetitPotam.exe?raw=true |
| 1 | cpl | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.002/bin/calc.cpl |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.003/src/T1218.003.inf |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.003/src/T1218.003_uacbypass.inf |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.008/src/Win32/T1218-2.dll |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.008/bin/T1218.008.rsp |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.008/bin/o.dll |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218.010/src/RegSvr32.sct |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218/src/x64/T1218.dll |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218/src/Win32/T1218-2.dll |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218/src/Infdefaultinstall.inf |
| 1 | txt | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218/src/T1218.txt |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1218/bin/calc.dll?raw=true |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1218/src/ieuinit.inf |
| 1 | exe | https://web.archive.org/web/20140625232737/http://www.ammyy.com/AA_v3.exe |
| 1 | exe | https://static.remotepc.com/downloads/rpc/140422/RemotePC.exe |
| 1 | exe | https://nsproducts.azureedge.net/nsm-1270/en/Setup.exe |
| 1 | exe | https://www.ultraviewer.net/en/UltraViewer_setup_6.5_en.exe |
| 1 | exe | https://www.uvnc.eu/download/1381/UltraVNC_1_3_81_X64_Setup.exe |
| 1 | exe | https://download.splashtop.com/winclient/STP/Splashtop_Personal_Win_v3.6.6.0.exe |
| 1 | exe | https://download.splashtop.com/win/Splashtop_Streamer_Win_INSTALLER_v3.6.4.1.exe |
| 1 | xml | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1220/src/msxslxmlfile.xml |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1220/src/msxslscript.xsl |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1220/src/wmicscript.xsl |
| 1 | ps1 | https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/f94a5d298a1b4c5dfb1f30a246d9c73d13b22888/Recon/PowerView.ps1 |
| 1 | exe | https://github.com/dsnezhkov/TruffleSnout/releases/download/0.5/TruffleSnout.exe |
| 1 | zip | https://download.sysinternals.com/files/SDelete.zip |
| 1 | exe | https://files.gpg4win.org/gpg4win-4.1.0.exe |
| 1 | exe | https://github.com/DavidXanatos/DiskCryptor/releases/download/1.1.846.118/dcrypt_setup_1.1.846.118.exe |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1505.003/src/b.jsp |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1505.003/src/tests.jsp |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1505.003/src/cmd.aspx |
| 1 | ps1 | https://raw.githubusercontent.com/NetSPI/MicroBurst/c771c665a2c71f9c5ba474869cd1c211ebee68fd/Az/Get-AzDomainInfo.ps1 |
| 1 | other | https://github.com/slyd0g/WhiteChocolateMacademiaNut.git |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.003/src/T1546.003.mof |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.007/bin/NetshHelper.dll |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.009/bin/AtomicTest.dll |
| 1 | reg | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.010/src/T1546.010.reg |
| 1 | reg | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.010/src/T1546.010-cleanup.reg |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.010/bin/T1546.010.dll |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.010/bin/T1546.010x86.dll |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.011/bin/AtomicShimx86.sdb |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.011/bin/AtomicTest.dll |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.015/bin/AtomicTest.dll |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.015/bin/T1546.015_calc.dll |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546/bin/AltWinSock2DLL.dll |
| 1 | cmd | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546/src/ErrorHandler.cmd |
| 1 | dll | https://github.com/oxfemale/LogonCredentialsSteal/raw/53e74251f397ddeab2bd1348c3ff26d702cfd836/lsass_lib/x64/Release/lsass_lib.dll |
| 1 | other | https://kubernetes.io/docs/tasks/tools/ |
| 1 | dll | https://github.com/gtworek/PSBits/raw/2aa885c7d09f7f100997bfa5ee0c404084177f24/SIP/GTSIPProvider.dll |
| 1 | iso | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1553.005/bin/T1553.005.iso |
| 1 | iso | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1553.005/bin/FeelTheBurn.iso |
| 1 | iso | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1553.005/bin/AllTheThings.iso |
| 1 | zip | https://github.com/mitre-attack/attack-arsenal/raw/66650cebd33b9a1e180f7b31261da1789cdceb66/adversary_emulation/APT29/CALDERA_DIY/evals/payloads/Modified-SysInternalsSuite.zip |
| 1 | exe | https://github.com/AlessandroZ/LaZagne/releases/download/v2.4.5/LaZagne.exe |
| 1 | msi | https://ftp.mozilla.org/pub/firefox/releases/98.0/win64/en-US/Firefox%20Setup%2098.0.msi |
| 1 | exe | https://aka.ms/vs/17/release/vs_BuildTools.exe |
| 1 | py | https://raw.githubusercontent.com/lclevy/firepwd/167eabf3b88d5a7ba8b8bc427283f827b6885982/firepwd.py |
| 1 | other | https://github.com/AlessandroZ/LaZagne |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1555.003/bin/WebBrowserPassView.exe |
| 1 | other | https://download.mozilla.org/?product=firefox-stub&os=win&lang=en-US |
| 1 | exe | https://github.com/SaulBerrenson/BrowserStealer/releases/download/1.0.0.4/BrowserCollector_x64.exe |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1555.003/src/key4.db?raw=true |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1555.003/src/logins.json?raw=true |
| 1 | msi | https://dl.google.com/chrome/install/googlechromestandaloneenterprise64.msi |
| 1 | ps1 | https://raw.githubusercontent.com/NetSPI/MicroBurst/c771c665a2c71f9c5ba474869cd1c211ebee68fd/AzureRM/Get-AzurePasswords.ps1 |
| 1 | exe | https://www.7-zip.org/a/7z2301-x64.exe |
| 1 | msi | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1564.006/bin/Virtualbox_52.msi |
| 1 | other | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1564.006/bin/common.cab |
| 1 | zip | https://www.nirsoft.net/utils/nircmd-x64.zip |
| 1 | zip | https://downloads.rclone.org/rclone-current-osx-$arch.zip |
| 1 | zip | https://downloads.rclone.org/rclone-current-linux-$arch.zip |
| 1 | zip | https://releases.hashicorp.com/terraform/1.10.5/terraform_1.10.5_darwin_$arch.zip |
| 1 | zip | https://releases.hashicorp.com/terraform/1.10.5/terraform_1.10.5_linux_$arch.zip |
| 1 | exe | https://github.com/kavika13/RemCom/raw/master/bin/Release/RemCom.exe |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1574.001/bin/GUP.exe?raw=true |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1574.001/bin/preloader.dll?raw=true |
| 1 | other | https://learn.microsoft.com/en-us/cli/azure/install-azure-cli |
| 1 | other | https://aws.amazon.com/cli/ |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1614.001/bin/LanguageKeyboardLayout.exe |
| 1 | ps1 | https://raw.githubusercontent.com/NetSPI/MicroBurst/156c4e9f4253b482b2b68eda4651116b9f0f2e17/Misc/Invoke-EnumerateAzureBlobs.ps1 |
| 1 | txt | https://raw.githubusercontent.com/NetSPI/MicroBurst/156c4e9f4253b482b2b68eda4651116b9f0f2e17/Misc/permutations.txt |
| 1 | sh | https://astral.sh/uv/install.ps1 |
| 1 | js | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059.007/src/xpexplore.js |
| 1 | js | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059.007/src/Chkdsk.js |
| 1 | js | https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059.007/src/registry_payload.js |
| 1 | bin | https://github.com/magicsword-io/LOLDrivers/blob/main/drivers/c796a92a66ec725b7b7febbdc13dc69b.bin?raw=true |
| 1 | bin | https://github.com/magicsword-io/LOLDrivers/raw/main/drivers/eaea9ccb40c82af8f3867cd0f4dd5e9d.bin |
| 1 | py | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1568.002/src/T1568.002.py |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1574.001/bin/ntprint.dll?raw=true |
| 1 | dll | https://github.com/redcanaryco/atomic-red-team/atomics/T1620/bin/CommanderDLL.dll?raw=true |
| 1 | exe | https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1685.001/bin/Phant0m.exe |
| 1 | zip | http://www.nirsoft.net/utils/advancedrun.zip |
| 1 | exe | https://github.com/Yaxser/Backstab/releases/download/v1.0.1-beta/Backstab64.exe |
