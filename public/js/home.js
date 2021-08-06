'use strict'

var roomUrl

const shortUrl = () => { return ("000000" + (Math.random() * Math.pow(36, 6) << 0).toString(36)).slice(-6) }

const generateRoomUrl = () => {
  var room = shortUrl()
  roomUrl = 'http://' + window.location.host + '/' + room

  var link = document.getElementById("room-url")
  link.href = roomUrl
  link.innerHTML = roomUrl
}

$(document).ready(generateRoomUrl)