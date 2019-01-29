console.log(process.versions.electron)
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
})

$("#clearSettings").on('click', () => {
    main.clearSettings()
})

function loadPage(type) {
    if (type === "settings") {
        $("#settings").css('display', 'block')
    } else if (type === "update") {
        $("#update").css('display', 'block')
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