//unrestrict.me Desktop Application.
//Dependencies
const {app, BrowserWindow, ipcMain, Menu, Tray} = require("electron")
const path = require("path")
const url = require("url")
const fs = require("fs")
const log = require("electron-log")
const os = require("os")
const isElevated = require("is-elevated")
const exec = require('child_process').exec
const request = require("request")
const progress = require("request-progress")
const nodersa = require('node-rsa')
const network = require("network")

//Log
// Same as for console transport
log.transports.file.level = 'info';
log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
 
// Set approximate maximum log size in bytes. When it exceeds,
// the archived log will be saved as the log.old.log file
log.transports.file.maxSize = 5 * 1024 * 1024;
 
// Write to this file, must be set before first logging
log.transports.file.file = path.join(__dirname, 'log.txt');
 
// fs.createWriteStream options, must be set before first logging
// you can find more information at
// https://nodejs.org/api/fs.html#fs_fs_createwritestream_path_options
log.transports.file.streamConfig = { flags: 'w' };
 
// set existed file stream
log.transports.file.stream = fs.createWriteStream(path.join(__dirname, 'log.txt'));
//Log

//Definition of global variables
let loadErrors = {}, loadingWindow, errorWindow, welcomeWindow, mainWindow, tray, killSwitchStatus, intentionalDisconnect

app.on('ready', () => {
    appStart()
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
            loadErrors["elevated"] = false
            checkSettings()
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
            loadErrors["settings"] = 'new_install'
            //Go straight to new install wizard. Skip other checks as they rely on the settings.conf file.
            evaluateErrors()
        } else if (error) {
            log.error(`Main: Unknown error reading settings.conf. Error: ${error}`)
            loadErrors["settings"] = `${error}`
            evaluateErrors()
        } else {
            log.info("Main: settings.conf found!")
            checkForUpdates()
        }
    })
}

function checkForUpdates() {
    //This grabs the latest version number from the API
    let requestConfig, settingsFile
    log.info(`Main: Checking for updates.`)
    fs.readFile(path.join(__dirname, 'settings.conf'), 'utf8', (error, data) => {
        settingsFile = JSON.parse(data)
        if (settingsFile["customAPI"]) {
            log.info(`Main: Using custom API.`)
            requestConfig = {
                url: `${settingsFile["customAPI"]}/client/version`,
                timeout: 5000,
                method: "GET"
            } 
        } else {
            log.info(`Main: Using normal API.`)
            requestConfig = {
                url: `https://api.unrestrict.me/client/version`,
                timeout: 5000,
                method: "GET"
            }
        }
        request(requestConfig, (error, response, body) => {
            if (error) {
                log.error(`Main: Error checking for updates. Error: ${error}`)
                loadErrors["update"] = `error`
                checkKeys()
            } else if (parseFloat(body) <= parseFloat(app.getVersion())){
                log.info(`Main: Already on newest or newer version than publicly available.`)
                checkKeys()
            } else {
                log.info(`Main: New version available. New version: ${body}. Current version: ${app.getVersion()}`)
                update(body)
            }
        })
    })
}

function checkKeys() {
    log.info(`Main: Checking for public/private keys`)
    fs.readFile(path.join(__dirname, 'keys/public'), (error, data) => {
        if (error) {
            log.error(`Main: Error reading public key. Error: ${error}`)
            createKeys()
        } else {
            fs.readFile(path.join(__dirname, 'keys/private'), (error, data) => {
                if (error) {
                    log.error(`Main: Error reading private key. Error: ${error}`)
                    createKeys()
                } else {
                    evaluateErrors()
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
            log.error(`Main: Error occurred deleting public key. Error: ${error}`)
        }
        fs.writeFile(path.join(__dirname, 'keys/public'), publicKey, (error) => {
            if (error) {
                loadErrors["publicKey"] = 0
            }
        })
        fs.unlink(path.join(__dirname, 'keys/private'), (error) => {
            if (error) {
                log.error(`Main: Error occurred deleting private key. Error: ${error}`)
            }
            fs.writeFile(path.join(__dirname, 'keys/private'), privateKey, (error) => {
                if (error) {
                    loadErrors["privateKey"] = 0
                }
                evaluateErrors()
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
            } else {
                //Unknown error, alert user
                createErrorWindow('settings')
            }
        }
    }
}

function createLoadingWindow() {
    loadingWindow = new BrowserWindow({show: false, frame: false, width: 300, height: 300, icon: path.resolve(__dirname, 'assets', 'icons', 'win.ico'), 'minWidth': 300, 'minHeight': 300, transparent: false, title: "unrestrict.me Client", resizable: false})
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

function createErrorWindow(error) {
    errorWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 400, icon: path.resolve(__dirname, 'assets', 'icons', 'win.ico'), 'minWidth': 600, 'minHeight': 400, transparent: false, title: "unrestrict.me Client", resizable: false})
    errorWindow.setMenu(null)
    errorWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/error/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    errorWindow.webContents.on('did-finish-load', () => {
        errorWindow.show()
        errorWindow.webContents.send('error', error)
    })
    //errorWindow.webContents.openDevTools({mode: "undocked"})
    errorWindow.setAlwaysOnTop(false)
    if (loadingWindow) {
        loadingWindow.close()
        loadingWindow = null
    }
}

function createWelcomeWindow() {
    welcomeWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 400, icon: path.resolve(__dirname, 'assets', 'icons', 'win.ico'), 'minWidth': 600, 'minHeight': 400, transparent: false, title: "unrestrict.me Client", resizable: false})
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
    mainWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 400, icon: path.resolve(__dirname, 'assets', 'icons', 'win.ico'), 'minWidth': 600, 'minHeight': 400, transparent: false, title: "unrestrict.me Client", resizable: false})
    mainWindow.setMenu(null)
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/main/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.show()
    })
    mainWindow.webContents.openDevTools({mode: "undocked"})
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

