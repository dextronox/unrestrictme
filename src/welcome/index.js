const {remote} = require("electron")
const app = remote.app
const $ = jQuery = require('jquery')
const path = require("path")
const main = remote.require(path.resolve(__dirname, '../..', 'main.js'))

$("#step1_button").on("click", () => {
    $("#step1").css("display", "none")
    $("#step2").css("display", "block")
})

$("#step2_button").on("click", () => {
    $("#step2").css("display", "none")
    $("#step3").css("display", "block")
})

$("#step3_button1").on("click", () => {
    main.tap()
    $("#step3_button_div1").css("display", "none")
    $("#step3_button_div2").css("display", "block")
})

$("#step3_button2").on("click", () => {
    main.verify()
})


