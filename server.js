const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const ENEMY_COUNT = 8;
const ENEMY_BOUND = 23;
const ENEMY_SPEED_MIN = 1.2;
const ENEMY_SPEED_MAX = 2.8;
const ENEMY_TURN_INTERVAL_MIN = 900;
const ENEMY_TURN_INTERVAL_MAX = 2200;
const TICK_MS = 100;
const PLAYER_MAX_HP = 100;
const ENEMY_MAX_HP = 100;
const PLAYER_ATTACK_DAMAGE = 25;
const ENEMY_CONTACT_DAMAGE_PER_SEC = 15;
const ENEMY_HIT_RADIUS = 1.2;
const WAVE_BASE_COUNT = ENEMY_COUNT;
const WAVE_GROWTH_PER_WAVE = 2;
const WAVE_DELAY_MS = 2500;
const SESSION_ID_MAX_LEN = 30;
const MAX_PLAYERS_PER_SESSION = 4;
const sessions = new Map();

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

function sanitizeSessionId(rawSessionId) {
  const sessionId = (rawSessionId || 'lobby').toString().trim().slice(0, SESSION_ID_MAX_LEN);
  return sessionId || 'lobby';
}

function createEmptySession(id) {
  return {
    id,
    players: {},
    enemies: {},
    currentWave: 0,
    nextEnemyId: 0,
    waveSpawnScheduled: false,
  };
}

function getOrCreateSession(sessionId) {
  const normalizedId = sanitizeSessionId(sessionId);
  if (!sessions.has(normalizedId)) {
    const session = createEmptySession(normalizedId);
    sessions.set(normalizedId, session);
    session.currentWave = 1;
    spawnWave(session, getWaveEnemyCount(session.currentWave));
  }
  return sessions.get(normalizedId);
}

function getRoomListPayload() {
  return Array.from(sessions.values())
    .map((session) => ({
      id: session.id,
      players: Object.keys(session.players).length,
      wave: session.currentWave,
    }))
    .sort((a, b) => b.players - a.players || a.id.localeCompare(b.id));
}

function broadcastRoomList() {
  io.emit('room-list', getRoomListPayload());
}

function createEnemy(session, id) {
  const pos = {
    x: randomRange(-ENEMY_BOUND, ENEMY_BOUND),
    y: 0.5,
    z: randomRange(-ENEMY_BOUND, ENEMY_BOUND),
  };
  const angle = randomRange(0, Math.PI * 2);
  session.enemies[id] = {
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
    hp: ENEMY_MAX_HP,
    alive: true,
  };
}

function getWaveEnemyCount(wave) {
  return WAVE_BASE_COUNT + (wave - 1) * WAVE_GROWTH_PER_WAVE;
}

function spawnWave(session, enemyCount) {
  for (let i = 0; i < enemyCount; i += 1) {
    createEnemy(session, session.nextEnemyId);
    session.nextEnemyId += 1;
  }
  io.to(session.id).emit('wave-started', { wave: session.currentWave, enemyCount });
}

function scheduleNextWave(session) {
  if (session.waveSpawnScheduled) return;
  session.waveSpawnScheduled = true;
  setTimeout(() => {
    session.waveSpawnScheduled = false;
    if (!sessions.has(session.id)) return;
    if (Object.keys(session.enemies).length > 0) return;
    session.currentWave += 1;
    spawnWave(session, getWaveEnemyCount(session.currentWave));
  }, WAVE_DELAY_MS);
}

function maybeTurnEnemy(enemy, now) {
  if (now < enemy.nextTurnAt) return;
  const angle = randomRange(0, Math.PI * 2);
  enemy.vx = Math.cos(angle);
  enemy.vz = Math.sin(angle);
  enemy.speed = randomRange(ENEMY_SPEED_MIN, ENEMY_SPEED_MAX);
  enemy.nextTurnAt = now + randomRange(ENEMY_TURN_INTERVAL_MIN, ENEMY_TURN_INTERVAL_MAX);
}

function findNearestAlivePlayer(session, enemy) {
  let nearestPlayer = null;
  let nearestDistSq = Infinity;
  Object.values(session.players).forEach((player) => {
    if (!player.alive) return;
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestPlayer = player;
    }
  });
  return nearestPlayer;
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

