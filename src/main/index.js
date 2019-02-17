const {remote, ipcRenderer} = require("electron")
const app = remote.app
const $ = jQuery = require('jquery')
const path = require("path")
const main = remote.require(path.resolve(__dirname, '../..', 'main.js'))
const request = require("request")
const fs = require("fs")
const log = require('electron-log')
const swal = require('sweetalert')
const nodersa = require('node-rsa')
const network = require("network")
const os = require("os")

let currentRequestId, interval, configDir
function setConfigDir() {
    if (os.platform() === "win32") {
        //Set for install directory.
        configDir = path.join(__dirname, "../..")
    } else if (os.platform() === "linux") {
        configDir = path.join("~/.config/unrestrictme/")
    }
}
$(document).ready(() => {
    setConfigDir()
    //These are our listeners from the main process.
    //These manage the connection lifecycle changes.
    ipcRenderer.on(`connection`, (event, args) => {
        if (args["connected"]) {
            //We are connected to unrestrict.me
            //We'd better change the buttons back before
            $("#loading3").css("display", "none")
            $("#connectButtons").css("display", "block")
            //Hide the disconnected view, show the connected view
            $("#disconnected").css('display', 'none')
            $("#connected").css('display', 'block')
            //Clear the counter and the tag.
            clearInterval(interval);
            $("#placeholderTimeRemaining").html("")
            fs.readFile(path.join(configDir, 'settings.conf'), 'utf8', (error, data) => {
                if (error) {
                    log.error(`Renderer: Error reading settings file. Error: ${error}`)
                    swal("Whoops!", "We were unable to read your settings file. Please try rebooting the client.", "error")
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
                        log.error(`Renderer: Error getting public IP. Error: ${error}`)
                    } else {
                        if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(body) || body === "::ffff:127.0.0.1") {
                            populateConnected(args["ip"], body, currentRequestId)
                        } else {
                            populateConnected(args["ip"], "API Failure", currentRequestId)
                        }
                    }
                })
            })
        } else if (args["connectionCancelled"]) {
            $("#loading3").css("display", "none")
            $("#connectButtons").css("display", "block")
        } else if (!args["connected"]) {
            if ($("#connected").css('display') === 'none') {
                //We have failed to connect to unrestrict.me
                $("#loading3").css("display", "none")
                $("#connectButtons").css("display", "block")
                swal("Whoops!", "We were unable to connect you to unrestrict.me.", "error")
            } else {
                $("#connected").css("display", "none")
                $("#connectButtons").css("display", "block")
                $("#disconnected").css("display", "block")
                swal("Success!", "You have been disconnected from unrestrict.me.", "success")
            }

        }
    })
    //An OpenVPN error occurred.
    ipcRenderer.on(`error`, (event, args) => {
        if (args["tapError"]) {
            //All TAP devices used. In future maybe should kill any rogue ovpn processes to prevent this issue.
            swal("Whoops!", "All TAP devices are currently in use. This means there is another VPN connected.", "error")
            $("#connected").css('display', 'none')
            $("#disconnected").css('display', 'block')
            $("#loading3").css("display", "none")
            $("#connectButtons").css("display", "block")
        } else if (args["writeError"]) {
            //Issue should never occur because up until this point writing has been successful. Maybe if we run out of storage?
            swal("Whoops!", "We couldn't write the OpenVPN config file to disk.", "error")
            $("#connected").css('display', 'none')
            $("#disconnected").css('display', 'block')
            $("#loading3").css("display", "none")
            $("#connectButtons").css("display", "block")
        } else if (args["disconnectError"]) {
            //Triggered by taskkill.
            swal("Whoops!", "We couldn't kill OpenVPN. It's possible it's already closed, in which case this message can be ignored.", "error")
            $("#connected").css('display', 'none')
            $("#disconnected").css('display', 'block')
            $("#loading3").css("display", "none")
            $("#connectButtons").css("display", "block")
        } else if (args["connectError"]) {
            swal("Whoops!", "We couldn't connect you to OpenVPN. Feel free to try a different location.", "error")
            $("#loading3").css("display", "none")
            $("#connectButtons").css("display", "block")
        } else if (args["inactivityTimeout"]) {
            
        }
    })
    ipcRenderer.on(`killSwitch`, (event, args) => {
        //Kill switch has been triggered
        if (args["enabled"]) {
            $("#connected").css('display', 'none')
            $("#disconnected").css('display', 'none')
            $("#killSwitch").css("display", "block")
        } else if (args["enabled"] === false) {
            $("#killSwitch").css("display", "none")
            $("#disconnected").css('display', 'block')
        } else if (args["error"] === "disable") {
            swal("Whoops!", "We were unable to disable the kill switch. You can try enabling the effected network driver manually. This error may have occurred because the kill switch has already been disabled, in which case the interface should be updated to reflect this shortly.", "error")
        } else if (args["error"] === "enable") {
            swal("Whoops!", "We were unable to enable the kill switch.", "error")
            $("#connected").css('display', 'none')
            $("#disconnected").css('display', 'block')
        }
    })
    ipcRenderer.on(`trayError`, (event, args) => {
        swal("Whoops!", "We were unable to get your IP address from our API server.", "error")
    })
    network.get_interfaces_list(function(error, obj) {
        for (i = 0; Object.keys(obj).length >= i; i++) {
            //This populates the settings list with current adapters.
            $("#adapterSelect").append(new Option(`${obj[i]["name"]} (${obj[i]["model"]})`, i))
            if (Object.keys(obj).length -1 === i) {
                fs.readFile(path.join(configDir, 'settings.conf'), 'utf8', (error, data) => {
                    if (error) {
                        log.error(`Renderer: Error reading settings file. Error: ${error}`)
                        swal("Whoops!", "We were unable to read your settings file. Please try rebooting the client.", "error")
                        return;
                    }
                    settingsFile = JSON.parse(data)
                    if (settingsFile["selectedNic"]) {
                        //There is a custom adapter selected. In future, we should check it exists, then select it on the settings list.
                        $("#adapterDiv").css("display", "block")
                        $("#adapterWait").css("display", "none")
                        $("#adapterSelect").val(settingsFile["selectedNic"])
                        log.info(`Renderer: Custom adapter in settings. Reflected in settings.`)
                    } else {
                        //No custom adapter selected.
                        $("#adapterDiv").css("display", "block")
                        $("#adapterWait").css("display", "none")
                        log.info(`Renderer: No custom adapter in settings file. Reflected in settings menu.`)
                    }
                })
            }
        }
    })

})

