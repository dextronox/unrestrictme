//This is the unrestrict.me background node service.
//This file handles anything that requires elevation.
const net = require("net")
const fs = require(`fs`)
const path = require("path")
const os = require("os")
const {exec} = require('child_process')
const { stdout } = require("process")
let client, EventLogger, log

if (os.platform() === "win32") {
    EventLogger = require('node-windows').EventLogger
    log = new EventLogger('unrestrict.me Service Log')
} else {
    log = {}
    log.info = (arg) => {
        console.log(arg)
    }
    log.error = () => {
        console.log(arg)
    }
}

let ver = 1.0

let killSwitchStatus, intentionalDisconnect
entryPoint()
function entryPoint() {
    //Behaviour explaination
    //On Windows, don't kill the service, just keep retrying. Service worker continues in the background indefinitely, only restarted after application is closed.
    if (os.platform() === "win32") {
        exec("tasklist", (error, stdout, stderr) => {
            if (String(stdout).includes("unrestrict.me.exe") || String(stdout).includes("electron.exe")) {
                log.info("unrestrict.me.exe found to be running. Starting service worker.")
                tryConnect()
            } else {
                //log.info("unrestrict.me.exe not running. Will retry in 1 second.")
                setTimeout(() => {entryPoint()}, 1000)
            }
        })
    } else {
        tryConnect()
    }
}


function tryConnect() {
    client = net.createConnection({ port: 4964 }, () => {
        //Runs once connected to the server.
        log.info(`Background: Connected to client server. Ready to receive instructions.`)
        testMessage()
    });
    client.on('data', (data) => {
        //We have received some data from the server.
        //data should always be JSON in buffer format
        log.info(`Background: Data received.`)
        foregroundProcessDataHandler(data.toString())
    });
    client.on('end', () => {
        //Connection has been ended. Kill this process.
        process.exit()
    });
    client.on('error', (error) => {
        log.info(`Background: An error occurred. Error: ${error}`)
    })
}



function testMessage() {
    let writeData = {
        "command":"testMessage",
        "ver": ver
    }
    client.write(JSON.stringify(writeData))
}
function foregroundProcessDataHandler(data) {
    let dataInterpreted
    try {
        dataInterpreted = JSON.parse(data)
    } catch (e) {
        dataInterpreted = data.replace("}{", '}!{').split("!")
        dataInterpreted.forEach((value) => {
            foregroundProcessDataHandler(value)
        })
        return;
    }

    log.info(JSON.stringify(dataInterpreted))
    if (dataInterpreted["command"] === "connectToOpenVPN") {
        ovpnFunction(dataInterpreted["configPath"], dataInterpreted["ovpnPath"], dataInterpreted["scriptPath"])
    }
    if (dataInterpreted["command"] === "disconnect") {
        disconnectFromVPN(dataInterpreted["quitBoolean"])
    }
    if (dataInterpreted["command"] === "killSwitchEnable") {
        killSwitchEnable(dataInterpreted["nic"])
    }
    if (dataInterpreted["command"] === "killSwitchDisable") {
        killSwitchDisable(dataInterpreted["nic"])
    }
    if (dataInterpreted["command"] === "connectToStealth") {
        //Runs into stealthFunction
        stealthFunction(dataInterpreted["wstunnelPath"], dataInterpreted["domain"], dataInterpreted["configPath"], dataInterpreted["ovpnPath"], dataInterpreted["scriptPath"])
    }
    if (dataInterpreted["command"] === "disableIPv6") {
        IPv6Management(true, dataInterpreted["adapter"])
    }
    if (dataInterpreted["command"] === "enableIPv6") {
        IPv6Management(false, dataInterpreted["adapter"])
    }
    if (dataInterpreted["command"] === "runTapInstaller") {
        runTapInstaller()
    }
}

function ovpnFunction(configPath, ovpnPath, scriptPath) {
    if (scriptPath) {
        exec(`/bin/chmod +x "${scriptPath}"`, (error, stdout, stderr) => {
            if (error) {
                log.info(`Couldn't set the permission of the DNS updater script. Error: ${error}`)
                let writeData = {
                    "command":"sendToRenderer",
                    "channel": "error",
                    "status": {
                        "connectError": true
                    }
                }
                client.write(JSON.stringify(writeData))
            } else {
                startOvpn(configPath, ovpnPath, scriptPath)
            }
        })
    } else if (ovpnPath) {
        startOvpn(configPath, ovpnPath)
    } else {
        startOvpn(configPath)
    }

}

