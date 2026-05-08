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
let myId = null;

function createPlayer(p) {
  const mesh = new THREE.Mesh(
    cubeGeo,
    new THREE.MeshLambertMaterial({ color: new THREE.Color(p.color) })
  );
  mesh.position.set(p.x, p.y, p.z);
  scene.add(mesh);

  const div = document.createElement('div');
  div.className = 'name-tag';
  div.textContent = p.name;
  const label = new CSS2DObject(div);
  label.position.set(0, 0.9, 0);
  mesh.add(label);

  players[p.id] = { mesh, label, data: p };
}

function removePlayer(id) {
  const p = players[id];
  if (!p) return;
  scene.remove(p.mesh);
  p.mesh.geometry = null;
  p.mesh.material.dispose();
  delete players[id];
}

const socket = io();

const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const playerCountEl = document.getElementById('playerCount');

function join() {
  const name = nameInput.value.trim() || 'Player';
  socket.emit('join', name);
  overlay.classList.add('hidden');
  hud.classList.remove('hidden');
}

joinBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
nameInput.focus();

socket.on('init', ({ id, players: list }) => {
  myId = id;
  Object.values(list).forEach(createPlayer);
});
socket.on('player-joined', createPlayer);
socket.on('player-left', removePlayer);
socket.on('player-moved', ({ id, x, y, z }) => {
  const p = players[id];
  if (!p || id === myId) return;
  p.mesh.position.set(x, y, z);
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

const SPEED = 6;
const BOUND = 24;
const SEND_INTERVAL_MS = 50;

let lastTime = performance.now();
let lastSent = 0;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const me = players[myId];
  if (me) {
    let dx = 0, dz = 0;
    if (keys['w']) dz -= 1;
    if (keys['s']) dz += 1;
    if (keys['a']) dx -= 1;
    if (keys['d']) dx += 1;

    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      dx /= len; dz /= len;
      const pos = me.mesh.position;
      pos.x = Math.max(-BOUND, Math.min(BOUND, pos.x + dx * SPEED * dt));
      pos.z = Math.max(-BOUND, Math.min(BOUND, pos.z + dz * SPEED * dt));
    }

    const target = me.mesh.position;
    camera.position.x += (target.x - camera.position.x) * 0.15;
    camera.position.z += (target.z + 12 - camera.position.z) * 0.15;
    camera.position.y = 8;
    camera.lookAt(target.x, target.y, target.z);

    if (now - lastSent > SEND_INTERVAL_MS) {
      socket.emit('move', { x: target.x, y: target.y, z: target.z });
      lastSent = now;
    }
  }

  playerCountEl.textContent = `Players: ${Object.keys(players).length}`;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
