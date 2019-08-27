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

autoUpdater.logger = null

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
let loadingWindow, errorWindow, welcomeWindow, mainWindow, tray, killSwitchStatus, intentionalDisconnect, backgroundServer, clientObj

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
    } else if (os.platform() === "darwin") {
        checkSettings()
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
        log.info(`Main: The client will now attempt to download the update.`)
        autoUpdater.downloadUpdate()
        autoUpdater.on("update-downloaded", (info) => {
            autoUpdater.quitAndInstall()
        })
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
        //This runs the time a client connects.
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
        client.on("end", () => {
            //Background process has disconnected.
            log.info(`Main: Background process has disconnected.`)
            try {
                mainWindow.webContents.send("backgroundService", "processClosed")
                mainWindow.focus()
                mainWindow.show()
            } catch (e) {
                log.error(`Main: Couldn't send backgroundService processClosed to renderer.`)
            }
            clientObj = "killed"
        })
        clientObj = client
    })
    backgroundServer.listen(4964, () => {
        log.info(`Main: Background server has started successfully.`)
    })
    backgroundServer.on("error", (error) => {
        log.error(`Main: An error has occurred with the background server. Error: ${error}`)
        if (String(error).includes('EADDRINUSE')) {
            //Something is using our port
            try {
                mainWindow.webContents.send("backgroundService", "portInUse")
            } catch (e) {
                log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
            }
        }
    })
}

