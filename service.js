//This is the unrestrict.me background node service.
//This file handles anything that requires elevation.
const net = require("net")
const fs = require(`fs`)
const path = require("path")
const os = require("os")
const {exec} = require('child_process')

let killSwitchStatus, intentionalDisconnect
function setLogValues() {
    //We need a new way of logging, because this script runs as root (i.e. different user environment)
}
setLogValues()
const client = net.createConnection({ port: 4964 }, () => {
    //Runs once connected to the server.
    console.log(`Background: Connected to client server. Ready to receive instructions.`)
    testMessage()
});
client.on('data', (data) => {
    //We have received some data from the server.
    //data should always be JSON in buffer format
    console.log(`Background: Data received.`)
    foregroundProcessDataHandler(data.toString())
});
client.on('end', () => {
    //Connection has been ended. Kill this process.
    process.exit()
});
client.on('error', (error) => {
    console.log(`Background: An error occurred. Error: ${error}`)
})

function testMessage() {
    let writeData = {
        "command":"testMessage"
    }
    client.write(JSON.stringify(writeData))
}
function foregroundProcessDataHandler(data) {
    let dataInterpreted = JSON.parse(data)
    if (dataInterpreted["command"] === "connectToOpenVPN") {
        ovpnFunction(dataInterpreted["configPath"])
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
}

function ovpnFunction(configPath) {
    if (os.platform() === "linux") {
        intentionalDisconnect = false
        killSwitchStatus = false
        let ovpnProc = exec(`openvpn --config "${configPath}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
        var datalog
        ovpnProc.stdout.on('data', (data) => {
            console.log(data)
            datalog = datalog + data 
            if (data.includes(`Initialization Sequence Completed`)) {
                killSwitchStatus = false
                let initializeCount = (datalog.match(/Initialization Sequence Completed/g) || []).length;
                if (initializeCount <= 1) {
                    //Send required information to main window.
                    var ipString = datalog.search("Peer Connection Initiated with")
                    ipString = datalog.substring(ipString, ipString + 70)
                    var regexp = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/g
                    console.log(`Main: IP list: ${ipString.match(regexp)}`)
                    //Connected to unrestrictme
                    let writeData = {
                        "command":"sendToRenderer",
                        "channel": "connection",
                        "status": {
                            "connected": true,
                            "ip": ipString.match(regexp)
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
                    console.log(`Main: OpenVPN has disconnected on its own. Enabling kill switch.`)
                    killSwitchStatus = true
                }
            }
            if (data.includes('SIGTERM[soft,tls-error] received, process exiting') || data.includes('Exiting due to fatal error')) {
                //OpenVPN failed to connect, check if had already connected.
                if (!datalog.includes(`Initialization Sequence Completed`)) {
                    console.log(`Main: OpenVPN failed to connect.`)
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
                console.log(`Main: Activating failsafe.`)
                let writeData = {
                    "command":"execute",
                    "methods": [
                        "killSwitch(true)"
                    ]
                }
                client.write(JSON.stringify(writeData))
            }
        })
    }
}

function disconnectFromVPN(quit) {
    exec(`pgrep openvpn`, (error, stdout, stderr) => {
        if (error && !error.code === 1) {
            //Error occurred checking if OpenVPN is running.
            console.log(`Background: We couldn't check if OpenVPN is running. Error: ${error}. stdout: ${stdout}. stderr: ${stderr}`)
            let writeData = {
                "command":"sendToRenderer",
                "channel": "error",
                "status": {
                    "pgrep": true
                },
                "showWindow": true
            }
            client.write(JSON.stringify(writeData))
            return;
        }
        if (String(stdout) != "") {
            intentionalDisconnect = true
            exec(`pkill openvpn`, (error, stdout, stderr) => {
                if (error) {
                    console.log(`Background: An error occurred running pkill for OpenVPN.`)
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
                console.log(`Background: pkill has run successfully.`)
                let writeData = {
                    "command":"sendToRenderer",
                    "channel": "connection",
                    "status": {
                        "connected": false
                    }
                }
                client.write(JSON.stringify(writeData))
                if (quit) {
                    console.log(`Background: Sending command to quit unrestrict.me`)
                    let writeData = {
                        "command":"execute",
                        "methods": [
                            "tray.destroy()",
                            "app.quit()"
                        ]
                    }
                    client.write(JSON.stringify(writeData))
                }
            })
        } else {
            if (quit) {
                let writeData = {
                    "command":"execute",
                    "methods": [
                        "tray.destroy()",
                        "app.quit()"
                    ]
                }
                client.write(JSON.stringify(writeData))
            }
        }
    })
}

function killSwitchEnable(nic) {
    exec(`ifconfig "${nic}" down`, (error, stderr, stdout) => {
        if (error) {
            console.log(`Main: Couldn't disable network adapter. Error: ${error}`)
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
        console.log(`Main: Kill switch enabled.`)
    })
}

function killSwitchDisable(nic) {
    exec(`ifconfig "${nic}" up`, (error, stderr, stdout) => {
        if (error) {
            console.log(`Main: Couldn't enable network adapter. Error: ${error}`)
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
        console.log(`Main: Kill switch disabled.`)
    })
}