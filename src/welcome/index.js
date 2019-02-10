const {remote, ipcRenderer} = require("electron")
const app = remote.app
const $ = jQuery = require('jquery')
const path = require("path")
const main = remote.require(path.resolve(__dirname, '../..', 'main.js'))
const swal = require('sweetalert')
const log = require("electron-log")

$(document).ready(() => {
    ipcRenderer.once(`error`, (event, args) => {
        if (args["error"] === "writeError") {
            swal("Whoops!", "We couldn't write your settings file to disk. The application will now restart.", "error").then(() => {
                app.relaunch()
                app.quit()
            })
        } else if (args["error"] === "tapVerify") {
            swal("Whoops!", "We couldn't verify that the TAP driver installed correctly. Check the log.txt for more information. The application will now restart.", "error").then(() => {
                app.relaunch()
                app.quit()
            })
        } else if (args["error"] === "tapInstall") {
            swal("Whoops!", "The TAP driver did not install correctly, as it is not being seen by the OpenVPN daemon. Check the log.txt for more information. The application will now restart.", "error").then(() => {
                app.relaunch()
                app.quit()
            })
        }
    })
    ipcRenderer.on(`aptInstall`, (event, args) => {
        log.info(args)
        if (args["status"] === "installing") {
            $("#step3_repository_installing").css("display", "block")
        }
    })
})

$("#step1_button").on("click", () => {
    $("#step1").css("display", "none")
    $("#step2").css("display", "block")
})

$("#step2_button").on("click", () => {
    $("#step2").css("display", "none")
    $("#step3").css("display", "block")
})

$("#step3_button1").on("click", () => {
    ipcRenderer.once("errorFirst", (event, args) => {
        if (args["error"] === "writeError") {
            swal("Whoops!", "You already had a TAP adapter installed, however we couldn't write your settings file to disk. The application will now close to preserve the log.", "error").then(() => {
                app.quit()
            })
        } else if (args["error"] === "tapVerify") {
            swal("Whoops!", "We couldn't verify that the TAP driver installed correctly. Check the log.txt for more information. The application will now close to preserve the log.", "error").then(() => {
                app.quit()
            })
        } else if (args["error"] === "tapInstall") {
            main.tap()
            $("#step3_button_div2").css("display", "block")
        } else if (args["error"] === "unsupportedOS") {
            swal("Whoops!", "Your platform is not supported.", "error").then(() => {
                app.quit()
            })
        } else if (args["error"] === "openvpnVerify") {
            swal("Whoops!", "We couldn't check whether OpenVPN is installed. Check the log file for more information.", "error").then(() => {
                app.quit()
            })
        } else if (args["error"] === "openvpnInstall") {
            swal("Whoops!", "We couldn't install OpenVPN. Check the log file for more information.", "error").then(() => {
                app.quit()
            })
        }
    })
    main.verify(true)
    $("#step3_button_div1").css("display", "none")
    
})

$("#step3_button2").on("click", () => {
    main.verify()
})