$("#connect").on("click", () => {
    log.info(`Renderer: Creating connection request.`)
    $("#connectButtons").css("display", "none")
    $("#loading1").css("display", "block")
    let settingsFile, requestConfig
    fs.readFile(path.join(configDir, 'settings.conf'), 'utf8', (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file. Error: ${error}`)
            swal("Whoops!", "We were unable to read your settings file. Please try rebooting the client.", "error")
            $("#loading1").css("display", "none")
            $("#connectButtons").css("display", "block")
            return;
        }
        settingsFile = JSON.parse(data)
        fs.readFile(path.join(__dirname, '../..', 'keys/public'), 'utf8', (error, data) => {
            if (error) {
                log.error(`Renderer: Error reading public key for new connection request. Error: ${error}`)
                swal("Whoops!", "We were unable to read your public key file. Try regenerating your keypair from the settings menu.", "error")
                $("#loading1").css("display", "none")
                $("#connectButtons").css("display", "block")
                return;
            }
            if (settingsFile["customAPI"]) {
                log.info(`Renderer: Using custom API entry.`)
                requestConfig = {
                    url: `${settingsFile["customAPI"]}/connection/create`,
                    timeout: 5000,
                    method: "POST",
                    json: {
                        "key": `${data}`
                    }
                } 
            } else {
                log.info(`Renderer: Using standard API entry.`)
                requestConfig = {
                    url: `https://api.unrestrict.me/connection/create`,
                    timeout: 5000,
                    method: "POST",
                    json: {
                        "key": `${data}`
                    }
                } 
            }
            request(requestConfig, (error, response, body) => {
                log.info(`Renderer: Response received!`)
                if (error) {
                    log.error(`Renderer: Connection request error. Error: ${error}`)
                    swal("Whoops!", "An error occurred sending a request for a new connection identifier. Check your internet connection.", "error")
                    $("#loading1").css("display", "none")
                    $("#connectButtons").css("display", "block")
                    return
                }
                let checkJSON = body["error"]
                if (checkJSON) {
                    if (checkJSON === "internal") {
                        log.error(`Renderer: Internal API error. Error: ${checkJSON}`)
                        swal("Whoops!", "Something went wrong on our end, and we were unable to create your connection.", "error")
                        $("#loading1").css("display", "none")
                        $("#connectButtons").css("display", "block")
                    } else {
                        log.error(`Renderer: API server rejected our request. Error: ${checkJSON}`)
                        swal("Whoops!", "The API server rejected our request. See log for more info. Try regenerating the keypair.", "error")
                        $("#loading1").css("display", "none")
                        $("#connectButtons").css("display", "block")
                    }
                } else {
                    log.info(`Renderer: We sent a valid request! Decrypting response...`)
                    let key = new nodersa()
                    fs.readFile(path.join(__dirname, '../..', 'keys/private'), 'utf8', (error, data) => {
                        if (error) {
                            log.error(`Renderer: Error reading private key file. Error: ${error}`)
                            swal("Whoops!", "We sent a valid request, but we can't read the private key to decrypt the response. Try regenerating the keypair.")
                            return
                        }
                        key.importKey(data, 'private')
                        try {
                            let decryptedResponse = JSON.parse(key.decrypt(body, 'utf8'))
                            if (decryptedResponse["success"]) {
                                log.info(`Renderer: API server created request!`)
                                fs.readFile(path.join(configDir, "settings.conf"), (error, data) => {
                                    if (error) {
                                        log.error(`Renderer: Error reading settings file. Error: ${error}`)
                                        swal("Whoops!", "We can't read the settings.conf file.", "error")
                                        return
                                    }
                                    let current = JSON.parse(data)
                                    current["latestId"] = decryptedResponse["id"]
                                    fs.writeFile(path.join(configDir, "settings.conf"), JSON.stringify(current), (error) => {
                                        if (error) {
                                            log.error(`Renderer: Error writing to settings file. Error: ${error}`)
                                            swal("Whoops!", "We can't write to the settings.conf file.", "error")
                                            return
                                        }
                                        openWebpage(decryptedResponse["id"])
                                    })
                                })
                            } else {
                                log.error(`Renderer: API server unable to fulfil.`)
                                swal('Whoops!', "Something went wrong on our end creating your connection request.", "error")
                                $("#loading1").css("display", "none")
                                $("#connectButtons").css("display", "block")
                            }
                        } catch(error) {
                            log.error(`Renderer: API server sent a response but it wasn't encrypted. Unexpected. Error: ${error}`)
                            swal("Whoops!", "We received a response from the API server, but it wasn't in the format we expected. This is probably a fault on our end.", "error")
                            $("#loading1").css("display", "none")
                            $("#connectButtons").css("display", "block")
                        }                        
                    })
                }
            })
        })
    })
})

