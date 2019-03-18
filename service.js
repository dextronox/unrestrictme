//This is the unrestrict.me background node service.
//This file handles anything that requires elevation.
const net = require("net")
const fs = require(`fs`)
const path = require("path")
const os = require("os")
function setLogValues() {
    //We need a new way of logging, because this script runs as root (i.e. different user environment)
}
setLogValues()
const client = net.createConnection({ port: 4964 }, () => {
    //Runs once connected to the server.
    log.info(`Background: Connected to client server. Ready to receive instructions.`)
});
client.on('data', (data) => {
    //We have received some data from the server.
    //data should always be JSON in buffer format
    log.info(`Background: Data received.`)
    foregroundProcessDataHandler(data.toString())
});
client.on('end', () => {
    //Connection has been ended. Kill this process.
    process.exit()
});
client.on('error', (error) => {
    log.error(`Background: An error occurred. Error: ${error}`)
})

function foregroundProcessDataHandler(data) {
    let dataInterpreted = JSON.parse(data)
}