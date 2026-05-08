import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 80);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 8, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(10, 20, 10);
scene.add(dir);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshLambertMaterial({ color: 0x6abf69 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(50, 50, 0x222222, 0x555555);
grid.position.y = 0.01;
scene.add(grid);

const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const players = {};
const enemies = {};
let myId = null;
let currentWave = 1;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function destroyEntity(entity) {
  if (!entity) return;
  if (entity.label?.element) {
    entity.label.element.remove();
  }
  if (entity.label?.parent) {
    entity.label.parent.remove(entity.label);
  }
  if (entity.mesh?.parent) {
    entity.mesh.parent.remove(entity.mesh);
  }
  if (entity.mesh?.material) {
    entity.mesh.material.dispose();
  }
}

function clearEntityMap(map) {
  Object.keys(map).forEach((id) => {
    destroyEntity(map[id]);
    delete map[id];
  });
}

function applyPlayerVisualState(player) {
  if (!player?.mesh?.material || !player?.data) return;
  if (player.data.alive === false) {
    player.mesh.material.color.set(0x555555);
    return;
  }
  player.mesh.material.color.set(new THREE.Color(player.data.color || 'white'));
}

function createPlayer(p) {
  const existing = players[p.id];
  if (existing) {
    destroyEntity(existing);
    delete players[p.id];
  }

  const mesh = new THREE.Mesh(
    cubeGeo,
    new THREE.MeshLambertMaterial({ color: new THREE.Color(p.color) })
  );
  mesh.position.set(p.x, p.y, p.z);
  mesh.rotation.y = typeof p.ry === 'number' ? p.ry : 0;
  scene.add(mesh);

  const div = document.createElement('div');
  div.className = 'name-tag';
  div.textContent = p.name;
  const label = new CSS2DObject(div);
  label.position.set(0, 0.9, 0);
  mesh.add(label);

  players[p.id] = {
    mesh,
    label,
    data: {
      ...p,
      hp: typeof p.hp === 'number' ? p.hp : 100,
      alive: p.alive !== false,
      ry: typeof p.ry === 'number' ? p.ry : 0,
    },
  };
  applyPlayerVisualState(players[p.id]);
}

function removePlayer(id) {
  const p = players[id];
  if (!p) return;
  destroyEntity(p);
  delete players[id];
}

function createEnemy(e) {
  const existing = enemies[e.id];
  if (existing) {
    destroyEntity(existing);
    delete enemies[e.id];
  }

  const mesh = new THREE.Mesh(
    cubeGeo,
    new THREE.MeshLambertMaterial({ color: new THREE.Color(e.color || 'hsl(0, 80%, 55%)') })
  );
  mesh.position.set(e.x, e.y, e.z);
  scene.add(mesh);

  const div = document.createElement('div');
  div.className = 'name-tag';
  const hp = typeof e.hp === 'number' ? e.hp : 100;
  div.textContent = `${e.name || 'Enemy'} (${Math.ceil(hp)})`;
  const label = new CSS2DObject(div);
  label.position.set(0, 0.9, 0);
  mesh.add(label);

  enemies[e.id] = {
    mesh,
    label,
    data: {
      ...e,
      hp,
      alive: e.alive !== false,
    },
    targetPosition: new THREE.Vector3(e.x, e.y, e.z),
  };
}

const socket = io();

const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const crosshair = document.getElementById('crosshair');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const playerCountEl = document.getElementById('playerCount');
const roomListEl = document.getElementById('roomList');
let currentSessionId = 'lobby';
let joined = false;

function renderRoomList(rooms) {
  if (!roomListEl) return;
  roomListEl.innerHTML = '';
  if (!Array.isArray(rooms) || rooms.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'room-item';
    empty.textContent = '아직 활성 방이 없습니다.';
    roomListEl.appendChild(empty);
    return;
  }

  rooms.forEach((room) => {
    const item = document.createElement('div');
    item.className = 'room-item';

    const label = document.createElement('span');
    label.textContent = `${room.id} (${room.players}/4)`;

    const useBtn = document.createElement('button');
    useBtn.textContent = room.players >= 4 ? '가득 참' : '선택';
    useBtn.disabled = room.players >= 4;
    useBtn.addEventListener('click', () => {
      if (roomInput) roomInput.value = room.id;
      roomInput?.focus();
    });

    item.appendChild(label);
    item.appendChild(useBtn);
    roomListEl.appendChild(item);
  });
}

function join() {
  if (joined) return;
  const name = nameInput.value.trim() || 'Player';
  const sessionId = roomInput?.value.trim() || 'lobby';
  currentSessionId = sessionId;
  socket.emit('join', { name, sessionId });
}

joinBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
roomInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
if (roomInput) {
  roomInput.value = new URLSearchParams(window.location.search).get('room') || 'lobby';
}
nameInput.focus();

socket.on('init', ({ id, players: list, enemies: enemyList, wave }) => {
  joined = true;
  overlay.classList.add('hidden');
  hud.classList.remove('hidden');
  crosshair?.classList.remove('hidden');
  clearEntityMap(players);
  clearEntityMap(enemies);
  myId = id;
  if (typeof wave === 'number') {
    currentWave = wave;
  }
  Object.values(list).forEach(createPlayer);
  Object.values(enemyList || {}).forEach(createEnemy);
  const me = players[myId];
  if (me) {
    playerYaw = -(me.data.ry || 0);
  }
});
socket.on('join-error', ({ message }) => {
  joined = false;
  alert(message || '방 입장에 실패했습니다.');
});
socket.on('room-list', (rooms) => {
  if (joined) return;
  renderRoomList(rooms);
});
socket.on('wave-started', ({ wave }) => {
  if (typeof wave === 'number') {
    currentWave = wave;
  }
});
socket.on('player-joined', createPlayer);
socket.on('player-left', removePlayer);
socket.on('player-moved', ({ id, x, y, z, ry }) => {
  const p = players[id];
  if (!p || id === myId) return;
  p.mesh.position.set(x, y, z);
  if (typeof ry === 'number') {
    p.data.ry = ry;
    p.mesh.rotation.y = ry;
  }
});
socket.on('players-updated', (updatedPlayers) => {
  if (!Array.isArray(updatedPlayers)) return;
  updatedPlayers.forEach((state) => {
    const p = players[state.id];
    if (!p) return;
    p.data.hp = state.hp;
    p.data.alive = state.alive;
    applyPlayerVisualState(p);
  });
});
socket.on('enemies-moved', (movedEnemies) => {
  if (!Array.isArray(movedEnemies)) return;
  movedEnemies.forEach((enemyPos) => {
    let enemy = enemies[enemyPos.id];
    if (!enemy) {
      createEnemy({
        id: enemyPos.id,
        name: `Enemy-${enemyPos.id + 1}`,
        color: 'hsl(0, 80%, 55%)',
        x: enemyPos.x,
        y: enemyPos.y,
        z: enemyPos.z,
      });
      enemy = enemies[enemyPos.id];
    }
    enemy.targetPosition.set(enemyPos.x, enemyPos.y, enemyPos.z);
  });
});
socket.on('enemy-updated', ({ id, hp, alive }) => {
  const enemy = enemies[id];
  if (!enemy) return;
  enemy.data.hp = hp;
  enemy.data.alive = alive;
  enemy.label.element.textContent = `${enemy.data.name || `Enemy-${id + 1}`} (${Math.ceil(hp)})`;
});
socket.on('enemy-removed', (id) => {
  const enemy = enemies[id];
  if (!enemy) return;
  destroyEntity(enemy);
  delete enemies[id];
});

const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (overlay && !overlay.classList.contains('hidden')) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  const me = players[myId];
  if (!me || !me.data?.alive) return;

  pointer.x = 0;
  pointer.y = 0;
  raycaster.setFromCamera(pointer, camera);

  const enemyMeshes = Object.values(enemies).map((enemy) => enemy.mesh);
  if (enemyMeshes.length === 0) return;
  const hits = raycaster.intersectObjects(enemyMeshes, false);
  if (hits.length === 0) return;

  const hitMesh = hits[0].object;
  const enemyId = Object.keys(enemies).find((id) => enemies[id].mesh === hitMesh);
  if (enemyId === undefined) return;
  socket.emit('attack-enemy', { enemyId: Number(enemyId) });
});

