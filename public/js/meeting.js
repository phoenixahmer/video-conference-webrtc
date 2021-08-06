'use strict';

var Meeting = function (socketioHost) {
  var exports = {};

  var _isInitiator = false;
  var _localStream;
  var _remoteStream;
  var _pcConfig = {
    'iceServers': [
      {
        'url': 'stun:stun.l.google.com:19302'
      },
      {
        "urls": "turn:your-aws-instance:3478?transport=tcp",
        "username": "username",
        "credential": "password"
      },
      {
        "urls": "stun:your-aws-instance:3478?transport=tcp"
      }]
  };
  var _constraints = { video: true, audio: true };
  var _defaultChannel;
  var _privateAnswerChannel;
  var _offerChannels = {};
  var _opc = {};
  var _apc = {};
  var _sendChannel = {};
  var _myID;
  var _onRemoteVideoCallback;
  var _onLocalVideoCallback;
  var _host = socketioHost;

  ////////////////////////////////////////////////
  // PUBLIC FUNCTIONS
  ////////////////////////////////////////////////

  function generateID() {
    var s4 = function () { return Math.floor(Math.random() * 0x10000).toString(16) }
    return s4() + s4() + "-" + s4() + "-" + s4() + "-" + s4() + "-" + s4() + s4() + s4()
  }

  function joinRoom(roomName) {

    _myID = generateID()
    console.log({ myID: _myID })

    // Open up a default communication channel
    initDefaultChannel()

    if (roomName !== '') {
      console.log('Create or join room', roomName)
      _defaultChannel.emit('create or join', { room: roomName, from: _myID })
    }

    // Open up a private communication channel
    initPrivateChannel()

    // Get local media data
    navigator.mediaDevices.getUserMedia(_constraints).then(handleUserMedia, printError)

    window.onbeforeunload = () => _defaultChannel.emit('message', { type: 'bye', from: _myID })
  }

  // Add callback function to be called when local video is available.
  const onLocalVideo = callback => _onLocalVideoCallback = callback

  // Add callback function to be called when remote video is available.
  const onRemoteVideo = callback => _onRemoteVideoCallback = callback
  
  // Add callback function to be called when remote video is added.
  const addRemoteVideo = (stream, from) => _onRemoteVideoCallback(stream, from)

  // handling error 
  const printError = error => console.log({ error })

  // remove connection
  function hangup(from) {
    if (_opc.hasOwnProperty(from)) {
      _opc[from].close();
      _opc[from] = null;
    }

    if (_apc.hasOwnProperty(from)) {
      _apc[from].close();
      _apc[from] = null;
    }

    $("#" + from).remove() // remove video tag from ui
  }

  ////////////////////////////////////////////////
  // INIT FUNCTIONS
  ////////////////////////////////////////////////

  function initDefaultChannel() {
    _defaultChannel = openSignalingChannel('')

    _defaultChannel.on('created', room => {
      console.log({ room_created: room })
      _isInitiator = true
    })

    _defaultChannel.on('message', message => {
      console.log('Client received message:', message)
      if (message.type === 'newparticipant') {
        var partID = message.from

        // Open a new communication channel to the new participant
        _offerChannels[partID] = openSignalingChannel(partID)

        // Wait for answers (to offers) from the new participant
        _offerChannels[partID].on('message', msg => {
          if (msg.dest === _myID) {
            if (msg.type === 'answer') {
              _opc[msg.from].setRemoteDescription(new RTCSessionDescription(msg.snDescription), () => { }, printError)
            } else if (msg.type === 'candidate') {
              var candidate = new RTCIceCandidate({ sdpMLineIndex: msg.label, candidate: msg.candidate })
              console.log('got ice candidate from ' + msg.from)
              _opc[msg.from].addIceCandidate(candidate, () => { }, printError)
            }
          }
        })

        // Send an offer to the new participant
        createOffer(partID)
      }

      else if (message.type === 'bye') hangup(message.from)
    })
  }

  function initPrivateChannel() {
    // Open a private channel (namespace = _myID) to receive offers
    _privateAnswerChannel = openSignalingChannel(_myID);

    // Wait for offers or ice candidates
    _privateAnswerChannel.on('message', function (message) {
      if (message.dest === _myID) {
        if (message.type === 'offer') {
          var to = message.from;
          createAnswer(message, _privateAnswerChannel, to);
        } else if (message.type === 'candidate') {
          var candidate = new RTCIceCandidate({ sdpMLineIndex: message.label, candidate: message.candidate });
          _apc[message.from].addIceCandidate(candidate, () => { }, printError);
        }
      }
    });
  }

  ////////////////////////////////////////////////
  // COMMUNICATION FUNCTIONS
  ////////////////////////////////////////////////

  // Connect to the server and open a signal channel using channel as the channel's name.
  function openSignalingChannel(channel) {
    console.log({ Opening_private_channel: namespace });

    var namespace = _host + '/' + channel;
    var sckt = io.connect(namespace, { 'forceNew': true, 'transports': ['websocket'] });
    return sckt;
  }

  // Send an offer to peer with id participantId
  function createOffer(participantId) {
    console.log('Creating offer for peer ' + participantId);
    _opc[participantId] = new RTCPeerConnection(_pcConfig);
    _opc[participantId].onicecandidate = handleIceCandidateAnswerWrapper(_offerChannels[participantId], participantId);
    _opc[participantId].ontrack = handleRemoteStreamAdded(participantId);
    _opc[participantId].onremovestream = handleRemoteStreamRemoved;
    _opc[participantId].addStream(_localStream);

    try {
      // Reliable Data Channels not yet supported in Chrome
      _sendChannel[participantId] = _opc[participantId].createDataChannel("sendDataChannel", { reliable: false });
      console.log('Created send data channel');
    } catch (e) {
      alert('Failed to create data channel. ' + 'You need Chrome M25 or later with RtpDataChannel enabled');
      console.log('createDataChannel() failed with exception: ' + e.message);
    }
    _sendChannel[participantId].onopen = handleSendChannelStateChange(participantId);
    _sendChannel[participantId].onclose = handleSendChannelStateChange(participantId);

    var onSuccess = function (participantId) {
      return function (sessionDescription) {
        var channel = _offerChannels[participantId];

        // Set Opus as the preferred codec in SDP if Opus is present.
        sessionDescription.sdp = preferOpus(sessionDescription.sdp);

        _opc[participantId].setLocalDescription(sessionDescription, () => { }, printError);
        console.log('Sending offer to channel ' + channel.nsp);
        channel.emit('message', { snDescription: sessionDescription, from: _myID, type: 'offer', dest: participantId });
      }
    }

    _opc[participantId].createOffer(onSuccess(participantId), printError);
  }

  function createAnswer(sdp, cnl, to) {
    console.log('Creating answer for peer ' + to);
    _apc[to] = new RTCPeerConnection(_pcConfig);
    _apc[to].ontrack = handleIceCandidateAnswerWrapper(cnl, to);
    _apc[to].ontrack = handleRemoteStreamAdded(to);
    _apc[to].onremovestream = handleRemoteStreamRemoved;
    _apc[to].addStream(_localStream);
    _apc[to].setRemoteDescription(new RTCSessionDescription(sdp.snDescription), () => { }, printError);

    _apc[to].ondatachannel = gotReceiveChannel(to);

    var onSuccess = function (channel) {
      return function (sessionDescription) {
        87
        // Set Opus as the preferred codec in SDP if Opus is present.
        sessionDescription.sdp = preferOpus(sessionDescription.sdp);

        _apc[to].setLocalDescription(sessionDescription, () => { }, printError);
        console.log('Sending answer to channel ' + channel.nsp);
        channel.emit('message', { snDescription: sessionDescription, from: _myID, type: 'answer', dest: to });
      }
    }

    _apc[to].createAnswer(onSuccess(cnl), printError);
  }

  ////////////////////////////////////////////////
  // HANDLERS
  ////////////////////////////////////////////////

  function handleUserMedia(stream) {
    console.log({ message: 'local stream added' });
    _onLocalVideoCallback(stream);
    _localStream = stream;
    _defaultChannel.emit('message', { type: 'newparticipant', from: _myID });
  }

  function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
  }

  function handleRemoteStreamAdded(from) {
    return function (event) {
      console.log('Remote stream added');

      _remoteStream = event.streams[0];

      if (event.track.kind == "video") {
        addRemoteVideo(_remoteStream, from);
      }
    }
  }

  function handleIceCandidateAnswerWrapper(channel, to) {
    return function handleIceCandidate(event) {
      console.log('handleIceCandidate event');
      if (event.candidate) {
        channel.emit('message',
          {
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate,
            from: _myID,
            dest: to
          }
        );

      } else {
        console.log('End of candidates.');
      }
    }
  }

  function gotReceiveChannel(id) {
    return function (event) {
      console.log('Receive Channel Callback');
      _sendChannel[id] = event.channel;
      _sendChannel[id].onopen = handleReceiveChannelStateChange(id);
      _sendChannel[id].onclose = handleReceiveChannelStateChange(id);
    }
  }

  function handleSendChannelStateChange(participantId) {
    return function () {
      var readyState = _sendChannel[participantId].readyState;
      console.log('Send channel state is: ' + readyState);
    }
  }

  function handleReceiveChannelStateChange(participantId) {
    return function () {
      var readyState = _sendChannel[participantId].readyState;
      console.log('Receive channel state is: ' + readyState);
    }
  }

  ////////////////////////////////////////////////
  // CODEC
  ////////////////////////////////////////////////

  // Set Opus as the default audio codec if it's present.
  function preferOpus(sdp) {
    var sdpLines = sdp.split('\r\n');
    var mLineIndex;
    // Search for m line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('m=audio') !== -1) {
        mLineIndex = i;
        break;
      }
    }
    if (mLineIndex === null || mLineIndex === undefined) {
      return sdp;
    }

    // If Opus is available, set it as the default in m line.
    for (i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('opus/48000') !== -1) {
        var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        if (opusPayload) {
          sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], opusPayload);
        }
        break;
      }
    }

    // Remove CN in m line and sdp.
    sdpLines = removeCN(sdpLines, mLineIndex);

    sdp = sdpLines.join('\r\n');
    return sdp;
  }

  function extractSdp(sdpLine, pattern) {
    var result = sdpLine.match(pattern);
    return result && result.length === 2 ? result[1] : null;
  }

  // Set the selected codec to the first in m line.
  function setDefaultCodec(mLine, payload) {
    var elements = mLine.split(' ');
    var newLine = [];
    var index = 0;
    for (var i = 0; i < elements.length; i++) {
      if (index === 3) { // Format of media starts from the fourth.
        newLine[index++] = payload; // Put target payload to the first.
      }
      if (elements[i] !== payload) {
        newLine[index++] = elements[i];
      }
    }
    return newLine.join(' ');
  }

  // Strip CN from sdp before CN constraints is ready.
  function removeCN(sdpLines, mLineIndex) {
    var mLineElements = sdpLines[mLineIndex].split(' ');
    // Scan from end for the convenience of removing an item.
    for (var i = sdpLines.length - 1; i >= 0; i--) {
      var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
      if (payload) {
        var cnPos = mLineElements.indexOf(payload);
        if (cnPos !== -1) {
          // Remove CN payload from m line.
          mLineElements.splice(cnPos, 1);
        }
        // Remove CN line in sdp
        sdpLines.splice(i, 1);
      }
    }

    sdpLines[mLineIndex] = mLineElements.join(' ');
    return sdpLines;
  }

  ////////////////////////////////////////////////
  // EXPORT PUBLIC FUNCTIONS
  ////////////////////////////////////////////////

  exports.joinRoom = joinRoom;
  exports.onLocalVideo = onLocalVideo;
  exports.onRemoteVideo = onRemoteVideo;
  return exports;

};
