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
let loadErrors = {}, loadingWindow, errorWindow, welcomeWindow, mainWindow, apiEndpoint = "http://127.0.0.1:3000"

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
            checkForUpdates()
        } else if (error) {
            log.error(`Main: Unknown error reading settings.conf. Error: ${error}`)
            loadErrors["settings"] = `${error}`
            checkForUpdates()
        } else {
            log.info("Main: settings.conf found!")
            checkForUpdates()
        }
    })
}

function checkForUpdates() {
    let requestConfig = {
        url: `${apiEndpoint}/client/version`,
        method: `get`,
        timeout: `5000`
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
                loadErrors["publicKey"] = false
            }
        })
        fs.unlink(path.join(__dirname, 'keys/private'), (error) => {
            if (error) {
                log.error(`Main: Error occurred deleting private key. Error: ${error}`)
            }
            fs.writeFile(path.join(__dirname, 'keys/private'), privateKey, (error) => {
                if (error) {
                    loadErrors["privateKey"] = false
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
        } else if (!loadErrors["publicKey"] || !loadErrors["privateKey"]) {
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
    loadingWindow = new BrowserWindow({show: false, frame: false, width: 300, height: 300, /*icon: path.resolve(__dirname, 'icons', 'icon.ico'),*/'minWidth': 300, 'minHeight': 300, transparent: false, title: "unrestrict.me Client", resizable: false})
    loadingWindow.setMenu(null)
    loadingWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/loading/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    loadingWindow.webContents.on('did-finish-load', () => {
        loadingWindow.show()
    })
    loadingWindow.webContents.openDevTools({mode: "undocked"})
    loadingWindow.setAlwaysOnTop(true)
}

function createErrorWindow(error) {
    errorWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 400, /*icon: path.resolve(__dirname, 'icons', 'icon.ico'),*/'minWidth': 600, 'minHeight': 400, transparent: false, title: "unrestrict.me Client", resizable: false})
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
    errorWindow.webContents.openDevTools({mode: "undocked"})
    errorWindow.setAlwaysOnTop(false)
    if (loadingWindow) {
        loadingWindow.close()
        loadingWindow = null
    }
}

function createWelcomeWindow() {
    welcomeWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 400, /*icon: path.resolve(__dirname, 'icons', 'icon.ico'),*/'minWidth': 600, 'minHeight': 400, transparent: false, title: "unrestrict.me Client", resizable: false})
    welcomeWindow.setMenu(null)
    welcomeWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'src/welcome/index.html'),
        protocol: 'file:',
        slashes: true
    }))
    welcomeWindow.webContents.on('did-finish-load', () => {
        welcomeWindow.show()
    })
    welcomeWindow.webContents.openDevTools({mode: "undocked"})
    welcomeWindow.setAlwaysOnTop(false)
    if (loadingWindow) {
        loadingWindow.close()
        loadingWindow = null
    }
}

function createMainWindow() {
    mainWindow = new BrowserWindow({show: false, frame: true, width: 600, height: 400, /*icon: path.resolve(__dirname, 'icons', 'icon.ico'),*/'minWidth': 600, 'minHeight': 400, transparent: false, title: "unrestrict.me Client", resizable: false})
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
    fs.unlink(path.join(__dirname, 'update.exe'), (error) => {
        if (error) {
            log.error(`Main: Error deleting past update file. This is probably fine because it doesn't exist. Should write over anyway. Error: ${error}`)
        }
    })
    requestConfig = {
        url: `https://syd-au-ping.vultr.com/vultr.com.1000MB.bin`,
        method: `get`,
        timeout: 15000
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
        // Do something after request finishes
    })
    .pipe(fs.createWriteStream('update.exe'));
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
    if (os.arch() === "x64") {
        exec(`"${path.join(__dirname, 'assets', 'openvpn', 'x64', 'openvpn.exe')}" --show-adapters`, (error, stdout, stderr) => {
            if (error) {
                log.error(`Main: Could not verify TAP installation. Error: ${error}`)
            } else if ((stdout.replace('Available TAP-WIN32 adapters [name, GUID]:', '')).replace(/\s/g, '') === "") {
                log.error(`Main: Install was a failure! Log: ${stdout}`)
            } else {
                log.info(`Main: ${stdout}`)
                let settings = {}
                fs.writeFile(path.join(__dirname, 'settings.conf'), JSON.stringify(settings), (error) => {
                    if (error) {
                        log.error(`Main: Error ocurred writing settings file. Permissions error perhaps?`)
                    } else {
                        log.info(`Main: Settings file created!`)
                        createMainWindow()
                    }
                })
            }
        })
    }   
}

exports.connect = (config) => {
    log.info(`Main: Received command to connect OpenVPN with config: ${config}`)
}