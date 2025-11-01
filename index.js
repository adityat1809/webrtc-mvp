const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..public/index.html'));
});

app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, '..public/join.html'));
});

app.get('/call', (req, res) => {
  res.sendFile(path.join(__dirname, '..public/call.html'));
});

io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  socket.on('join', (roomId) => {
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`👥 ${socket.id} joined room ${roomId}`);

    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    console.log(`Room ${roomId} now has ${clients.length} user(s)`);

    // When second user joins, both are ready
    if (clients.length === 2) {
      io.to(roomId).emit('ready');
      socket.on('end-call', () => {
  if (socket.roomId) {
    console.log(`☎️ Call ended by ${socket.id} in room ${socket.roomId}`);
    socket.to(socket.roomId).emit('call-ended');
  }
});

    }
    socket.on('end-call', () => {
        if (socket.roomId) {
          console.log(`☎️ Call ended by ${socket.id} in room ${socket.roomId}`);
          socket.to(socket.roomId).emit('call-ended');
        }
      });
      
  });

  // Explicit ready event for reliability
  socket.on('ready', (roomId) => {
    socket.to(roomId).emit('ready');
  });

  socket.on('offer', (data) => {
    console.log('📤 Offer from', socket.id);
    socket.to(data.roomId).emit('offer', data);
  });

  socket.on('answer', (data) => {
    console.log('📥 Answer from', socket.id);
    socket.to(data.roomId).emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.roomId).emit('ice-candidate', data);
  });

  // --- Chat ---
  socket.on('chat-message', (data) => {
    console.log(`💬 ${data.sender}: ${data.message}`);
    socket.to(data.roomId).emit('chat-message', {
      sender: data.sender,
      message: data.message
    });
  });

  socket.on('disconnect', () => {
    console.log('🔴 Disconnected:', socket.id);
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-disconnected', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