renderer.domElement.addEventListener('click', () => {
  if (overlay && !overlay.classList.contains('hidden')) return;
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

window.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const me = players[myId];
  if (!me || me.data?.alive === false) return;

  const yawDelta = event.movementX * MOUSE_SENSITIVITY;
  playerYaw = normalizeAngle(playerYaw + yawDelta);
  // Keep cube rotation tied strictly to horizontal mouse movement.
  me.mesh.rotation.y = -playerYaw;
  me.data.ry = -playerYaw;

  cameraPitch = Math.max(
    CAMERA_PITCH_MIN,
    Math.min(CAMERA_PITCH_MAX, cameraPitch + event.movementY * MOUSE_SENSITIVITY)
  );
});

const SPEED = 6;
const BOUND = 24;
const SEND_INTERVAL_MS = 50;
const GROUND_Y = 0.5;
const JUMP_VELOCITY = 8;
const GRAVITY = 20;
const ENEMY_SMOOTHING = 12;
const CAMERA_DISTANCE = 3.5;
const CAMERA_HEIGHT = 3.2;
const CAMERA_PITCH_MIN = -1.5;
const CAMERA_PITCH_MAX = 1.5;
const MOUSE_SENSITIVITY = 0.0025;

let lastTime = performance.now();
let lastSent = 0;
let verticalVelocity = 0;
let jumpQueued = false;
let playerYaw = 0;
let cameraPitch = 0.35;

