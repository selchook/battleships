import { useState, useEffect, useRef, useCallback } from 'react'
import Peer from 'peerjs'

// ── constants ────────────────────────────────────────────────────────────────
const GRID = 10
const SHIPS = [
  { id: 'carrier',    name: 'Carrier',     size: 5, icon: '🛳' },
  { id: 'battleship', name: 'Battleship',  size: 4, icon: '⚓' },
  { id: 'cruiser',    name: 'Cruiser',     size: 3, icon: '🚢' },
  { id: 'submarine',  name: 'Submarine',   size: 3, icon: '🤿' },
  { id: 'destroyer',  name: 'Destroyer',   size: 2, icon: '⛵' },
]
const cols = Array.from({ length: GRID }, (_, i) => String.fromCharCode(65 + i))

// ── audio engine ─────────────────────────────────────────────────────────────
const AudioEngine = {
  ctx: null,
  init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)()
  },
  play(type) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (type === 'hit') {
      const osc = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      osc.connect(g); g.connect(this.ctx.destination)
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(180, now)
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.4)
      g.gain.setValueAtTime(0.3, now); g.gain.exponentialRampToValueAtTime(0.01, now + 0.6)
      osc.start(now); osc.stop(now + 0.6)
      // boom layer
      const n = this.ctx.createOscillator()
      const ng = this.ctx.createGain()
      n.connect(ng); ng.connect(this.ctx.destination)
      n.type = 'square'; n.frequency.setValueAtTime(80, now)
      ng.gain.setValueAtTime(0.4, now); ng.gain.exponentialRampToValueAtTime(0.01, now + 0.5)
      n.start(now); n.stop(now + 0.5)
    } else if (type === 'miss') {
      const osc = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      osc.connect(g); g.connect(this.ctx.destination)
      osc.type = 'sine'; osc.frequency.setValueAtTime(400, now)
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.3)
      g.gain.setValueAtTime(0.15, now); g.gain.exponentialRampToValueAtTime(0.01, now + 0.4)
      osc.start(now); osc.stop(now + 0.4)
    } else if (type === 'sink') {
      [0, 0.1, 0.2].forEach(t => {
        const o = this.ctx.createOscillator()
        const g = this.ctx.createGain()
        o.connect(g); g.connect(this.ctx.destination)
        o.type = 'sawtooth'; o.frequency.setValueAtTime(120 - t * 30, now + t)
        g.gain.setValueAtTime(0.5, now + t); g.gain.exponentialRampToValueAtTime(0.01, now + t + 0.8)
        o.start(now + t); o.stop(now + t + 0.8)
      })
    } else if (type === 'place') {
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.connect(g); g.connect(this.ctx.destination)
      o.type = 'sine'; o.frequency.setValueAtTime(600, now)
      g.gain.setValueAtTime(0.1, now); g.gain.exponentialRampToValueAtTime(0.01, now + 0.15)
      o.start(now); o.stop(now + 0.15)
    } else if (type === 'win') {
      [0, 0.2, 0.4, 0.7].forEach((t, i) => {
        const o = this.ctx.createOscillator()
        const g = this.ctx.createGain()
        o.connect(g); g.connect(this.ctx.destination)
        o.frequency.setValueAtTime([440, 550, 660, 880][i], now + t)
        g.gain.setValueAtTime(0.3, now + t); g.gain.exponentialRampToValueAtTime(0.01, now + t + 0.4)
        o.start(now + t); o.stop(now + t + 0.4)
      })
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function makeEmptyGrid() {
  return Array.from({ length: GRID }, () => Array(GRID).fill(null))
}

function canPlace(grid, ship, row, col, dir) {
  const cells = getShipCells(ship, row, col, dir)
  if (!cells) return false
  return cells.every(([r, c]) => r >= 0 && r < GRID && c >= 0 && c < GRID && !grid[r][c])
}

function getShipCells(ship, row, col, dir) {
  const cells = []
  for (let i = 0; i < ship.size; i++) {
    const r = dir === 'H' ? row : row + i
    const c = dir === 'H' ? col + i : col
    if (r >= GRID || c >= GRID) return null
    cells.push([r, c])
  }
  return cells
}

function placeShip(grid, ship, row, col, dir) {
  const cells = getShipCells(ship, row, col, dir)
  if (!cells) return null
  const newGrid = grid.map(r => [...r])
  cells.forEach(([r, c]) => { newGrid[r][c] = ship.id })
  return newGrid
}

function checkSunk(shipId, shipGrid, hits) {
  let found = false
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (shipGrid[r][c] === shipId) {
        found = true
        if (!(hits[r] && hits[r][c] === 'hit')) return false
      }
  return found
}

function countSunk(shipGrid, hits) {
  return SHIPS.filter(s => checkSunk(s.id, shipGrid, hits)).length
}

function allSunk(shipGrid, hits) {
  return SHIPS.every(s => checkSunk(s.id, shipGrid, hits))
}

function gridToHitArray(grid) {
  return grid.map(r => r.map(c => c))
}

function inferAllPlacements(grid) {
  const placements = {}
  SHIPS.forEach(ship => {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (grid[r][c] === ship.id && !placements[ship.id]) {
          const dir = (c + 1 < GRID && grid[r][c + 1] === ship.id) ? 'H' : 'V'
          placements[ship.id] = { row: r, col: c, dir }
        }
      }
    }
  })
  return placements
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Share+Tech+Mono&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --navy:    #020c18;
    --deep:    #041226;
    --mid:     #062040;
    --ocean:   #0a3560;
    --steel:   #0d4a85;
    --cyan:    #00d4ff;
    --cyan2:   #00a8cc;
    --gold:    #f0a500;
    --red:     #ff3838;
    --green:   #00ff88;
    --miss:    #1a4a6e;
    --hit:     #ff4500;
    --text:    #c8e8f8;
    --dim:     #4a7a9b;
    --font:    'Orbitron', sans-serif;
    --mono:    'Share Tech Mono', monospace;
  }

  html, body, #root {
    width: 100%; height: 100%; overflow-x: hidden;
    background: var(--navy);
    color: var(--text);
    font-family: var(--font);
  }

  /* SCROLLBAR */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: var(--deep); }
  ::-webkit-scrollbar-thumb { background: var(--steel); border-radius: 3px; }

  /* OCEAN BG */
  .ocean-bg {
    position: fixed; inset: 0; z-index: 0; overflow: hidden;
    background: radial-gradient(ellipse at 50% 100%, #0a3060 0%, #020c18 70%);
  }
  .ocean-bg::before {
    content: '';
    position: absolute; inset: 0;
    background: 
      radial-gradient(ellipse 120% 60% at 50% 120%, rgba(0,100,180,0.25) 0%, transparent 70%),
      repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,80,160,0.05) 2px, rgba(0,80,160,0.05) 4px);
    animation: oceanShift 12s ease-in-out infinite;
  }
  .ocean-bg::after {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(ellipse 80% 40% at 20% 80%, rgba(0,212,255,0.04) 0%, transparent 60%),
                radial-gradient(ellipse 60% 30% at 80% 90%, rgba(0,212,255,0.04) 0%, transparent 60%);
    animation: oceanShift 8s ease-in-out infinite reverse;
  }
  @keyframes oceanShift {
    0%, 100% { transform: translateY(0) scaleX(1); }
    50% { transform: translateY(-8px) scaleX(1.02); }
  }

  .app { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }

  /* HEADER */
  .header {
    width: 100%; padding: 16px 24px;
    display: flex; align-items: center; justify-content: space-between;
    background: linear-gradient(180deg, rgba(2,12,24,0.95) 0%, transparent 100%);
    border-bottom: 1px solid rgba(0,212,255,0.15);
  }
  .logo {
    font-size: 22px; font-weight: 900; letter-spacing: 3px;
    background: linear-gradient(135deg, var(--cyan), var(--gold));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    text-shadow: none;
    filter: drop-shadow(0 0 12px rgba(0,212,255,0.4));
  }
  .logo span { font-size: 11px; display: block; letter-spacing: 6px; font-weight: 400;
    background: linear-gradient(90deg, var(--dim), var(--cyan2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .header-status {
    font-family: var(--mono); font-size: 12px; color: var(--dim);
    text-align: right; line-height: 1.6;
  }
  .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; animation: blink 1.5s infinite; }
  .status-dot.online { background: var(--green); }
  .status-dot.offline { background: var(--red); animation: none; }
  .status-dot.waiting { background: var(--gold); }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

  /* LOBBY */
  .lobby {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 40px 20px; gap: 32px;
  }
  .lobby-title {
    font-size: clamp(28px,5vw,52px); font-weight: 900; text-align: center;
    letter-spacing: 4px; line-height: 1.1;
    background: linear-gradient(135deg, #ffffff 0%, var(--cyan) 50%, var(--gold) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 0 30px rgba(0,212,255,0.3));
    animation: titleGlow 3s ease-in-out infinite;
  }
  @keyframes titleGlow {
    0%,100% { filter: drop-shadow(0 0 20px rgba(0,212,255,0.3)); }
    50% { filter: drop-shadow(0 0 40px rgba(0,212,255,0.6)); }
  }
  .lobby-subtitle { font-family: var(--mono); font-size: 13px; color: var(--dim); letter-spacing: 3px; text-transform: uppercase; }

  .lobby-card {
    background: rgba(4,18,38,0.8);
    border: 1px solid rgba(0,212,255,0.2);
    border-radius: 16px;
    padding: 32px; width: 100%; max-width: 440px;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(0,212,255,0.1);
  }
  .lobby-card h3 { font-size: 13px; letter-spacing: 3px; color: var(--cyan); margin-bottom: 20px; text-transform: uppercase; }

  .input-group { display: flex; gap: 10px; margin-bottom: 12px; }
  .game-input {
    flex: 1; background: rgba(6,32,64,0.8); border: 1px solid rgba(0,212,255,0.25);
    color: var(--text); font-family: var(--mono); font-size: 14px;
    padding: 12px 16px; border-radius: 8px; outline: none; letter-spacing: 2px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .game-input:focus { border-color: var(--cyan); box-shadow: 0 0 0 2px rgba(0,212,255,0.15); }
  .game-input::placeholder { color: var(--dim); }

  .btn {
    font-family: var(--font); font-size: 12px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; border: none; cursor: pointer;
    padding: 12px 20px; border-radius: 8px; transition: all 0.2s;
    white-space: nowrap;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--steel), var(--ocean));
    color: var(--cyan); border: 1px solid rgba(0,212,255,0.4);
  }
  .btn-primary:hover { background: linear-gradient(135deg, var(--ocean), var(--steel)); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,212,255,0.3); }
  .btn-danger { background: linear-gradient(135deg, #4a1010, #7a2020); color: var(--red); border: 1px solid rgba(255,56,56,0.4); }
  .btn-danger:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(255,56,56,0.3); }
  .btn-gold { background: linear-gradient(135deg, #3a2800, #5a4000); color: var(--gold); border: 1px solid rgba(240,165,0,0.4); }
  .btn-gold:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(240,165,0,0.3); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }
  .btn-sm { padding: 8px 14px; font-size: 10px; }
  .btn-full { width: 100%; justify-content: center; }

  .divider { display: flex; align-items: center; gap: 12px; margin: 16px 0; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: rgba(0,212,255,0.15); }
  .divider span { font-family: var(--mono); font-size: 11px; color: var(--dim); }

  .room-code-display {
    font-family: var(--mono); font-size: 28px; letter-spacing: 8px;
    color: var(--gold); text-align: center; padding: 16px;
    background: rgba(0,0,0,0.3); border-radius: 8px;
    border: 1px solid rgba(240,165,0,0.3);
    user-select: all; cursor: copy;
    margin: 12px 0;
  }
  .room-code-display:hover { border-color: var(--gold); }

  .waiting-msg {
    font-family: var(--mono); font-size: 12px; color: var(--dim);
    text-align: center; animation: fadeInOut 2s ease-in-out infinite;
  }
  @keyframes fadeInOut { 0%,100%{opacity:0.4} 50%{opacity:1} }

  /* PLACEMENT */
  .placement-screen {
    flex: 1; width: 100%; max-width: 1100px; padding: 20px;
    display: flex; flex-direction: column; align-items: center; gap: 20px;
  }
  .placement-title { font-size: 14px; letter-spacing: 4px; color: var(--cyan); text-transform: uppercase; }

  .placement-layout { display: flex; gap: 24px; width: 100%; justify-content: center; flex-wrap: wrap; }

  .ship-panel {
    background: rgba(4,18,38,0.85); border: 1px solid rgba(0,212,255,0.15);
    border-radius: 12px; padding: 20px; min-width: 200px;
    backdrop-filter: blur(8px);
  }
  .ship-panel h4 { font-size: 11px; letter-spacing: 3px; color: var(--cyan); margin-bottom: 16px; text-transform: uppercase; }

  .ship-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 6px; margin-bottom: 6px;
    border: 1px solid transparent; cursor: pointer; transition: all 0.2s;
    font-size: 12px;
  }
  .ship-item:hover:not(.placed):not(.active) { background: rgba(0,212,255,0.05); border-color: rgba(0,212,255,0.2); }
  .ship-item.active { background: rgba(0,212,255,0.1); border-color: var(--cyan); }
  .ship-item.placed { opacity: 0.4; text-decoration: line-through; cursor: default; }
  .ship-name { flex: 1; font-family: var(--mono); color: var(--text); }
  .ship-size-dots { display: flex; gap: 3px; }
  .ship-dot { width: 8px; height: 8px; border-radius: 2px; background: var(--steel); }
  .ship-dot.filled { background: var(--cyan); }

  .orient-btn {
    font-family: var(--mono); font-size: 11px; color: var(--dim);
    background: rgba(0,0,0,0.3); border: 1px solid rgba(0,212,255,0.15);
    padding: 6px 12px; border-radius: 6px; cursor: pointer;
    transition: all 0.2s; margin-top: 12px; width: 100%; text-align: center;
  }
  .orient-btn:hover { border-color: var(--cyan); color: var(--cyan); }

  /* GRID */
  .grid-wrapper { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .grid-label { font-size: 11px; letter-spacing: 3px; color: var(--dim); text-transform: uppercase; font-family: var(--mono); }

  .grid-container { position: relative; }
  .grid-table { border-collapse: collapse; }

  .grid-col-header, .grid-row-header {
    width: 24px; height: 24px; font-family: var(--mono);
    font-size: 10px; color: var(--dim); text-align: center;
  }

  .grid-cell {
    width: 36px; height: 36px;
    border: 1px solid rgba(0,70,120,0.5);
    position: relative; cursor: pointer;
    transition: background 0.1s;
    background: rgba(4,18,38,0.6);
  }
  .grid-cell:hover { background: rgba(0,212,255,0.08); border-color: rgba(0,212,255,0.3); }
  .grid-cell.ship { background: transparent; border-color: rgba(0,212,255,0.1); }
  .grid-cell.preview-ok { background: rgba(0,212,255,0.15) !important; border-color: rgba(0,212,255,0.5) !important; }
  .grid-cell.preview-bad { background: rgba(255,56,56,0.15) !important; border-color: rgba(255,56,56,0.4) !important; }
  .grid-cell.hit {
    background: radial-gradient(circle, rgba(255,100,0,0.6), rgba(180,20,0,0.4)) !important;
    border-color: rgba(255,80,0,0.6) !important;
    animation: hitPulse 0.4s ease-out;
  }
  .grid-cell.hit::after {
    content: '💥'; position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; animation: none;
  }
  .grid-cell.miss {
    background: rgba(0,40,80,0.5) !important;
    border-color: rgba(0,100,150,0.3) !important;
  }
  .grid-cell.miss::after {
    content: ''; position: absolute;
    width: 8px; height: 8px; border-radius: 50%;
    background: rgba(0,150,200,0.5);
    top: 50%; left: 50%; transform: translate(-50%,-50%);
    box-shadow: 0 0 6px rgba(0,150,200,0.5);
  }
  .grid-cell.sunk { background: rgba(40,0,0,0.7) !important; border-color: rgba(120,0,0,0.5) !important; }
  .grid-cell.sunk::after { content: '🔥'; font-size: 14px; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .grid-cell.enemy-ship {
    background: rgba(255,50,0,0.2) !important;
    border-color: rgba(255,80,0,0.5) !important;
  }
  @keyframes hitPulse { 0%{transform:scale(1.3)} 100%{transform:scale(1)} }

  .grid-cell.my-turn-hover:hover {
    background: rgba(0,212,255,0.12) !important;
    border-color: var(--cyan) !important;
    cursor: crosshair;
  }
  .grid-cell.my-turn-hover.already-shot { cursor: not-allowed; opacity: 0.7; }

  /* BATTLE */
  .battle-screen {
    flex: 1; width: 100%; max-width: 1200px; padding: 12px 16px;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
  }

  .battle-hud {
    width: 100%; display: flex; align-items: center; justify-content: space-between;
    background: rgba(4,18,38,0.85); border: 1px solid rgba(0,212,255,0.15);
    border-radius: 10px; padding: 10px 20px;
    backdrop-filter: blur(8px);
  }
  .hud-section { display: flex; flex-direction: column; gap: 4px; }
  .hud-label { font-family: var(--mono); font-size: 10px; color: var(--dim); letter-spacing: 2px; }
  .hud-value { font-size: 18px; font-weight: 700; color: var(--cyan); }
  .hud-value.danger { color: var(--red); }
  .hud-value.safe { color: var(--green); }

  .turn-indicator {
    padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 700;
    letter-spacing: 2px; text-transform: uppercase; text-align: center;
    transition: all 0.3s;
  }
  .turn-indicator.my-turn {
    background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.4);
    color: var(--green); animation: turnPulse 1.5s ease-in-out infinite;
  }
  .turn-indicator.enemy-turn {
    background: rgba(255,56,56,0.1); border: 1px solid rgba(255,56,56,0.3);
    color: var(--red);
  }
  @keyframes turnPulse { 0%,100%{box-shadow:0 0 10px rgba(0,255,136,0.2)} 50%{box-shadow:0 0 20px rgba(0,255,136,0.5)} }

  .boards-row {
    display: flex; gap: 24px; justify-content: center;
    flex-wrap: wrap; width: 100%;
  }
  .board-panel {
    background: rgba(4,18,38,0.8); border: 1px solid rgba(0,212,255,0.12);
    border-radius: 12px; padding: 16px;
    backdrop-filter: blur(8px);
  }
  .board-panel.enemy-board { border-color: rgba(255,56,56,0.2); }
  .board-title {
    font-size: 11px; letter-spacing: 3px; margin-bottom: 12px;
    text-transform: uppercase; font-family: var(--mono);
  }
  .board-title.my { color: var(--cyan); }
  .board-title.enemy { color: var(--red); }

  .ship-status-row {
    display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; justify-content: center;
  }
  .ship-badge {
    font-family: var(--mono); font-size: 9px; padding: 3px 7px; border-radius: 4px;
    border: 1px solid rgba(0,212,255,0.2); color: var(--dim); white-space: nowrap;
    transition: all 0.3s;
  }
  .ship-badge.alive { color: var(--cyan); border-color: rgba(0,212,255,0.4); background: rgba(0,212,255,0.05); }
  .ship-badge.sunk { color: var(--red); border-color: rgba(255,56,56,0.3); text-decoration: line-through; background: rgba(255,0,0,0.05); }

  /* EXPLOSION OVERLAY */
  .explosion-overlay {
    position: fixed; inset: 0; z-index: 100;
    pointer-events: none;
  }
  .explosion {
    position: absolute; width: 120px; height: 120px;
    transform: translate(-50%, -50%);
    animation: explode 0.7s ease-out forwards;
  }
  .explosion-ring {
    position: absolute; inset: 0; border-radius: 50%;
    border: 3px solid var(--hit);
    animation: expandRing 0.6s ease-out forwards;
  }
  @keyframes explode {
    0% { transform: translate(-50%,-50%) scale(0); opacity: 1; }
    100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; }
  }
  @keyframes expandRing {
    0% { transform: scale(0); opacity: 1; border-color: #fff; }
    50% { border-color: var(--hit); }
    100% { transform: scale(2); opacity: 0; border-color: transparent; }
  }

  .splash {
    position: absolute; transform: translate(-50%, -50%);
    animation: splashAnim 0.6s ease-out forwards;
    font-size: 40px;
  }
  @keyframes splashAnim {
    0% { transform: translate(-50%,-50%) scale(0) rotate(0deg); opacity: 1; }
    100% { transform: translate(-50%,-80%) scale(1.2) rotate(20deg); opacity: 0; }
  }

  /* LOG */
  .battle-log {
    width: 100%; max-width: 400px;
    background: rgba(2,12,24,0.9); border: 1px solid rgba(0,212,255,0.1);
    border-radius: 8px; padding: 10px 14px; max-height: 120px; overflow-y: auto;
  }
  .log-entry {
    font-family: var(--mono); font-size: 11px; line-height: 1.8;
    border-bottom: 1px solid rgba(0,50,80,0.3); padding: 1px 0;
  }
  .log-entry:last-child { border-bottom: none; }
  .log-entry.hit { color: #ff8c42; }
  .log-entry.miss { color: var(--dim); }
  .log-entry.sunk { color: var(--red); font-weight: 600; }
  .log-entry.info { color: var(--cyan); }
  .log-entry.system { color: var(--gold); }

  /* END SCREEN */
  .end-screen {
    position: fixed; inset: 0; z-index: 50;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 24px; padding: 40px;
    background: rgba(2,12,24,0.93); backdrop-filter: blur(10px);
    overflow-y: auto;
  }
  .end-result {
    font-size: clamp(40px,8vw,80px); font-weight: 900; letter-spacing: 6px; text-align: center;
    line-height: 1;
  }
  .end-result.win {
    background: linear-gradient(135deg, var(--gold), #fff, var(--green));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    animation: winGlow 1.5s ease-in-out infinite;
    filter: drop-shadow(0 0 30px rgba(240,165,0,0.5));
  }
  .end-result.lose {
    background: linear-gradient(135deg, var(--red), #cc2244, #880022);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    animation: loseGlow 1.5s ease-in-out infinite;
    filter: drop-shadow(0 0 30px rgba(220,50,50,0.5));
  }
  @keyframes winGlow { 0%,100%{filter:drop-shadow(0 0 20px rgba(240,165,0,0.4))} 50%{filter:drop-shadow(0 0 50px rgba(240,165,0,0.8))} }
  @keyframes loseGlow { 0%,100%{filter:drop-shadow(0 0 20px rgba(220,50,50,0.4))} 50%{filter:drop-shadow(0 0 50px rgba(220,50,50,0.9))} }

  .end-stats {
    background: rgba(4,18,38,0.85); border: 1px solid rgba(0,212,255,0.2);
    border-radius: 12px; padding: 24px 32px;
    display: flex; gap: 40px; text-align: center;
    backdrop-filter: blur(8px);
  }
  .stat-item { display: flex; flex-direction: column; gap: 6px; }
  .stat-num { font-size: 32px; font-weight: 700; color: var(--cyan); }
  .stat-label { font-family: var(--mono); font-size: 10px; color: var(--dim); letter-spacing: 2px; }

  /* WATER SPLASH */
  @keyframes waterRipple {
    0%   { transform: translate(-50%,-50%) scale(0);   opacity: 0.9; }
    60%  { opacity: 0.6; }
    100% { transform: translate(-50%,-50%) scale(2.8); opacity: 0; }
  }
  @keyframes waterDrop {
    0%   { transform: translateY(-160%) scale(0.6); opacity: 1; }
    60%  { transform: translateY(-20%)  scale(1.1); opacity: 1; }
    100% { transform: translateY(0%)   scale(0.8); opacity: 0; }
  }
  .grid-cell.splash-anim::before {
    content: '';
    position: absolute; top: 50%; left: 50%;
    width: 100%; height: 100%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,200,255,0.75) 0%, rgba(0,130,220,0.35) 45%, transparent 70%);
    pointer-events: none; z-index: 3;
    animation: waterRipple 0.65s ease-out forwards;
  }
  .grid-cell.splash-anim .water-drop {
    position: absolute; top: 50%; left: 50%;
    font-size: 14px; pointer-events: none; z-index: 4;
    animation: waterDrop 0.55s ease-in forwards;
  }

  /* RADAR PING */
  .radar-ping {
    position: absolute; inset: 0; pointer-events: none; z-index: 5;
    border-radius: inherit;
  }
  .radar-ping::after {
    content: '';
    position: absolute; inset: 0; border-radius: inherit;
    border: 2px solid var(--cyan);
    animation: radarPing 2s ease-out infinite;
    opacity: 0;
  }
  @keyframes radarPing {
    0% { transform: scale(0.95); opacity: 0.5; }
    100% { transform: scale(1.05); opacity: 0; }
  }

  /* RESPONSIVE */
  @media (max-width: 700px) {
    /* Header — compact so screens have more room */
    .header { padding: 6px 12px; }
    .logo { font-size: 14px; letter-spacing: 2px; }
    .logo span { display: none; }
    .header-status { font-size: 10px; }

    /* Grid — smaller cells for placement & battle */
    .grid-cell { width: 24px; height: 24px; }
    .grid-col-header, .grid-row-header { width: 16px; height: 16px; font-size: 7px; }

    /* Placement */
    .placement-screen { padding: 6px 8px; gap: 6px; }
    .placement-title { font-size: 11px; letter-spacing: 2px; }
    .placement-layout { gap: 8px; }
    .ship-panel { order: 2; padding: 10px 12px; min-width: 0; width: 100%; }
    .ship-panel h4 { margin-bottom: 8px; }
    .ship-item { padding: 5px 8px; margin-bottom: 3px; }
    .grid-wrapper { order: 1; }
    .board-panel { padding: 8px 10px; }

    /* Battle */
    .battle-screen { height: calc(100dvh - 38px); overflow: hidden; padding: 6px 8px; gap: 6px; }
    .battle-hud { flex-direction: column; gap: 4px; text-align: center; order: 2; padding: 8px 12px; }
    .hud-value { font-size: 14px; }
    .turn-indicator { padding: 6px 14px; font-size: 10px; }
    .battle-stats { order: 3; display: none; }
    .boards-row { order: 1; flex: 1; min-height: 0; overflow-y: auto; gap: 8px; }
    .battle-log { order: 4; display: none; }
    .board-title { margin-bottom: 6px; }
    .ship-status-row { margin-top: 6px; gap: 4px; }
    .end-stats { gap: 20px; }
  }

  /* NOTIFICATION TOAST */
  .toast {
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    z-index: 200; padding: 12px 24px; border-radius: 8px;
    font-family: var(--mono); font-size: 13px; letter-spacing: 1px;
    pointer-events: none;
    animation: toastAnim 3s ease forwards;
  }
  .toast.hit { background: rgba(255,69,0,0.9); color: white; border: 1px solid var(--hit); }
  .toast.miss { background: rgba(0,60,100,0.9); color: var(--cyan); border: 1px solid var(--cyan2); }
  .toast.sunk { background: rgba(120,0,0,0.95); color: white; border: 1px solid var(--red); font-weight: 700; }
  .toast.info { background: rgba(4,18,38,0.95); color: var(--gold); border: 1px solid var(--gold); }
  @keyframes toastAnim {
    0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    10% { opacity: 1; transform: translateX(-50%) translateY(0); }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }

  /* COPY BTN */
  .copy-hint { font-family: var(--mono); font-size: 10px; color: var(--dim); text-align: center; margin-top: -4px; }
  .btn-whatsapp {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; margin-top: 10px; padding: 9px 16px;
    background: linear-gradient(135deg, #25d366, #128c7e);
    color: #fff; border: none; border-radius: 8px;
    font-family: var(--mono); font-size: 11px; letter-spacing: 1px;
    cursor: pointer; text-decoration: none; transition: filter 0.2s, transform 0.15s;
  }
  .btn-whatsapp:hover { filter: brightness(1.15); transform: translateY(-1px); }

  .flex-row { display: flex; gap: 10px; align-items: center; }
  .flex-col { display: flex; flex-direction: column; gap: 8px; }
  .mt-8 { margin-top: 8px; }
  .mt-16 { margin-top: 16px; }
  .text-center { text-align: center; }
  .text-small { font-family: var(--mono); font-size: 11px; color: var(--dim); }
  .text-gold { color: var(--gold); }
  .text-green { color: var(--green); }
  .text-red { color: var(--red); }
  .text-cyan { color: var(--cyan); }

  /* PROGRESS BAR */
  .progress-bar {
    width: 100%; height: 4px; background: rgba(0,50,80,0.5);
    border-radius: 2px; overflow: hidden; margin-top: 6px;
  }
  .progress-fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
  .progress-fill.green { background: linear-gradient(90deg, var(--green), var(--cyan)); }
  .progress-fill.red { background: linear-gradient(90deg, var(--red), #ff8c42); }
`

// ── Ship SVG graphics (warship top-down style) ────────────────────────────────
function ShipShape({ shipId, size, x, y, dir, sunk }) {
  const C = 36, L = size * C
  const t = dir === 'H' ? `translate(${x},${y})` : `translate(${x},${y + L}) rotate(-90)`

  // Color palette
  const h  = sunk ? '#180303' : '#0b2e52'   // hull
  const d  = sunk ? '#2e0606' : '#0e3d6e'   // deck
  const s2 = sunk ? '#4a0a0a' : '#144e87'   // superstructure
  const ac = sunk ? '#bb1515' : '#00c8f8'   // accent / edge
  const lt = sunk ? '#e84040' : '#6ddbff'   // lights / barrels
  const op = sunk ? 0.6 : 1

  // Hull profiles per ship type
  const hullPath = {
    carrier:    `M 4,9 L ${L-12},7 L ${L-3},11 L ${L-1},18 L ${L-3},25 L ${L-12},29 L 4,27 L 2,18 Z`,
    battleship: `M 4,10 L ${L-14},8 L ${L-5},12 L ${L-1},18 L ${L-5},24 L ${L-14},28 L 4,26 L 1,18 Z`,
    cruiser:    `M 4,11 L ${L-12},9 L ${L-3},13 L ${L-1},18 L ${L-3},23 L ${L-12},27 L 4,25 L 2,18 Z`,
    submarine:  `M 8,13 Q 16,9 ${L/2},9 Q ${L-6},9 ${L-1},18 Q ${L-6},27 ${L/2},27 Q 16,27 8,23 Z`,
    destroyer:  `M 4,12 L ${L-10},10 L ${L-2},14 L ${L-1},18 L ${L-2},22 L ${L-10},26 L 4,24 L 2,18 Z`,
  }[shipId] || `M 3,10 L ${L-10},8 L ${L-1},18 L ${L-10},28 L 3,26 L 1,18 Z`

  // Inner deck plate
  const deckPath = {
    carrier:    `M 10,12 L ${L-14},10 L ${L-5},14 L ${L-4},22 L ${L-14},26 L 10,24 Z`,
    battleship: `M 10,13 L ${L-18},11 L ${L-8},15 L ${L-7},21 L ${L-18},25 L 10,23 Z`,
    cruiser:    `M 9,14 L ${L-14},12 L ${L-6},15 L ${L-5},21 L ${L-14},24 L 9,22 Z`,
    submarine:  null,
    destroyer:  `M 8,14 L ${L-12},12 L ${L-5},15 L ${L-4},21 L ${L-12},24 L 8,22 Z`,
  }[shipId]

  const mX = L / 2

  const Details = () => {
    if (shipId === 'carrier') {
      const isX = Math.round(L * 0.58)
      return <>
        {/* Angled flight deck */}
        <polygon points={`12,10 ${L-15},10 ${L-15},22 70,22 55,14`} fill={s2} opacity={0.9} />
        {/* Runway centerline */}
        <line x1={60} y1={16} x2={L-17} y2={16} stroke={lt} strokeWidth={0.8} strokeDasharray="6,4" opacity={0.6}/>
        {/* Island superstructure */}
        <rect x={isX} y={8} width={20} height={12} rx={1} fill={s2} stroke={ac} strokeWidth={0.8}/>
        <rect x={isX+3} y={5} width={6} height={4} rx={1} fill={h}/>
        <line x1={isX+6} y1={5} x2={isX+6} y2={2} stroke={ac} strokeWidth={0.9}/>
        <circle cx={isX+6} cy={2} r={1.8} fill={ac}/>
        {/* Deck edge lights */}
        {[16,30,44,58].map(cx => <circle key={cx} cx={cx} cy={11} r={1.2} fill={lt} opacity={0.8}/>)}
        {/* Elevator */}
        <rect x={18} y={12} width={8} height={9} rx={0.5} fill={h} stroke={ac} strokeWidth={0.5} opacity={0.7}/>
      </>
    }
    if (shipId === 'battleship') {
      return <>
        {/* Rear twin turret */}
        <rect x={12} y={12} width={18} height={12} rx={2} fill={s2} stroke={ac} strokeWidth={0.7}/>
        <rect x={10} y={15.5} width={4} height={2} rx={0.5} fill={lt}/>
        <rect x={10} y={18.5} width={4} height={2} rx={0.5} fill={lt}/>
        {/* Bridge tower */}
        <rect x={mX-11} y={10} width={20} height={16} rx={2} fill={s2} stroke={ac} strokeWidth={0.9}/>
        <rect x={mX-7} y={7} width={12} height={6} rx={1} fill={h}/>
        <rect x={mX-3} y={4} width={6} height={4} rx={1} fill={s2}/>
        <line x1={mX} y1={4} x2={mX} y2={1} stroke={ac} strokeWidth={0.9}/>
        <circle cx={mX} cy={1} r={2} fill={ac}/>
        {/* Front twin turret */}
        <rect x={L-30} y={12} width={18} height={12} rx={2} fill={s2} stroke={ac} strokeWidth={0.7}/>
        <rect x={L-14} y={15.5} width={4} height={2} rx={0.5} fill={lt}/>
        <rect x={L-14} y={18.5} width={4} height={2} rx={0.5} fill={lt}/>
        {/* Smoke funnels */}
        <ellipse cx={mX-16} cy={18} rx={3} ry={4} fill={h} stroke={ac} strokeWidth={0.5}/>
        <ellipse cx={mX+16} cy={18} rx={3} ry={4} fill={h} stroke={ac} strokeWidth={0.5}/>
      </>
    }
    if (shipId === 'cruiser') {
      return <>
        {/* Rear deck gun */}
        <rect x={10} y={13} width={14} height={10} rx={2} fill={s2} stroke={ac} strokeWidth={0.7}/>
        <rect x={8} y={16.5} width={4} height={2} rx={0.5} fill={lt}/>
        {/* Bridge */}
        <rect x={mX-10} y={10} width={18} height={16} rx={2} fill={s2} stroke={ac} strokeWidth={0.8}/>
        <rect x={mX-6} y={7} width={10} height={5} rx={1} fill={h}/>
        <line x1={mX-1} y1={7} x2={mX-1} y2={3} stroke={ac} strokeWidth={0.9}/>
        <circle cx={mX-1} cy={3} r={1.8} fill={ac}/>
        {/* Front gun turret */}
        <rect x={L-26} y={13} width={14} height={10} rx={2} fill={s2} stroke={ac} strokeWidth={0.7}/>
        <rect x={L-14} y={16} width={5} height={2} rx={0.5} fill={lt}/>
        {/* Funnel */}
        <ellipse cx={mX-14} cy={18} rx={3} ry={4} fill={h} stroke={ac} strokeWidth={0.5}/>
      </>
    }
    if (shipId === 'submarine') {
      return <>
        {/* Pressure hull shading */}
        <ellipse cx={mX} cy={18} rx={L/2-10} ry={7} fill={s2} opacity={0.6}/>
        {/* Conning tower (sail) */}
        <rect x={mX-11} y={11} width={16} height={11} rx={3} fill={s2} stroke={ac} strokeWidth={0.8}/>
        <rect x={mX-8} y={8} width={10} height={5} rx={2} fill={h}/>
        {/* Periscope + scope head */}
        <line x1={mX-4} y1={8} x2={mX-4} y2={3} stroke={ac} strokeWidth={1.2}/>
        <line x1={mX-8} y1={3} x2={mX} y2={3} stroke={ac} strokeWidth={1.2}/>
        <circle cx={mX-8} cy={3} r={2} fill={lt} opacity={0.9}/>
        {/* Diving planes */}
        <polygon points={`4,14 12,14 12,22 4,22`} fill={s2} opacity={0.8}/>
        <polygon points={`${L-14},14 ${L-6},14 ${L-6},22 ${L-14},22`} fill={s2} opacity={0.8}/>
        {/* Propeller hint */}
        <ellipse cx={5} cy={18} rx={2} ry={4} fill={s2} stroke={ac} strokeWidth={0.5}/>
      </>
    }
    if (shipId === 'destroyer') {
      return <>
        {/* Rear deck */}
        <rect x={6} y={13} width={L-18} height={10} rx={1} fill={s2} opacity={0.7}/>
        {/* Main gun */}
        <rect x={mX-6} y={12} width={14} height={12} rx={2} fill={s2} stroke={ac} strokeWidth={0.7}/>
        <rect x={mX+6} y={16} width={8} height={2} rx={0.5} fill={lt}/>
        {/* Bridge */}
        <rect x={mX-18} y={12} width={10} height={12} rx={1} fill={s2} stroke={ac} strokeWidth={0.6}/>
        <rect x={mX-16} y={10} width={6} height={4} rx={1} fill={h}/>
        <line x1={mX-13} y1={10} x2={mX-13} y2={7} stroke={ac} strokeWidth={0.8}/>
        {/* Torpedo tubes */}
        <rect x={L-18} y={14} width={8} height={3} rx={1} fill={h} stroke={ac} strokeWidth={0.4}/>
        <rect x={L-18} y={19} width={8} height={3} rx={1} fill={h} stroke={ac} strokeWidth={0.4}/>
      </>
    }
    return null
  }

  return (
    <g transform={t} opacity={op}>
      {/* Hull base */}
      <path d={hullPath} fill={h} stroke={ac} strokeWidth={1.4} strokeLinejoin="round"/>
      {/* Deck plate */}
      {deckPath && <path d={deckPath} fill={d} opacity={0.9}/>}
      {/* Details */}
      <Details/>
      {/* Waterline highlight */}
      <path d={hullPath} fill="none" stroke={lt} strokeWidth={0.4} opacity={0.25}/>
    </g>
  )
}

function ShipOverlay({ shipPlacements, hits, grid, cell, hdr }) {
  const BASE_CELL = 36, BASE_HDR = 24
  const BASE_SZ = BASE_HDR + GRID * BASE_CELL
  const actualSZ = hdr + GRID * cell
  return (
    <svg width={actualSZ} height={actualSZ}
      viewBox={`0 0 ${BASE_SZ} ${BASE_SZ}`}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
      {Object.entries(shipPlacements).map(([shipId, { row, col, dir }]) => {
        const ship = SHIPS.find(s => s.id === shipId)
        if (!ship) return null
        const sunk = hits && grid ? checkSunk(shipId, grid, hits) : false
        return (
          <ShipShape key={shipId} shipId={shipId} size={ship.size}
            x={BASE_HDR + col * BASE_CELL} y={BASE_HDR + row * BASE_CELL} dir={dir} sunk={sunk}/>
        )
      })}
    </svg>
  )
}

// ── Grid component ────────────────────────────────────────────────────────────
function BattleGrid({ grid, hits, ships, mode, onCellClick, onCellHover, hoveredCell, hoverDirection, selectedShip, shipPlacements, splashCells }) {
  // mode: 'placement' | 'my-board' | 'enemy-board'
  const tableRef = useRef(null)
  const [dims, setDims] = useState({ cell: 36, hdr: 24 })

  useEffect(() => {
    const measure = () => {
      if (!tableRef.current) return
      const cell = tableRef.current.querySelector('.grid-cell')
      const hdr = tableRef.current.querySelector('.grid-row-header')
      if (cell && hdr) {
        setDims({ cell: cell.offsetWidth, hdr: hdr.offsetWidth })
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (tableRef.current) ro.observe(tableRef.current)
    return () => ro.disconnect()
  }, [])

  const getCellClass = (r, c) => {
    const classes = ['grid-cell']
    const h = hits?.[r]?.[c]
    const s = grid?.[r]?.[c]
    if (h === 'hit') {
      // Check if sunk
      const shipId = ships?.[r]?.[c] || grid?.[r]?.[c]
      classes.push('hit')
    } else if (h === 'miss') {
      classes.push('miss')
    } else if (s) {
      if (mode === 'my-board') classes.push('ship')
      else if (mode === 'enemy-board') { /* hidden */ }
      else classes.push('ship') // placement
    }

    if (mode === 'placement' && selectedShip && hoveredCell) {
      const [hr, hc] = hoveredCell
      const cells = getShipCells(selectedShip, hr, hc, hoverDirection)
      if (cells) {
        const inPreview = cells.some(([cr, cc]) => cr === r && cc === c)
        if (inPreview) {
          const ok = canPlace(grid, selectedShip, hr, hc, hoverDirection)
          classes.push(ok ? 'preview-ok' : 'preview-bad')
        }
      }
    }
    if (mode === 'enemy-board' && !h) {
      classes.push('my-turn-hover')
      if (h) classes.push('already-shot')
    }
    if (splashCells?.some(s => s.r === r && s.c === c)) classes.push('splash-anim')
    return classes.join(' ')
  }

  const hasShips = shipPlacements && Object.keys(shipPlacements).length > 0
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {hasShips && <ShipOverlay shipPlacements={shipPlacements} hits={hits} grid={grid} cell={dims.cell} hdr={dims.hdr}/>}
      <table className="grid-table" ref={tableRef}>
        <thead>
          <tr>
            <th className="grid-row-header" />
            {cols.map(c => <th key={c} className="grid-col-header">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: GRID }, (_, r) => (
            <tr key={r}>
              <td className="grid-row-header">{r + 1}</td>
              {Array.from({ length: GRID }, (_, c) => (
                <td
                  key={c}
                  className={getCellClass(r, c)}
                  onClick={() => onCellClick?.(r, c)}
                  onMouseEnter={() => onCellHover?.(r, c)}
                  onMouseLeave={() => onCellHover?.(null, null)}
                >
                  {splashCells?.some(s => s.r === r && s.c === c) && <span className="water-drop">💧</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('lobby') // lobby | placement | battle | end
  const [roomCode, setRoomCode] = useState('')
  const [inputCode, setInputCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [peerReady, setPeerReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [connError, setConnError] = useState('')

  // Placement state
  const [myGrid, setMyGrid] = useState(makeEmptyGrid())
  const [placedShips, setPlacedShips] = useState([])
  const [selectedShipIdx, setSelectedShipIdx] = useState(0)
  const [direction, setDirection] = useState('H')
  const [hoveredCell, setHoveredCell] = useState(null)
  const [opponentReady, setOpponentReady] = useState(false)
  const [myReady, setMyReady] = useState(false)

  // Battle state
  const [myHits, setMyHits] = useState(makeEmptyGrid()) // what enemy shot at me
  const [enemyHits, setEnemyHits] = useState(makeEmptyGrid()) // what I shot at enemy
  const [enemyShipGrid, setEnemyShipGrid] = useState(makeEmptyGrid()) // revealed on sink
  const [myTurn, setMyTurn] = useState(false)
  const [gameLog, setGameLog] = useState([])
  const [effects, setEffects] = useState([])
  const [toast, setToast] = useState(null)
  const [endResult, setEndResult] = useState(null) // 'win' | 'lose'
  const [stats, setStats] = useState({ myShots: 0, myHitsCount: 0, enemySunk: 0, mySunk: 0 })
  const [myRematch, setMyRematch] = useState(false)
  const [opponentRematch, setOpponentRematch] = useState(false)

  const [splashCells, setSplashCells] = useState([]) // { r, c, id, board: 'my'|'enemy' }

  const triggerSplash = useCallback((r, c, board) => {
    const id = Date.now() + Math.random()
    setSplashCells(prev => [...prev, { r, c, id, board }])
    setTimeout(() => setSplashCells(prev => prev.filter(s => s.id !== id)), 700)
  }, [])

  const peerRef = useRef(null)
  const connRef = useRef(null)
  const logRef = useRef(null)

  // Scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [gameLog])

  // Cleanup peer on unmount
  useEffect(() => () => { peerRef.current?.destroy() }, [])

  const addLog = useCallback((msg, type = 'info') => {
    setGameLog(prev => [...prev.slice(-50), { msg, type, id: Date.now() + Math.random() }])
  }, [])

  const showToast = useCallback((msg, type) => {
    setToast({ msg, type, id: Date.now() })
    setTimeout(() => setToast(null), 3100)
  }, [])

  const addEffect = useCallback((x, y, type) => {
    const id = Date.now() + Math.random()
    setEffects(prev => [...prev, { id, x, y, type }])
    setTimeout(() => setEffects(prev => prev.filter(e => e.id !== id)), 800)
  }, [])

  // ── PEER SETUP ──
  const initPeer = useCallback((peerId) => {
    const peer = new Peer(peerId, {
      host: '0.peerjs.com', port: 443, path: '/', secure: true,
      debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    })
    peerRef.current = peer

    peer.on('open', (id) => {
      setRoomCode(id)
      setPeerReady(true)
    })

    peer.on('connection', (conn) => {
      setupConn(conn, true)
    })

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // retry with random
        peer.destroy()
        initPeer(null)
      } else {
        setConnError('Connection error: ' + err.message)
      }
    })
  }, [])

  const setupConn = useCallback((conn, hosting) => {
    connRef.current = conn
    conn.on('open', () => {
      setConnected(true)
      setConnError('')
      addLog('Opponent connected. Place your ships.', 'system')
    })
    conn.on('data', handleMessage)
    conn.on('close', () => {
      setConnected(false)
      addLog('Opponent disconnected.', 'system')
    })
    conn.on('error', (e) => setConnError(e.message))
  }, [])

  const send = useCallback((data) => {
    connRef.current?.send(data)
  }, [])

  const handleMessage = useCallback((data) => {
    if (data.type === 'ready') {
      setOpponentReady(true)
      addLog('Opponent is ready!', 'system')
    }
    if (data.type === 'shot') {
      // Enemy shot at me
      const { r, c } = data
      setMyGrid(prev => {
        const isHit = !!prev[r][c]
        setMyHits(prevH => {
          const newH = prevH.map(row => [...row])
          newH[r][c] = isHit ? 'hit' : 'miss'
          // Check if enemy sunk one of my ships
          if (isHit) {
            const shipId = prev[r][c]
            const sunk = checkSunk(shipId, prev, newH)
            send({ type: 'shot-result', r, c, hit: true, miss: false, sunk: sunk ? shipId : null, shipGrid: sunk ? prev : null })
            AudioEngine.init(); AudioEngine.play(sunk ? 'sink' : 'hit')
            addLog(`Enemy hit ${cols[c]}${r+1}${sunk ? ` — ${shipId.toUpperCase()} SUNK!` : '!'}`, sunk ? 'sunk' : 'hit')
            setStats(s => ({ ...s, mySunk: s.mySunk + (sunk ? 1 : 0) }))
            // Hit: enemy keeps shooting — don't flip myTurn
            if (sunk) {
              setTimeout(() => {
                if (allSunk(prev, newH)) {
                  send({ type: 'game-over', winner: 'enemy' })
                  setEndResult('lose')
                  setScreen('end')
                }
              }, 200)
            }
          } else {
            send({ type: 'shot-result', r, c, hit: false, miss: true, sunk: null })
            AudioEngine.init(); AudioEngine.play('miss')
            addLog(`Enemy missed ${cols[c]}${r+1}`, 'miss')
            triggerSplash(r, c, 'my')
            setMyTurn(true) // miss → now it's my turn
          }
          return newH
        })
        return prev
      })
      // removed unconditional setMyTurn(true) — handled per-outcome above
    }
    if (data.type === 'shot-result') {
      // Result of my shot
      const { r, c, hit, miss, sunk, shipGrid } = data
      setEnemyHits(prev => {
        const newH = prev.map(row => [...row])
        newH[r][c] = hit ? 'hit' : 'miss'
        return newH
      })
      if (sunk && shipGrid) {
        setEnemyShipGrid(shipGrid)
        AudioEngine.init(); AudioEngine.play('sink')
        addLog(`💥 You sank their ${sunk.toUpperCase()}! Fire again!`, 'sunk')
        showToast(`${sunk.toUpperCase()} SUNK! KEEP FIRING!`, 'sunk')
        setStats(s => ({ ...s, enemySunk: s.enemySunk + 1, myHitsCount: s.myHitsCount + 1 }))
        setMyTurn(true) // hit → keep shooting
      } else if (hit) {
        AudioEngine.init(); AudioEngine.play('hit')
        addLog(`Hit at ${cols[c]}${r+1}! Fire again!`, 'hit')
        showToast('DIRECT HIT! FIRE AGAIN!', 'hit')
        setStats(s => ({ ...s, myHitsCount: s.myHitsCount + 1 }))
        setMyTurn(true) // hit → keep shooting
      } else {
        AudioEngine.init(); AudioEngine.play('miss')
        addLog(`Missed ${cols[c]}${r+1}`, 'miss')
        showToast('MISS — ENEMY TURN', 'miss')
        triggerSplash(r, c, 'enemy')
        // miss → enemy's turn (myTurn stays false)
      }
    }
    if (data.type === 'game-over') {
      if (data.winner === 'enemy') {
        setEndResult('win')
        setScreen('end')
        AudioEngine.init(); AudioEngine.play('win')
      }
    }
    if (data.type === 'rematch') {
      setOpponentRematch(true)
    }
  }, [send, addLog, showToast, triggerSplash])

  // Re-bind handleMessage on conn open since closure is stale
  useEffect(() => {
    const conn = connRef.current
    if (!conn) return
    conn.off('data')
    conn.on('data', handleMessage)
  }, [handleMessage])

  const createRoom = () => {
    AudioEngine.init()
    setIsHost(true)
    setConnError('')
    const code = 'NS' + Math.random().toString(36).substring(2, 6).toUpperCase()
    initPeer(code)
  }

  const joinRoom = () => {
    if (!inputCode.trim()) return
    AudioEngine.init()
    setIsHost(false)
    setConnError('')
    const peer = new Peer(null, {
      host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 0,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    })
    peerRef.current = peer
    peer.on('open', () => {
      const conn = peer.connect(inputCode.trim().toUpperCase(), { reliable: true })
      setupConn(conn, false)
    })
    peer.on('error', e => setConnError('Could not connect: ' + e.message))
  }

  const copyCode = () => {
    navigator.clipboard?.writeText(roomCode)
    showToast('Room code copied!', 'info')
  }

  // ── PLACEMENT ──
  const unplacedShips = SHIPS.filter(s => !placedShips.includes(s.id))
  const selectedShip = unplacedShips[selectedShipIdx] || null

  const handlePlacementClick = (r, c) => {
    if (!selectedShip) return
    if (!canPlace(myGrid, selectedShip, r, c, direction)) return
    const newGrid = placeShip(myGrid, selectedShip, r, c, direction)
    setMyGrid(newGrid)
    setPlacedShips(prev => [...prev, selectedShip.id])
    setSelectedShipIdx(prev => Math.min(prev, unplacedShips.length - 2))
    AudioEngine.init(); AudioEngine.play('place')
  }

  const handleReady = () => {
    if (placedShips.length < SHIPS.length) return
    setMyReady(true)
    send({ type: 'ready' })
    addLog('You are ready! Waiting for opponent...', 'system')
  }

  const handleRandomPlace = () => {
    let grid = makeEmptyGrid()
    const placed = []
    SHIPS.forEach(ship => {
      let ok = false; let attempts = 0
      while (!ok && attempts < 200) {
        const r = Math.floor(Math.random() * GRID)
        const c = Math.floor(Math.random() * GRID)
        const d = Math.random() > 0.5 ? 'H' : 'V'
        if (canPlace(grid, ship, r, c, d)) {
          grid = placeShip(grid, ship, r, c, d)
          placed.push(ship.id); ok = true
        }
        attempts++
      }
    })
    setMyGrid(grid)
    setPlacedShips(placed)
    AudioEngine.init(); AudioEngine.play('place')
  }

  const handleReset = () => {
    setMyGrid(makeEmptyGrid())
    setPlacedShips([])
    setSelectedShipIdx(0)
  }

  // Start battle when both ready
  useEffect(() => {
    if (myReady && opponentReady) {
      setScreen('battle')
      // Host goes first
      setMyTurn(isHost)
      addLog('BATTLE BEGINS!', 'system')
      if (isHost) addLog('You go first. Fire!', 'info')
      else addLog('Enemy goes first. Brace!', 'info')
    }
  }, [myReady, opponentReady, isHost])

  // ── BATTLE ──
  const handleShot = (r, c) => {
    if (!myTurn) return
    if (enemyHits[r][c]) return // already shot
    AudioEngine.init()
    send({ type: 'shot', r, c })
    setStats(s => ({ ...s, myShots: s.myShots + 1 }))
    addLog(`You fired at ${cols[c]}${r+1}...`, 'info')
    setMyTurn(false) // wait for result
  }

  const handleRematch = () => {
    send({ type: 'rematch' })
    setMyRematch(true)
  }

  // Winner-side game-over: when all enemy ships sunk locally, go to end screen
  useEffect(() => {
    if (screen === 'battle' && stats.enemySunk >= SHIPS.length) {
      setEndResult('win')
      setScreen('end')
      AudioEngine.init(); AudioEngine.play('win')
    }
  }, [stats.enemySunk, screen])

  // When both players requested rematch → reset and go to placement
  useEffect(() => {
    if (!myRematch || !opponentRematch) return
    setMyGrid(makeEmptyGrid())
    setPlacedShips([])
    setSelectedShipIdx(0)
    setHoveredCell(null)
    setMyHits(makeEmptyGrid())
    setEnemyHits(makeEmptyGrid())
    setEnemyShipGrid(makeEmptyGrid())
    setMyTurn(false)
    setGameLog([])
    setEffects([])
    setEndResult(null)
    setStats({ myShots: 0, myHitsCount: 0, enemySunk: 0, mySunk: 0 })
    setMyReady(false)
    setOpponentReady(false)
    setMyRematch(false)
    setOpponentRematch(false)
    setScreen('placement')
    addLog('Rematch started! Deploy your fleet.', 'system')
  }, [myRematch, opponentRematch])

  const startNewGame = () => {
    setScreen('lobby')
    setMyGrid(makeEmptyGrid())
    setPlacedShips([])
    setSelectedShipIdx(0)
    setMyHits(makeEmptyGrid())
    setEnemyHits(makeEmptyGrid())
    setEnemyShipGrid(makeEmptyGrid())
    setMyTurn(false)
    setGameLog([])
    setOpponentReady(false)
    setMyReady(false)
    setConnected(false)
    setRoomCode('')
    setInputCode('')
    setEndResult(null)
    setStats({ myShots: 0, myHitsCount: 0, enemySunk: 0, mySunk: 0 })
    peerRef.current?.destroy()
    peerRef.current = null
    connRef.current = null
  }

  // Start placement when connected
  useEffect(() => {
    if (connected && screen === 'lobby') {
      setScreen('placement')
    }
  }, [connected])

  // Auto-join from URL param (?join=CODE)
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('join')?.toUpperCase()
    if (!code || peerRef.current) return
    setInputCode(code)
    setIsHost(false)
    setConnError('')
    const peer = new Peer(null, {
      host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 0,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    })
    peerRef.current = peer
    peer.on('open', () => {
      const conn = peer.connect(code, { reliable: true })
      setupConn(conn, false)
    })
    peer.on('error', e => setConnError('Could not connect: ' + e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── RENDER ──
  const accuracy = stats.myShots > 0 ? Math.round((stats.myHitsCount / stats.myShots) * 100) : 0
  const myShipPlacements = inferAllPlacements(myGrid)
  const allEnemyPlacements = inferAllPlacements(enemyShipGrid)
  const enemyShipPlacements = Object.fromEntries(
    Object.entries(allEnemyPlacements).filter(([shipId]) => checkSunk(shipId, enemyShipGrid, enemyHits))
  )
  const gameUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : ''

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="ocean-bg" />

      {/* Effects Layer */}
      <div className="explosion-overlay">
        {effects.map(e => (
          <div key={e.id} style={{ position: 'absolute', left: e.x, top: e.y }}>
            {e.type === 'hit' ? (
              <div className="explosion"><div className="explosion-ring" /></div>
            ) : (
              <span className="splash">💧</span>
            )}
          </div>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div key={toast.id} className={`toast ${toast.type}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <header className="header">
        <div className="logo">
          ⚓ NAVAL STRIKE
          <span>MULTIPLAYER BATTLESHIPS</span>
        </div>
        <div className="header-status">
          <div>
            <span className={`status-dot ${connected ? 'online' : peerReady ? 'waiting' : 'offline'}`} />
            {connected ? 'CONNECTED' : peerReady ? 'AWAITING OPPONENT' : 'OFFLINE'}
          </div>
          {roomCode && <div style={{ color: 'var(--dim)' }}>ROOM: <span style={{ color: 'var(--gold)' }}>{roomCode}</span></div>}
        </div>
      </header>

      {/* ── LOBBY ── */}
      {screen === 'lobby' && (
        <div className="lobby">
          <div>
            <div className="lobby-title">NAVAL STRIKE</div>
            <div className="lobby-subtitle" style={{ textAlign: 'center', marginTop: 8 }}>Sink the enemy fleet</div>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: 900 }}>
            {/* Create Room */}
            <div className="lobby-card" style={{ flex: 1, minWidth: 280 }}>
              <h3>🎯 Host a Battle</h3>
              <p className="text-small" style={{ marginBottom: 16 }}>Create a room and share the code with your opponent.</p>
              {!peerReady ? (
                <button className="btn btn-gold btn-full" onClick={createRoom}>CREATE ROOM</button>
              ) : (
                <>
                  <div className="room-code-display" onClick={copyCode} title="Click to copy">{roomCode}</div>
                  <div className="copy-hint">Click code to copy · Share with opponent</div>
                  <a
                    className="btn-whatsapp"
                    href={`https://wa.me/?text=${encodeURIComponent(`⚓ Join my Naval Strike battle!\nTap to join instantly: ${gameUrl}?join=${roomCode}`)}`}
                    target="_blank" rel="noopener noreferrer"
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    INVITE VIA WHATSAPP
                  </a>
                  <div className="waiting-msg mt-8">
                    {connected ? '✅ Opponent connected!' : '⏳ Waiting for opponent to join...'}
                  </div>
                </>
              )}
            </div>

            {/* Join Room */}
            <div className="lobby-card" style={{ flex: 1, minWidth: 280 }}>
              <h3>🚀 Join a Battle</h3>
              <p className="text-small" style={{ marginBottom: 16 }}>Enter the room code from your opponent.</p>
              <div className="input-group">
                <input
                  className="game-input"
                  placeholder="ENTER ROOM CODE"
                  value={inputCode}
                  onChange={e => setInputCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && joinRoom()}
                  maxLength={8}
                />
                <button className="btn btn-primary" onClick={joinRoom} disabled={!inputCode.trim()}>JOIN</button>
              </div>
              {connError && <p className="text-small text-red mt-8">{connError}</p>}
            </div>
          </div>

          {/* Rules */}
          <div className="lobby-card" style={{ maxWidth: 600 }}>
            <h3>📋 How to Play</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
              {[
                ['Place Ships', 'Drag & click to position your fleet strategically'],
                ['Take Turns', 'Click enemy grid to fire — alternating shots'],
                ['Hit or Miss', '💥 Hit = orange | 💧 Miss = blue dot'],
                ['Sink Fleet', 'Sink all 5 enemy ships to win the battle'],
              ].map(([t, d]) => (
                <div key={t} style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--cyan)', fontFamily: 'var(--mono)', marginBottom: 2 }}>{t}</div>
                  <div className="text-small">{d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── PLACEMENT ── */}
      {screen === 'placement' && (
        <div className="placement-screen">
          <div className="placement-title">⚓ DEPLOY YOUR FLEET</div>

          <div className="placement-layout">
            {/* Ship List */}
            <div className="ship-panel">
              <h4>Fleet</h4>
              {SHIPS.map((s, i) => {
                const placed = placedShips.includes(s.id)
                const active = !placed && unplacedShips[selectedShipIdx]?.id === s.id
                return (
                  <div
                    key={s.id}
                    className={`ship-item ${placed ? 'placed' : ''} ${active ? 'active' : ''}`}
                    onClick={() => {
                      if (!placed) {
                        const idx = unplacedShips.findIndex(u => u.id === s.id)
                        if (idx >= 0) setSelectedShipIdx(idx)
                      }
                    }}
                  >
                    <span>{s.icon}</span>
                    <span className="ship-name">{s.name}</span>
                    <div className="ship-size-dots">
                      {Array.from({ length: s.size }, (_, i) => (
                        <div key={i} className={`ship-dot filled`} />
                      ))}
                    </div>
                  </div>
                )
              })}

              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="orient-btn" onClick={() => setDirection(d => d === 'H' ? 'V' : 'H')}>
                  Rotate: {direction === 'H' ? '↔ Horizontal' : '↕ Vertical'} (R)
                </button>
                <button className="btn btn-primary btn-sm btn-full" onClick={handleRandomPlace}>🎲 Random Place</button>
                <button className="btn btn-danger btn-sm btn-full" onClick={handleReset}>↺ Reset</button>
                <button className="btn btn-sm btn-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--dim)', border: '1px solid rgba(255,255,255,0.15)' }} onClick={startNewGame}>← Lobby</button>
                {myReady ? (
                  <div className="waiting-msg" style={{ textAlign: 'center', padding: '8px 0' }}>
                    {opponentReady ? '⚔️ Starting...' : '⏳ Waiting for opponent...'}
                  </div>
                ) : (
                  <button
                    className="btn btn-gold btn-sm btn-full"
                    onClick={handleReady}
                    disabled={placedShips.length < SHIPS.length}
                    style={{ opacity: placedShips.length < SHIPS.length ? 0.3 : 1 }}
                  >
                    ✅ READY TO BATTLE
                  </button>
                )}
              </div>
            </div>

            {/* Grid */}
            <div className="grid-wrapper">
              <div className="grid-label">Your Waters</div>
              <div className="board-panel">
                <BattleGrid
                  grid={myGrid}
                  mode="placement"
                  selectedShip={selectedShip}
                  hoveredCell={hoveredCell}
                  hoverDirection={direction}
                  onCellClick={handlePlacementClick}
                  onCellHover={(r, c) => r !== null ? setHoveredCell([r, c]) : setHoveredCell(null)}
                  shipPlacements={myShipPlacements}
                />
              </div>
              <div className="text-small" style={{ textAlign: 'center' }}>
                {selectedShip
                  ? `Placing: ${selectedShip.icon} ${selectedShip.name} (${selectedShip.size} cells)`
                  : placedShips.length === SHIPS.length ? '✅ All ships placed!' : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BATTLE ── */}
      {screen === 'battle' && (
        <div className="battle-screen">
          {/* HUD */}
          <div className="battle-hud">
            <div className="hud-section">
              <div className="hud-label">MY FLEET</div>
              <div className={`hud-value ${SHIPS.length - countSunk(myGrid, myHits) <= 1 ? 'danger' : 'safe'}`}>
                {SHIPS.length - countSunk(myGrid, myHits)}/{SHIPS.length}
              </div>
            </div>
            <div className="hud-section" style={{ textAlign: 'center' }}>
              <div className={`turn-indicator ${myTurn ? 'my-turn' : 'enemy-turn'}`}>
                {myTurn ? '🎯 YOUR TURN — FIRE!' : '⏳ ENEMY TURN...'}
              </div>
            </div>
            <div className="hud-section" style={{ textAlign: 'right' }}>
              <div className="hud-label">ENEMY FLEET</div>
              <div className={`hud-value ${stats.enemySunk >= 4 ? 'danger' : ''}`}>
                {SHIPS.length - stats.enemySunk}/{SHIPS.length}
              </div>
              <button className="btn btn-sm" style={{ marginTop: 4, background: 'rgba(255,255,255,0.07)', color: 'var(--dim)', border: '1px solid rgba(255,255,255,0.15)', fontSize: 10 }} onClick={startNewGame}>← LOBBY</button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="battle-stats" style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
            <div className="text-small">SHOTS: <span className="text-cyan">{stats.myShots}</span></div>
            <div className="text-small">HITS: <span className="text-gold">{stats.myHitsCount}</span></div>
            <div className="text-small">ACCURACY: <span className={accuracy >= 50 ? 'text-green' : 'text-cyan'}>{accuracy}%</span></div>
            <div className="text-small">SUNK: <span className="text-red">{stats.enemySunk}</span></div>
          </div>

          <div className="boards-row">
            {/* My Board */}
            <div className="board-panel">
              <div className="board-title my">⚓ MY WATERS</div>
              <BattleGrid
                grid={myGrid}
                hits={myHits}
                mode="my-board"
                shipPlacements={myShipPlacements}
                splashCells={splashCells.filter(s => s.board === 'my')}
              />
              <div className="ship-status-row">
                {SHIPS.map(s => {
                  const sunk = checkSunk(s.id, myGrid, myHits)
                  return (
                    <span key={s.id} className={`ship-badge ${sunk ? 'sunk' : 'alive'}`}>
                      {s.icon} {s.name}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* Enemy Board */}
            <div className="board-panel enemy-board" style={{ position: 'relative' }}>
              {myTurn && <div className="radar-ping" />}
              <div className="board-title enemy">🎯 ENEMY WATERS</div>
              <BattleGrid
                grid={enemyShipGrid}
                hits={enemyHits}
                mode="enemy-board"
                onCellClick={myTurn ? handleShot : undefined}
                shipPlacements={enemyShipPlacements}
                splashCells={splashCells.filter(s => s.board === 'enemy')}
              />
              <div className="ship-status-row">
                {SHIPS.map(s => {
                  const sunk = checkSunk(s.id, enemyShipGrid, enemyHits)
                  return (
                    <span key={s.id} className={`ship-badge ${sunk ? 'sunk' : 'alive'}`}>
                      {s.icon} {s.name}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Log */}
          <div className="battle-log" ref={logRef}>
            {gameLog.map(entry => (
              <div key={entry.id} className={`log-entry ${entry.type}`}>{entry.msg}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── END SCREEN ── */}
      {screen === 'end' && (
        <div className="end-screen">
          <div className={`end-result ${endResult}`}>
            {endResult === 'win' ? '⚓ VICTORY!' : '💀 DEFEATED'}
          </div>
          <div className="text-small text-center" style={{ letterSpacing: 3 }}>
            {endResult === 'win' ? 'You sank the entire enemy fleet!' : 'Your fleet has been annihilated.'}
          </div>

          <div className="end-stats">
            <div className="stat-item">
              <div className="stat-num">{stats.myShots}</div>
              <div className="stat-label">Shots Fired</div>
            </div>
            <div className="stat-item">
              <div className="stat-num">{stats.myHitsCount}</div>
              <div className="stat-label">Direct Hits</div>
            </div>
            <div className="stat-item">
              <div className="stat-num">{accuracy}%</div>
              <div className="stat-label">Accuracy</div>
            </div>
            <div className="stat-item">
              <div className="stat-num">{stats.enemySunk}</div>
              <div className="stat-label">Ships Sunk</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={handleRematch}
              disabled={myRematch}
              style={{ padding: '14px 32px', fontSize: 14, minWidth: 160 }}
            >
              {myRematch
                ? (opponentRematch ? '⚔️ Starting...' : '⏳ Waiting...')
                : '🔄 REMATCH'}
            </button>
          </div>
          {myRematch && !opponentRematch && (
            <div className="text-small" style={{ textAlign: 'center', color: 'var(--dim)' }}>
              Waiting for opponent to accept...
            </div>
          )}
          {!myRematch && opponentRematch && (
            <div className="text-small text-gold" style={{ textAlign: 'center', fontWeight: 700, letterSpacing: 1 }}>
              ⚔️ Opponent wants a rematch!
            </div>
          )}
        </div>
      )}
    </div>
  )
}
