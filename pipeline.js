/**
 * NAIROBI RUSH — Graphics Pipeline Demo
 * ======================================
 * Demonstrates the three classical real-time graphics pipeline stages:
 *
 *  1. APPLICATION STAGE  — CPU: game logic, physics, input, scene graph updates
 *  2. GEOMETRY STAGE     — Per-vertex transforms: model→world→clip space (2D sim)
 *  3. RASTERIZATION STAGE— Fragment/pixel output: Canvas 2D draw calls fill pixels
 *
 * Stack: pure HTML5 Canvas + CSS + vanilla JS  (no libraries)
 */

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS SETUP
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

const W = 480, H = 700;
canvas.width  = W;
canvas.height = H;

// ─────────────────────────────────────────────────────────────────────────────
// WEB AUDIO — synthesised sound effects (no external files needed)
// ─────────────────────────────────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audio = null;

function initAudio() {
  if (audio) return;
  audio = new AudioCtx();
}

/** Play a crash/collision sound: noise burst + low thud */
function playCrashSound() {
  if (!audio) return;
  // Noise burst
  const bufLen = audio.sampleRate * 0.3;
  const buf    = audio.createBuffer(1, bufLen, audio.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
  const src  = audio.createBufferSource();
  src.buffer = buf;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.6, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  src.start();

  // Low thud oscillator
  const osc = audio.createOscillator();
  const og  = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80, audio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(20, audio.currentTime + 0.25);
  og.gain.setValueAtTime(0.9, audio.currentTime);
  og.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
  osc.connect(og);
  og.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.25);
}

/** Play boost sound: rising engine rev */
function playBoostSound() {
  if (!audio) return;
  const osc  = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, audio.currentTime);
  osc.frequency.linearRampToValueAtTime(420, audio.currentTime + 0.35);
  gain.gain.setValueAtTime(0.18, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.35);
}

/** Play lane-change click */
function playLaneSound() {
  if (!audio) return;
  const osc  = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = 520;
  gain.gain.setValueAtTime(0.1, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.06);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.06);
}

// ─────────────────────────────────────────────────────────────────────────────
// MATRIX HELPERS  (used in Geometry Stage)
// A 2D affine transform is a 3×3 matrix; we store as flat [a,b,c,d,tx,ty].
// Equivalent to WebGL model/view/projection matrices but in 2D.
// ─────────────────────────────────────────────────────────────────────────────
const Mat3 = {
  identity:  () => [1,0,0, 0,1,0, 0,0,1],
  translate: (tx, ty) => [1,0,tx, 0,1,ty, 0,0,1],
  scale:     (sx, sy) => [sx,0,0, 0,sy,0, 0,0,1],
  rotate:    (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [c,-s,0, s,c,0, 0,0,1];
  },
  mul: (A, B) => [
    A[0]*B[0]+A[1]*B[3]+A[2]*B[6], A[0]*B[1]+A[1]*B[4]+A[2]*B[7], A[0]*B[2]+A[1]*B[5]+A[2]*B[8],
    A[3]*B[0]+A[4]*B[3]+A[5]*B[6], A[3]*B[1]+A[4]*B[4]+A[5]*B[7], A[3]*B[2]+A[4]*B[5]+A[5]*B[8],
    A[6]*B[0]+A[7]*B[3]+A[8]*B[6], A[6]*B[1]+A[7]*B[4]+A[8]*B[7], A[6]*B[2]+A[7]*B[5]+A[8]*B[8],
  ],
  transformPoint: (M, x, y) => [M[0]*x + M[1]*y + M[2], M[3]*x + M[4]*y + M[5]],
  transformPoly:  (M, verts) => verts.map(([x,y]) => Mat3.transformPoint(M, x, y)),
};