function normalizeAngle(angle) {
  if (angle > Math.PI || angle < -Math.PI) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }
  return angle;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    jumpQueued = true;
    e.preventDefault();
  }
});

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  const enemyLerpAlpha = 1 - Math.exp(-ENEMY_SMOOTHING * dt);

  const me = players[myId];
  if (me) {
    const isAlive = me.data?.alive !== false;
    let dx = 0, dz = 0;
    if (isAlive) {
      const forwardX = Math.sin(playerYaw);
      const forwardZ = -Math.cos(playerYaw);
      const rightX = Math.cos(playerYaw);
      const rightZ = Math.sin(playerYaw);
      if (keys['w']) { dx += forwardX; dz += forwardZ; }
      if (keys['s']) { dx -= forwardX; dz -= forwardZ; }
      if (keys['a']) { dx -= rightX; dz -= rightZ; }
      if (keys['d']) { dx += rightX; dz += rightZ; }
    }

    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      dx /= len; dz /= len;
      const pos = me.mesh.position;
      pos.x = Math.max(-BOUND, Math.min(BOUND, pos.x + dx * SPEED * dt));
      pos.z = Math.max(-BOUND, Math.min(BOUND, pos.z + dz * SPEED * dt));
    }

    const pos = me.mesh.position;
    const onGround = pos.y <= GROUND_Y + 0.001;
    if (jumpQueued && onGround && isAlive) {
      verticalVelocity = JUMP_VELOCITY;
    }
    jumpQueued = false;

    verticalVelocity -= GRAVITY * dt;
    pos.y += verticalVelocity * dt;
    if (pos.y < GROUND_Y) {
      pos.y = GROUND_Y;
      if (verticalVelocity < 0) verticalVelocity = 0;
    }

    const target = pos;
    me.data.ry = -playerYaw;
    me.mesh.rotation.y = -playerYaw;

    const horizontalDistance = CAMERA_DISTANCE * Math.cos(cameraPitch);
    const desiredCameraX = target.x - Math.sin(playerYaw) * horizontalDistance;
    const desiredCameraZ = target.z + Math.cos(playerYaw) * horizontalDistance;
    const desiredCameraY = target.y + CAMERA_HEIGHT + Math.sin(cameraPitch) * CAMERA_DISTANCE;
    camera.position.set(desiredCameraX, desiredCameraY, desiredCameraZ);
    camera.lookAt(target.x, target.y + 1.6, target.z);

    if (isAlive && now - lastSent > SEND_INTERVAL_MS) {
      socket.emit('move', { x: target.x, y: target.y, z: target.z, ry: -playerYaw });
      lastSent = now;
    }
  }

  Object.values(enemies).forEach((enemy) => {
    enemy.mesh.position.lerp(enemy.targetPosition, enemyLerpAlpha);
  });

  const myPlayer = players[myId];
  const hpText = myPlayer?.data?.hp != null ? Math.ceil(myPlayer.data.hp) : '-';
  const aliveText = myPlayer?.data?.alive === false ? 'DEAD' : 'ALIVE';
  playerCountEl.textContent = `Room: ${currentSessionId} / Wave: ${currentWave} / Players: ${Object.keys(players).length} / Enemies: ${Object.keys(enemies).length} / HP: ${hpText} (${aliveText})`;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