function createBackgroundService() {
    if (os.platform() === "linux") {
        if (!fs.existsSync(path.join(app.getPath('userData'), "node"))) {
            fs.copyFile(path.join(__dirname, "assets/node/node"), path.join(app.getPath('userData'), "node"), (error) => {
                if (error) {
                    log.error(`Main: An error occurred copying the node executable to the userData folder.`)
                    try {
                        mainWindow.webContents.send("backgroundService", "startingError")
                    } catch (e) {
                        log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                    }
                    return
                }
    
            })
        }
        let template = `[Unit]
        Description=unrestrictme Service
        
        [Service]
        ExecStart=${path.join(app.getPath('userData'), 'service.js')}
        Restart=no
        User=root
        Group=root
        Environment=PATH=/usr/bin:/usr/sbin:/usr/local/bin:/sbin
        Environment=NODE_ENV=production
        WorkingDirectory=${app.getPath('userData')}
        
        [Install]
        WantedBy=multi-user.target`
        fs.readFile(path.join(__dirname, 'service.js'), (error, templateData) => {
            if (error) {
                log.error(`Main: An error occurred reading the template service file. Error: ${error}`)
                try {
                    mainWindow.webContents.send("backgroundService", "startingError")
                } catch (e) {
                    log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                }
                return
            }
            let shebang = new Buffer(`#!${app.getPath('userData')}/node\n`)
            fs.writeFile(path.join(app.getPath('userData'), 'service.js'), shebang, (error) => {
                if (error) {
                    log.error(`Main: An error occurred writing the shebang to the service file. Error: ${error}`)
                    try {
                        mainWindow.webContents.send("backgroundService", "startingError")
                    } catch (e) {
                        log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                    }
                    return
                }
                fs.appendFile(path.join(app.getPath('userData'), 'service.js'), templateData, (error) => {
                    if (error) {
                        log.error(`Main: An error occurred appending the service file. Error: ${error}`)
                        try {
                            mainWindow.webContents.send("backgroundService", "startingError")
                        } catch (e) {
                            log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                        }
                        return
                    }
                })
            })
        })
        fs.writeFile(path.join(app.getPath('userData'), 'serviceTemplate'), template, (error) => {
            if (error) {
                log.error(`Main: An error occurred writing the service file. Error: ${error}`)
                try {
                    mainWindow.webContents.send("backgroundService", "startingError")
                } catch (e) {
                    log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                }
                return
            }
            startBackgroundService()
        })
    } else if (os.platform() === "darwin") {
        fs.copyFile(path.join(__dirname, "service.js"), path.join(app.getPath("userData"), "service.js"), (error) => {
            if (error) {
                log.error(`Main: An error occurred copying the service.js to the userData folder.`)
                try {
                    mainWindow.webContents.send("backgroundService", "startingError")
                } catch (e) {
                    log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                }
                return
            } else {
                startBackgroundService()
            }
        })
    }

}
function startBackgroundService() {
    try {
        mainWindow.webContents.send("authentication", "waiting")
    } catch (e) {
        log.error(`Main: Couldn't send authentication waiting to renderer.`)
    }
    let options = {
        name: "unrestrictme"
    }
    if (os.platform() === "linux") {
        sudo.exec(`sh -c "cp ${path.join(app.getPath('userData'), 'serviceTemplate')} /etc/systemd/system/unrestrictme.service && systemctl daemon-reload && chmod +x /etc/systemd/system/unrestrictme.service && systemctl start unrestrictme"`, options, (error, stdout, stderr) => {
            if (error) {
                if (String(error).includes(`User did not grant permission`)) {
                    log.error(`Main: User did not grant permission to start background service. Error: ${error}`)
                    try {
                        mainWindow.webContents.send("backgroundService", "startingPermission")
                    } catch (e) {
                        log.error(`Main: Couldn't send backgroundService startingPermission to renderer.`)
                    }
                } else {
                    if (!clientObj || clientObj != "killed") {
                        log.error(`Main: An error occurred running the command to start the background service.`)
                        try {
                            mainWindow.webContents.send("backgroundService", "startingError")
                        } catch (e) {
                            log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                        }
                    }
                }
            } else if (stderr) {
                if (String(stderr).includes(`Request dismissed`)) {
                    log.error(`Main: User did not grant permission to start background service. Error: ${error}`)
                    try {
                        mainWindow.webContents.send("backgroundService", "startingPermission")
                    } catch (e) {
                        log.error(`Main: Couldn't send backgroundService startingPermission to renderer.`)
                    }
                } else {
                    if (!clientObj || clientObj != "killed") {
                        log.error(`Main: An error occurred running the command to start the background service.`)
                        try {
                            mainWindow.webContents.send("backgroundService", "startingError")
                        } catch (e) {
                            log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                        }
                    }
                }
            }
            log.info(`Stdout: ${stdout}, Stderr: ${stderr}, Error: ${error}`)
        })
    } else if (os.platform() === "darwin") {
        let options = {
            name: "unrestrictme"
        }
        sudo.exec(`sh -c "'${app.getPath("home")}/unrestrictme/bin/node' '${app.getPath("userData")}/service.js'"`, options, (error, stdout, stderr) => {
            log.info(`Error: ${error}, Stdout: ${stdout}, Stderr: ${stderr}`)
            if (error) {
                if (String(error).includes(`User did not grant permission`)) {
                    log.error(`Main: User did not grant permission to start background service. Error: ${error}`)
                    try {
                        mainWindow.webContents.send("backgroundService", "startingPermission")
                    } catch (e) {
                        log.error(`Main: Couldn't send backgroundService startingPermission to renderer.`)
                    }
                } else {
                    if (!clientObj || clientObj != "killed") {
                        log.error(`Main: An error occurred running the command to start the background service.`)
                        try {
                            mainWindow.webContents.send("backgroundService", "startingError")
                        } catch (e) {
                            log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                        }
                    }
                }
            } else if (stderr) {
                if (String(stderr).includes(`Request dismissed`)) {
                    log.error(`Main: User did not grant permission to start background service. Error: ${error}`)
                    try {
                        mainWindow.webContents.send("backgroundService", "startingPermission")
                    } catch (e) {
                        log.error(`Main: Couldn't send backgroundService startingPermission to renderer.`)
                    }
                } else {
                    if (!clientObj || clientObj != "killed") {
                        log.error(`Main: An error occurred running the command to start the background service.`)
                        try {
                            mainWindow.webContents.send("backgroundService", "startingError")
                        } catch (e) {
                            log.error(`Main: Couldn't send backgroundService startingError to renderer.`)
                        }
                    }
                }
            }
        })
    }

}

