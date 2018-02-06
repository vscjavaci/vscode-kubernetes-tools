import * as vscode from "vscode";

import { IDockerParser, IDockerResolver, PortInfo } from './debugInterfaces';
import { Kubectl } from '../kubectl';

const defaultAppPort = "9000";
const nodeDebugOptsRegExp = /(--)?(debug|inspect)(=\S*)?/;
const fullNodeDebugOptsRegExp = /node(js)?\s+.*(--)?(debug|inspect)(=\S*)?/i;

export class NodeDockerResolver implements IDockerResolver {
    public isSupportedImage(baseImage: string): boolean {
        return baseImage.indexOf("node") >= 0;
    }

    public async resolvePortsFromFile(dockerParser: IDockerParser, env: {}): Promise<PortInfo> {
        const portInfo: PortInfo = {
            debug: null,
            app: null
        };

        // Resolve the debug port.
        const nodeCmd = dockerParser.searchLaunchArgs(nodeDebugOptsRegExp);
        if (nodeCmd) {
            if (!nodeCmd[3]) {
                portInfo.debug = (nodeCmd[2] === "inspect" ? "9229" : "5858");
            } else {
                const addresses = nodeCmd[3].substring(1).split(":");
                portInfo.debug = addresses[addresses.length - 1];
            }
        }
        // Cannot resolve the debug port from Dockerfile, then ask user to specify it.
        if (!portInfo.debug) {
            const input = await vscode.window.showInputBox({
                prompt: `Please specify debug port exposed by the Dockerfile (e.g. 9229)`,
                placeHolder: "9229"
            });
            portInfo.debug = (input ? input.trim() : null);
        }
        if (!portInfo.debug) {
            return portInfo;
        }

        // Resolve the app port.
        const dockerExpose = dockerParser.getExposedPorts();
        if (portInfo.debug && dockerExpose.length) {
            const excludes = [ "9229", "5858", portInfo.debug ];
            const possiblePorts = dockerExpose.filter((port) => excludes.indexOf(port) === -1);
            if (possiblePorts.length === 1) {
                portInfo.app = possiblePorts[0];
            } else if (possiblePorts.length > 1) {
                portInfo.app = await vscode.window.showQuickPick(possiblePorts, { placeHolder: "Please select the app port exposed at Dockerfile" });
            }
            // If the exposed port is a variable, then need set it in environment variables.
            if (/\$\{?(\w+)\}?/.test(portInfo.app)) {
                const varName = portInfo.app.match(/\$\{?(\w+)\}?/)[1];
                env[varName] = defaultAppPort;
                portInfo.app = defaultAppPort;
            }
        }

        return portInfo;
    }

    public async resolvePortsFromContainer(kubectl: Kubectl, pod: string, container: string): Promise<PortInfo> {
        const portInfo: PortInfo = {
            debug: null,
            app: null
        };

        const execCmd = `exec ${pod} ${container ? "-c ${selectedContainer}" : ""} -- ps -ef`;
        const execResult = await kubectl.invokeAsync(execCmd);
        if (execResult.code === 0) {
            /**
             * UID        PID  PPID  C STIME TTY          TIME CMD
             * root         1     0  0 05:49 ?        00:00:00 node --inspect=9229 index.js
             * root        17     0  0 06:44 pts/0    00:00:00 bash
             * root        26    17  0 06:46 pts/0    00:00:00 ps -ef
             */
            const ps = execResult.stdout.split("\n");
            const totalCol = ps[0].trim().split(/\s+/).length;
            for (let i = 1; i < ps.length; i++) {
                const cols = ps[i].trim().split(/\s+/);
                if (cols.length < totalCol) {
                    continue;
                }
                const cmd = cols.slice(totalCol - 1, cols.length).join(" ");
                const matches = cmd.match(fullNodeDebugOptsRegExp);
                if (matches && matches.length === 5) {
                    if (!matches[4]) {
                        portInfo.debug = (matches[3] === "inspect" ? "9229" : "5858");
                    } else {
                        const addresses = matches[4].substring(1).split(":");
                        portInfo.debug = addresses[addresses.length - 1];
                    }
                    break;
                }
            }
        }

        if (!portInfo.debug) {
            const input = await vscode.window.showInputBox({
                prompt: `Please specify debug port exposed by the container (e.g. 9229)`,
                placeHolder: "9229"
            });
            portInfo.debug = (input ? input.trim() : null);
        }

        return portInfo;
    }
}
