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
const bulletGeo = new THREE.SphereGeometry(0.08, 8, 8);
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xfff27a });
const players = {};
const enemies = {};
const bullets = [];
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
const mobileUiPref = document.getElementById('mobileUiPref');
const mobileUiToggleBtn = document.getElementById('mobileUiToggleBtn');
const mobileUiPanel = document.getElementById('mobileUiPanel');
const mobileStickArea = document.getElementById('mobileStickArea');
const mobileStickRing = document.getElementById('mobileStickRing');
const mobileStickKnob = document.getElementById('mobileStickKnob');
const mobileLookArea = document.getElementById('mobileLookArea');
const mobileFireBtn = document.getElementById('mobileFireBtn');
const mobileJumpBtn = document.getElementById('mobileJumpBtn');
const hudHintsDesktop = document.getElementById('hudHintsDesktop');
const hudHintsMobile = document.getElementById('hudHintsMobile');
const authLoading = document.getElementById('authLoading');
const authError = document.getElementById('authError');
const guestFallbackBtn = document.getElementById('guestFallbackBtn');
const alpAccountRow = document.getElementById('alpAccountRow');
const guestNameRow = document.getElementById('guestNameRow');
const alpNicknameEl = document.getElementById('alpNickname');
const serverCapacityRow = document.getElementById('serverCapacityRow');
const serverCapacityCurrentEl = document.getElementById('serverCapacityCurrent');
const serverCapacityMaxEl = document.getElementById('serverCapacityMax');
const serverCapacityBreakdownEl = document.getElementById('serverCapacityBreakdown');

let currentSessionId = 'lobby';
let joined = false;
let lobbyJoinAuthBlocked = false;
let lobbyServerFull = false;
let lastServerCapacity = { current: 0, max: 100, inGame: 0, inLobby: 0 };

const urlParams = new URLSearchParams(window.location.search);
const urlAlpToken = urlParams.get('token');
let joinToken = urlAlpToken || null;
const platformApi = window.__ALP_PLATFORM_API__ || '';

function setLobbyAuthBlocked(on) {
  lobbyJoinAuthBlocked = !!on;
  refreshLobbyJoinButton();
}

function refreshLobbyJoinButton() {
  if (!joinBtn) return;
  const blocked = lobbyJoinAuthBlocked || lobbyServerFull;
  joinBtn.disabled = blocked;
  joinBtn.textContent = lobbyServerFull ? '서버 정원 초과' : '입장';
}

function updateServerCapacityDisplay(payload) {
  const cur = typeof payload.current === 'number' ? payload.current : lastServerCapacity.current;
  const max = typeof payload.max === 'number' ? payload.max : lastServerCapacity.max;
  const inGame = typeof payload.inGame === 'number' ? payload.inGame : lastServerCapacity.inGame;
  const inLobby = typeof payload.inLobby === 'number'
    ? payload.inLobby
    : Math.max(0, cur - inGame);
  lastServerCapacity = { current: cur, max, inGame, inLobby };
  if (serverCapacityMaxEl) {
    serverCapacityMaxEl.textContent = String(max);
  }
  if (serverCapacityCurrentEl) {
    serverCapacityCurrentEl.textContent = String(cur);
  }
  if (serverCapacityBreakdownEl) {
    serverCapacityBreakdownEl.textContent = `게임 중 ${inGame} · 입장 대기 ${inLobby}`;
  }
  lobbyServerFull = cur >= max;
  serverCapacityRow?.classList.toggle('server-full', lobbyServerFull);
  if (!joined) {
    refreshLobbyJoinButton();
  }
}

function applyGuestPlayUi() {
  joinToken = null;
  authError?.classList.add('hidden');
  guestFallbackBtn?.classList.add('hidden');
  alpAccountRow?.classList.add('hidden');
  guestNameRow?.classList.remove('hidden');
  if (nameInput) {
    nameInput.readOnly = false;
    nameInput.value = '';
  }
}

function initNoTokenGuestUi() {
  authLoading?.classList.add('hidden');
  authError?.classList.add('hidden');
  guestFallbackBtn?.classList.add('hidden');
  alpAccountRow?.classList.add('hidden');
  guestNameRow?.classList.remove('hidden');
  joinToken = null;
  setLobbyAuthBlocked(false);
}

