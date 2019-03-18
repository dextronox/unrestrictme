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
const { autoUpdater } = require("electron-updater")
const net = require("net")

if (!appLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.focus()
            mainWindow.show()
        }
    })
}

//Definition of global variables
let loadingWindow, errorWindow, welcomeWindow, mainWindow, tray, killSwitchStatus, intentionalDisconnect, backgroundServer

function setLogValues() {
    //Create log file with a date naming schema.
    var date = new Date();
    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;
    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;
    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;
    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;
    let logDate = year + "-" + month + "-" + day + "-" + hour + "-" + min + "-" + sec;
    log.transports.file.level = 'info';
    log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
    log.transports.file.maxSize = 5 * 1024 * 1024;
    fs.mkdir(`${app.getPath('userData')}/logs/`, { recursive: true }, (error) => {
        if (!String(error).includes("EEXIST:")) {
            log.error(`Main: Couldn't create log directory. Error: ${error}`)
        } else {
            log.transports.file.stream = fs.createWriteStream(path.join(app.getPath('userData'), `logs/log-${logDate}.txt`));
        }
    });
    log.transports.file.streamConfig = { flags: 'w' };
}

app.on('ready', () => {
    setLogValues()
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
    if (os.platform() === "win32") {
        isElevated().then(elevated => {
            if (!elevated) {
                log.error("Main: Application run without elevated privileges. OpenVPN will not be able to change routing table.")
                createErrorWindow(`elevation`)
            } else {
                log.info("Main: Application is elevated.")
                checkSettings()
            }
        })
    } else if (os.platform() === "linux") {
        isElevated().then(elevated => {
            if (!elevated) {
                log.error("Main: Application is not elevated. Consequently, we will run with limited functionality.")
                checkSettings()
            } else {
                log.info("Main: Application is elevated.")
                checkSettings()
            }
        })
    }

}

function checkSettings() {
    fs.readFile(path.join(app.getPath('userData'), 'settings.conf'), 'utf8', (error, data) => {
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
    fs.readFile(path.join(app.getPath('userData'), 'settings.conf'), 'utf8', (error, data) => {
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
    fs.readFile(path.join(app.getPath('userData'), 'public'), (error, data) => {
        if (error) {
            log.error(`Main: Error reading public key. Will now begin key generation. Error: ${error}`)
            createKeys()
        } else {
            fs.readFile(path.join(app.getPath('userData'), 'private'), (error, data) => {
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
    fs.unlink(path.join(app.getPath('userData'), 'public'), (error) => {
        if (error) {
            //File will simply be created if it does not exist
            log.error(`Main: Error occurred deleting public key. It might not exist, which is fine. Error: ${error}`)
        }
        fs.writeFile(path.join(app.getPath('userData'), 'public'), publicKey, (error) => {
            if (error) {
                createErrorWindow('key')
                return
            }
        })
        fs.unlink(path.join(app.getPath('userData'), 'private'), (error) => {
            if (error) {
                log.error(`Main: Error occurred deleting private key. It might not exist, which is fine. Error: ${error}`)
            }
            fs.writeFile(path.join(app.getPath('userData'), 'private'), privateKey, (error) => {
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

function checkForUpdates(install) {
    if (install) {
        if (disconnect() === true) {
            appUpdater.downloadUpdate()
            autoUpdater.on("update-downloaded", (info) => {
                autoUpdater.quitAndInstall()
            })
        } else {
            log.error("Main: We can't update because we're still connected to unrestrict.me.")
        }
    } else {
        autoUpdater.checkForUpdates()
        autoUpdater.autoDownload = false
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.on("error", (error) => {
            log.error(`Main: An error occurred during the update procedure. This does not necessarily mean the client was updating. Error: ${error}`)
            let updater = {
                "updateError": true,
                "error": error
            }
            mainWindow.webContents.send('updaterError', updater)
        })
        autoUpdater.on("update-available", (info) => {
            let updater = {
                "updateAvailable": true,
                "info": info
            }
            mainWindow.webContents.send('updater', updater)
        })
        autoUpdater.on("download-progress", (progress, bytesPerSecond, percent, total, transferred) => {
            let updateProgress = {
                "progress": progress,
                "bytesPerSecond": bytesPerSecond,
                "percent": percent,
                "total": total,
                "transferred": transferred
            }
            mainWindow.webContents.send('updaterProgress', updateProgress)
        })
    }

}

function startBackgroundServer() {
    backgroundServer = net.createServer((client) => {
        //This runs the first time a client connects.
        log.info(`Main: Background process has started successfully.`)
        //Tell the renderer
        try {
            mainWindow.webContents.send("backgroundService", "processStarted")
        } catch (e) {
            log.error(`Main: Couldn't send backgroundService processStarted to renderer.`)
        }
        client.on("error", (error) => {
            if (error.errno === "ECONNRESET") {
                log.info(`Main: Background process has disconnected.`)
            } else {
                log.error(`Main: An unknown error has occurred. Error: ${error}`)
            }
        })
        client.on("data", (data) => {
            //We've got data from the background process. Send it to the function that handles that stuff.
            backgroundProcessDataHandler(data.toString())
        })
    })
    server.listen(4964, () => {
        log.info(`Main: Background server has started successfully.`)
    })
    server.on("error", (error) => {
        log.error(`Main: An error has occurred with the background server. Error: ${error}`)
    })
}

function startBackgroundService() {
    let options = {
        name: "unrestrictme"
    }
    sudo.exec(`${process.env._}/${path.join(__dirname, 'service.js')}`, options, (error, stdout, stderr) => {
        if (error) {
            if (String(error).includes(`User did not grant permission`)) {
                log.error(`Main: User did not grant permission to start background service.`)
                try {
                    mainWindow.webContents.send("backgroundService", "startingPermission")
                } catch (e) {
                    log.error(`Main: Couldn't send backgroundService startingPermission to renderer.`)
                }
            } else {
                log.error(`Main: An error occurred running the command to start the background service.`)
                try {
                    mainWindow.webContents.send("backgroundService", "startingError")
                } catch (e) {
                    log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                }
            }
        }
    })
}

function backgroundProcessDataHandler(data) {

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
        checkForUpdates()
        if (!os.platform() === "win32") {
            startBackgroundServer()
            startBackgroundService()
        }
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
    if (os.platform() === "win32") {
        tray = new Tray(path.join(__dirname, "assets", "icons", "win.ico"))
    } else {
        tray = new Tray(path.join(__dirname, "assets", "icons", "icon.png"))
    }
    let contextMenu = Menu.buildFromTemplate([
        {
            label: "Show unrestrict.me", click: () => {
                mainWindow.show()
            }
        },
        {
            label: "Copy IP to Clipboard", click: () => {
                fs.readFile(path.join(app.getPath('userData'), 'settings.conf'), 'utf8', (error, data) => {
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
                            mainWindow.show()
                            mainWindow.webContents.send("trayError", "")
                            log.error(`Renderer: Error getting public IP. Error: ${error}`)
                        } else {
                            if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(body) || body === "::ffff:127.0.0.1") {
                                clipboard.writeText(body)
                                log.info(`Renderer: IP address copied to clipboard.`)
                            } else {
                                mainWindow.show()
                                mainWindow.webContents.send("trayError", "")
                                log.error(`Renderer: Failed to get IP address. We got a response, however: ${body}`)
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
    fs.readFile(path.join(app.getPath('userData'), 'settings.conf'), 'utf8', (error, data) => {
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

function quit(hard) {
    log.info(`Main: We're about to kill OpenVPN. Hard kill?: ${hard}`)
    intentionalDisconnect = true
    if (os.platform() === "win32" && !hard) {
        exec(`taskkill /IM openvpn.exe /F`, (error, stdout, stderr) => {
            if (error) {
                log.error(`Main: An error occurred killing OpenVPN. Error: ${error}`)
                mainWindow.show()
                let status = {
                    "disconnectError": true
                }
                try {
                    mainWindow.webContents.send('error', status)
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
                tray.destroy()
                app.quit()
                return;
            }
            log.error(`Main: OpenVPN should have been killed.`)
            let status = {
                "connected": false
            }
            try {
                mainWindow.webContents.send('connection', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
            log.info(`Main: OpenVPN was killed`)
            tray.destroy()
            app.quit()
        })
    } else if (os.platform() === "linux" && !hard) {
        exec(`pgrep openvpn`, (error, stdout, stderr) => {
            if (error && !error.code === 1) {
                //Error occurred checking if OpenVPN is running.
                log.error(`Main: We couldn't check if OpenVPN is running. Error: ${error}. stdout: ${stdout}. stderr: ${stderr}`)
                mainWindow.show()
                let status = {
                    "pgrep": true
                }
                try {
                    mainWindow.webContents.send('error', status)
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
                return;
            }
            if (String(stdout) != "") {
                let options = {
                    name: "unrestrictme"
                }
                intentionalDisconnect = true
                sudo.exec(`pkill openvpn`, options, (error, stdout, stderr) => {
                    if (error) {
                        intentionalDisconnect = false
                        if (String(error).includes("User did not grant permission")) {
                            log.error(`Main: User did not grant permission to disconnect. Error: ${error}`)
                            mainWindow.show()
                            let status = {
                                "disconnectError": "permission"
                            }
                            try {
                                mainWindow.webContents.send('error', status)
                            } catch(e) {
                                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                            }
                            return;
                        }
                        log.error(`Main: An error occurred killing OpenVPN. Error: ${error}`)
                        mainWindow.show()
                        let status = {
                            "disconnectError": true
                        }
                        try {
                            mainWindow.webContents.send('error', status)
                        } catch(e) {
                            log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                        }
                        tray.destroy()
                        app.quit()
                        return;
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
                    tray.destroy()
                    app.quit()
                })
            } else {
                log.info(`Main: No OpenVPN found in stdout, we're ready to quit! Stdout: ${stdout}`)
                tray.destroy()
                app.quit()
            }
        })
    } else if (hard) {
        tray.destroy()
        app.quit()
    }

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
                fs.writeFile(path.join(app.getPath('userData'), 'settings.conf'), JSON.stringify(settings), (error) => {
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
                installDependenciesLinux(error)
            }
            if (String(stdout).includes(`built on`)) {
                let settings = {}
                fs.writeFile(path.join(app.getPath('userData'), 'settings.conf'), JSON.stringify(settings), (error) => {
                    if (error) {
                        log.error(`Main: Error occurred writing settings file. Permissions error perhaps? Error: ${error}`)
                        let ipcUpdate = {
                            "error":"writingSettingsFile",
                            "errorText": error
                        }
                        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                    } else {
                        log.info(`Main: Settings file created!`)
                        //Show alert to user and have them run quit()
                        let ipcUpdate = {
                            "update": "InstallComplete"
                        }
                        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                    }
                })
            } else {
                installDependenciesLinux(stdout)
            }
        })
    } else {
        log.error(`Main: This is not a supported system. Time to exit.`)
        app.quit()
    }

}

exports.connect = (config) => {
    intentionalDisconnect = false
    killSwitchStatus = false
    log.info(`Main: Received command to connect OpenVPN with config: ${config}`)
    fs.writeFile(path.join(app.getPath('userData'), "current.ovpn"), config, (error) => {
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
            log.info(`Main: Going to run: "${path.join(__dirname, "assets", "openvpn", `${os.arch()}`)}\\openvpn.exe" --config "${path.join(app.getPath('userData'), "current.ovpn")}" --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
            let ovpnProc = exec(`"${path.join(__dirname, "assets", "openvpn", `${os.arch()}`)}\\openvpn.exe" --config "${path.join(app.getPath('userData'), "current.ovpn")}"  --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15`)
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
                if (data.includes('SIGTERM[soft,tls-error] received, process exiting') || data.includes('Exiting due to fatal error')) {
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
                fs.unlink(path.join(app.getPath('userData'), "current.ovpn"), (error) => {
                    if (error) {
                        log.error(`Main: Error deleting previous config file. This shouldn't matter as it will be overwritten.`)
                    }
                })
            })
        } else if (os.platform() === "linux") {
            log.info(`Main: Going to run: touch /var/log/openvpn.log && chown ${process.env.USER}:nogroup /var/log/openvpn.log && openvpn --config "${path.join(app.getPath('userData'), "current.ovpn")}" --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15 --daemon`)
            let options = {
                name: "unrestrictme"
            }
            var datalog
            sudo.exec(`sh -c "touch /var/log/openvpn.log && chown ${process.env.USER}:nogroup /var/log/openvpn.log && openvpn --config '${path.join(app.getPath('userData'), "current.ovpn")}' --connect-retry-max 1 --tls-exit --mute-replay-warnings --connect-timeout 15 --daemon"`, options, (error, stdout, stderr) => {
                if (error) {
                    if (String(error).includes("User did not grant permission")) {
                        log.error("Main: We cannot connect without super user privileges!")
                        intentionalDisconnect = true
                        let status = {
                            "requireSudo": true
                        }
                        try {
                            mainWindow.webContents.send('error', status)
                        } catch(e) {
                            log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                        }
                        return;
                    }
                    log.error(`Main: OpenVPN failed to connect. Error: ${error}`)
                    intentionalDisconnect = true
                    let status = {
                        "connectError": true
                    }
                    try {
                        mainWindow.webContents.send('error', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                    }
                    return;
                }
                monitorOpenVPNLog()
                function monitorOpenVPNLog() {
                    fs.readFile(`/var/log/openvpn.log`, (error, wholeLog) => {
                        let data = String(wholeLog).replace(datalog, '')
                        datalog = String(wholeLog)
                        if (data != "") {
                            //Prevents empty logging
                            log.info(`OpenVPN: ${data}`)
                        }
                        if (data.includes(`Initialization Sequence Completed`)) {
                            let initializeCount = (datalog.match(/Initialization Sequence Completed/g) || []).length;
                            if (initializeCount <= 1) {
                                //Send required information to main window.
                                var ipString = datalog.search("Peer Connection Initiated with")
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
                            return;
                        }
                        if (data.includes('Closing TUN/TAP interface')) {
                            if (datalog.includes(`Initialization Sequence Completed`)) {
                                //OpenVPN has disconnected on its own. Activate kill switch.
                                log.info(`Main: OpenVPN has disconnected on its own. Enabling kill switch.`)
                                killSwitchStatus = true
                                handleOpenVPNClose()
                                return;
                            }
                        }
                        if (data.includes('SIGTERM[soft,tls-error] received, process exiting') || data.includes('Exiting due to fatal error')) {
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
                                handleOpenVPNClose()
                                return;
                            }
                        }
                        if (data.includes(`Inactivity timeout (--ping-restart), restarting`)) {
                            //Something has caused the VPN to restart. Alert the user that there are issues.
                            let error = {
                                "inactivityTimeout": true
                            }
                            mainWindow.webContents.send("error", error)
                        }
                        setTimeout(() => {monitorOpenVPNLog()}, 100)
                    })
                }
                function handleOpenVPNClose() {
                    if (killSwitchStatus || !intentionalDisconnect) {
                        log.info(`Main: Activating failsafe.`)
                        killSwitch(true)
                    }
                    fs.unlink(path.join(app.getPath('userData'), "current.ovpn"), (error) => {
                        if (error) {
                            log.error(`Main: Error deleting previous config file. This shouldn't matter as it will be overwritten.`)
                        }
                    })
                }
            })
/*             ovpnProc.stdout.on('data', (data) => {
                log.info(`OpenVPN: ${data}`)
                datalog = datalog + data 
                if (data.includes(`Initialization Sequence Completed`)) {
                    let initializeCount = (datalog.match(/Initialization Sequence Completed/g) || []).length;
                    if (initializeCount <= 1) {
                        //Send required information to main window.
                        var ipString = datalog.search("Peer Connection Initiated with")
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
                fs.unlink(path.join(app.getPath('userData'), "current.ovpn"), (error) => {
                    if (error) {
                        log.error(`Main: Error deleting previous config file. This shouldn't matter as it will be overwritten.`)
                    }
                })
            }) */
        }
    }) 
}

function disconnect() {
    intentionalDisconnect = true
    log.info(`Main: We're about to kill OpenVPN. If OpenVPN is not running, you will see no confirmation it wasn't killed.`)
    if (os.platform() === "win32") {
        exec(`taskkill /IM openvpn.exe /F`, (error, stdout, stderr) => {
            if (error) {
                log.error(`Main: An error occurred killing OpenVPN. Error: ${error}`)
                mainWindow.show()
                let status = {
                    "disconnectError": true
                }
                try {
                    mainWindow.webContents.send('error', status)
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
                return false;
            }
            log.error(`Main: OpenVPN should have been killed.`)
            let status = {
                "connected": false
            }
            try {
                mainWindow.webContents.send('connection', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
            log.info(`Main: OpenVPN was killed`)
            return true;
        })
    } else if (os.platform() === "linux") {
        let options = {
            name: "unrestrictme"
        }
        sudo.exec(`pkill openvpn`, options, (error, stdout, stderr) => {
            intentionalDisconnect = true
            if (error) {
                intentionalDisconnect = false
                if (String(error).includes("User did not grant permission")) {
                    log.error("Main: User did not grant permission to disconnect.")
                    mainWindow.show()
                    let status = {
                        "disconnectError": "permission"
                    }
                    try {
                        mainWindow.webContents.send('error', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                    }
                    return false;
                }
                log.error(`Main: An error occurred killing OpenVPN. Error: ${error}`)
                mainWindow.show()
                let status = {
                    "disconnectError": true
                }
                try {
                    mainWindow.webContents.send('error', status)
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
                return false;
            }
            log.error(`Main: OpenVPN should have been killed.`)
            let status = {
                "connected": false
            }
            try {
                mainWindow.webContents.send('connection', status)
            } catch(e) {
                log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
            }
            log.info(`Main: OpenVPN was killed`)
            return true;
        })
    }
}

exports.disconnect = () => {
    disconnect()
}
exports.disableKillSwitch = () => {
    killSwitch(false)
}

exports.startBackgroundService = () => {
    startBackgroundService()
}

exports.clearSettings = () => {
    log.info(`Main: Clearing settings file and restarting application.`)
    let settings = {}
    fs.writeFile(path.join(app.getPath('userData'), 'settings.conf'), JSON.stringify(settings), (error) => {
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

exports.hardQuit = () => {
    quit(true)
}

exports.installUpdates = () => {
    checkForUpdates(true)
}
function killSwitch(enable) {
    //All platform specific options are to be handled in killSwitchEnable
    if (enable) {
        fs.readFile(path.join(app.getPath('userData'), 'settings.conf'), 'utf8', (error, data) => {
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
            if (!settings["selectedNic"] || settings["selectedNic"] == -1) {
                //Automatically determine nic.
                log.info(`Main: Will enable the kill switch with automatic configuration.`)
                killSwitchEnable("auto")
            } else {
                //Use preset nic.
                log.info(`Main: Will enable the kill switch with preset configuration.`)
                killSwitchEnable(settings["selectedNic"])
            }

        })
    } else {
        fs.readFile(path.join(app.getPath('userData'), 'settings.conf'), 'utf8', (error, data) => {
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
                fs.readFile(path.join(app.getPath('userData'), 'settings.conf'), 'utf8', (error, data) => {
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
                    fs.writeFile(path.join(app.getPath('userData'), 'settings.conf'), JSON.stringify(settings), (error) => {
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
    } else if (os.platform() === "linux") {
        isElevated().then(elevated => {
            if (elevated) {
                log.info(`Main: unrestrict.me is elevated. Enabling kill switch.`)
            } else {
                //Because unrestrict.me is not elevated (linux) we can't activate the kill switch without user auth (unrealistic)
                log.info(`Main: unrestrict.me is not elevated, therefore we cannot activate the kill switch.`)
                let status = {
                    "error": "elevated"
                }
                try {
                    mainWindow.webContents.send('killSwitch', status)
                } catch(e) {
                    log.error(`Main: Couldn't send kill switch error to renderer. Error: ${e}`)
                }
                return;
            }
        })
    }
}

function installDependenciesLinux(error) {
    if (String(error).includes("openvpn: not found")) {
        //OpenVPN not installed. Get from package repository.
        log.info(`Main: Installing OpenVPN from package repository.`)
        getos((error, ops) => {
            if (error) {
                log.error(`Main: Error checking operating system environment. Error: ${error}`)
                let ipcUpdate = {
                    "error": "operatingSystemCheck"
                }
                welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                return;
            }
            if (String(ops["dist"]).includes("Ubuntu") || String(ops["dist"]).includes("Debian")) {
                log.info(`Main: Will install OpenVPN for Debian/Ubuntu.`)
                let ipcUpdate = {
                    "update": "installingOpenVPN"
                }
                welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                let options = {
                    name: "unrestrictme"
                }
                sudo.exec(`apt -y install openvpn`, options, (error, stdout, stderr) => {
                    if (error) {
                        //Couldn't run the install command.
                        log.error(`Main: Failed to run command to install OpenVPN. Error: ${error}`)
                        let ipcUpdate = {
                            "error": "sudoFail"
                        }
                        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                        return;
                    }
                    if (String(stdout).includes("E:")) {
                        //An error occurred installing OpenVPN
                        log.error(`Main: Failed to install OpenVPN. Stdout: ${stdout}`)
                        let ipcUpdate = {
                            "error": "OpenVPNInstallFail",
                            "errorText": stdout
                        }
                        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                    } else {
                        let settings = {}
                        fs.writeFile(path.join(app.getPath('userData'), 'settings.conf'), JSON.stringify(settings), (error) => {
                            if (error) {
                                log.error(`Main: Error occurred writing settings file. Permissions error perhaps? Error: ${error}`)
                                let ipcUpdate = {
                                    "error":"writingSettingsFile",
                                    "errorText": error
                                }
                                welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                            } else {
                                log.info(`Main: Settings file created!`)
                                //Show alert to user and have them run quit()
                                let ipcUpdate = {
                                    "update": "InstallComplete"
                                }
                                welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                            }
                        }) 
                    }
                })
            }
        })
    } else if (!String(stdout).includes('built on')) {
        log.error(`Main: Couldn't detect whether OpenVPN is installed. Error: ${error}`)
        let ipcUpdate = {
            "error": "builtOnMissing"
        }
        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
    }
}