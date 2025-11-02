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
