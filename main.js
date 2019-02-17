//unrestrict.me Desktop Application.
//Dependencies
const {app, BrowserWindow, ipcMain, Menu, Tray, dialog, clipboard} = require("electron")
const path = require("path")
module.paths.push(path.resolve('node_modules'));
module.paths.push(path.resolve('../node_modules'));
module.paths.push(path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'app', 'node_modules'));
module.paths.push(path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'app.asar', 'node_modules'));
const url = require("url")
const fs = require("fs")
const log = require("electron-log")
const os = require("os")
const isElevated = require("is-elevated")
const exec = require('child_process').exec
const request = require("request")
const nodersa = require('node-rsa')
const network = require("network")
const getos = require("getos")
const sudo = require('sudo-prompt');
const appLock = app.requestSingleInstanceLock()

if (!appLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.focus()
        }
    })
}

//Definition of global variables
let loadErrors = {}, loadingWindow, errorWindow, welcomeWindow, mainWindow, tray, killSwitchStatus, intentionalDisconnect

function setLogValues() {
    //This has to be done in a function because if the file does not exist the application will terminate with an exception.
    log.transports.file.level = 'info';
    log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
    log.transports.file.maxSize = 5 * 1024 * 1024;
    log.transports.file.streamConfig = { flags: 'w' };
}

app.on('ready', () => {
    setLogValues()
    appStart()
/*     fs.writeFile(path.join(__dirname, "log.txt"), "", (error) => {
        if (error){
            console.log(dialog.showMessageBox({type: "error", buttons: ["Ok"], defaultId: 0, title: "Application Initialisation Error", message: `We couldn't write to your log.txt file, which will prevent the application from running. Check permissions. Error: ${error}`}))
            app.quit()
            return
        } else {
            setLogValues()
            appStart()
        }
    }) */
})


// Quit when all windows are closed.
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow()
    }
})

function appStart() {
    createLoadingWindow()
    isElevated().then(elevated => {
        if (!elevated) {
            log.error("Main: Application not run with elevated privileges. OpenVPN will not be able to change routing table.")
            createErrorWindow(`elevation`)
        } else {
            log.info("Main: Application is elevated.")
            checkSettings()
        }
    })
}

function checkSettings() {
    fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
        if (String(error).includes('ENOENT')) {
            log.error("Main: settings.conf does not exist! Assuming new installation.")
            //Go straight to new install wizard. Skip other checks as they rely on the settings.conf file.
            createWelcomeWindow()
        } else if (error) {
            log.error(`Main: Unknown error reading settings.conf. Error: ${error}`)
            createErrorWindow('settings')
        } else {
            try {
                JSON.parse(data)
                log.info("Main: settings.conf found!")
                checkForApi()
            } catch (e) {
                //We found a file but couldn't parse it.
                createErrorWindow('parse')
            }
        }
    })
}

function checkForApi() {
    //This simply pings the API server to make sure it lives.
    let requestConfig, settingsFile
    log.info(`Main: Checking for API.`)
    fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
        settingsFile = JSON.parse(data)
        if (settingsFile["customAPI"]) {
            log.info(`Main: Using custom API.`)
            requestConfig = {
                url: `${settingsFile["customAPI"]}/client/ping`,
                timeout: 5000,
                method: "GET"
            } 
        } else {
            log.info(`Main: Using normal API.`)
            requestConfig = {
                url: `https://api.unrestrict.me/client/ping`,
                timeout: 5000,
                method: "GET"
            }
        }
        request(requestConfig, (error, response, body) => {
            if (error) {
                log.error(`Main: Error checking API. Error: ${error}`)
                let sendError = {
                    "type": "apiError",
                    "error": error
                }
                createErrorWindow(`api`, sendError)
            } else if (body === "Pong!") {
                log.info(`Main: API responds to ping.`)
                checkKeys()
            } else {
                log.error(`Main: API responded to ping, but with a different response than expected. Response received: ${body}`)
                let sendError = {
                    "type": "apiError",
                    "error": `We received a response from the API server, but it was different than expected. The server may be down. Response: ${body}`
                }
                createErrorWindow(`api`, sendError)
            }
        })
    })
}