// ─────────────────────────────────────────────────────────────────────────────
// COLOUR PALETTES — brown / earth tones matatu vibe
// ─────────────────────────────────────────────────────────────────────────────
const MATATU_PALETTES = [
  { body:'#8B4513', stripe:'#DEB887', glass:'#3B1F0A', wheel:'#1A0800', text:'#F5DEB3' }, // saddle brown
  { body:'#6B3A2A', stripe:'#F4A460', glass:'#2C1810', wheel:'#0D0500', text:'#FFE4B5' }, // dark sienna
  { body:'#A0522D', stripe:'#CD853F', glass:'#3B1F0A', wheel:'#1A0800', text:'#FFFACD' }, // sienna
  { body:'#7B3F00', stripe:'#C8962A', glass:'#2C1000', wheel:'#111',    text:'#FFF8DC' }, // chocolate
  { body:'#5C2E00', stripe:'#DEB887', glass:'#1A0A00', wheel:'#222',    text:'#F5DEB3' }, // deep brown
];

const GRAFFITI_MSGS = ['MOOD','SOURCE','OG RONGA','THE BEAST','DOWNTOWN',
                       'EASTLANDS','ROUTE 58','RIVER RD','UPPERHILL','CBD'];

// ─────────────────────────────────────────────────────────────────────────────
// LANE LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
const ROAD_LEFT  = 60;
const ROAD_RIGHT = W - 60;
const ROAD_W     = ROAD_RIGHT - ROAD_LEFT;
const LANES      = [ROAD_LEFT + ROAD_W*0.17,
                    ROAD_LEFT + ROAD_W*0.5,
                    ROAD_LEFT + ROAD_W*0.83];

// ─────────────────────────────────────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────────────────────────────────────
let gameRunning = false;
let gamePaused  = false;
let score       = 0;
let lives       = 3;
let gameSpeed   = 2;
let frameCount  = 0;
let roadOffset  = 0;

// Boost
const BOOST_MAX = 100;
let boostEnergy = BOOST_MAX;
let boosting    = false;