function backgroundProcessDataHandler(data) {
    log.info(data)
    let dataInterpreted = JSON.parse(data)
    if (dataInterpreted["command"] === "sendToRenderer") {
        try {
            mainWindow.webContents.send(dataInterpreted["channel"], dataInterpreted["status"])
        } catch(e) {
            log.error(`Main: Couldn't send data from service worker to renderer. Error: ${e}`)
        }
        if (dataInterpreted["showWindow"] === true) {
            mainWindow.show()
        }
    }
    if (dataInterpreted["command"] === "execute") {
        dataInterpreted["methods"].forEach(cmd => {
            eval(cmd)
        });
    }
    if (dataInterpreted["command"] === "testMessage") {
        log.info(`Main: We can communicate with the service.js.`)
        try {
            mainWindow.webContents.send("authentication", "passed")
        } catch (e) {
            log.error(`Main: Couldn't send authentication waiting to renderer.`)
        }
    }
}
function createLoadingWindow() {
    loadingWindow = new BrowserWindow({show: false, frame: false, width: 300, height: 300, icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 'minWidth': 300, 'minHeight': 300, transparent: false, title: "unrestrict.me Client", resizable: false, maximizable: false})
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
    errorWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 420, icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 'minWidth': 600, 'minHeight': 420, transparent: false, title: "unrestrict.me Client", resizable: false, maximizable: false})
    errorWindow.setMenu(null)
    errorWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/error/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    errorWindow.webContents.on('did-finish-load', () => {
        errorWindow.show()
        errorWindow.webContents.send('error', error)
        errorWindow.webContents.send('logPath', log.transports.file.stream["path"])
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
    welcomeWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 420, icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 'minWidth': 600, 'minHeight': 420, transparent: false, title: "unrestrict.me Client", resizable: false, maximizable: false})
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
    mainWindow = new BrowserWindow({
        show: false, 
        frame: true, 
        width: 600, 
        height: 420, 
        icon: path.resolve(__dirname, 'assets', 'icons', 'icon.png'), 
        'minWidth': 600, 
        'minHeight': 420,
        transparent: false, 
        title: "unrestrict.me Client", 
        resizable: false,
        maximizable: false
    })
    mainWindow.setMenu(null)
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/main/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.show()
        checkForUpdates()
        checkIfConnected()
        if (os.platform() != "win32") {
            log.info(`Main: This is not a win32 installation. Starting background service/server.`)
            startBackgroundServer()
            createBackgroundService()
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
    } else if (os.platform() === "darwin") {
        tray = new Tray(path.join(__dirname, "assets", "icons", "mac.png"))
    } else {
        tray = new Tray(path.join(__dirname, "assets", "icons", "icon.png"))
    }
    let contextMenu = Menu.buildFromTemplate([
        {
            label: "Show unrestrict.me", click: () => {
                mainWindow.focus()
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

function quit(hard) {
    log.info(`Main: We're about to kill OpenVPN. Hard kill?: ${hard}`)
    intentionalDisconnect = true
    if (os.platform() === "win32" && !hard) {
        exec(`taskkill /IM openvpn.exe /F & taskkill /IM tstunnel.exe /F`, (error, stdout, stderr) => {
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
        if (clientObj && clientObj != "killed") {
            let writeData = {
                "command": "disconnect",
                "quitBoolean": true
            }
            clientObj.write(JSON.stringify(writeData))
        } else {
            quit(true)
        }
    } else if (os.platform() === "darwin" && !hard){
        if (clientObj && clientObj != "killed") {
            let writeData = {
                "command": "disconnect",
                "quitBoolean": true
            }
            clientObj.write(JSON.stringify(writeData))
        } else {
            quit(true)
        }
    } else if (hard) {
        tray.destroy()
        app.quit()
    }

}

function runTapInstaller () {
    exec(`"${path.join(__dirname, `assets`, `openvpn`, `tap-${os.arch()}`, `tapinstall.exe`)}" install "${path.join(__dirname, `assets`, `openvpn`, `tap-${os.arch()}`, `OemVista.inf`)}" tap0901`, (error, stdout, stderr) => {
        if (error) {
            log.error(`Main: Could not install the TAP driver. Error: ${error}`)
            //Alert renderer.
            let ipcUpdate = {
                "error":"TAPInstallationFailure",
                "errorText":`Error: ${error}`
            }
            welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
        } else if (String(stdout).includes(`Drivers installed successfully.`)) {
            //The driver install successfully.
            createSettingsFile()
        } else {
            //Something went wrong with the installation.
            let ipcUpdate = {
                "error":"TAPInstallationFailure",
                "errorText":`Stdout: ${stdout}, Stderr: ${stderr}`
            }
            welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
        }
    })
}
function createSettingsFile() {
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
exports.dependenciesCheck = () => {
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
                log.error(`Main: There is no TAP adapter on the system. Log: ${stdout}`)
                runTapInstaller()
/*                     let ipcUpdate = {
                    "update":"installingTAPAdapter"
                }
                welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate) */
            } else {
                createSettingsFile()
            }
        })
    } else if (os.platform() === "linux") {
        exec(`openvpn`, (error, stdout, stderr) => {
            if (error) {
                log.error(`Main: Error checking whether OpenVPN is installed. Error: ${error}`)
                installDependenciesLinux(error)
            } else if (String(stdout).includes(`built on`)) {
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
    } else if (os.platform() === "darwin") {
        exec(`openvpn`, (error, stdout, stderr) => {
            if (error) {
                log.error(`Main: Error checking whether OpenVPN is installed. Error: ${error}`)
                installDependenciesMac(error)
            } else if (String(stdout).includes(`built on`)) {
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
                installDependenciesMac(stdout)
            }
        })
    } else {
        log.error(`Main: This is not a supported system. Time to exit.`)
        app.quit()
    }

}

exports.connect = (config) => {
    connect(config)
}

function connect(config) {
    intentionalDisconnect = false
    killSwitchStatus = false
    log.info(`Main: Received command to connect OpenVPN.`)
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
                    killSwitchStatus = false
                    let initializeCount = (datalog.match(/Initialization Sequence Completed/g) || []).length;
                    if (initializeCount <= 1) {
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
                if (killSwitchStatus === true || !intentionalDisconnect) {
                    log.info(`Main: Activating failsafe.`)
                    killSwitch(true)
                }
                fs.unlink(path.join(app.getPath('userData'), "current.ovpn"), (error) => {
                    if (error) {
                        log.error(`Main: Error deleting previous config file. This shouldn't matter as it will be overwritten.`)
                    }
                })
            })
        } else if (os.platform() === "darwin") {
            copyDnsHelper()
            let writeData = {
                "command": "connectToOpenVPN",
                "configPath": `${path.join(app.getPath("userData"), 'current.ovpn')}`,
                "ovpnPath": `${app.getPath("home")}/unrestrictme/sbin/openvpn`,
                "scriptPath": `${app.getPath("home")}/unrestrictme/sbin/update-resolv-conf`
            }
            clientObj.write(JSON.stringify(writeData))
        } else if (os.platform() === "linux") {
            copyDnsHelper()
            let writeData = {
                "command": "connectToOpenVPN",
                "configPath": `${path.join(app.getPath("userData"), 'current.ovpn')}`
            }
            clientObj.write(JSON.stringify(writeData))

        }
    }) 
}

exports.stealthConnect = (decryptedResponse) => {
    fs.writeFile(path.join(app.getPath("userData"), 'stunnel.conf'), decryptedResponse["stunnel"], (error) => {
        if (error) {
            log.error(`Main: Couldn't write the stunnel configuartion to disk.`)
        }
    })
    fs.writeFile(path.join(app.getPath("userData"), 'stunnel.pem'), decryptedResponse["cert"], (error) => {
        if (error) {
            log.error(`Main: Couldn't write the stunnel configuartion to disk.`)
        }
    })
    //Fire up stunnel and send off the config
    if (os.platform() === "win32" && os.arch() === "x64") {
        log.info(`"${path.join(__dirname, "assets", "stunnel", "bin", "tstunnel.exe")}" "${path.join(app.getPath("userData"), 'stunnel.conf')}" -p "${path.join(app.getPath("userData"), 'stunnel.pem')}"`)
        let stunnelProc = exec(`"${path.join(__dirname, "assets", "stunnel", "bin", "tstunnel.exe")}" "${path.join(app.getPath("userData"), 'stunnel.conf')}" -p "${path.join(app.getPath("userData"), 'stunnel.pem')}"`)
        let dataLog
        stunnelProc.stderr.on('data', (data) => {
            log.info(`Stunnel: ${data}`)
            dataLog = dataLog + data
            if (String(data).includes("Configuration successful")) {
                //Stunnel has loaded successfully.
                connect(decryptedResponse["config"])
            }
        })
    } else if (os.platform() === "linux" || os.platform() === "darwin") {
        if (os.platform() === "darwin") {
            fs.copyFile(path.join(__dirname, "assets", "openvpn", "update-resolv-conf"), path.join(app.getPath("home"), `unrestrictme/sbin/update-resolv-conf`), (error) => {
                if (error) {
                    let status = {
                        "writeError": true
                    }
                    try {
                        mainWindow.webContents.send('error', status)
                    } catch(e) {
                        log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                    }
                    log.info(`Main: Couldn't copy the DNS updater script. Error: ${error}`)
                    return
                }
            })
        }
        fs.writeFile(path.join(app.getPath('userData'), "current.ovpn"), decryptedResponse["config"], (error) => {
            if (error) {
                let status = {
                    "writeError": true
                }
                try {
                    mainWindow.webContents.send('error', status)
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
            } else {
                let writeData = {
                    "command": "connectToStealth",
                    "stunnelPath": `${app.getPath("home")}/unrestrictme/bin/stunnel`,
                    "resourcePath": {
                        "config": path.join(app.getPath("userData"), 'stunnel.conf'),
                        "pem": path.join(app.getPath("userData"), 'stunnel.pem')
                    },
                    "configPath": path.join(app.getPath('userData'), "current.ovpn"),
                    "ovpnPath": `${app.getPath("home")}/unrestrictme/sbin/openvpn`,
                    "scriptPath": `${app.getPath("home")}/unrestrictme/sbin/update-resolv-conf`
                }
                clientObj.write(JSON.stringify(writeData))
            }
        })

    } else {
        let status = {
            "platformSupport": true
        }
        try {
            mainWindow.webContents.send('error', status)
        } catch(e) {
            log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
        }
    }
}

function copyDnsHelper() {
    if (os.platform() === "darwin") {
        fs.copyFile(path.join(__dirname, "assets", "openvpn", "update-resolv-conf"), path.join(app.getPath("home"), `unrestrictme/sbin/update-resolv-conf`), (error) => {
            if (error) {
                let status = {
                    "writeError": true
                }
                try {
                    mainWindow.webContents.send('error', status)
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
                log.info(`Main: Couldn't copy the DNS updater script. Error: ${error}`)
                return false
            }
        })
    } else if (os.platform() === "linux") {
        fs.copyFile(path.join(__dirname, "assets", "openvpn", "update-systemd-resolved"), path.join(app.getPath("userData"), `update-systemd-resolved`), (error) => {
            if (error) {
                let status = {
                    "writeError": true
                }
                try {
                    mainWindow.webContents.send('error', status)
                } catch(e) {
                    log.error(`Main: Couldn't send OpenVPN status to renderer. Error: ${e}`)
                }
                log.info(`Main: Couldn't copy the DNS updater script. Error: ${error}`)
                return false
            }
        })
    }
}

function disconnect() {
    intentionalDisconnect = true
    log.info(`Main: We're about to kill OpenVPN. If OpenVPN is not running, you will see no confirmation it wasn't killed.`)
    if (os.platform() === "win32") {
        exec(`taskkill /IM openvpn.exe /F & taskkill /IM tstunnel.exe /F`, (error, stdout, stderr) => {
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
    } else if (os.platform() === "linux" || os.platform() === "darwin") {
        let writeData = {
            "command": "disconnect",
            "quitBoolean": false
        }
        clientObj.write(JSON.stringify(writeData))
    }
}

exports.disconnect = () => {
    disconnect()
}
exports.disableKillSwitch = () => {
    killSwitch(false)
}

exports.startBackgroundService = () => {
    createBackgroundService()
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
exports.restartApp = () => {
    app.relaunch()
    app.exit()
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
            killSwitchDisable(settings["nic"])
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
    } else if (os.platform() === "linux" || os.platform() === "darwin") {
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
                        let writeData = {
                            "command": "killSwitchEnable",
                            "nic": autoInterface["name"]
                        }
                        clientObj.write(JSON.stringify(writeData))
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
                let nicCmd = obj[parseInt(nic)]["name"]
                let writeData = {
                    "command": "killSwitchEnable",
                    "nic": nicCmd
                }
                clientObj.write(JSON.stringify(writeData))
            })
        }
    }
}

function killSwitchDisable(nic) {
    if (os.platform() === "win32") {
        exec(`netsh interface set interface "${nic}" admin=enable`, (error, stderr, stdout) => {
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
    } else if (os.platform() === "linux" || os.platform() === "darwin") {
        let writeData = {
            "command": "killSwitchDisable",
            "nic": nic
        }
        clientObj.write(JSON.stringify(writeData))
    }
}
function installDependenciesLinux(checkError) {
    if (String(checkError).includes("openvpn: not found")) {
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
                sudo.exec(`apt-get -y install openvpn stunnel4`, options, (error, stdout, stderr) => {
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
                        writeBlankSettingsFile()
                    }
                })
            }
        })
    } else if (!String(checkError).includes('built on')) {
        log.error(`Main: Couldn't detect whether OpenVPN is installed. Error: ${checkError}`)
        let ipcUpdate = {
            "error": "builtOnMissing"
        }
        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
    }
}

function installDependenciesMac(checkError) {
    if (String(checkError).includes(`command not found`)) {
        let ipcUpdate = {
            "update": "installingOpenVPN"
        }
        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
        fs.exists(`${app.getPath("home")}/unrestrictme/bin/brew`, (exists) => {
            if (exists) {
                log.info(`Main: Brew is already installed.`)
                brewInstallDependencies()
            } else {
                exec(`mkdir "${app.getPath("home")}/unrestrictme/" && curl -L https://github.com/Homebrew/brew/tarball/master | tar xz --strip 1 -C "${app.getPath("home")}/unrestrictme/"`, (error, stdout, stderr) => {
                    if (error) {
                        log.error(`Main: Error downloading brew. Error: ${error}`)
                        let ipcUpdate = {
                            "error": "downloadingBrew",
                            "errorText": JSON.stringify(error)
                        }
                        welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
                    } else {
                        //Install openvpn and stunnel
                        brewInstallDependencies()
                    }
                })
            }
        })

    }
}

function brewInstallDependencies() {
    exec(`${app.getPath("home")}/unrestrictme/bin/brew install openvpn stunnel node`, (error, stdout, stderr) => {
        if (error) {
            log.info(`Main: Error installing dependencies from brew. Error: ${error}`)
            let ipcUpdate = {
                "error": "OpenVPNInstallFail",
                "errorText": JSON.stringify(error)
            }
            welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
        } else {
            let ipcUpdate = {
                "update": "InstallComplete"
            }
            welcomeWindow.webContents.send(`statusUpdate`, ipcUpdate)
            log.info(stdout)
            writeBlankSettingsFile()
        }
    })
}

function writeBlankSettingsFile() {
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
function checkIfConnected() {
    //This function runs on start to check if openvpn is already running.
    if (os.platform() === "win32") {
        exec("tasklist", (error, stdout, stderr) => {
            if (error) {
                log.error(`Main: Couldn't check whether OpenVPN is running.`)
                return;
            }
            if (String(stdout).includes(`openvpn.exe`)) {
                try {
                    mainWindow.webContents.send("openvpnStatus", "processRunning")
                } catch (e) {
                    log.error(`Main: Couldn't send openvpnStatus processRunning to renderer.`)
                }
            }
        })
    } else if (os.platform() === "linux") {
        exec(`pgrep openvpn`, (error, stdout, stderr) => {
            if (error && !error.code === 1) {
                //Error occurred checking if OpenVPN is running.
                log.error(`Main: We couldn't check if OpenVPN is running.`)
                return;
            } else if (String(stdout) != "") {
                //OpenVPN is running.
                try {
                    mainWindow.webContents.send("openvpnStatus", "processRunning")
                } catch (e) {
                    log.error(`Main: Couldn't send openvpnStatus processRunning to renderer.`)
                }
            }
        })
    }
}