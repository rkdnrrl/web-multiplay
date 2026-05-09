const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

// ALP 플랫폼 백엔드 주소 (회원 토큰 검증용)
const PLATFORM_API_URL = process.env.PLATFORM_API_URL || 'http://43.203.215.179:4000';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// 클라이언트가 부팅 시 플랫폼 API URL을 알 수 있도록 노출
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.__ALP_PLATFORM_API__ = ${JSON.stringify(PLATFORM_API_URL)};`);
});

// 플랫폼 서버가 접속자 수를 조회하는 엔드포인트
app.get('/status', (req, res) => {
  const inGame = countTotalPlayers();
  const totalConnections = io.sockets.sockets.size;
  res.json({
    totalPlayers: inGame,
    totalConnections,
    inLobby: Math.max(0, totalConnections - inGame),
    totalRooms: sessions.size,
    maxTotalPlayers: MAX_TOTAL_PLAYERS,
  });
});

async function verifyTokenWithPlatform(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${PLATFORM_API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user || null;
  } catch (err) {
    console.error('[token-verify] error', err.message);
    return null;
  }
}

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
const MAX_TOTAL_PLAYERS = 100;
const IDLE_TIMEOUT_MS = 30_000;
const sessions = new Map();

function countTotalPlayers() {
  let n = 0;
  sessions.forEach((session) => {
    n += Object.keys(session.players).length;
  });
  return n;
}

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

function normalizeNickname(name) {
  return (name || '').toString().trim().toLowerCase();
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

function getServerCapacityPayload() {
  const total = io.sockets.sockets.size;
  const inGame = countTotalPlayers();
  const inLobby = Math.max(0, total - inGame);
  return {
    current: total,
    inGame,
    inLobby,
    max: MAX_TOTAL_PLAYERS,
  };
}

function broadcastServerCapacity() {
  io.emit('server-capacity', getServerCapacityPayload());
}

function broadcastLobbyMeta() {
  broadcastRoomList();
  broadcastServerCapacity();
}

function removePlayerFromSession(session, playerId) {
  if (!session?.players?.[playerId]) return false;
  delete session.players[playerId];
  io.to(session.id).emit('player-left', playerId);
  if (Object.keys(session.players).length === 0) {
    sessions.delete(session.id);
  }
  return true;
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
  let lobbyKicked = false;
  io.sockets.sockets.forEach((sock) => {
    if (sock.data.sessionId) return;
    const lastLobby = sock.data.lastLobbyActivityAt || 0;
    if (now - lastLobby < IDLE_TIMEOUT_MS) return;
    sock.emit('join-error', { message: '입장 화면에서 30초 동안 응답이 없어 연결이 종료되었습니다.' });
    sock.disconnect(true);
    lobbyKicked = true;
  });
  if (lobbyKicked) {
    broadcastServerCapacity();
  }

  let roomListDirty = false;
  sessions.forEach((session) => {
    Object.keys(session.players).forEach((playerId) => {
      const player = session.players[playerId];
      if (!player) return;
      if (now - (player.lastActiveAt || 0) < IDLE_TIMEOUT_MS) return;
      if (!removePlayerFromSession(session, playerId)) return;
      roomListDirty = true;
      const idleSocket = io.sockets.sockets.get(playerId);
      if (idleSocket) {
        idleSocket.emit('join-error', { message: '30초 동안 동작이 없어 방에서 퇴장되었습니다.' });
        idleSocket.data.sessionId = undefined;
        idleSocket.disconnect(true);
      }
    });

    if (!sessions.has(session.id)) return;

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
  if (roomListDirty) {
    broadcastLobbyMeta();
  }
}, TICK_MS);

io.on('connection', (socket) => {
  if (io.sockets.sockets.size > MAX_TOTAL_PLAYERS) {
    socket.emit('join-error', {
      message: `서버 접속 인원이 가득 찼습니다. (최대 ${MAX_TOTAL_PLAYERS}명, 입장 대기 포함)`,
    });
    socket.disconnect(true);
    broadcastServerCapacity();
    return;
  }

  socket.data.lastLobbyActivityAt = Date.now();

  socket.on('lobby-ping', () => {
    if (socket.data.sessionId) return;
    socket.data.lastLobbyActivityAt = Date.now();
  });

  socket.emit('room-list', getRoomListPayload());
  socket.emit('server-capacity', getServerCapacityPayload());
  broadcastServerCapacity();

  socket.on('join', async ({ name: rawName, sessionId: rawSessionId, token } = {}) => {
    socket.data.lastLobbyActivityAt = Date.now();
    const sessionId = sanitizeSessionId(rawSessionId);
    const session = getOrCreateSession(sessionId);
    if (session.players[socket.id]) return;
    if (Object.keys(session.players).length >= MAX_PLAYERS_PER_SESSION) {
      socket.emit('join-error', { message: `방 정원은 최대 ${MAX_PLAYERS_PER_SESSION}명입니다.` });
      return;
    }

    if (countTotalPlayers() >= MAX_TOTAL_PLAYERS) {
      socket.emit('join-error', {
        message: `게임 입장 인원이 가득 찼습니다. (최대 ${MAX_TOTAL_PLAYERS}명, 입장 대기·게임 중 합산 접속 기준)`,
      });
      return;
    }

    // 토큰이 있으면 플랫폼에 검증 → 검증된 닉네임 강제 사용 (위조 불가)
    let name;
    let alpUserId = null;
    if (token) {
      const verified = await verifyTokenWithPlatform(token);
      if (!verified) {
        socket.emit('join-error', { message: 'ALP 로그인 세션이 만료되었습니다. 플랫폼에서 다시 로그인해주세요.' });
        return;
      }
      name = verified.nickname;
      alpUserId = verified.id;
    } else {
      name = (rawName || 'Player').toString().trim().slice(0, 20) || 'Player';
    }

    const normalizedName = normalizeNickname(name);
    const hasDuplicateName = Object.values(session.players).some(
      (player) => normalizeNickname(player.name) === normalizedName
    );
    if (hasDuplicateName) {
      socket.emit('join-error', { message: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.' });
      return;
    }

    if (countTotalPlayers() >= MAX_TOTAL_PLAYERS) {
      socket.emit('join-error', {
        message: `게임 입장 인원이 가득 찼습니다. (최대 ${MAX_TOTAL_PLAYERS}명, 입장 대기·게임 중 합산 접속 기준)`,
      });
      return;
    }

    const pos = spawnPosition();
    session.players[socket.id] = {
      id: socket.id,
      name,
      alpUserId,
      color: randomColor(),
      x: pos.x,
      y: pos.y,
      z: pos.z,
      ry: 0,
      hp: PLAYER_MAX_HP,
      alive: true,
      lastActiveAt: Date.now(),
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
    broadcastLobbyMeta();
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
    p.lastActiveAt = Date.now();
    socket.to(sessionId).emit('player-moved', { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry });
  });

  socket.on('attack-enemy', ({ enemyId }) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    const attacker = session.players[socket.id];
    if (!attacker || !attacker.alive) return;
    attacker.lastActiveAt = Date.now();
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

      // ALP 로그인 유저에게 코인 지급
      if (attacker.alpUserId) {
        fetch(`${PLATFORM_API_URL}/api/coins/add`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-game-api-key': process.env.GAME_API_KEY || 'game-secret-key',
          },
          body: JSON.stringify({ userId: attacker.alpUserId, amount: 10 }),
        }).catch((err) => console.error('[coins] add error', err.message));
      }
    }
  });

  socket.on('disconnect', () => {
    const sessionId = socket.data.sessionId;
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (session && removePlayerFromSession(session, socket.id)) {
        broadcastLobbyMeta();
        return;
      }
    }
    broadcastServerCapacity();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