// Input flags
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === 'p' || e.key === 'P') togglePause();
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER
// ─────────────────────────────────────────────────────────────────────────────
const player = {
  x: LANES[1],
  y: H - 140,
  w: 44,
  h: 80,
  lane: 1,
  targetX: LANES[1],
  palette: MATATU_PALETTES[0],
  graffiti: 'GARI MOJA',
  invincible: 0,
  wobble: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// NPC MATATUS
// ─────────────────────────────────────────────────────────────────────────────
let npcs = [];

function spawnNPC() {
  const lane = Math.floor(Math.random() * 3);
  const pal  = MATATU_PALETTES[1 + Math.floor(Math.random() * (MATATU_PALETTES.length-1))];
  npcs.push({
    x: LANES[lane],
    y: -90,
    w: 44,
    h: 80,
    speedMul: 0.7 + Math.random() * 0.8,
    palette: pal,
    graffiti: GRAFFITI_MSGS[Math.floor(Math.random() * GRAFFITI_MSGS.length)],
    wobble: 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────────────────────────────────────────
let particles = [];

function emitParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      decay: 0.03 + Math.random() * 0.04,
      r: 3 + Math.random() * 5,
      color,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//
//  ██████████████████████████████████████████████████████
//  █  APPLICATION STAGE                                 █
//  █  CPU-side: input, physics, AI, scene-graph update  █
//  ██████████████████████████████████████████████████████
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * APPLICATION STAGE — processInput()
 * Reads raw device input and converts to game intent (steering, boost).
 * In a full GPU pipeline this maps to the CPU thread that feeds the
 * command buffer before any GPU work begins.
 */
function processInput() {
  // Lateral steering
  if ((keys['ArrowLeft'] || keys['a'] || keys['A']) && player.lane > 0) {
    player.lane--;
    player.targetX = LANES[player.lane];
    keys['ArrowLeft'] = keys['a'] = keys['A'] = false;
    playLaneSound();
  }
  if ((keys['ArrowRight'] || keys['d'] || keys['D']) && player.lane < 2) {
    player.lane++;
    player.targetX = LANES[player.lane];
    keys['ArrowRight'] = keys['d'] = keys['D'] = false;
    playLaneSound();
  }

  // Fine speed control
  if (keys['ArrowUp'] || keys['w'] || keys['W']) {
    gameSpeed = Math.min(gameSpeed + 0.05, 8);
  }
  if (keys['ArrowDown'] || keys['s'] || keys['S']) {
    gameSpeed = Math.max(gameSpeed - 0.05, 1);
  }

  // BOOST — Space bar
  boosting = (keys[' '] || keys['Spacebar']) && boostEnergy > 0;
  if (boosting) {
    boostEnergy = Math.max(0, boostEnergy - 1.5);
    if (frameCount % 8 === 0) playBoostSound();
  } else {
    // Recharge boost when not pressing space
    boostEnergy = Math.min(BOOST_MAX, boostEnergy + 0.4);
  }
}

/**
 * APPLICATION STAGE — updateScene()
 * Updates all world-space object positions, spawns/culls entities,
 * runs collision detection. This is the "scene graph" tick — world-space
 * positions are determined here before any transform pipeline runs.
 */
function updateScene() {
  frameCount++;

  const effectiveSpeed = gameSpeed * (boosting ? 2.2 : 1);

  roadOffset = (roadOffset + effectiveSpeed) % 40;

  player.x += (player.targetX - player.x) * 0.18;
  player.wobble *= 0.85;
  if (player.invincible > 0) player.invincible--;

  score += Math.ceil(effectiveSpeed * (boosting ? 0.6 : 0.3));

  if (frameCount % 300 === 0) gameSpeed = Math.min(gameSpeed + 0.3, 8);

  const spawnInterval = Math.max(40, 90 - gameSpeed * 6);
  if (frameCount % Math.round(spawnInterval) === 0) spawnNPC();

  for (const npc of npcs) {
    npc.y += effectiveSpeed * npc.speedMul;
    npc.wobble *= 0.9;
  }

  // AABB collision detection — APPLICATION STAGE responsibility
  if (player.invincible === 0) {
    for (const npc of npcs) {
      const dx = Math.abs(player.x - npc.x);
      const dy = Math.abs(player.y - npc.y);
      if (dx < (player.w + npc.w) * 0.4 && dy < (player.h + npc.h) * 0.45) {
        lives--;
        player.invincible = 120;
        npc.wobble = 0.3;
        player.wobble = 0.25;
        emitParticles(player.x, player.y, '#CD853F', 24);
        emitParticles(player.x, player.y, '#8B4513', 16);
        playCrashSound();
        if (lives <= 0) endGame();
        break;
      }
    }
  }

  npcs = npcs.filter(n => n.y < H + 100);

  for (const p of particles) {
    p.x    += p.vx;
    p.y    += p.vy;
    p.vy   += 0.15;
    p.life -= p.decay;
  }
  particles = particles.filter(p => p.life > 0);

  // Exhaust smoke
  if (frameCount % 4 === 0) {
    const smokeColor = boosting ? '#A0522D' : '#4a3020';
    emitParticles(player.x, player.y + player.h * 0.5, smokeColor, boosting ? 3 : 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//
//  ██████████████████████████████████████████████████████
//  █  GEOMETRY STAGE                                    █
//  █  Per-vertex: model→world→view→clip transforms      █
//  ██████████████████████████████████████████████████████
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GEOMETRY STAGE — buildModelMatrix()
 * Constructs the Model Matrix: local (model) space → world space.
 * In 3D: M = T * R * S.  Here we use 3×3 affine matrices in 2D.
 */
function buildModelMatrix(wx, wy, rot, sx, sy) {
  const T = Mat3.translate(wx, wy);
  const R = Mat3.rotate(rot);
  const S = Mat3.scale(sx, sy);
  return Mat3.mul(T, Mat3.mul(R, S));  // T * R * S
}

/**
 * GEOMETRY STAGE — buildViewMatrix()
 * Camera / view transform: world space → camera (view) space.
 * Applies camera shake effect when the player takes a hit.
 */
function buildViewMatrix() {
  const shakeX = player.invincible > 0 ? (Math.random()-0.5)*6 : 0;
  const shakeY = player.invincible > 0 ? (Math.random()-0.5)*6 : 0;
  return Mat3.translate(shakeX, shakeY);
}

/**
 * GEOMETRY STAGE — clipTest()
 * Trivial accept/reject clipping against the viewport rectangle.
 * In a GPU pipeline this happens in clip space per primitive.
 * Returns false → skip rasterization for this object entirely.
 */
function clipTest(x, y, w, h) {
  return !(x + w < 0 || x - w > W || y + h < 0 || y - h > H);
}

/**
 * GEOMETRY STAGE — transformVertices()
 * Apply the combined MVP matrix to local-space vertices.
 * Output: clip/screen-space positions ready for rasterization.
 * MVP = View * Model  (no perspective needed in 2D top-down view)
 */
function transformVertices(localVerts, modelMatrix, viewMatrix) {
  const MVP = Mat3.mul(viewMatrix, modelMatrix);
  return Mat3.transformPoly(MVP, localVerts);
}

// ─────────────────────────────────────────────────────────────────────────────
//
//  ██████████████████████████████████████████████████████
//  █  RASTERIZATION STAGE                               █
//  █  Convert geometry → pixels on the framebuffer      █
//  ██████████████████████████████████████████████████████
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RASTERIZATION STAGE — drawRoad()
 * Road is a background quad. Lane markings are scrolling instanced quads.
 * Canvas 2D fillRect = rasterizer writing fragments to the framebuffer.
 */
function drawRoad() {
  // Tarmac — dark brown
  ctx.fillStyle = '#1c1008';
  ctx.fillRect(ROAD_LEFT, 0, ROAD_W, H);

  // Shoulder lines — warm brown
  ctx.strokeStyle = '#8B4513';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ROAD_LEFT,  0); ctx.lineTo(ROAD_LEFT,  H);
  ctx.moveTo(ROAD_RIGHT, 0); ctx.lineTo(ROAD_RIGHT, H);
  ctx.stroke();

  // Scrolling dashed lane dividers
  ctx.fillStyle = 'rgba(139,101,19,0.35)';
  const dashH = 28, gapH = 12, totalH = dashH + gapH;
  for (let lane = 1; lane < 3; lane++) {
    const lx = ROAD_LEFT + (ROAD_W / 3) * lane - 1;
    for (let yy = -totalH + roadOffset; yy < H + totalH; yy += totalH) {
      ctx.fillRect(lx, yy, 2, dashH);
    }
  }

  drawBuildings();
}

/**
 * RASTERIZATION STAGE — drawBuildings()
 * Nairobi building silhouettes on road shoulders, purely in screen space.
 */
function drawBuildings() {
  ctx.fillStyle = '#0D0500';
  ctx.fillRect(0,          0, ROAD_LEFT, H);
  ctx.fillRect(ROAD_RIGHT, 0, W - ROAD_RIGHT, H);

  // Warm window glows
  for (let side = 0; side < 2; side++) {
    const bx = side === 0 ? 0 : ROAD_RIGHT;
    const bw = side === 0 ? ROAD_LEFT : W - ROAD_RIGHT;
    ctx.fillStyle = 'rgba(139,69,19,0.18)';
    for (let wy = (roadOffset * 2) % 60; wy < H; wy += 60) {
      ctx.fillRect(bx + 4, wy, bw - 8, 16);
    }
  }
}

/**
 * RASTERIZATION STAGE — drawMatatu()
 * Converts transformed screen-space vertices into filled/stroked pixel regions.
 * Each ctx.fill() / ctx.stroke() = the rasterizer writing colour fragments
 * to the framebuffer for that primitive.
 */
function drawMatatu(sx, sy, sw, sh, pal, label, wobble, isPlayer) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(wobble);

  const hw = sw / 2, hh = sh / 2;

  // Body
  ctx.fillStyle = pal.body;
  ctx.fillRect(-hw, -hh, sw, sh);

  // Decorative stripe
  ctx.fillStyle = pal.stripe;
  ctx.fillRect(-hw, -hh + sh * 0.28, sw, sh * 0.12);

  // Roof rack
  ctx.fillStyle = '#2C1000';
  ctx.fillRect(-hw * 0.8, -hh, sw * 0.8, sh * 0.06);

  // Front windshield
  ctx.fillStyle = pal.glass;
  ctx.fillRect(-hw * 0.65, -hh + sh * 0.07, sw * 0.65, sh * 0.2);

  // Rear glass
  ctx.fillStyle = pal.glass;
  ctx.fillRect(-hw * 0.55, hh - sh * 0.22, sw * 0.55, sh * 0.14);

  // Side windows
  ctx.fillStyle = pal.glass + 'cc';
  ctx.fillRect(-hw,      -hh + sh * 0.1, sw * 0.08, sh * 0.18);
  ctx.fillRect(hw * 0.9, -hh + sh * 0.1, sw * 0.1,  sh * 0.18);

  // Wheels
  ctx.fillStyle = pal.wheel;
  const wr = sw * 0.18;
  [[-hw*0.85,-hh+sh*0.16],[hw*0.85,-hh+sh*0.16],
   [-hw*0.85, hh-sh*0.16],[hw*0.85, hh-sh*0.16]].forEach(([wx,wy]) => {
    ctx.beginPath();
    ctx.ellipse(wx, wy, wr, wr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6B3A2A';
    ctx.beginPath();
    ctx.ellipse(wx, wy, wr * 0.4, wr * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.wheel;
  });

  // Graffiti text — rasterized glyphs
  ctx.fillStyle = pal.text;
  ctx.font = `bold ${Math.max(7, sw * 0.18)}px Courier New`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, sh * 0.05);

  // Boost flame effect on player
  if (isPlayer && boosting) {
    const flameGrad = ctx.createLinearGradient(0, hh, 0, hh + 30);
    flameGrad.addColorStop(0, '#CD853F');
    flameGrad.addColorStop(0.5, '#8B4513');
    flameGrad.addColorStop(1,  'transparent');
    ctx.fillStyle = flameGrad;
    ctx.fillRect(-hw * 0.4, hh, sw * 0.4, 20 + Math.random() * 14);
  }

  // Player highlight
  if (isPlayer) {
    ctx.strokeStyle = '#DEB887';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-hw, -hh, sw, sh);
  }

  // Invincibility flicker
  if (isPlayer && player.invincible > 0 && (frameCount % 6 < 3)) {
    ctx.fillStyle = 'rgba(205,133,63,0.35)';
    ctx.fillRect(-hw, -hh, sw, sh);
  }

  ctx.restore();
}

/**
 * RASTERIZATION STAGE — drawParticles()
 * Filled circles — raw fragment writes, no additional geometry transform needed.
 */
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.life;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * RASTERIZATION STAGE — updateHUD()
 * Updates DOM HUD elements (screen-space overlay, no world transform).
 */
function updateHUD() {
  document.getElementById('score-display').textContent = `SCORE: ${score}`;
  document.getElementById('speed-display').textContent = `SPEED: ${gameSpeed.toFixed(1)}x${boosting ? ' ⚡' : ''}`;
  const filled  = Math.round((boostEnergy / BOOST_MAX) * 8);
  const boostBar = '█'.repeat(filled) + '░'.repeat(8 - filled);
  document.getElementById('boost-display').textContent = `BOOST: ${boostBar}`;
  const heartStr = '❤️'.repeat(lives) + '🖤'.repeat(Math.max(0, 3 - lives));
  document.getElementById('lives-display').textContent = heartStr;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE STAGE INDICATOR
// ─────────────────────────────────────────────────────────────────────────────
function flashStage(id) {
  document.querySelectorAll('.stage-tag').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN GAME LOOP
// ─────────────────────────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning || gamePaused) return;

  // ── APPLICATION STAGE ──────────────────────────────────────────────────
  flashStage('tag-app');
  processInput();
  updateScene();

  // ── GEOMETRY STAGE ─────────────────────────────────────────────────────
  flashStage('tag-geo');
  const viewMatrix   = buildViewMatrix();
  const playerModel  = buildModelMatrix(player.x, player.y, player.wobble, 1, 1);
  const npcModels    = npcs.map(n => buildModelMatrix(n.x, n.y, n.wobble, 1, 1));
  const playerScreen = Mat3.transformPoint(Mat3.mul(viewMatrix, playerModel), 0, 0);
  const npcScreens   = npcModels.map(m => Mat3.transformPoint(Mat3.mul(viewMatrix, m), 0, 0));
  const playerVis    = clipTest(playerScreen[0], playerScreen[1], player.w, player.h);
  const npcVis       = npcs.map((n,i) => clipTest(npcScreens[i][0], npcScreens[i][1], n.w, n.h));

  // ── RASTERIZATION STAGE ────────────────────────────────────────────────
  flashStage('tag-rast');

  // Clear framebuffer
  ctx.fillStyle = '#0D0500';
  ctx.fillRect(0, 0, W, H);

  drawRoad();

  // Paint NPCs back-to-front (painter's algorithm)
  npcs.forEach((npc, i) => {
    if (!npcVis[i]) return;
    const [sx, sy] = npcScreens[i];
    drawMatatu(sx, sy, npc.w, npc.h, npc.palette, npc.graffiti, npc.wobble, false);
  });

  if (playerVis) {
    drawMatatu(playerScreen[0], playerScreen[1],
               player.w, player.h, player.palette, 'MY MATATU', player.wobble, true);
  }

  drawParticles();
  updateHUD();

  requestAnimationFrame(gameLoop);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE / RESUME
// ─────────────────────────────────────────────────────────────────────────────
function togglePause() {
  if (!gameRunning) return;
  gamePaused = !gamePaused;
  document.getElementById('pause-screen').classList.toggle('hidden', !gamePaused);
  document.getElementById('pause-btn').textContent = gamePaused ? '▶ RESUME' : '⏸ PAUSE';
  if (!gamePaused) requestAnimationFrame(gameLoop);
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME START / RESTART / END
// ─────────────────────────────────────────────────────────────────────────────
function resetState() {
  score      = 0;
  lives      = 3;
  gameSpeed  = 2;
  frameCount = 0;
  roadOffset = 0;
  boostEnergy = BOOST_MAX;
  boosting   = false;
  npcs       = [];
  particles  = [];
  gamePaused = false;
  player.x         = LANES[1];
  player.targetX   = LANES[1];
  player.lane      = 1;
  player.invincible = 0;
  player.wobble    = 0;
}

function startGame() {
  initAudio();
  resetState();

  document.getElementById('intro-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('pause-screen').classList.add('hidden');
  document.getElementById('pause-btn').textContent = '⏸ PAUSE';

  gameRunning = true;
  requestAnimationFrame(gameLoop);
}

function endGame() {
  gameRunning = false;
  document.getElementById('final-score').textContent = `Final Score: ${score}`;
  document.getElementById('gameover-screen').classList.remove('hidden');
}

function goToMenu() {
  gameRunning = false;
  gamePaused  = false;
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('intro-screen').classList.remove('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('pause-screen').classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// SCROLL-REVEAL  (Intersection Observer)
// Watches elements below the fold and adds .revealed / .card-revealed
// when they cross the viewport threshold, triggering CSS transitions.
// ─────────────────────────────────────────────────────────────────────────────
function initScrollReveal() {
  // Sections flow in as a whole
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        sectionObserver.unobserve(entry.target); // fire once
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.culture-section').forEach((el, i) => {
    // Stagger each section's entrance slightly
    el.style.transitionDelay = `${i * 80}ms`;
    sectionObserver.observe(el);
  });

  // Cards fly in with per-card stagger index
  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Assign stagger index to each card inside this grid
        const cards = entry.target.querySelectorAll('.matatu-card');
        cards.forEach((card, i) => {
          card.style.setProperty('--i', i);
          // Small timeout so the section reveal lands first
          setTimeout(() => card.classList.add('card-revealed'), 80);
        });
        cardObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.matatu-cards').forEach(el => cardObserver.observe(el));

  // Rule items stagger in
  const ruleObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const items = entry.target.querySelectorAll('.rule-item');
        items.forEach((item, i) => {
          item.style.opacity    = '0';
          item.style.transform  = 'translateY(30px)';
          item.style.transition = `opacity 0.5s ease ${i * 100}ms, transform 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 100}ms`;
          setTimeout(() => {
            item.style.opacity   = '1';
            item.style.transform = 'none';
          }, 40);
        });
        ruleObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });

  document.querySelectorAll('.rules-grid').forEach(el => ruleObserver.observe(el));
}

// Run on page load
initScrollReveal();

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON WIRING
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('intro-play-btn').addEventListener('click', startGame);
document.getElementById('pause-btn').addEventListener('click', togglePause);
document.getElementById('resume-btn').addEventListener('click', togglePause);
document.getElementById('restart-btn-top').addEventListener('click', startGame);
document.getElementById('play-again-btn').addEventListener('click', startGame);
document.getElementById('menu-btn').addEventListener('click', goToMenu);
document.getElementById('quit-btn').addEventListener('click', goToMenu);