$("#disconnect").on("click", () => {
    main.disconnect()
})

function openWebpage(id) {
    currentRequestId = id
    $("#loading1").css("display", "none")
    $("#loading2").css("display", "block")
    log.info(`Renderer: Opening connection webpage with connection id ${id}`)
    fs.readFile(path.join(configDir, 'settings.conf'), 'utf8', (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file for customWebpage. Error: ${error}`)
            swal("Whoops!", "We were unable to read your settings file. Please try rebooting the client.", "error")
            return;
        }
        let settingsFile = JSON.parse(data)
        if (settingsFile["customWebpage"]) {
            log.info(`Renderer: Opening webpage with custom URL.`)
            require('electron').shell.openExternal(`${settingsFile["customWebpage"]}/connection?id=${id}`)
            monitorRequest(id)
        } else {
            log.info(`Renderer: Opening webpage with standard URL.`)
            require('electron').shell.openExternal(`https://unrestrict.me/connection?id=${id}`)
            monitorRequest(id)
        }
    })
}

function monitorRequest(id) {
    log.info(`Renderer: Checking if config file is ready...`)
    let requestConfig
    fs.readFile(path.join(configDir, 'settings.conf'), 'utf8', (error, data) => {
        let settingsFile = JSON.parse(data)
        if (settingsFile["customAPI"]) {
            log.info(`Renderer: Using custom API.`)
            requestConfig = {
                url: `${settingsFile["customAPI"]}/connection/query/${id}`,
                timeout: 5000,
                method: "GET"
            } 
        } else {
            log.info(`Renderer: Using normal API.`)
            requestConfig = {
                url: `https://api.unrestrict.me/connection/query/${id}`,
                timeout: 5000,
                method: "GET"
            } 
        }
        request(requestConfig, (error, response, body) => {
            if (error) {
                log.error(`Renderer: Couldn't query connection id. Error: ${error}`)
                $("#connectButtons").css("display", "block")
                $("#loading1").css("display", "none")
                $("#loading2").css("display", "none")
                swal("Whoops!", "We encountered an error querying our API server to check on the status of the connection. Check the log for more information.", "error")
                return;
            }
            try {
                let bodyParse = JSON.parse(body)
                log.debug(`Renderer: Config file not yet available. User probably hasn't selected a location, or config hasn't finished generation. Error: ${bodyParse["error"]}`)
                if (bodyParse["error"] != "id") {
                    setTimeout(() => {monitorRequest(id)}, 1000)
                }
            } catch (error) {
                let key = new nodersa()
                fs.readFile(path.join(__dirname, '../..', 'keys/private'), 'utf8', (error, data) => {
                    if (error) {
                        log.error(`Renderer: Error reading private key file. Error: ${error}`)
                        swal("Whoops!", "Our config file is available, but we can't read the private key to decrypt the response. Try regenerating the keypair.")
                        $("#loading2").css("display", "none")
                        $("#connectButtons").css("display", "block")
                        return
                    }
                    key.importKey(data, 'private')
                    let decryptedResponse = JSON.parse(key.decrypt(body, 'utf8'))
                    $("#loading2").css("display", "none")
                    $("#loading3").css("display", "block")
                    main.connect(decryptedResponse["config"])
                }) 
            }
        })
    })
}

