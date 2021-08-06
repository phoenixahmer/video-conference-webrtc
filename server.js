'use strict'

// libraries
var express = require('express')
var cors = require('cors')
const http = require('http')

// settingup server
var serverPort = 8100
var socketIoServer = 'localhost' + ':' + serverPort
var app = express()
app.use(cors())
require('./router')(app, socketIoServer)

const server = http.createServer(app)
server.listen(serverPort, () => { console.log(`listening to ${serverPort}`) })
var io = require('socket.io').listen(server, { log: false, origins: '*:*' })

// ejs settings
app.use(express.static(__dirname + '/public'))
app.set('views', __dirname + '/views')
app.set('view engine', 'ejs')
app.engine('html', require('ejs').renderFile)

//websocket // socket io 
io.sockets.on('connection', function (socket) {

  socket.on('create or join', message => {
    var room = message.room
    socket.room = room

    var participantID = message.from
    configNameSpaceChannel(participantID)

    io.of('/').in(room).clients(function (error, clients) {

      clients.length == 0 && socket.emit('created', room)
      socket.join(room)

    })
  })

  socket.on('message', message =>
    socket.broadcast.to(socket.room).emit('message', message))

  // Setup a communication channel (namespace) to communicate with a given participant (participantID)
  function configNameSpaceChannel(room) {
    var nsp = '/' + room
    var socketNamespace = io.of(nsp)

    socketNamespace.on('connection', socket =>
      socket.on('message', message =>
        socket.broadcast.emit('message', message)))

    return socketNamespace
  }
})