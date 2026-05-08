const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const players = {};

function randomColor() {
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h}, 70%, 55%)`;
}

function spawnPosition() {
  return {
    x: (Math.random() - 0.5) * 10,
    y: 0.5,
    z: (Math.random() - 0.5) * 10,
  };
}

io.on('connection', (socket) => {
  socket.on('join', (rawName) => {
    if (players[socket.id]) return;
    const name = (rawName || 'Player').toString().trim().slice(0, 20) || 'Player';
    const pos = spawnPosition();
    players[socket.id] = {
      id: socket.id,
      name,
      color: randomColor(),
      x: pos.x,
      y: pos.y,
      z: pos.z,
    };
    socket.emit('init', { id: socket.id, players });
    socket.broadcast.emit('player-joined', players[socket.id]);
  });

  socket.on('move', (pos) => {
    const p = players[socket.id];
    if (!p || !pos) return;
    if (typeof pos.x !== 'number' || typeof pos.z !== 'number') return;
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    socket.broadcast.emit('player-moved', { id: socket.id, x: p.x, y: p.y, z: p.z });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      delete players[socket.id];
      io.emit('player-left', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