exports.tap = () => {
    exec(`"${path.join(__dirname, 'assets', 'openvpn', 'tap-windows.exe')}"`, (error, stdout, stderr) => {
        if (error) {
            log.error(`Main: Could not run TAP installer. Error: ${error}`)
        } else {
            log.info("Main: TAP installation complete.")
        }
    })
}

exports.verify = () => {
    exec(`"${path.join(__dirname, 'assets', 'openvpn', `${os.arch()}`, 'openvpn.exe')}" --show-adapters`, (error, stdout, stderr) => {
        if (error) {
            log.error(`Main: Could not verify TAP installation. Error: ${error}`)
            let error = {
                "error": "tapVerify"
            }
            welcomeWindow.webContents.send("error", error)
        } else if ((stdout.replace('Available TAP-WIN32 adapters [name, GUID]:', '')).replace(/\s/g, '') === "") {
            log.error(`Main: Install was a failure! Log: ${stdout}`)
            let error = {
                "error": "tapInstall"
            }
            welcomeWindow.webContents.send("error", error)
        } else {
            log.info(`Main: ${stdout}`)
            let settings = {}
            fs.writeFile(path.join(__dirname, 'settings.conf'), JSON.stringify(settings), (error) => {
                if (error) {
                    log.error(`Main: Error occurred writing settings file. Permissions error perhaps?`)
                    let error = {
                        "error": "writeError"
                    }
                    welcomeWindow.webContents.send("error", error)
                } else {
                    log.info(`Main: Settings file created!`)
                    app.relaunch()
                    app.quit()
                }
            })
        }
    })
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
            log.info(`Main: Going to run: "${path.join(__dirname, "assets", "openvpn", `${os.arch()}`)}\\openvpn.exe" --config "${path.join(__dirname, "current.ovpn")}" --connect-retry-max 1 --tls-exit`)
            let ovpnProc = exec(`"${path.join(__dirname, "assets", "openvpn", `${os.arch()}`)}\\openvpn.exe" --config "${path.join(__dirname, "current.ovpn")}"  --connect-retry-max 1 --tls-exit`)
            ovpnProc.stdout.on('data', (data) => {
                log.info(`OpenVPN: ${data}`)
                if (data.includes(`Initialization Sequence Completed`)) {
                    //Connected to unrestrictme
                    let status = {
                        "connected": true
                    }
                    try {
                        mainWindow.webContents.send('connection', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
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
                    killSwitch(true)
                }
            })
            ovpnProc.on('close', (data) => {
                //OpenVPN has closed!
                let status = {
                    "connected": false
                }
                try {
                    if (!killSwitchStatus && !intentionalDisconnect) {
                        mainWindow.webContents.send('connection', status)
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

exports.disconnect = () => {
    intentionalDisconnect = true
    log.info(`Main: We're about to kill OpenVPN. If OpenVPN is not running, you will see no confirmation it wasn't killed.`)
    exec(`taskkill /IM openvpn.exe /F`, (error, stdout, stderr) => {
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
        let status = {
            "connected": false
        }
        try {
            mainWindow.webContents.send('connection', status)
        } catch(e) {
            log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
        }
        log.info(`Main: OpenVPN was killed`)
    })
}

exports.disableKillSwitch = () => {
    killSwitch(false)
}

function killSwitch(enable) {
    if (enable) {
        network.get_interfaces_list(function(error, obj) {
            let interface = obj.find(function(element) {
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
                settings["nic"] = interface["name"]
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
                    exec(`netsh interface set interface "${interface["name"]}" admin=disable`, (error, stderr, stdout) => {
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