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
let callStarted = false; // ✅ Prevents duplicate offers

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

// --- Chat Setup ---
function setupDataChannel(channel) {
  const chatBox = document.getElementById('chatBox');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');

  channel.onopen = () => console.log('💬 Chat channel opened');
  channel.onmessage = (event) => {
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

// --- Socket events ---
socket.on('connect', () => {
  console.log('🔌 Connected to signaling server');
});

// --- Start Media and mark as ready ---
initMedia().then(() => {
  isReady = true;
  socket.emit('ready', roomId);
});

// --- When another peer is ready ---
socket.on('ready', () => {
  console.log('👥 A user is ready');
  otherReady = true;

  const waitingScreen = document.getElementById('waitingScreen');
  if (isReady && otherReady && waitingScreen) {
    waitingScreen.style.display = 'none';
  }

  // ✅ Ensure only the doctor starts the call ONCE
  if (isReady && otherReady && role === 'doctor' && !callStarted) {
    callStarted = true;
    console.log('📞 Both ready — doctor starting call');
    startCall();
  } else if (role !== 'doctor') {
    console.log('🧏 Waiting for offer from doctor...');
  }
});

// --- Start call ---
async function startCall() {
  try {
    createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { offer, roomId });
    console.log('📤 Offer sent');
  } catch (err) {
    console.error('❌ Error creating offer:', err);
  }
}

// --- Handle Offer / Answer / ICE ---
socket.on('offer', async (data) => {
  console.log('📨 Offer received');
  if (peerConnection && peerConnection.signalingState !== 'stable') {
    console.warn('⚠️ Skipping duplicate offer');
    return;
  }
  createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('answer', { answer, roomId });
  console.log('📤 Answer sent');
});

socket.on('answer', async (data) => {
  console.log('✅ Answer received');
  try {
    if (peerConnection.signalingState === 'have-local-offer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else {
      console.warn('⚠️ Skipped answer — wrong state:', peerConnection.signalingState);
    }
  } catch (err) {
    console.error('❌ Error applying answer:', err);
  }
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



// ====== Call Stats Monitor ======
let statsInterval = null;
let lastStats = {
  timestamp: 0,
  bytesSent: 0,
  bytesReceived: 0,
  packetsLost: 0,
  packetsReceived: 0
};
const STATS_INTERVAL_MS = 1000; // sample every 1 second

// latency: implemented via datachannel ping/pong
let lastPingTime = null;
let lastRTT = null;
function sendPing() {
  if (dataChannel && dataChannel.readyState === 'open') {
    lastPingTime = performance.now();
    // send small ping object with unique id + timestamp
    dataChannel.send(JSON.stringify({ type: 'pc-ping', ts: lastPingTime }));
  }
}

// handle incoming ping/pong on setupDataChannel - extend that function
// inside setupDataChannel(channel) add:
channel.onmessage = (event) => {
  try {
    const payload = typeof event.data === 'string' ? JSON.parse(event.data) : null;
    if (payload && payload.type === 'pc-ping') {
      // echo back as pong with original ts
      channel.send(JSON.stringify({ type: 'pc-pong', ts: payload.ts }));
      return;
    } else if (payload && payload.type === 'pc-pong') {
      // compute RTT
      const now = performance.now();
      const rtt = now - payload.ts;
      lastRTT = rtt;
      // preserve older onmessage behavior for text messages:
      // if payload contains .text, or if it's not a ping/pong, fall through below
      // (the code will continue to treat non-json or other messages below)
    }
  } catch (e) {
    // not JSON ping/pong; continue to treat as normal chat message
  }

  // original chat message handling (your existing code)
  try {
    // If the message was a JSON ping/pong we've already handled it and returned above.
    if (typeof event.data === 'string') {
      // If it's not ping/pong JSON, treat as chat text
      // (this duplicates your existing handler—ensure you keep the original UI update behavior)
    }
  } catch (err) {
    console.warn('datachannel msg handling error', err);
  }
};

// (If you already set channel.onmessage in your setupDataChannel, merge the logic above
// into that existing handler rather than creating a second onmessage assignment.)

// Stats collection using getStats()
async function collectStats() {
  if (!peerConnection) return;
  try {
    const statsReport = await peerConnection.getStats(null);
    // The report is a map of stats objects. We'll find inbound-rtp and outbound-rtp
    let bytesSent = 0;
    let bytesReceived = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let jitter = null;

    statsReport.forEach(stat => {
      // WebRTC uses type 'outbound-rtp' and 'inbound-rtp' in Chrome
      if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
        // bytesSent present
        if (typeof stat.bytesSent === 'number') bytesSent += stat.bytesSent;
      }
      if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
        if (typeof stat.bytesSent === 'number') bytesSent += stat.bytesSent;
      }
      if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.kind === 'audio')) {
        if (typeof stat.bytesReceived === 'number') bytesReceived += stat.bytesReceived;
        if (typeof stat.packetsLost === 'number') packetsLost += stat.packetsLost;
        if (typeof stat.packetsReceived === 'number') packetsReceived += stat.packetsReceived;
        // jitter is in seconds (RFC3550) -> convert to ms if present (take last value if multiple)
        if (typeof stat.jitter === 'number') jitter = stat.jitter * 1000;
      }

      // Some browsers put aggregate bytes in 'transport' or 'candidate-pair' fields.
      // We prefer RTP stats above, but you can extend this if needed.
    });

    const now = performance.now();
    const deltaSec = lastStats.timestamp ? (now - lastStats.timestamp) / 1000 : STATS_INTERVAL_MS / 1000;

    // compute bandwidth (bits/sec) by diffing bytes
    const sentDelta = bytesSent - (lastStats.bytesSent || 0);
    const recvDelta = bytesReceived - (lastStats.bytesReceived || 0);

    const sendBps = sentDelta > 0 ? (sentDelta * 8) / deltaSec : 0;
    const recvBps = recvDelta > 0 ? (recvDelta * 8) / deltaSec : 0;

    // compute packet loss percentage since last sample
    let pktLossPct = 0;
    const totalReceived = packetsReceived - (lastStats.packetsReceived || 0);
    const lostDelta = packetsLost - (lastStats.packetsLost || 0);
    if (totalReceived + lostDelta > 0) {
      pktLossPct = ((lostDelta > 0 ? lostDelta : 0) / (totalReceived + (lostDelta > 0 ? lostDelta : 0))) * 100;
    }

    // update lastStats
    lastStats = {
      timestamp: now,
      bytesSent,
      bytesReceived,
      packetsLost,
      packetsReceived
    };

    // push to UI
    const elLatency = document.getElementById('stat-latency');
    const elJitter = document.getElementById('stat-jitter');
    const elPktLoss = document.getElementById('stat-pktloss');
    const elSendBw = document.getElementById('stat-send-bw');
    const elRecvBw = document.getElementById('stat-recv-bw');
    const elUpdated = document.getElementById('stat-updated');

    if (elLatency) elLatency.textContent = lastRTT ? Math.round(lastRTT) : '—';
    if (elJitter) elJitter.textContent = jitter !== null ? Math.round(jitter) : '—';
    if (elPktLoss) elPktLoss.textContent = pktLossPct.toFixed(2);
    if (elSendBw) elSendBw.textContent = (sendBps / 1024).toFixed(2);
    if (elRecvBw) elRecvBw.textContent = (recvBps / 1024).toFixed(2);
    if (elUpdated) elUpdated.textContent = new Date().toLocaleTimeString();

  } catch (err) {
    console.warn('collectStats error', err);
  }
}

// start/stop monitor functions
function startStatsMonitor() {
  if (statsInterval) return;
  // reset baseline
  lastStats = { timestamp: 0, bytesSent: 0, bytesReceived: 0, packetsLost: 0, packetsReceived: 0 };
  // ping frequently (every 1s) to get RTT via datachannel
  const pingTimer = setInterval(() => {
    sendPing();
  }, STATS_INTERVAL_MS);

  // collect stats on interval
  statsInterval = setInterval(() => {
    collectStats();
  }, STATS_INTERVAL_MS);

  // store pingTimer on the interval so we can clear both
  statsInterval.pingTimer = pingTimer;
}

function stopStatsMonitor() {
  if (!statsInterval) return;
  clearInterval(statsInterval);
  if (statsInterval.pingTimer) clearInterval(statsInterval.pingTimer);
  statsInterval = null;
  lastRTT = null;
  lastStats = { timestamp: 0, bytesSent: 0, bytesReceived: 0, packetsLost: 0, packetsReceived: 0 };
  // clear UI
  ['stat-latency','stat-jitter','stat-pktloss','stat-send-bw','stat-recv-bw','stat-updated'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}



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