guestFallbackBtn?.addEventListener('click', () => {
  applyGuestPlayUi();
  nameInput?.focus();
});

if (roomInput) {
  roomInput.value = urlParams.get('room') || 'lobby';
}

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

function initAuthUi() {
  if (!urlAlpToken) {
    initNoTokenGuestUi();
    nameInput?.focus();
    return;
  }

  if (!platformApi) {
    authLoading?.classList.add('hidden');
    if (authError) {
      authError.textContent = '플랫폼 연동 설정이 없어 로그인 확인을 할 수 없습니다. 게스트 닉네임으로 플레이해 주세요.';
      authError.classList.remove('hidden');
    }
    applyGuestPlayUi();
    setLobbyAuthBlocked(false);
    nameInput?.focus();
    return;
  }

  joinToken = urlAlpToken;
  guestNameRow?.classList.add('hidden');
  alpAccountRow?.classList.add('hidden');
  authError?.classList.add('hidden');
  guestFallbackBtn?.classList.add('hidden');
  authLoading?.classList.remove('hidden');
  setLobbyAuthBlocked(true);

  fetch(`${platformApi}/api/auth/me`, {
    headers: { Authorization: `Bearer ${urlAlpToken}` },
  })
    .then((r) => {
      if (!r.ok) throw new Error('verify');
      return r.json();
    })
    .then((data) => {
      const nick = data?.user?.nickname;
      if (!nick) throw new Error('no-nick');
      if (alpNicknameEl) alpNicknameEl.textContent = nick;
      alpAccountRow?.classList.remove('hidden');
      authError?.classList.add('hidden');
      guestFallbackBtn?.classList.add('hidden');
      joinToken = urlAlpToken;
      roomInput?.focus();
    })
    .catch(() => {
      if (authError) {
        authError.textContent = '계정 정보를 불러오지 못했습니다. 입장 시 서버에서 로그인을 다시 확인합니다. 게스트로 플레이하려면 아래 버튼을 누르세요.';
        authError.classList.remove('hidden');
      }
      guestFallbackBtn?.classList.remove('hidden');
      alpAccountRow?.classList.add('hidden');
      guestNameRow?.classList.add('hidden');
      joinToken = urlAlpToken;
    })
    .finally(() => {
      authLoading?.classList.add('hidden');
      setLobbyAuthBlocked(false);
    });
}

socket.on('server-capacity', (payload) => {
  if (!payload || typeof payload !== 'object') return;
  updateServerCapacityDisplay(payload);
});

initAuthUi();

function join() {
  if (joined) return;
  const sessionId = roomInput?.value.trim() || 'lobby';
  currentSessionId = sessionId;

  if (joinToken) {
    socket.emit('join', { name: '', sessionId, token: joinToken });
    return;
  }

  const name = nameInput?.value.trim() || '';
  if (!name) {
    alert('닉네임을 입력해 주세요.');
    nameInput?.focus();
    return;
  }
  socket.emit('join', { name, sessionId });
}

joinBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
roomInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

socket.on('init', ({ id, players: list, enemies: enemyList, wave }) => {
  joined = true;
  overlay.classList.add('hidden');
  hud.classList.remove('hidden');
  crosshair?.classList.remove('hidden');
  mobileUiToggleBtn?.classList.remove('hidden');
  refreshMobileUiDom();
  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const bullet = bullets[i];
    if (bullet.mesh.parent) bullet.mesh.parent.remove(bullet.mesh);
    if (bullet.mesh.material) bullet.mesh.material.dispose();
    bullets.splice(i, 1);
  }
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
  if (message && /로그인|세션|만료|ALP/i.test(message) && urlAlpToken) {
    applyGuestPlayUi();
    setLobbyAuthBlocked(false);
    nameInput?.focus();
  }
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
  if (mobileUiEnabled) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  const me = players[myId];
  if (!me || !me.data?.alive) return;
  fireBullet();
});

