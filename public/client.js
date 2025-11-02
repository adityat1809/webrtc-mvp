const socket = io();

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const endBtn = document.getElementById('endBtn');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');

let localStream;
let peerConnection;
let dataChannel;

const roomId = localStorage.getItem('room');
const role = localStorage.getItem('role');

let isReady = false;
let otherReady = false;

if (!roomId) {
  alert('No room found. Please join again.');
  window.location.href = '/';
}

const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// --- Initialize media devices ---
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    console.log('✅ Media initialized');
    socket.emit('join', roomId);
  } catch (err) {
    console.error('❌ Error accessing media devices:', err);
    alert('Please allow camera and microphone access.');
  }
}

// --- Create PeerConnection ---
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(servers);
  addConnectionMonitor(); // ✅ monitor state

  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = (event) => {
    console.log('🎥 Remote stream received');
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, roomId });
    }
  };

  if (role === 'doctor') {
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);
  } else {
    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };
  }
}

// --- Monitor connection state ---
function addConnectionMonitor() {
  if (!peerConnection) return;
  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      console.log('✅ Peer connected, starting stats monitor');
      startStatsMonitor();
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'closed') {
      stopStatsMonitor();
    }
  };
}

// --- Chat Setup + Ping RTT ---
function setupDataChannel(channel) {
  const chatBox = document.getElementById('chatBox');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');

  channel.onopen = () => {
    console.log('💬 Chat channel opened');
    startStatsMonitor();
  };

  channel.onmessage = (event) => {
    try {
      const payload = typeof event.data === 'string' ? JSON.parse(event.data) : null;
      if (payload && payload.type === 'pc-ping') {
        channel.send(JSON.stringify({ type: 'pc-pong', ts: payload.ts }));
        return;
      } else if (payload && payload.type === 'pc-pong') {
        const now = performance.now();
        lastRTT = now - payload.ts;
        return;
      }
    } catch (e) {}

    const msg = document.createElement('div');
    msg.className = 'text-left mb-1';
    msg.innerHTML = `<span class="bg-gray-200 px-2 py-1 rounded-lg inline-block">${event.data}</span>`;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
  };

  const send = () => {
    const message = chatInput.value.trim();
    if (!message || channel.readyState !== 'open') return;

    channel.send(message);
    const msg = document.createElement('div');
    msg.className = 'text-right mb-1';
    msg.innerHTML = `<span class="bg-blue-500 text-white px-2 py-1 rounded-lg inline-block">${message}</span>`;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
    chatInput.value = '';
  };

  sendBtn.onclick = send;
  chatInput.onkeypress = (e) => { if (e.key === 'Enter') send(); };
}

// --- Signaling Logic ---
socket.on('connect', () => {
  console.log('🔌 Connected to signaling server');
});

initMedia().then(() => {
  isReady = true;
  socket.emit('ready', roomId);
});

socket.on('ready', () => {
  console.log('👥 A user is ready');
  otherReady = true;

  const waitingScreen = document.getElementById('waitingScreen');
  if (isReady && otherReady && waitingScreen) {
    waitingScreen.style.display = 'none';
  }

  if (isReady && otherReady) {
    if (role === 'doctor') {
      console.log('📞 Both ready — doctor starting call');
      startCall();
    } else {
      console.log('🧏 Waiting for offer from doctor...');
    }
  }
});

function startCall() {
  console.log('📞 Starting call (doctor)');
  createPeerConnection();

  peerConnection.createOffer()
    .then(offer => {
      peerConnection.setLocalDescription(offer);
      socket.emit('offer', { offer, roomId });
    })
    .catch(err => console.error('❌ Error creating offer:', err));
}

socket.on('offer', async (data) => {
  console.log('📨 Offer received');
  createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('answer', { answer, roomId });
});

socket.on('answer', async (data) => {
  console.log('✅ Answer received');
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
  if (peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});

// --- Mute / Unmute ---
let isMuted = false;
muteBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTracks = localStream.getAudioTracks();
  if (!audioTracks.length) return;

  isMuted = !isMuted;
  audioTracks.forEach(track => track.enabled = !isMuted);
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('bg-gray-500', isMuted);
  muteBtn.classList.toggle('bg-blue-600', !isMuted);
});

// --- Camera On / Off ---
let isCameraOff = false;
cameraBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  if (!videoTracks.length) return;

  isCameraOff = !isCameraOff;
  videoTracks.forEach(track => track.enabled = !isCameraOff);
  cameraBtn.textContent = isCameraOff ? 'Camera On' : 'Camera Off';
  cameraBtn.classList.toggle('bg-gray-500', isCameraOff);
  cameraBtn.classList.toggle('bg-blue-600', !isCameraOff);
});

// --- End Call ---
function endCall(cleanupOnly = false) {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  if (!cleanupOnly) {
    socket.emit('end-call', { roomId });
    window.location.href = '/';
  }
}

endBtn.addEventListener('click', () => endCall());

socket.on('call-ended', () => {
  alert('📞 The other user has ended the call.');
  endCall(true);
  window.location.href = '/';
});

// --- Real-time Stats Monitor ---
let statsInterval = null;
let lastStats = null;
let lastRTT = 0;

function startStatsMonitor() {
  if (statsInterval) return;

  statsInterval = setInterval(async () => {
    if (!peerConnection) return;

    const stats = await peerConnection.getStats();
    let jitter = 0, packetsLost = 0, packetsSent = 0, packetsRecv = 0;
    let bitrateSend = 0, bitrateRecv = 0;

    stats.forEach(report => {
      if (report.type === 'outbound-rtp' && !report.isRemote) {
        bitrateSend += report.bytesSent;
        packetsSent += report.packetsSent || 0;
      } else if (report.type === 'inbound-rtp' && !report.isRemote) {
        bitrateRecv += report.bytesReceived;
        packetsRecv += report.packetsReceived || 0;
        packetsLost += report.packetsLost || 0;
        jitter = report.jitter ? report.jitter * 1000 : jitter;
      }
    });

    const now = Date.now();
    if (lastStats) {
      const timeDiff = (now - lastStats.time) / 1000;
      const sendBw = ((bitrateSend - lastStats.bitrateSend) * 8) / timeDiff / 1000;
      const recvBw = ((bitrateRecv - lastStats.bitrateRecv) * 8) / timeDiff / 1000;
      const totalPackets = packetsRecv + packetsLost;
      const loss = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

      updateStatsUI(lastRTT.toFixed(1), jitter.toFixed(1), loss.toFixed(2), sendBw.toFixed(1), recvBw.toFixed(1));
    }

    lastStats = {
      time: now,
      bitrateSend,
      bitrateRecv
    };

    // send ping
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'pc-ping', ts: performance.now() }));
    }
  }, 1000);
}

function stopStatsMonitor() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

function updateStatsUI(latency, jitter, loss, sendBw, recvBw) {
  const el = document.getElementById('statsBox');
  if (!el) return;
  el.innerHTML = `
    // Latency (RTT): ${latency} ms<br>
    // Jitter: ${jitter} ms<br>
    // Packet loss: ${loss} %<br>
    // Send bandwidth: ${sendBw} kb/s<br>
    // Recv bandwidth: ${recvBw} kb/s<br>
    // Last update: ${new Date().toLocaleTimeString()}
  `;
}
