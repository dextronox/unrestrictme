//This is the unrestrict.me background node service.
//This file handles anything that requires elevation.
const net = require("net")
const fs = require(`fs`)
const path = require("path")
const os = require("os")
const {exec} = require('child_process')

let killSwitchStatus, intentionalDisconnect
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
    console.log(JSON.stringify(dataInterpreted))
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
        stealthFunction(dataInterpreted["stunnelPath"]["config"], dataInterpreted["stunnelPath"]["pem"], dataInterpreted["configPath"])
    }
}

function ovpnFunction(configPath, ovpnPath, scriptPath) {
    exec(`chmod +x "${scriptPath}"`, (error, stdout, stderr) => {
        if (error) {
            console.log(`Couldn't set the permission of the DNS updater script. Error: ${error}`)
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
}

function startOvpn(configPath, ovpnPath, scriptPath) {
    intentionalDisconnect = false
    killSwitchStatus = false
    let ovpnProc
    if (os.platform() === "linux") {
        ovpnProc = exec(`openvpn --config "${configPath}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
    } else {
        ovpnProc = exec(`${ovpnPath} --config "${configPath}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15 --script-security 2 --up ${scriptPath} --down ${scriptPath}`)        
    }
    var datalog
    ovpnProc.stdout.on('data', (data) => {
        console.log(data)
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
function disconnectFromVPN(quit) {
    intentionalDisconnect = true
    exec(`pkill openvpn && pkill stunnel4`, (error, stdout, stderr) => {
        //https://www.freebsd.org/cgi/man.cgi?query=pkill&sektion=1
        if (error && error.code != 1) {
            console.log(error, stdout, stderr)
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
        client.write(JSON.stringify(writeData), () => {
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

function stealthFunction(stunnelConfig, stunnelPem, openvpnConfig) {
    let stunnelProc = exec(`stunnel4 "${stunnelConfig}" -p "${stunnelPem}"`)
    ovpnFunction(openvpnConfig)
}