renderer.domElement.addEventListener('click', () => {
  if (overlay && !overlay.classList.contains('hidden')) return;
  if (mobileUiEnabled) return;
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

window.addEventListener('mousemove', (event) => {
  if (mobileUiEnabled) return;
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
const BULLET_SPEED = 35;
const BULLET_MAX_LIFETIME = 1.5;
const BULLET_HIT_RADIUS = 0.6;

const MOBILE_UI_STORAGE_KEY = 'multiplay-mobile-ui';
const MOBILE_LOOK_SENSITIVITY = 0.0045;
const MOBILE_FIRE_COOLDOWN_MS = 280;

let mobileUiEnabled = false;
const stickInput = { x: 0, y: 0 };
let stickPointerId = null;
let lookPointerId = null;
let lastLookClientX = 0;
let lastLookClientY = 0;
let lastMobileFireTime = 0;

function readStoredMobileUi() {
  try {
    const v = localStorage.getItem(MOBILE_UI_STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (_) {
    /* ignore */
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function writeStoredMobileUi(on) {
  try {
    localStorage.setItem(MOBILE_UI_STORAGE_KEY, on ? '1' : '0');
  } catch (_) {
    /* ignore */
  }
}

function updateHudHintsForMobile() {
  if (!hudHintsDesktop || !hudHintsMobile) return;
  if (mobileUiEnabled) {
    hudHintsDesktop.classList.add('hidden');
    hudHintsMobile.classList.remove('hidden');
  } else {
    hudHintsDesktop.classList.remove('hidden');
    hudHintsMobile.classList.add('hidden');
  }
}

function refreshMobileUiDom() {
  const showPanel = mobileUiEnabled && joined;
  if (mobileUiPanel) {
    mobileUiPanel.classList.toggle('hidden', !showPanel);
    mobileUiPanel.setAttribute('aria-hidden', showPanel ? 'false' : 'true');
  }
  document.body.classList.toggle('mobile-controls-active', showPanel);
  updateHudHintsForMobile();
  if (mobileUiToggleBtn) {
    mobileUiToggleBtn.setAttribute('aria-pressed', mobileUiEnabled ? 'true' : 'false');
    mobileUiToggleBtn.textContent = mobileUiEnabled ? '조작 UI 끄기' : '조작 UI 켜기';
  }
}

function setMobileUiEnabled(on, persist) {
  mobileUiEnabled = on;
  if (!on) resetStickVisual();
  if (mobileUiPref) mobileUiPref.checked = on;
  if (persist) writeStoredMobileUi(on);
  refreshMobileUiDom();
  if (on && document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
}

mobileUiPref?.addEventListener('change', () => {
  setMobileUiEnabled(!!mobileUiPref.checked, true);
});

mobileUiToggleBtn?.addEventListener('click', () => {
  setMobileUiEnabled(!mobileUiEnabled, true);
});

function resetStickVisual() {
  if (mobileStickKnob) mobileStickKnob.style.transform = 'translate(0, 0)';
  stickInput.x = 0;
  stickInput.y = 0;
}

function updateStickFromEvent(clientX, clientY) {
  if (!mobileStickRing || !mobileStickKnob) return;
  const r = mobileStickRing.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const maxR = Math.max(12, r.width / 2 - 26);
  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR && dist > 0) {
    dx = (dx / dist) * maxR;
    dy = (dy / dist) * maxR;
  }
  mobileStickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  stickInput.x = dx / maxR;
  stickInput.y = -dy / maxR;
}

mobileStickArea?.addEventListener('pointerdown', (e) => {
  if (!mobileUiEnabled || !joined) return;
  e.preventDefault();
  stickPointerId = e.pointerId;
  mobileStickArea.setPointerCapture(e.pointerId);
  updateStickFromEvent(e.clientX, e.clientY);
});

mobileStickArea?.addEventListener('pointermove', (e) => {
  if (stickPointerId !== e.pointerId) return;
  updateStickFromEvent(e.clientX, e.clientY);
});

function endStick(e) {
  if (stickPointerId !== e.pointerId) return;
  stickPointerId = null;
  try {
    mobileStickArea?.releasePointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
  resetStickVisual();
}

mobileStickArea?.addEventListener('pointerup', endStick);
mobileStickArea?.addEventListener('pointercancel', endStick);

mobileLookArea?.addEventListener('pointerdown', (e) => {
  if (!mobileUiEnabled || !joined) return;
  e.preventDefault();
  lookPointerId = e.pointerId;
  mobileLookArea.setPointerCapture(e.pointerId);
  lastLookClientX = e.clientX;
  lastLookClientY = e.clientY;
});

mobileLookArea?.addEventListener('pointermove', (e) => {
  if (lookPointerId !== e.pointerId) return;
  const me = players[myId];
  if (!me || me.data?.alive === false) return;
  const dlx = e.clientX - lastLookClientX;
  const dly = e.clientY - lastLookClientY;
  lastLookClientX = e.clientX;
  lastLookClientY = e.clientY;
  const yawDelta = dlx * MOBILE_LOOK_SENSITIVITY;
  playerYaw = normalizeAngle(playerYaw + yawDelta);
  me.mesh.rotation.y = -playerYaw;
  me.data.ry = -playerYaw;
  cameraPitch = Math.max(
    CAMERA_PITCH_MIN,
    Math.min(CAMERA_PITCH_MAX, cameraPitch + dly * MOBILE_LOOK_SENSITIVITY)
  );
});

function endLook(e) {
  if (lookPointerId !== e.pointerId) return;
  lookPointerId = null;
  try {
    mobileLookArea?.releasePointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
}

mobileLookArea?.addEventListener('pointerup', endLook);
mobileLookArea?.addEventListener('pointercancel', endLook);

function tryMobileFire() {
  const now = performance.now();
  if (now - lastMobileFireTime < MOBILE_FIRE_COOLDOWN_MS) return;
  const me = players[myId];
  if (!me || !me.data?.alive) return;
  lastMobileFireTime = now;
  fireBullet();
}

mobileFireBtn?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!mobileUiEnabled || !joined) return;
  tryMobileFire();
});

mobileJumpBtn?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!mobileUiEnabled || !joined) return;
  jumpQueued = true;
});

setMobileUiEnabled(readStoredMobileUi(), false);

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

function fireBullet() {
  const me = players[myId];
  if (!me) return;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  direction.normalize();

  const playerForward = new THREE.Vector3(Math.sin(playerYaw), 0, -Math.cos(playerYaw)).normalize();
  const start = me.mesh.position.clone()
    .add(new THREE.Vector3(0, 1.3, 0))
    .addScaledVector(playerForward, 0.75);
  const mesh = new THREE.Mesh(bulletGeo, bulletMaterial.clone());
  mesh.position.copy(start);
  scene.add(mesh);

  bullets.push({
    mesh,
    direction,
    life: BULLET_MAX_LIFETIME,
    hitEnemyIds: new Set(),
  });
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
      if (mobileUiEnabled && (stickInput.x !== 0 || stickInput.y !== 0)) {
        dx += rightX * stickInput.x + forwardX * stickInput.y;
        dz += rightZ * stickInput.x + forwardZ * stickInput.y;
      }
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

  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const bullet = bullets[i];
    bullet.mesh.position.addScaledVector(bullet.direction, BULLET_SPEED * dt);
    bullet.life -= dt;

    let shouldDestroy = bullet.life <= 0;
    if (!shouldDestroy) {
      if (
        Math.abs(bullet.mesh.position.x) > BOUND + 2 ||
        bullet.mesh.position.y < 0.05 ||
        Math.abs(bullet.mesh.position.z) > BOUND + 2
      ) {
        shouldDestroy = true;
      }
    }

    if (!shouldDestroy) {
      Object.keys(enemies).forEach((enemyId) => {
        if (shouldDestroy) return;
        if (bullet.hitEnemyIds.has(enemyId)) return;
        const enemy = enemies[enemyId];
        if (!enemy?.data?.alive) return;
        const dist = bullet.mesh.position.distanceTo(enemy.mesh.position);
        if (dist <= BULLET_HIT_RADIUS) {
          bullet.hitEnemyIds.add(enemyId);
          socket.emit('attack-enemy', { enemyId: Number(enemyId) });
          shouldDestroy = true;
        }
      });
    }

    if (shouldDestroy) {
      if (bullet.mesh.parent) bullet.mesh.parent.remove(bullet.mesh);
      if (bullet.mesh.material) bullet.mesh.material.dispose();
      bullets.splice(i, 1);
    }
  }

  const myPlayer = players[myId];
  const hpText = myPlayer?.data?.hp != null ? Math.ceil(myPlayer.data.hp) : '-';
  const aliveText = myPlayer?.data?.alive === false ? 'DEAD' : 'ALIVE';
  playerCountEl.textContent = `Room: ${currentSessionId} / Wave: ${currentWave} / Players: ${Object.keys(players).length} / Enemies: ${Object.keys(enemies).length} / HP: ${hpText} (${aliveText})`;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
