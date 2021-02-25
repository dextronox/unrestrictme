const {remote, ipcRenderer} = require("electron")
const app = remote.app
const $ = jQuery = require('jquery')
const path = require("path")
const main = remote.require(path.resolve(__dirname, '../..', 'main.js'))
const swal = require('sweetalert')
const log = require("electron-log")
const fs = require('fs')

$(document).ready(() => {
    ipcRenderer.on(`statusUpdate`, (event, args) => {
        if (args["error"]) {
            //An error occurred doing something. Let the user know.
            if (args["error"] === "TAPVerifyInstall") {
                //We couldn't verify if a TAP adapter was installed.
                //WINDOWS
                swal("Whoops!", "We couldn't verify if a TAP adapter is installed. Check to ensure the OpenVPN executable is in the appropriate directory.", "error")
                $("#errorExcerpt").css("display", "block")
                $("#errorExcerptText").html(args["errorText"])
            } else if (args["error"] === "TAPInstallationFailure") {
                //There is STILL no adapter on the system.
                //WINDOWS
                swal("Whoops!", "The TAP adapter installation was a failure.", "error")
                $("#errorExcerpt").css("display", "block")
                $("#errorExcerptText").html(args["errorText"])
            } else if (args["error"] === "operatingSystemCheck") {
                swal("Whoops!", "A programmatic error occurred getting operating system information.", "error")
                $("#errorExcerpt").css("display", "block")
                $("#errorExcerptText").html("Check the log.txt file for more information.")
            } else if (args["error"] === "sudoFail") {
                //User didn't give us sudo permissions. Displaying option to retry.
                //LINUX
                swal("Whoops!", "We didn't get permission to install our dependencies. If prompted, please enter your sudo password.", "error")
                $("#step3_repository_installing").css("display", "none")
                $("#step3_button_div1").css("display", "block")
            } else if (args["error"] === "OpenVPNInstallFail") {
                //OpenVPN failed to be installed from the repository
                //LINUX
                swal("Whoops!", "We couldn't install OpenVPN from the package repository.", "error")
                $("#step3_repository_installing").css("display", "none")
                $("#errorExcerpt").css("display", "block")
                $("#errorExcerptText").html(args["errorText"])
            } else if (args["error"] === "builtOnMissing") {
                //OpenVPN command ran, but it didn't contain the text we expected it to.
                //LINUX
                swal({
                    title: "Whoops!",
                    text: "OpenVPN is installed, but we didn't get the output we expected. Check the log file for more information. unrestrict.me will now close.",
                    icon: "error",
                    button: "Close"
                }).then((restart) => {
                    log.info(`Renderer: unrestrict.me will now close because OpenVPN installation is broken.`)
                    app.quit()
                });
            } else if (args["error"] === "writingSettingsFile") {
                //We couldn't write to settings.conf
                //WINDOWS+LINUX
                $("#step3_repository_installing").css("display", "none")
                $("#errorExcerpt").css("display", "block")
                $("#errorExcerptText").html(args["errorText"])
                swal("Whoops!", "We were unable to create a settings.conf file.", "error")
            } else if (args["error"] === "folderSetup") {
                //MACOS
                $("#step3_repository_installing").css("display", "none")
                $("#errorExcerpt").css("display", "block")
                $("#errorExcerptText").html(args["errorText"])
                swal("Whoops!", "An error occurred copying the files we need to run.", "error")
            }
        } else if (args["update"]) {
            if (args["update"] === "installingTAPAdapter") {
                //The TAP driver is being installed in the background.

            } else if (args["update"] === "installingOpenVPN") {
                $("#step3_repository_installing").css("display", "block")
            } else if (args["update"] === "InstallComplete") {
                swal({
                    title: "Success!",
                    text: "Everything has been setup and you are ready to use unrestrict.me. The application will now restart.",
                    icon: "success",
                    button: "Okay"
                }).then((restart) => {
                    main.restartApp()
                });
            }
        } else if (args["installLog"]) {
            $("#step3").css("display", "none")
            $("#installProgress").css("display", "block")
            $("#installLogText").html(args["installLog"])
        }
    })
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
        if (args["status"] === "installing") {
            $("#step3_repository_installing").css("display", "block")
        }
    })
    ipcRenderer.on('service', (event, args) => {
        if (args === "error") {
            swal("Whoops!", "We couldn't install our service worker script. Did you grant permission?", "error")
            $("#installButton").removeClass("running")
            $("#installButton").attr("disabled", false)
        } else if (args === "installed") {
            main.dependenciesCheck2()
        }
    })
    checkIfUpdate()
})

function checkIfUpdate() {
    /**
     * Return value can be true or false.
     */
    main.checkIfUpdate((returnValue) => {
        if (returnValue) {
            $("#main").css("display", "none")
            $("#update").css("display", "block")
        }
    })
}

$("#installButton").on("click", () => {
    $("#installButton").addClass("running")
    $("#installButton").attr("disabled", true)
    main.dependenciesCheck()
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
    //Show legal modal.
    $("#legal").modal('show')
})
$("#show_install_log").on("click", () => {
    $("#show_install_log").css("display", "none")
    $("#installLog").css("display", "block")
})

$("#openLegalExternal").on('click', () => {
    require('electron').shell.openExternal('https://unrestrict.me/legal')
})

$("#tosAccept").on("click", () => {
    main.dependenciesCheck()
    $("#legal").modal('hide')
    $("#step3_button_div1").css("display", "none")
})

$("#decline").on("click", () => {
    app.quit()
})

