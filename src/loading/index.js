const {remote, ipcRenderer} = require("electron")
const {app} = remote
const $ = jQuery = require('jquery')
const log = require('electron-log')

$(document).ready(() => {
    ipcRenderer.on(`update`, (event, args) => {
        updateStatus(args)
    })
})

function updateStatus(status) {
    $("#loading").css('display', 'none')
    $("#update").css('display', 'block')
    log.debug(`Renderer: Download % ${status.percent}`)
    log.debug(`Renderer: Download speed ${status.speed}`)
    log.debug(`Renderer: Time remaining ${status.remaining}`)
    $("#percent").html(Math.round(status.percent*100))
    $("#speed").html(Math.round(status.speed/100000)/10)
    $("#time").html(status.remaining)
}