$("#cancelRequest").on("click", () => {
    let settingsFile, requestConfig
    log.info(`Renderer: Request cancellation instruction received.`)
    fs.readFile(path.join(configDir, 'settings.conf'), 'utf8', (error, data) => {
        settingsFile = JSON.parse(data)
        if (settingsFile["customAPI"]) {
            log.info(`Renderer: Using custom API.`)
            requestConfig = {
                url: `${settingsFile["customAPI"]}/connection/destroy`,
                timeout: 5000,
                method: "POST",
                json: {
                    "id": `${currentRequestId}`
                }
            } 
        } else {
            log.info(`Renderer: Using normal API.`)
            requestConfig = {
                url: `https://api.unrestrict.me/connection/destroy`,
                timeout: 5000,
                method: "POST",
                json: {
                    "id": `${currentRequestId}`
                }
            } 
        }
        request(requestConfig, (error, response, body) => {
            if (error) {
                log.error(`Renderer: Error deleting request. Error: ${error}`)
                $("#loading2").css("display", "none")
                $("#connectButtons").css("display", "block")
                swal("Whoops!", "An error occurred. Check the log for more information.", "error")
                return;
            } 
            if (body["success"]) {
                log.info(`Renderer: Request cancelled.`)
                $("#loading2").css("display", "none")
                $("#connectButtons").css("display", "block")
                swal("Success!", "Your connection request has been cancelled.", "success")
            } else if (body["error"] === "id") {
                log.info(`Renderer: Error cancelling request. Id was not found.`)
                $("#loading2").css("display", "none")
                $("#connectButtons").css("display", "block")
                swal("Whoops!", "We couldn't cancel your connection request. This is probably because it's already been deleted.", "error")
            }
        })
    })
})

$("#cancelConnection").on("click", () => {
    log.info(`Renderer: We're going to cancel our connection to unrestrict.me`)
    main.disconnect(true)
})