function checkKeys() {
    log.info(`Main: Checking for public/private keys`)
    fs.readFile(path.join(__dirname, 'keys/public'), (error, data) => {
        if (error) {
            log.error(`Main: Error reading public key. Will now begin key generation. Error: ${error}`)
            createKeys()
        } else {
            fs.readFile(path.join(__dirname, 'keys/private'), (error, data) => {
                if (error) {
                    log.error(`Main: Error reading private key. Will now begin key generation. Error: ${error}`)
                    createKeys()
                } else {
                    log.info(`Main: Our install passed preflight checks!`)
                    createMainWindow()
                }
            }) 
        }
    })
}

function createKeys() {
    log.info(`Main: Generating a new RSA keypair.`)
    let key = new nodersa()
    key.generateKeyPair()
    let publicKey = key.exportKey('public')
    let privateKey = key.exportKey('private')
    fs.unlink(path.join(__dirname, 'keys/public'), (error) => {
        if (error) {
            //File will simply be created if it does not exist
            log.error(`Main: Error occurred deleting public key. It might not exist, which is fine. Error: ${error}`)
        }
        fs.writeFile(path.join(__dirname, 'keys/public'), publicKey, (error) => {
            if (error) {
                createErrorWindow('key')
                return
            }
        })
        fs.unlink(path.join(__dirname, 'keys/private'), (error) => {
            if (error) {
                log.error(`Main: Error occurred deleting private key. It might not exist, which is fine. Error: ${error}`)
            }
            fs.writeFile(path.join(__dirname, 'keys/private'), privateKey, (error) => {
                if (error) {
                    createErrorWindow('key')
                    return
                } else {
                    createMainWindow()
                }
            })
        })
    })
}

function evaluateErrors() {
    if (Object.keys(loadErrors).length === 0) {
        log.info(`Main: Normal install. Ready to continue.`)
        createMainWindow()
    } else {
        log.info(`Main: Abnormal installation.`)
        log.info(`Main: ${JSON.stringify(loadErrors)}`)
        if (loadErrors["elevated"] === false) {
            log.info(`Main: Process wasn't elevated!`)
            createErrorWindow(`elevation`)
        } else if (loadErrors["update"] === 'error') {
            log.info(`Main: Error checking for update.`)
            createErrorWindow(`update`)
        } else if (loadErrors["publicKey"] === 0|| loadErrors["privateKey"] === 0) {
            createErrorWindow('key')
        } else if (loadErrors["settings"]) {
            if (loadErrors["settings"]=== 'new_install') {
                //New installation
                createWelcomeWindow()
            } else if (loadErrors["settings"] === 'parse') {
                //Unknown error, alert user
                createErrorWindow('parse')
            } else {
                //Unknown error, alert user
                createErrorWindow('settings')
            }
        }
    }
}

function createLoadingWindow() {
    loadingWindow = new BrowserWindow({show: false, frame: false, width: 300, height: 300, icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 'minWidth': 300, 'minHeight': 300, transparent: false, title: "unrestrict.me Client", resizable: false})
    loadingWindow.setMenu(null)
    loadingWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/loading/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    loadingWindow.webContents.on('did-finish-load', () => {
        loadingWindow.show()
    })
    //loadingWindow.webContents.openDevTools({mode: "undocked"})
    loadingWindow.setAlwaysOnTop(true)
}

function createErrorWindow(error, sendError) {
    errorWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 420, icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 'minWidth': 600, 'minHeight': 420, transparent: false, title: "unrestrict.me Client", resizable: false})
    errorWindow.setMenu(null)
    errorWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/error/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    errorWindow.webContents.on('did-finish-load', () => {
        errorWindow.show()
        errorWindow.webContents.send('error', error)
        if (sendError) {
            if (sendError["type"] === "apiError") {
                try {
                    errorWindow.webContents.send('apiError', sendError["error"])
                } catch(e) {
                    log.error(`Main: Couldn't send update error to renderer. Error: ${e}`)
                }
            }
        }
    })
    //errorWindow.webContents.openDevTools({mode: "undocked"})
    errorWindow.setAlwaysOnTop(false)
    if (loadingWindow) {
        loadingWindow.close()
        loadingWindow = null
    }
}

