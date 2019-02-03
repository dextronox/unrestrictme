const {remote, ipcRenderer} = require("electron")
const {app} = remote
const $ = jQuery = require('jquery')
const log = require('electron-log')
const swal = require('sweetalert')
const path = require("path")
const main = remote.require(path.resolve(__dirname, '../..', 'main.js'))

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
})

$("#clearSettings").on('click', () => {
    main.clearSettings()
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
        text: "Rescue mode will activate a VPN which only allows connections to our servers. We should then be able to ping the API and then start the client.",
        buttons: true,
        dangerMode: true,
    }).then((bool) => {
        if (bool) {
            $("#api").css("display", "none")
            $("#rescueModeConnecting").css("display", "block")
            main.rescueMode()
        }
    })
})