//Settings listeners
$("#customAPISubmit").on("click", () => {
    log.info(`Renderer: Setting custom API`)
    fs.readFile(path.join(configDir, "settings.conf"), (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file. Error: ${error}`)
            swal("Whoops!", "We can't read the settings.conf file.", "error")
            return
        }
        let current = JSON.parse(data)
        current["customAPI"] = $("#customAPI").val()
        fs.writeFile(path.join(configDir, "settings.conf"), JSON.stringify(current), (error) => {
            if (error) {
                log.error(`Renderer: Error writing to settings file. Error: ${error}`)
                swal("Whoops!", "We can't write to the settings.conf file.", "error")
                return
            }
            log.info(`Renderer: Custom API set.`)
            $("#customAPI").val('')
            swal("Success!", "Your custom API server has been set.", "success")
        })
    })
})

$("#customWebpageSubmit").on("click", () => {
    log.info(`Renderer: Setting custom webpage`)
    fs.readFile(path.join(configDir, "settings.conf"), (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file. Error: ${error}`)
            swal("Whoops!", "We can't read the settings.conf file.", "error")
            return
        }
        let current = JSON.parse(data)
        current["customWebpage"] = $("#customWebpage").val()
        fs.writeFile(path.join(configDir, "settings.conf"), JSON.stringify(current), (error) => {
            if (error) {
                log.error(`Renderer: Error writing to settings file. Error: ${error}`)
                swal("Whoops!", "We can't write to the settings.conf file.", "error")
                return
            }
            log.info(`Renderer: Custom webpage set.`)
            $("#customWebpage").val('')
            swal("Success!", "Your custom webpage has been set.", "success")
        })
    })
})

$("#customAPIClear").on("click", () => {
    log.info(`Renderer: Clearing custom API.`)
    fs.readFile(path.join(configDir, "settings.conf"), (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file. Error: ${error}`)
            swal("Whoops!", "We can't read the settings.conf file.", "error")
            return
        }
        let current = JSON.parse(data)
        delete current["customAPI"]
        fs.writeFile(path.join(configDir, "settings.conf"), JSON.stringify(current), (error) => {
            if (error) {
                log.error(`Renderer: Error writing to settings file. Error: ${error}`)
                swal("Whoops!", "We can't write to the settings.conf file.", "error")
                return
            }
            log.info(`Renderer: Custom API cleared.`)
            $("#customAPI").val('')
            swal("Success!", "Your custom API server has been cleared.", "success")
        })
    })
})

$("#customWebpageClear").on("click", () => {
    log.info(`Renderer: Clearing custom webpage.`)
    fs.readFile(path.join(configDir, "settings.conf"), (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file. Error: ${error}`)
            swal("Whoops!", "We can't read the settings.conf file.", "error")
            return
        }
        let current = JSON.parse(data)
        delete current["customWebpage"]
        fs.writeFile(path.join(configDir, "settings.conf"), JSON.stringify(current), (error) => {
            if (error) {
                log.error(`Renderer: Error writing to settings file. Error: ${error}`)
                swal("Whoops!", "We can't write to the settings.conf file.", "error")
                return
            }
            log.info(`Renderer: Custom webpage cleared.`)
            $("#customWebpage").val('')
            swal("Success!", "Your custom webpage server has been cleared.", "success")
        })
    })
})

$("#rsa_regen").on("click", () => {
    log.info(`Renderer: Regenerating RSA keypair`)
    let key = new nodersa()
    key.generateKeyPair()
    let publicKey = key.exportKey('public')
    let privateKey = key.exportKey('private')
    fs.unlink(path.join(__dirname, '../..', 'keys/public'), (error) => {
        if (error) {
            log.error(`Renderer: Error occurred deleting public key. Error: ${error}`)
            swal("Whoops!", "We couldn't delete the original public key.", "error")
            return;
        }
        fs.writeFile(path.join(__dirname, '../..', 'keys/public'), publicKey, (error) => {
            if (error) {
                log.error(`Renderer: Error occurred writing the public key. Error: ${error}`)
                swal("Whoops!", "We couldn't write the new public key.", "error")
                return;
            }
        })
        fs.unlink(path.join(__dirname, '../..', 'keys/private'), (error) => {
            if (error) {
                log.error(`Renderer: Error occurred deleting private key. Error: ${error}`)
                swal("Whoops!", "We couldn't delete the original private key.", "error")
                return
            }
            fs.writeFile(path.join(__dirname, '../..', 'keys/private'), privateKey, (error) => {
                if (error) {
                    log.error(`Renderer: Error occurred writing the private key. Error: ${error}`)
                    swal("Whoops!", "We couldn't write the new private key.", "error")
                    return
                }
                log.info(`Renderer: RSA keypair regenerated.`)
                swal("Success!", "RSA keypair regenerated.", "success")
                $("#settings").modal('toggle')
            })
        })
    })
})