function createWelcomeWindow() {
    welcomeWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 420, icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 'minWidth': 600, 'minHeight': 420, transparent: false, title: "unrestrict.me Client", resizable: false})
    welcomeWindow.setMenu(null)
    welcomeWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/welcome/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    welcomeWindow.webContents.on('did-finish-load', () => {
        welcomeWindow.show()
    })
    //welcomeWindow.webContents.openDevTools({mode: "undocked"})
    welcomeWindow.setAlwaysOnTop(false)
    if (loadingWindow) {
        loadingWindow.close()
        loadingWindow = null
    }
}

function createMainWindow() {
    mainWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 420, icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 'minWidth': 600, 'minHeight': 420, transparent: false, title: "unrestrict.me Client", resizable: false})
    mainWindow.setMenu(null)
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/main/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.show()
    })
    //mainWindow.webContents.openDevTools({mode: "undocked"})
    mainWindow.setAlwaysOnTop(false)
    mainWindow.on('minimize',function(event){
        event.preventDefault();
        mainWindow.hide();
    });
    
    mainWindow.on('close', function (event) {
        if(!app.isQuiting){
            event.preventDefault();
            mainWindow.hide();
        }
    
        return false;
    });
    
    tray = new Tray(path.join(__dirname, "assets", "icons", "win.ico"))
    let contextMenu = Menu.buildFromTemplate([
        {
            label: "Show unrestrict.me", click: () => {
                mainWindow.show()
            }
        },
        {
            label: "Copy IP to Clipboard", click: () => {
                fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
                    if (error) {
                        log.error(`Renderer: Error reading settings file. Error: ${error}`)
                        mainWindow.webContents.send("trayError", "")
                        return;
                    }
                    let requestConfig
                    settingsFile = JSON.parse(data)
                    if (settingsFile["customAPI"]) {
                        log.info(`Renderer: Using custom API.`)
                        requestConfig = {
                            url: `${settingsFile["customAPI"]}/client/ip`,
                            timeout: 5000,
                            method: "GET"
                        } 
                    } else {
                        log.info(`Renderer: Using normal API.`)
                        requestConfig = {
                            url: `https://api.unrestrict.me/client/ip`,
                            timeout: 5000,
                            method: "GET"
                        }
                    }
                    request(requestConfig, (error, response, body) => {
                        if (error) {
                            log.error(`Renderer: Error getting public IP. Error: ${error}`)
                        } else {
                            if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(body) || body === "::ffff:127.0.0.1") {
                                clipboard.writeText(body)
                                log.info(`Renderer: IP address copied to clipboard.`)
                            } else {
                                mainWindow.show()
                                mainWindow.webContents.send("trayError", "")
                                log.error(`Renderer: Failed to get IP address for clipboard.`)
                            }
                        }
                    })
                })
            }
        },
        {
            label: "Quit", click: () => {
                app.isQuiting = true
                quit()
            }
        }
    ])
    tray.setContextMenu(contextMenu)
    tray.setToolTip('Show unrestrict.me')
    tray.on('click', () => {
        mainWindow.show()
    })
    if (loadingWindow) {
        loadingWindow.close()
        loadingWindow = null
    }
    if (welcomeWindow) {
        welcomeWindow.close()
        welcomeWindow = null
    }
}

