//This is the unrestrict.me background node service.
//This file handles anything that requires elevation.
const net = require("net")
const log = require(`electron-log`)
function setLogValues() {
    //Create log file with a date naming schema.
    var date = new Date();
    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;
    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;
    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;
    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;
    let logDate = year + "-" + month + "-" + day + "-" + hour + "-" + min + "-" + sec;
    log.transports.file.level = 'info';
    log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
    log.transports.file.maxSize = 5 * 1024 * 1024;
    fs.mkdir(`${app.getPath('userData')}/logs/`, { recursive: true }, (error) => {
        if (!String(error).includes("EEXIST:")) {
            log.error(`Main: Couldn't create log directory. Error: ${error}`)
        } else {
            log.transports.file.stream = fs.createWriteStream(path.join(app.getPath('userData'), `logs/log-background-${logDate}.txt`));
        }
    });
    log.transports.file.streamConfig = { flags: 'w' };
}
setLogValues()
const client = net.createConnection({ port: 8124 }, () => {
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

function foregroundProcessDataHandler(data) {
    let dataInterpreted = JSON.parse(data)
}