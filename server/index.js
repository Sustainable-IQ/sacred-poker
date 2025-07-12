const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

let gameState = null;
let connectedPlayers = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join-game', (playerName) => {
    connectedPlayers[socket.id] = playerName;
    console.log(`${playerName} joined the game`);
    io.emit('player-update', Object.values(connectedPlayers));
  });

  socket.on('game-action', (action) => {
    io.emit('game-state-update', action);
  });

  socket.on('disconnect', () => {
    const playerName = connectedPlayers[socket.id];
    delete connectedPlayers[socket.id];
    console.log(`${playerName} disconnected`);
    io.emit('player-update', Object.values(connectedPlayers));
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running', players: Object.keys(connectedPlayers).length });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Sacred Poker server running on port ${PORT}`);
});