//Handles application updates
function update(version) {
    let settingsFile, requestConfig
    fs.unlink(path.join(__dirname, 'update.exe'), (error) => {
        if (error) {
            log.error(`Main: Error deleting past update file. This is probably fine because it doesn't exist. Should write over anyway. Error: ${error}`)
        }
    })
    fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
        if (error) {
            log.error(`Main: Error reading config file whilst attempting to update. Error: ${error}`)
            createErrorWindow("settings")
            return;
        }
        settingsFile = JSON.parse(data)
        if (settingsFile["customAPI"]) {
            log.info(`Main: Using custom API.`)
            requestConfig = {
                url: `${settingsFile["customAPI"]}/client/builds/${version}/${os.platform()}/${os.arch()}.exe`,
                timeout: 5000,
                method: "GET"
            } 
        } else {
            log.info(`Main: Using normal API.`)
            requestConfig = {
                url: `https://api.unrestrict.me/client/builds/${version}/${os.platform()}/${os.arch()}.exe`,
                timeout: 5000,
                method: "GET"
            }
        }
        progress(request(requestConfig), {
            throttle: 100
        })
        .on('progress', function (state) {
            log.info(`${state.percent}`)
            let send = {
                percent: state.percent,
                speed: state.speed,
                remaining: state.time.remaining
            }
            if (loadingWindow) {
                loadingWindow.webContents.send('update', send)
            }
        })
        .on('error', function (error) {
            if (error) {
                log.error(`Main: An error occurred downloading the update. Error: ${error}`)
            }
        })
        .on('end', function () {
            // Run update file
            exec(`${path.join(__dirname, "update.exe")}`, (error, stdout, stderr) => {
                if (error) {
                    log.error(`Main: Could not run update package. Error window will be opened. Error: ${error}`)
                    createErrorWindow("updateRun")
                } else {
                    app.quit()
                }
            })
        })
        .pipe(fs.createWriteStream('update.exe'));
    })
}

