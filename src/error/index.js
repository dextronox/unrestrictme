const {remote, ipcRenderer} = require("electron")
const {app} = remote
const $ = jQuery = require('jquery')
const log = require('electron-log')

$(document).ready(() => {
    ipcRenderer.once(`error`, (event, args) => {
        loadPage(args)
    })
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
    }
}