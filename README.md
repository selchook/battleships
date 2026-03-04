# ⚓ Naval Strike — Multiplayer Battleships

A real-time multiplayer Battleships game inspired by Warships Online, built with React + Vite + PeerJS.

## Features

- 🎮 **Real-time P2P multiplayer** via PeerJS (no server required)
- ⚓ **5 ships**: Carrier, Battleship, Cruiser, Submarine, Destroyer
- 🎯 **Ship placement** with drag-preview, rotation, and random placement
- 💥 **Hit/miss animations** with explosion effects
- 🔊 **Web Audio** synthesized sound effects
- 📋 **Battle log** with real-time commentary
- 📊 **Post-game stats**: shots, accuracy, ships sunk
- 📱 **Mobile responsive** layout
- 🌊 **Warships Online-inspired** dark navy aesthetic

## Deploy to Vercel

### Option 1: Vercel CLI
```bash
npm install -g vercel
npm install
vercel --prod
```

### Option 2: GitHub + Vercel Dashboard
1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project
3. Import your repo → Deploy (auto-detects Vite)

### Option 3: Vercel Dashboard drag & drop
1. Run `npm run build` locally
2. Drag the `dist/` folder to Vercel's deploy page

## Local Development

```bash
npm install
npm run dev
```

## How to Play

1. **Player 1**: Click "Create Room" → Copy the room code
2. **Player 2**: Enter the room code → Click "Join"
3. Both players place their ships (or use Random)
4. Click "Ready to Battle"
5. Take turns clicking the enemy grid to fire
6. First to sink all 5 enemy ships wins!

## Tech Stack

- **React 18** + Vite
- **PeerJS** for WebRTC peer-to-peer connections
- **Web Audio API** for procedural sound effects
- **CSS animations** for visual effects
- Zero external CSS dependencies
