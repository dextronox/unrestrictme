const {remote, ipcRenderer, shell} = require("electron")
const {app} = remote
const $ = jQuery = require('jquery')
const log = require('electron-log')
const swal = require('sweetalert')
const path = require("path")
const main = remote.require(path.resolve(__dirname, '../..', 'main.js'))
let logPath

$(document).ready(() => {
    ipcRenderer.once(`error`, (event, args) => {
        loadPage(args)
    })
    ipcRenderer.on("settingsClear", (events, args) => {
        if (args["writeError"]) {
            log.info(`Renderer: Error writing settings file. Alerting user.`)
            swal("Whoops!", "We couldn't write to your settings file. This is probably a permissions error.", "error")
        }
    })
    ipcRenderer.on(`apiError`, (event, args) => {
        $("#apiError").html(JSON.stringify(args).split(',').join(', '))
    })
    ipcRenderer.on(`logPath`, (event, args) => {
        logPath = args
    })

})
$("#clearSettings").on('click', () => {
    main.clearSettings()
})

$("#retryAPI").on("click", () => {
    app.relaunch()
    app.quit()
})

function loadPage(type) {
    if (type === "settings") {
        $("#settings").css('display', 'block')
    } else if (type === "api") {
        $("#api").css('display', 'block')
    } else if (type === "elevation") {
        $("#elevate").css('display', 'block')
    } else if (type === "key") {
        $("#key").css('display', 'block')
    } else if (type === "updateRun") {
        $("#updateRun").css('display', 'block')
    } else if (type === "parse") {
        $("#parse").css('display', 'block')
    }
}

$("#rescueMode").on('click', () => {
    log.info(`Renderer: User wishes to engage rescue mode.`)
    swal({
        title: "Rescue Mode",
        text: "Rescue mode will activate a VPN which only allows connections to our servers. We should then be able to ping the API and start the client.",
        buttons: true,
        dangerMode: true,
    }).then((bool) => {
        if (bool) {
            log.info(`Renderer: We will attempt to engage rescue mode.`)
            $("#api").css("display", "none")
            $("#rescueModeConnecting").css("display", "block")
            main.rescueMode()
        } else {
            log.info(`Renderer: User chose not to enable rescue mode.`)
        }
    })
})
$("#openLog").on("click", () => {
    shell.openItem(logPath)
})