$("#reset").on("click", () => {
    log.info(`Resetting config.`)
    let content = JSON.stringify({})
    fs.writeFile(path.join(configDir, "settings.conf"), content, (error) => {
        if (error) {
            log.error(`Renderer: Error writing the settings file. Error: ${error}`)
            swal("Whoops!", "We can't write the settings.conf file.", "error")
            return
        }
        log.info(`Renderer: Config file reset!`)
        swal("Success!", "The config file has been reset. All settings are now at default.", "success")
        $("#settings").modal('toggle')
    })
})

$("#disableKillSwitch").on("click", () => {
    swal({
        title: "Are you sure?",
        text: "Disabling the kill switch will reconnect you to the internet. Check to make sure you aren't doing anything in the background.",
        icon: "warning",
        buttons: true,
        dangerMode: true,
    }).then((willDisable) => {
        if (willDisable) {
            main.disableKillSwitch()
        }
    });
})

$("#reopenBrowser").on('click', () => {
    fs.readFile(path.join(configDir, 'settings.conf'), 'utf8', (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file for customWebpage. Error: ${error}`)
            swal("Whoops!", "We were unable to read your settings file. Please try rebooting the client.", "error")
            return;
        }
        let settingsFile = JSON.parse(data)
        if (settingsFile["customWebpage"]) {
            log.info(`Renderer: Opening webpage with custom URL.`)
            require('electron').shell.openExternal(`${settingsFile["customWebpage"]}/connection?id=${settingsFile["latestId"]}`)
        } else {
            log.info(`Renderer: Opening webpage with standard URL.`)
            require('electron').shell.openExternal(`https://unrestrict.me/connection?id=${settingsFile["latestId"]}`)
        }
    })
})

$("#adapterSelect").on('change', () => {
    fs.readFile(path.join(configDir, "settings.conf"), (error, data) => {
        if (error) {
            log.error(`Renderer: Error reading settings file. Error: ${error}`)
            swal("Whoops!", "We can't read the settings.conf file.", "error")
            return
        }
        let current = JSON.parse(data)
        current["selectedNic"] = $("#adapterSelect").val()
        log.debug(`Renderer: Selected NIC changing to ${$("#adapterSelect").val()}`)
        fs.writeFile(path.join(configDir, "settings.conf"), JSON.stringify(current), (error) => {
            if (error) {
                log.error(`Renderer: Error writing to settings file. Error: ${error}`)
                swal("Whoops!", "We can't write to the settings.conf file.", "error")
                return
            }
        })
    })
})

function populateConnected (localIp, publicIp, connectionId) {
    if (interval) {
        clearInterval(interval);
    }
    log.info(`Renderer: Populating connected divider.`)
    //This populates the connected div info panel
    $("#placeholderIP").html(`${localIp} / ${publicIp}`)
    $("#placeholderConnectionID").html(`${connectionId}`)
    $("#placeholderTimeRemaining").css("display", "inline")
    var countdownTo = new Date()
    countdownTo.setDate(countdownTo.getDate() + 1);
    interval = setInterval(function() {
        var now = new Date().getTime();
        var distance = countdownTo - now;
        var days = Math.floor(distance / (1000 * 60 * 60 * 24));
        var hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        var seconds = Math.floor((distance % (1000 * 60)) / 1000);
        $("#placeholderTimeRemaining").html(`${hours}h ${minutes}m (<a href="#" data-toggle="modal" data-target="#timeRemainingFaq">What is this?</a>)`)
        if (distance < 0) {
            $("#placeholderTimeRemaining").html("Connection has expired. Expect to disconnect shortly. Fail safe will engage.")
        }
    }, 1000); 
}