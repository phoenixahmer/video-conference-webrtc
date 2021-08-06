'use strict'

var meeting
var host = HOST_ADDRESS // HOST_ADDRESS gets injected into room.ejs from the server side when it is rendered

$(document).ready(function () {

  meeting = new Meeting(host)

  meeting.onLocalVideo(
    stream => {
      document.querySelector('#localVideo').srcObject = stream
      $("#localVideo").prop('muted', true)
    }
  )

  meeting.onRemoteVideo(
    (stream, participantID) => addRemoteVideo(stream, participantID)
  )

  var room = window.location.pathname.match(/([^\/]*)\/*$/)[1]
  meeting.joinRoom(room)

}) // end of document.ready

function addRemoteVideo(stream, participantID) {

  const video = document.createElement('video')
  video.setAttribute("class", "videoBox")
  video.autoplay = true
  video.srcObject = stream

  var $videoBox = $("<div class='videoWrap' id='" + participantID + "'></div>")
  $videoBox.append(video)
  $("#videosWrapper").append($videoBox)

}