function quit() {
    tray.destroy()
    log.info(`Main: We're about to kill OpenVPN`)
    intentionalDisconnect = true
    exec(`taskkill /IM openvpn.exe /F`, (error, stdout, stderr) => {
        if (error) {
            let status = {
                "disconnectError": true
            }
            try {
                mainWindow.webContents.send('error', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
            app.quit()
            return
        }
        let status = {
            "connected": false
        }
        try {
            mainWindow.webContents.send('connection', status)
        } catch(e) {
            log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
        }
        log.info(`Main: OpenVPN was killed`)
        app.quit()
    }) 
}

function openTapInstaller () {
    exec(`"${path.join(__dirname, 'assets', 'openvpn', 'tap-windows.exe')}"`, (error, stdout, stderr) => {
        if (error) {
            log.error(`Main: Could not run TAP installer. Error: ${error}`)
        } else {
            log.info("Main: TAP installation complete.")
        }
    })
}

exports.dependenciesCheck = (verifyTap) => {
    if (os.platform() === "win32") {
        exec(`"${path.join(__dirname, 'assets', 'openvpn', `${os.arch()}`, 'openvpn.exe')}" --show-adapters`, (error, stdout, stderr) => {
            if (error) {
                log.error(`Main: Could not verify TAP installation. Error: ${error}`)
                let ipcUpdate = {
                    "error": "TAPVerifyInstall",
                    "errorText": error
                }
                welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
            } else if ((stdout.replace('Available TAP-WIN32 adapters [name, GUID]:', '')).replace(/\s/g, '') === "") {
                if (verifyTap) {
                    log.error(`Main: TAP installation was a failure. Alert the user.`)
                    let ipcUpdate = {
                        "error": "TAPInstallationFailure"
                    }
                    welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                } else {
                    log.error(`Main: There is no TAP adapter on the system. Log: ${stdout}`)
                    openTapInstaller()
                    let ipcUpdate = {
                        "update":"installingTAPAdapter"
                    }
                    welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                }
            } else {
                log.info(`Main: ${stdout}`)
                let settings = {}
                fs.writeFile(path.join(__dirname, 'settings.conf'), JSON.stringify(settings), (error) => {
                    if (error) {
                        log.error(`Main: Error occurred writing settings file. Permissions error perhaps? Error: ${error}`)
                        let ipcUpdate = {
                            "error":"writingSettingsFile",
                            "errorText": error
                        }
                        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                    } else {
                        log.info(`Main: Settings file created!`)
                        app.relaunch()
                        app.quit()
                    }
                })
            }
        })
    } else if (os.platform() === "linux") {
        exec(`openvpn`, (error, stdout, stderr) => {
            if (error) {
                if (String(error).includes("openvpn: not found")) {
                    //OpenVPN not installed. Get from package repository.
                    log.info(`Main: Installing OpenVPN from package repository.`)
                    getos((error, os) => {
                        if (error) {
                            log.error(`Main: Error checking operating system environment. Error: ${error}`)
                            let ipcUpdate = {
                                "error": "operatingSystemCheck"
                            }
                            welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                            return;
                        }
                        if (String(os["dist"]).includes("Ubuntu") || String(os["dist"]).includes("Debian")) {
                            log.info(`Main: Will install OpenVPN for Debian/Ubuntu.`)
                            let options = {
                                name: "unrestrict.me"
                            }
                            sudo.exec(`apt -y install openvpn`, options, (error, stdout, stderr) => {
                                let ipcUpdate = {
                                    "status": "installingOpenVPN"
                                }
                                mainWindow.webContents.send(`statusUpdate`, ipcUpdate)
                                if (error) {
                                    //Couldn't run the install command.
                                    log.error(`Main: Failed to run command to install OpenVPN. Error: ${error}`)
                                    let ipcUpdate = {
                                        "error": "sudoFail"
                                    }
                                    welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                                }
                                if (stdout.includes("E:")) {
                                    //An error occurred installing OpenVPN
                                    log.error(`Main: Failed to install OpenVPN. Stdout: ${stdout}`)
                                    let ipcUpdate = {
                                        "error": "OpenVPNInstallFail",
                                        "errorText": stdout
                                    }
                                    welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                                } else {
                                    let settings = {}
                                    fs.writeFile(path.join(__dirname, 'settings.conf'), JSON.stringify(settings), (error) => {
                                        if (error) {
                                            log.error(`Main: Error occurred writing settings file. Permissions error perhaps? Error: ${error}`)
                                            let ipcUpdate = {
                                                "error":"writingSettingsFile",
                                                "errorText": error
                                            }
                                            welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                                        } else {
                                            log.info(`Main: Settings file created!`)
                                            app.relaunch()
                                            app.quit()
                                        }
                                    }) 
                                }
                            })
                        }
                    })
                } else if (!stdout.includes('built on')) {
                    log.error(`Main: Couldn't detect whether OpenVPN is installed. Error: ${error}`)
                }

            }
            if (stdout.includes(`built on`)) {
                let settings = {}
                fs.writeFile(path.join(__dirname, 'settings.conf'), JSON.stringify(settings), (error) => {
                    if (error) {
                        log.error(`Main: Error occurred writing settings file. Permissions error perhaps? Error: ${error}`)
                        let ipcUpdate = {
                            "error":"writingSettingsFile",
                            "errorText": error
                        }
                        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                    } else {
                        log.info(`Main: Settings file created!`)
                        app.relaunch()
                        app.quit()
                    }
                })
            } else {

            }
        })
    } else {
        log.error(`Main: This is not a supported system. Time to exit.`)
        app.quit()
    }

}

exports.connect = (config) => {
    intentionalDisconnect = false
    log.info(`Main: Received command to connect OpenVPN with config: ${config}`)
    fs.writeFile(path.join(__dirname, "current.ovpn"), config, (error) => {
        if (error) {
            let status = {
                "writeError": true
            }
            try {
                mainWindow.webContents.send('error', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
            log.info(`Main: Couldn't write the current openvpn file to disk. Error: ${error}`)
            return
        }
        if (os.platform() === "win32") {
            log.info(`Main: Going to run: "${path.join(__dirname, "assets", "openvpn", `${os.arch()}`)}\\openvpn.exe" --config "${path.join(__dirname, "current.ovpn")}" --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
            let ovpnProc = exec(`"${path.join(__dirname, "assets", "openvpn", `${os.arch()}`)}\\openvpn.exe" --config "${path.join(__dirname, "current.ovpn")}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
            var datalog
            ovpnProc.stdout.on('data', (data) => {
                log.info(`OpenVPN: ${data}`)
                datalog = datalog + data 
                if (data.includes(`Initialization Sequence Completed`)) {
                    let initializeCount = (datalog.match(/Initialization Sequence Completed/g) || []).length;
                    if (initializeCount <= 1) {
                        //Send required information to main window.
                        var ipString = datalog.search("Notified TAP-Windows driver to set a DHCP IP/netmask of")
                        ipString = datalog.substring(ipString, ipString + 70)
                        var regexp = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/g
                        log.info(`Main: IP list: ${ipString.match(regexp)}`)
                        //Connected to unrestrictme
                        let status = {
                            "connected": true,
                            "ip": ipString.match(regexp)
                        }
                        try {
                            mainWindow.webContents.send('connection', status)
                        } catch(e) {
                            log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                        }
                    }
                }
                if (data.includes(`All TAP-Windows adapters on this system are currently in use.`)) {
                    //Couldn't connect, some other VPN (maybe us) is already connected
                    let status = {
                        "tapError": true
                    }
                    try {
                        mainWindow.webContents.send('error', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                    }
                }
                if (data.includes('Closing TUN/TAP interface')) {
                    //OpenVPN has disconnected on its own. Activate kill switch.
                    log.info(`Main: OpenVPN has disconnected on its own. Enabling kill switch.`)
                    killSwitchStatus = true
                }
                if (data.includes('SIGTERM[soft,tls-error] received, process exiting')) {
                    //OpenVPN failed to connect, check if had already connected.
                    if (!datalog.includes(`Initialization Sequence Completed`)) {
                        log.info(`Main: OpenVPN failed to connect.`)
                        intentionalDisconnect = true
                        let status = {
                            "connectError": true
                        }
                        try {
                            mainWindow.webContents.send('error', status)
                        } catch(e) {
                            log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                        }
                    }
                }
                if (data.includes(`Inactivity timeout (--ping-restart), restarting`)) {
                    //Something has caused the VPN to restart. Alert the user that there are issues.
                    let error = {
                        "inactivityTimeout": true
                    }
                    mainWindow.webContents.send("error", error)
                }
            })
            ovpnProc.on('close', (data) => {
                //OpenVPN has closed!
                try {
                    if (killSwitchStatus || !intentionalDisconnect) {
                        log.info(`Main: Activating failsafe.`)
                        killSwitch(true)
                    }
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
                fs.unlink(path.join(__dirname, "current.ovpn"), (error) => {
                    if (error) {
                        log.error(`Main: Error deleting previous config file. This shouldn't matter as it will be overwritten.`)
                    }
                })
            })
        } else {
            //This needs to be expanded to support other OSs.
        }
    }) 
}

exports.disconnect = (preconnect) => {
    intentionalDisconnect = true
    log.info(`Main: We're about to kill OpenVPN. If OpenVPN is not running, you will see no confirmation it wasn't killed.`)
    exec(`taskkill /F /IM openvpn.exe`, (error, stdout, stderr) => {
        if (error) {
            log.error(`Main: Error killing OpenVPN. Error: ${error}`)
            let status = {
                "disconnectError": true
            }
            try {
                mainWindow.webContents.send('error', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
            return
        }
        if (preconnect) {
            let status = {
                "connectionCancelled": true
            }
            try {
                mainWindow.webContents.send('connection', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
        } else {
            let status = {
                "connected": false
            }
            try {
                mainWindow.webContents.send('connection', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
        }

        log.info(`Main: OpenVPN was killed.`)
    })
}

exports.disableKillSwitch = () => {
    killSwitch(false)
}

exports.clearSettings = () => {
    log.info(`Main: Clearing settings file and restarting application.`)
    let settings = {}
    fs.writeFile(path.join(__dirname, 'settings.conf'), JSON.stringify(settings), (error) => {
        if (error) {
            log.error(`Main: Error occurred writing settings file. Permissions error perhaps?`)
            let error = {
                "writeError": true
            }
            errorWindow.webContents.send("settingsClear", error)
        } else {
            log.info(`Main: Settings file recreated!`)
            app.relaunch()
            app.quit()
        }
    })
}

function killSwitch(enable) {
    if (enable) {
        fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
            if (error) {
                log.error(`Main: Couldn't read settings file to enter kill switch NIC. Will not proceed. Error: ${error}`)
                let status = {
                    "error": "enable"
                }
                try {
                    mainWindow.webContents.send('killSwitch', status)
                } catch(e) {
                    log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                }
                return;
            }
            let settings = JSON.parse(data)
            if (!settings["selectedNic"] ||settings["selectedNic"] == -1) {
                //Automatically determine nic.
                killSwitchEnable("auto")
            } else {
                //Use preset nic.
                killSwitchEnable(settings["selectedNic"])
            }

        })
    } else {
        fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
            if (error) {
                log.error(`Main: Couldn't read settings file to retrieve kill switch NIC. Will not proceed. Error: ${error}`)
                return;
            }
            let settings = JSON.parse(data)
            exec(`netsh interface set interface "${settings["nic"]}" admin=enable`, (error, stderr, stdout) => {
                if (error) {
                    log.error(`Main: Couldn't enable network adapter. Error: ${error}`)
                    let status = {
                        "error": "disable"
                    }
                    try {
                        mainWindow.webContents.send('killSwitch', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                    }
                    return;
                }
                let status = {
                    "enabled": false
                }
                try {
                    mainWindow.webContents.send('killSwitch', status)
                } catch(e) {
                    log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                }
                log.info(`Main: Kill switch disabled.`)
            })
        })
    }
}

function killSwitchEnable(nic) {
    if (os.platform() === "win32") {
        log.info(`Main: Enabling Kill Switch for ${os.platform()}.`)
        //This refers to the function nic, stupid.
        if (nic === "auto") {
            log.info(`Main: We will automatically determine the interface to disable.`)
            network.get_interfaces_list(function(error, obj) {
                let autoInterface = obj.find(function(element) {
                    if (element["gateway_ip"] != null) {
                        return element
                    }
                })
                fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
                    if (error) {
                        log.error(`Main: Couldn't read settings file to enter kill switch NIC. Will not proceed. Error: ${error}`)
                        let status = {
                            "error": "enable"
                        }
                        try {
                            mainWindow.webContents.send('killSwitch', status)
                        } catch(e) {
                            log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                        }
                        return;
                    }
                    let settings = JSON.parse(data)
                    settings["nic"] = autoInterface["name"]
                    fs.writeFile(path.join(__dirname, 'settings.conf'), JSON.stringify(settings), (error) => {
                        if (error) {
                            log.error(`Main: Couldn't write settings file to enter kill switch NIC. Will not proceed. Error: ${error}`)
                            let status = {
                                "error": "enable"
                            }
                            try {
                                mainWindow.webContents.send('killSwitch', status)
                            } catch(e) {
                                log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                            }
                            return;
                        }
                        exec(`netsh interface set interface "${autoInterface["name"]}" admin=disable`, (error, stderr, stdout) => {
                            if (error) {
                                log.error(`Main: Couldn't disable network adapter. Error: ${error}`)
                                let status = {
                                    "error": "enable"
                                }
                                try {
                                    mainWindow.webContents.send('killSwitch', status)
                                } catch(e) {
                                    log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                                }
                                return;
                            }
                            let status = {
                                "enabled": true
                            }
                            try {
                                mainWindow.webContents.send('killSwitch', status)
                            } catch(e) {
                                log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                            }
                            log.info(`Main: Kill switch enabled.`)
                        })
                    })
                })
            })
        } else {
            log.info(`Main: We will disable the user defined NIC.`)
            network.get_interfaces_list(function(error, obj) {
                if (error) {
                    log.error(`Main: Couldn't get the list of network interfaces. Error: ${error}`)
                    let status = {
                        "error": "enable"
                    }
                    try {
                        mainWindow.webContents.send('killSwitch', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                    }
                    return;
                }
                let nicNo = parseInt(nic)
                let nicCmd = obj[parseInt(nic)]["name"]
                exec(`netsh interface set interface "${nicCmd}" admin=disable`, (error, stderr, stdout) => {
                    if (error) {
                        log.error(`Main: Couldn't disable network adapter. Error: ${error}`)
                        let status = {
                            "error": "enable"
                        }
                        try {
                            mainWindow.webContents.send('killSwitch', status)
                        } catch(e) {
                            log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                        }
                        return;
                    }
                    let status = {
                        "enabled": true
                    }
                    try {
                        mainWindow.webContents.send('killSwitch', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send kill switch status to renderer. Error: ${e}`)
                    }
                    log.info(`Main: Kill switch enabled.`)
                })
            })
        }
    }
}