function startOvpn(configPath, ovpnPath, scriptPath) {
    intentionalDisconnect = false
    killSwitchStatus = false
    let ovpnProc
    if (os.platform() === "linux") {
        ovpnProc = exec(`openvpn --config "${configPath}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15 --script-security 2 --up "${scriptPath}" --down "${scriptPath}"`)
    } else if (os.platform() === "darwin") {
        scriptPath = scriptPath.replace(/([ ])/g, '\\$1')
        ovpnProc = exec(`${ovpnPath} --config "${configPath}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15 --script-security 2 --up "${scriptPath}" --down "${scriptPath}"`)
    } else if (os.platform() === "win32") {
        log.info(`"${ovpnPath}" --config "${configPath}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
        ovpnProc = exec(`"${ovpnPath}" --config "${configPath}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
    }
    var datalog
    ovpnProc.stdout.on('data', (data) => {
        log.info(data)
        datalog = datalog + data 
        if (data.includes(`Initialization Sequence Completed`)) {
            killSwitchStatus = false
            let initializeCount = (datalog.match(/Initialization Sequence Completed/g) || []).length;
            if (initializeCount <= 1) {
                //Connected to unrestrictme
                let writeData = {
                    "command":"sendToRenderer",
                    "channel": "connection",
                    "status": {
                        "connected": true
                    }
                }
                client.write(JSON.stringify(writeData))
            }
        }
        if (data.includes(`All TAP-Windows adapters on this system are currently in use.`)) {
            //Couldn't connect, some other VPN (maybe us) is already connected
            let writeData = {
                "command":"sendToRenderer",
                "channel": "error",
                "status": {
                    "tapError": true
                }
            }
            client.write(JSON.stringify(writeData))
        }
        if (data.includes('Closing TUN/TAP interface')) {
            if (datalog.includes(`Initialization Sequence Completed`) && !intentionalDisconnect) {
                //OpenVPN has disconnected on its own. Activate kill switch.
                log.info(`Main: OpenVPN has disconnected on its own. Enabling kill switch.`)
                killSwitchStatus = true
            }
        }
        if (data.includes('SIGTERM[soft,tls-error] received, process exiting') || data.includes('Exiting due to fatal error')) {
            //OpenVPN failed to connect, check if had already connected.
            if (!datalog.includes(`Initialization Sequence Completed`)) {
                log.info(`Main: OpenVPN failed to connect.`)
                intentionalDisconnect = true
                let writeData = {
                    "command":"sendToRenderer",
                    "channel": "error",
                    "status": {
                        "connectError": true
                    }
                }
                client.write(JSON.stringify(writeData))
            }
        }
        if (data.includes(`Inactivity timeout (--ping-restart), restarting`)) {
            //Something has caused the VPN to restart. Alert the user that there are issues.
            let writeData = {
                "command":"sendToRenderer",
                "channel": "error",
                "status": {
                    "inactivityTimeout": true
                }
            }
            client.write(JSON.stringify(writeData))
        }
    })
    ovpnProc.on('close', (data) => {
        //OpenVPN has closed!
        if (killSwitchStatus === true || !intentionalDisconnect) {
            log.info(`Main: Activating failsafe.`)
            let writeData = {
                "command":"execute",
                "methods": [
                    "killSwitch(true)"
                ]
            }
            client.write(JSON.stringify(writeData))
        }
        let writeData = {
            "command":"execute",
            "methods": [
                "IPv6Management(false)"
            ]
        }
        client.write(JSON.stringify(writeData))
    })
}
function disconnectFromVPN(quit) {
    intentionalDisconnect = true
    if (os.platform() === "win32") {
        exec(`taskkill /IM openvpn.exe /F & taskkill /IM wstunnel.exe /F`, (error, stdout, stderr) => {
            if (error && !String(error).includes(`"wstunnel.exe" not found.`)) {
                log.info(`An error occurred killing OpenVPN. Error: ${error}`)
                let writeData = {
                    "command":"sendToRenderer",
                    "channel": "error",
                    "status": {
                        "disconnectError": true
                    },
                    "showWindow": true
                }
                client.write(JSON.stringify(writeData))
                return;
            }
            log.info(`Background: taskkill has run successfully.`)
            let writeData = {
                "command":"sendToRenderer",
                "channel": "connection",
                "status": {
                    "connected": false
                }
            }
            client.write(JSON.stringify(writeData), () => {
                if (quit) {
                    log.info(`Background: Sending command to quit unrestrict.me`)
                    let writeData = {
                        "command":"execute",
                        "methods": [
                            "tray.destroy()",
                            "app.quit()"
                        ]
                    }
                    setTimeout(() => {
                        //Give main js time to deal with buffer
                        client.write(JSON.stringify(writeData))
                    }, 200)
                    
                }
            })
        })
    } else if (os.platform() === "linux" || os.platform() === "darwin") {
        let execCmd = "pkill openvpn && pkill wstunnel"
        exec(execCmd, (error, stdout, stderr) => {
            //https://www.freebsd.org/cgi/man.cgi?query=pkill&sektion=1
            if (error && error.code != 1) {
                log.info(error, stdout, stderr)
                let writeData = {
                    "command":"sendToRenderer",
                    "channel": "error",
                    "status": {
                        "disconnectError": true
                    },
                    "showWindow": true
                }
                client.write(JSON.stringify(writeData))
                return;
            }
            log.info(`Background: pkill has run successfully.`)
            let writeData = {
                "command":"sendToRenderer",
                "channel": "connection",
                "status": {
                    "connected": false
                }
            }
            client.write(JSON.stringify(writeData), () => {
                if (quit) {
                    log.info(`Background: Sending command to quit unrestrict.me`)
                    let writeData = {
                        "command":"execute",
                        "methods": [
                            "tray.destroy()",
                            "app.quit()"
                        ]
                    }
                    setTimeout(() => {
                        //Give main js time to deal with buffer
                        client.write(JSON.stringify(writeData))
                    }, 200)
                    
                }
            })
    
        })
    }

}

function killSwitchEnable(nic) {
    let command
    if (os.platform() === "linux") {
        command = `ip link set "${nic}" down`
    } if (os.platform() === "win32") {
        command = `netsh interface set interface "${nic}" admin=disable`
    } else {
        command = `ifconfig ${nic} down`
    }
    exec(`${command}`, (error, stderr, stdout) => {
        if (error) {
            log.info(`Main: Couldn't disable network adapter. Error: ${error}`)
            let writeData = {
                "command":"sendToRenderer",
                "channel": "killSwitch",
                "status": {
                    "error": "enable"
                },
                "showWindow": true
            }
            client.write(JSON.stringify(writeData))
            return;
        }
        let writeData = {
            "command":"sendToRenderer",
            "channel": "killSwitch",
            "status": {
                "enabled": true
            }
        }
        client.write(JSON.stringify(writeData))
        log.info(`Main: Kill switch enabled.`)
    })
}

function killSwitchDisable(nic) {
    var command
    if (os.platform() === "linux") {
        command = `ip link set "${nic}" up`
    } if (os.platform() === "win32") {
        command = `netsh interface set interface "${nic}" admin=enable`
    } else {
        command = `ifconfig ${nic} up`
    }
    exec(`${command}`, (error, stderr, stdout) => {
        if (error) {
            log.info(`Main: Couldn't enable network adapter. Error: ${error}`)
            let writeData = {
                "command":"sendToRenderer",
                "channel": "killSwitch",
                "status": {
                    "error": "disable"
                },
                "showWindow": true
            }
            client.write(JSON.stringify(writeData))
            return;
        }
        let writeData = {
            "command":"sendToRenderer",
            "channel": "killSwitch",
            "status": {
                "enabled": false
            }
        }
        client.write(JSON.stringify(writeData))
        log.info(`Main: Kill switch disabled.`)
    })
}

function IPv6Management(disable, nic) {
    if (disable && os.platform() === "linux") {
        exec(`sysctl -w net.ipv6.conf.all.disable_ipv6=1`, (error, stdout, stderr) => {
            log.info(error, stdout, stderr)
        })
    } else if (disable && os.platform() === "darwin"){
        //Converts nic to 'network service'.
        exec(`networksetup -setv6off $(networksetup -listallhardwareports | awk '/${nic}/{print previous_line}{previous_line=$0}' | sed 's/[^,:]*://g' | sed -e 's/^[[:space:]]*//')`, (error, stdout, stderr) => {
            log.info(error, stdout, stderr)
        })
    } else if (!disable && os.platform() === "linux") {
        exec(`sysctl -w net.ipv6.conf.all.disable_ipv6=0`, (error, stdout, stderr) => {
            log.info(error, stdout, stderr)
        })
    } else if (!disable && os.platform() === "darwin") {
        exec(`networksetup -setv6automatic $(networksetup -listallhardwareports | awk '/${nic}/{print previous_line}{previous_line=$0}' | sed 's/[^,:]*://g' | sed -e 's/^[[:space:]]*//')`, (error, stdout, stderr) => {
            log.info(error, stdout, stderr)
        })
    }
}

function stealthFunction(wstunnelPath, wstunnelDomain, ovpnConfig, ovpnPath, scriptPath) {
    let wstunnelExe
    if (os.platform() === "linux") {
        fs.copyFile(`${wstunnelPath}`, path.join('/bin/', "wstunnel"), (error) => {
            if (error) {
                log.info(`Main: An error occurred copying the wstunnel executable to the userData folder. Error: ${error}`)
            }
        })
        exec(`/bin/chmod u+x '${path.join('/bin/', "wstunnel")}' && /bin/chmod 755 ${path.join('/bin/', "wstunnel")}`, (error) => {
            if (error) {
                log.info(`Error setting wstunnel to be executable. Error: ${error}`)
            }
        })
        wstunnelExe = "/bin/wstunnel"
    } else {
        exec(`/bin/chmod u+x '${wstunnelPath}' && /bin/chmod 755 '${wstunnelPath}'`, (error) => {
            if (error) {
                log.info(`Error setting wstunnel to be executable. Error: ${error}`)
            }
        })
        wstunnelExe = wstunnelPath
    }

    exec(`'${wstunnelExe}' -u --udpTimeoutSec=-1 -v -L 127.0.0.1:1194:127.0.0.1:1194 wss://${wstunnelDomain}`, (error, stdout, stderr) => {
        if (error) {
            log.info(`Error!`)
            log.info(error)
            log.info(stdout)
            log.info(stderr)
        }
        log.info(stdout)
        log.info(stderr)
    })
    ovpnFunction(ovpnConfig, ovpnPath, scriptPath)
}

function runTapInstaller () {
    exec(`"${path.join(__dirname, `assets`, `openvpn`, `tap-${os.arch()}`, `tapinstall.exe`)}" install "${path.join(__dirname, `assets`, `openvpn`, `tap-${os.arch()}`, `OemVista.inf`)}" tap0901`, (error, stdout, stderr) => {
        if (error) {
            log.info(`Could not install the TAP driver. Error: ${error}`)
            //Alert renderer.
            let writeData = {
                "command":"sendToRenderer",
                "window":"welcomeWindow",
                "channel": "killSwitch",
                "status": {
                    "error":"TAPInstallationFailure",
                    "errorText":`Error: ${error}`
                },
            }
            client.write(JSON.stringify(writeData))

        } else if (String(stdout).includes(`Drivers installed successfully.`)) {
            //The driver been installed successfully.
            let writeData = {
                "command":"execute",
                "methods": [
                    "createSettingsFile()"
                ]
            }
            client.write(JSON.stringify(writeData))
        } else {
            //Something went wrong with the installation.
            let writeData = {
                "command":"sendToRenderer",
                "window":"welcomeWindow",
                "channel": "killSwitch",
                "status": {
                    "error":"TAPInstallationFailure",
                    "errorText":`Stdout: ${stdout}, Stderr: ${stderr}`
                },
            }
            client.write(JSON.stringify(writeData))
        }
    })
}