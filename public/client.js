// public/client.js (replace your file with this)
const socket = io();

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const endBtn = document.getElementById('endBtn');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');

let localStream = null;
let peerConnection = null;
let dataChannel = null;
let createdOffer = false; // guard to avoid duplicate offers

const roomId = localStorage.getItem('room');
const role = localStorage.getItem('role'); // expected 'doctor' or something else

if (!roomId) {
  alert('No room found. Please join again.');
  window.location.href = '/';
}

console.log('🔎 roomId:', roomId, ' role:', role);

const servers = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    // Keep TURN only if you have valid TURN credentials. This is for testing.
    {
      urls: 'turn:relay.metered.ca:80',
      username: 'openai',
      credential: 'openai123'
    }
  ]
};

// --- Initialize media devices (only call once) ---
async function initMedia() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    console.log('✅ Media initialized, tracks:', localStream.getTracks().map(t => t.kind));
    // join room after media allowed
    socket.emit('join', roomId);
    return localStream;
  } catch (err) {
    console.error('❌ Error accessing media devices:', err);
    alert('Please allow camera and microphone access.');
    throw err;
  }
}

// --- Create PeerConnection (idempotent) ---
function createPeerConnection() {
  if (peerConnection) return peerConnection;
  console.log('🔧 Creating RTCPeerConnection with servers:', servers);
  peerConnection = new RTCPeerConnection(servers);

  // add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  }

  peerConnection.ontrack = (event) => {
    console.log('🎥 Remote stream received (ontrack)', event.streams);
    remoteVideo.srcObject = event.streams[0];
    // mobile browsers sometimes need an explicit play
    remoteVideo.play().catch(e => console.warn('remoteVideo.play() error:', e));
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('🔹 Emitting ICE candidate', event.candidate);
      socket.emit('ice-candidate', { candidate: event.candidate, roomId });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('🔁 PeerConnection state:', peerConnection.connectionState);
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('🔁 ICE connection state:', peerConnection.iceConnectionState);
  };

  // data channel setup
  if (role === 'doctor') {
    console.log('🩺 role doctor -> creating data channel');
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);
  } else {
    peerConnection.ondatachannel = (event) => {
      console.log('📥 ondatachannel event');
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };
  }

  return peerConnection;
}

// --- Chat Setup ---
function setupDataChannel(channel) {
  const chatBox = document.getElementById('chatBox');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');

  channel.onopen = () => console.log('💬 Chat channel opened (state=' + channel.readyState + ')');
  channel.onmessage = (event) => {
    const msg = document.createElement('div');
    msg.className = 'text-left mb-1';
    msg.innerHTML = `<span class="bg-gray-200 px-2 py-1 rounded-lg inline-block">${event.data}</span>`;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
  };

  const send = () => {
    const message = chatInput.value.trim();
    if (!message) return;
    if (!channel || channel.readyState !== 'open') {
      console.warn('❗ Data channel not open. Falling back to socket chat.');
      // fallback: socket-based chat if datachannel unavailable
      socket.emit('chat-message', { sender: role || 'user', message, roomId });
      chatInput.value = '';
      return;
    }
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

// --- Signaling listeners & call flow ---
socket.on('connect', () => {
  console.log('🔌 Connected to signaling server, socket id:', socket.id);
});

socket.on('ready', (payload) => {
  console.log('👥 received ready', payload);
  // hide waiting screen if present
  const waitingScreen = document.getElementById('waitingScreen');
  if (waitingScreen) waitingScreen.style.display = 'none';

  // create peer connection now (idempotent)
  createPeerConnection();

  // If doctor, create offer (guarded by createdOffer)
  if (role === 'doctor' && !createdOffer) {
    createdOffer = true;
    startCall();
  } else {
    console.log('ℹ️ Not doctor or offer already created; waiting for offer/answer exchange.');
  }
});

async function startCall() {
  try {
    console.log('📞 startCall: creating offer');
    const pc = createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { offer, roomId });
    console.log('📤 Offer emitted');
  } catch (err) {
    console.error('❌ Error in startCall:', err);
  }
}

socket.on('offer', async (data) => {
  console.log('📨 Offer received', data);
  try {
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { answer, roomId });
    console.log('📤 Answer emitted');
  } catch (err) {
    console.error('❌ Error handling offer:', err);
  }
});

socket.on('answer', async (data) => {
  console.log('✅ Answer received', data);
  try {
    if (!peerConnection) {
      console.warn('⚠️ Received answer but no peerConnection - creating one');
      createPeerConnection();
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } catch (err) {
    console.error('❌ Error setting remote description (answer):', err);
  }
});

socket.on('ice-candidate', async (data) => {
  console.log('🔹 ICE candidate received', data && data.candidate && data.candidate.candidate);
  try {
    if (peerConnection && data && data.candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else {
      console.warn('⚠️ No peerConnection or invalid candidate');
    }
  } catch (err) {
    console.error('❌ Error adding ICE candidate:', err);
  }
});

// fallback socket-based chat display (if we used it in setupDataChannel)
socket.on('chat-message', (data) => {
  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;
  const msg = document.createElement('div');
  msg.className = 'text-left mb-1';
  msg.innerHTML = `<span class="bg-gray-200 px-2 py-1 rounded-lg inline-block"><strong>${data.sender}:</strong> ${data.message}</span>`;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
});

// --- UI controls (mute/camera/end) ---
let isMuted = false;
muteBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTracks = localStream.getAudioTracks();
  if (!audioTracks.length) return;
  isMuted = !isMuted;
  audioTracks.forEach(track => track.enabled = !isMuted);
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
});

let isCameraOff = false;
cameraBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  if (!videoTracks.length) return;
  isCameraOff = !isCameraOff;
  videoTracks.forEach(track => track.enabled = !isCameraOff);
  cameraBtn.textContent = isCameraOff ? 'Camera On' : 'Camera Off';
});

function endCall(cleanupOnly = false) {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (!cleanupOnly) {
    socket.emit('end-call', { roomId });
    window.location.href = '/';
  }
}

endBtn.addEventListene