setInterval(() => {
  const now = Date.now();
  const dt = TICK_MS / 1000;
  sessions.forEach((session) => {
    const movedEnemies = [];
    const playerUpdates = [];

    Object.values(session.enemies).forEach((enemy) => {
      if (!enemy.alive) return;
      const targetPlayer = findNearestAlivePlayer(session, enemy);
      if (targetPlayer) {
        const dx = targetPlayer.x - enemy.x;
        const dz = targetPlayer.z - enemy.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.0001) {
          enemy.vx = dx / len;
          enemy.vz = dz / len;
        }
      } else {
        maybeTurnEnemy(enemy, now);
      }
      enemy.x += enemy.vx * enemy.speed * dt;
      enemy.z += enemy.vz * enemy.speed * dt;
      bounceEnemy(enemy);
      movedEnemies.push({ id: enemy.id, x: enemy.x, y: enemy.y, z: enemy.z });
    });

    Object.values(session.players).forEach((player) => {
      if (!player.alive) return;
      let damage = 0;

      Object.values(session.enemies).forEach((enemy) => {
        if (!enemy.alive) return;
        const dx = player.x - enemy.x;
        const dz = player.z - enemy.z;
        const distSq = dx * dx + dz * dz;
        if (distSq <= ENEMY_HIT_RADIUS * ENEMY_HIT_RADIUS) {
          damage += ENEMY_CONTACT_DAMAGE_PER_SEC * dt;
        }
      });

      if (damage <= 0) return;
      player.hp = clamp(player.hp - damage, 0, PLAYER_MAX_HP);
      if (player.hp <= 0 && player.alive) {
        player.alive = false;
      }
      playerUpdates.push({ id: player.id, hp: player.hp, alive: player.alive });
    });

    io.to(session.id).emit('enemies-moved', movedEnemies);
    if (playerUpdates.length > 0) {
      io.to(session.id).emit('players-updated', playerUpdates);
    }
  });
}, TICK_MS);

io.on('connection', (socket) => {
  socket.emit('room-list', getRoomListPayload());

  socket.on('join', ({ name: rawName, sessionId: rawSessionId } = {}) => {
    const sessionId = sanitizeSessionId(rawSessionId);
    const session = getOrCreateSession(sessionId);
    if (session.players[socket.id]) return;
    if (Object.keys(session.players).length >= MAX_PLAYERS_PER_SESSION) {
      socket.emit('join-error', { message: `방 정원은 최대 ${MAX_PLAYERS_PER_SESSION}명입니다.` });
      return;
    }

    const name = (rawName || 'Player').toString().trim().slice(0, 20) || 'Player';
    const pos = spawnPosition();
    session.players[socket.id] = {
      id: socket.id,
      name,
      color: randomColor(),
      x: pos.x,
      y: pos.y,
      z: pos.z,
      ry: 0,
      hp: PLAYER_MAX_HP,
      alive: true,
    };

    socket.data.sessionId = sessionId;
    socket.join(sessionId);

    socket.emit('init', {
      id: socket.id,
      players: session.players,
      enemies: session.enemies,
      wave: session.currentWave,
    });
    socket.to(sessionId).emit('player-joined', session.players[socket.id]);
    broadcastRoomList();
  });

  socket.on('move', (pos) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    const p = session.players[socket.id];
    if (!p || !pos) return;
    if (!p.alive) return;
    if (typeof pos.x !== 'number' || typeof pos.z !== 'number') return;
    if (pos.ry !== undefined && typeof pos.ry !== 'number') return;
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    if (typeof pos.ry === 'number') p.ry = pos.ry;
    socket.to(sessionId).emit('player-moved', { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry });
  });

  socket.on('attack-enemy', ({ enemyId }) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    const attacker = session.players[socket.id];
    if (!attacker || !attacker.alive) return;
    const enemy = session.enemies[enemyId];
    if (!enemy || !enemy.alive) return;

    enemy.hp = clamp(enemy.hp - PLAYER_ATTACK_DAMAGE, 0, ENEMY_MAX_HP);
    if (enemy.hp <= 0) {
      enemy.alive = false;
    }

    io.to(sessionId).emit('enemy-updated', { id: enemy.id, hp: enemy.hp, alive: enemy.alive });

    if (!enemy.alive) {
      delete session.enemies[enemy.id];
      io.to(sessionId).emit('enemy-removed', enemy.id);
      if (Object.keys(session.enemies).length === 0) {
        scheduleNextWave(session);
      }
    }
  });

  socket.on('disconnect', () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    if (!session.players[socket.id]) return;

    delete session.players[socket.id];
    io.to(sessionId).emit('player-left', socket.id);

    if (Object.keys(session.players).length === 0) {
      sessions.delete(sessionId);
    }
    broadcastRoomList();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
