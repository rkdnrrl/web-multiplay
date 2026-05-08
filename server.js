const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const players = {};
const enemies = {};
const ENEMY_COUNT = 8;
const ENEMY_BOUND = 23;
const ENEMY_SPEED_MIN = 1.2;
const ENEMY_SPEED_MAX = 2.8;
const ENEMY_TURN_INTERVAL_MIN = 900;
const ENEMY_TURN_INTERVAL_MAX = 2200;
const TICK_MS = 100;

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

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createEnemy(id) {
  const pos = {
    x: randomRange(-ENEMY_BOUND, ENEMY_BOUND),
    y: 0.5,
    z: randomRange(-ENEMY_BOUND, ENEMY_BOUND),
  };
  const angle = randomRange(0, Math.PI * 2);
  enemies[id] = {
    id,
    name: `Enemy-${id + 1}`,
    color: 'hsl(0, 80%, 55%)',
    x: pos.x,
    y: pos.y,
    z: pos.z,
    vx: Math.cos(angle),
    vz: Math.sin(angle),
    speed: randomRange(ENEMY_SPEED_MIN, ENEMY_SPEED_MAX),
    nextTurnAt: Date.now() + randomRange(ENEMY_TURN_INTERVAL_MIN, ENEMY_TURN_INTERVAL_MAX),
  };
}

function initEnemies() {
  for (let i = 0; i < ENEMY_COUNT; i += 1) {
    createEnemy(i);
  }
}

function maybeTurnEnemy(enemy, now) {
  if (now < enemy.nextTurnAt) return;
  const angle = randomRange(0, Math.PI * 2);
  enemy.vx = Math.cos(angle);
  enemy.vz = Math.sin(angle);
  enemy.speed = randomRange(ENEMY_SPEED_MIN, ENEMY_SPEED_MAX);
  enemy.nextTurnAt = now + randomRange(ENEMY_TURN_INTERVAL_MIN, ENEMY_TURN_INTERVAL_MAX);
}

function bounceEnemy(enemy) {
  if (enemy.x <= -ENEMY_BOUND || enemy.x >= ENEMY_BOUND) {
    enemy.vx *= -1;
  }
  if (enemy.z <= -ENEMY_BOUND || enemy.z >= ENEMY_BOUND) {
    enemy.vz *= -1;
  }
  enemy.x = clamp(enemy.x, -ENEMY_BOUND, ENEMY_BOUND);
  enemy.z = clamp(enemy.z, -ENEMY_BOUND, ENEMY_BOUND);
}

initEnemies();

setInterval(() => {
  const now = Date.now();
  const dt = TICK_MS / 1000;
  const movedEnemies = [];

  Object.values(enemies).forEach((enemy) => {
    maybeTurnEnemy(enemy, now);
    enemy.x += enemy.vx * enemy.speed * dt;
    enemy.z += enemy.vz * enemy.speed * dt;
    bounceEnemy(enemy);
    movedEnemies.push({ id: enemy.id, x: enemy.x, y: enemy.y, z: enemy.z });
  });

  io.emit('enemies-moved', movedEnemies);
}, TICK_MS);

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
    socket.emit('init', { id: socket.id, players, enemies });
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
