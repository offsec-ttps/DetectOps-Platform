# TOTAL-REPLAY

## Description

This lightweight tool helps you make the most of Splunk’s [Security Content](https://github.com/splunk/security_content) metadata, such as detection names, analytic stories, and more, by replaying relevant test event logs or attack data from either the [Splunk Attack Data](https://github.com/splunk/attack_data) or [Splunk Attack Range](https://github.com/splunk/attack_range) projects.


## MAC/LINUX:

1. Clone the Splunk Security Content github repo. We recommend to follow this steps [Security Content Getting Started](https://github.com/splunk/security_content).

2. We recommend following the instructions in the [Attack Range Getting Started](https://github.com/splunk/attack_range)
 guide. Once Attack Range is installed and its virtual environment (managed via Poetry) is activated, TOTAL-REPLAY is almost ready to use — you just need to configure it.

3. Install Poetry (if not already installed)
```
curl -sSL https://install.python-poetry.org/ | python3 -
```
4. Navigate to your project directory
```
cd /path/to/your/total-replay-project
```
5. Create a virtual environment and activate it
```
poetry shell
```
6. Install project dependencies
```
poetry install
```
7. In total_replay->configuration->config.yml, add the folder path of the Splunk Attack Data repo and the detection folder path in Splunk Security Content.

```
settings:
  security_content_detection_path: ~/path/to/your/security_content/detections
  attack_data_dir_path: ~/path/to/your/attack_data
```

8. Setup the required environment variables for splunk server connection:

    | Environment Variables.     | Description             |
    |----------------------------|-------------------------|
    | **SPLUNK_HOST**            | SPLUNK HOST IP ADDRESS  |
    | **SPLUNK_HEC_TOKEN**       | SPLUNK SERVER HEC TOKEN |

    you can use the `export` commandline function for adding these environment variables

    ```
    export SPLUNK_HOST= <IP_ADDRESS>
    export SPLUNK_HEC_TOKEN= <SPLUNK_HEC_TOKEN>
    ```

9. Make sure HEC token is set to "Enabled" in Splunk server (Settings → Data Inputs → HTTP Event Collector).

10. Confirm the HEC listener port is enabled, typically 8088, using HTTPS.

11. Update your firewall settings to allow inbound connections on port 8088, otherwise your data sender will not be able to reach Splunk.

### Windows OS:

We recommend using the Windows Subsystem for Linux (WSL). You can find a tutorial [here](https://learn.microsoft.com/en-us/windows/wsl/install). After installing WSL, you can follow the steps described in the Linux section.


for more information please visit attack data [Splunk Attack Data Repo](https://github.com/splunk/attack_data/) and [TOTAL-REPLAY repo](https://github.com/splunk/attack_data/blob/master/total_replay/readme.md)