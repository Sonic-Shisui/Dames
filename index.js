const express = require('express');
const fs = require('fs');
const app = express();
const port = 3000;

app.use(express.json());

// 📁 Création dossier de sauvegarde
const SAVE_DIR = './saves';
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR);

// 📦 Sauvegarde automatique
const GAME_FILE = `${SAVE_DIR}/games.json`;
const PLAYER_FILE = `${SAVE_DIR}/players.json`;

function saveToFile(filename, data) {
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

function loadFromFile(filename) {
  if (!fs.existsSync(filename)) return {};
  return JSON.parse(fs.readFileSync(filename));
}

// 🧠 Données persistantes
let games = loadFromFile(GAME_FILE);
let playerStats = loadFromFile(PLAYER_FILE);

// ♟️ Constants
const EMPTY = "🟩", PION_B = "⚪", PION_N = "⚫", DAME_B = "🔵", DAME_N = "🔴";

function createDamierBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 8; j++) if ((i + j) % 2 === 1) board[i][j] = PION_N;
  for (let i = 5; i < 8; i++)
    for (let j = 0; j < 8; j++) if ((i + j) % 2 === 1) board[i][j] = PION_B;
  return board;
}

function displayDamier(board) {
  let s = "  a b c d e f g h\n";
  for (let i = 0; i < 8; i++) {
    s += (8 - i) + " ";
    for (let j = 0; j < 8; j++) s += board[i][j] + " ";
    s += "\n";
  }
  return s;
}

function parseDamierMove(move) {
  const regex = /^([a-h][1-8])\s+([a-h][1-8])$/i;
  const match = move.match(regex);
  if (!match) return null;
  const pos = (p) => [8 - Number(p[1]), p.charCodeAt(0) - 97];
  return [pos(match[1].toLowerCase()), pos(match[2].toLowerCase())];
}

function isInside(x, y) {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

function isValidMove(board, from, to, color) {
  const [fx, fy] = from, [tx, ty] = to;
  if (!isInside(fx, fy) || !isInside(tx, ty)) return false;
  const piece = board[fx][fy];
  if (board[tx][ty] !== EMPTY) return false;

  if (piece === PION_B && color === 'blanc') {
    if (fx - tx === 1 && Math.abs(ty - fy) === 1) return true;
  }
  if (piece === PION_N && color === 'noir') {
    if (tx - fx === 1 && Math.abs(ty - fy) === 1) return true;
  }
  return false;
}

// 🆕 Nouvelle partie
app.post('/game', (req, res) => {
  const { player1, player2 } = req.body;
  const gameId = `${player1}-${player2}-${Date.now()}`;
  games[gameId] = {
    board: createDamierBoard(),
    players: { blanc: player1, noir: player2 },
    turn: 'blanc',
    inProgress: true
  };
  saveToFile(GAME_FILE, games);
  res.json({ gameId, message: "Nouvelle partie créée et sauvegardée !" });
});

// 🧠 Jouer un coup
app.post('/game/:gameId/move', (req, res) => {
  const { gameId } = req.params;
  const { move, player } = req.body;
  const game = games[gameId];

  if (!game || !game.inProgress)
    return res.status(404).json({ error: "Partie introuvable ou terminée." });

  if (game.players[game.turn] !== player)
    return res.status(403).json({ error: "Ce n'est pas votre tour." });

  const parsed = parseDamierMove(move);
  if (!parsed) return res.status(400).json({ error: "Format de coup invalide." });

  const [from, to] = parsed;
  const valid = isValidMove(game.board, from, to, game.turn);
  if (!valid) return res.status(400).json({ error: "Coup invalide." });

  const piece = game.board[from[0]][from[1]];
  game.board[to[0]][to[1]] = piece;
  game.board[from[0]][from[1]] = EMPTY;
  game.turn = game.turn === 'blanc' ? 'noir' : 'blanc';

  saveToFile(GAME_FILE, games);
  res.json({ message: "Coup joué et sauvegardé !", board: displayDamier(game.board) });
});

// 📋 Statistiques joueur
app.get('/player/:id/stats', (req, res) => {
  const id = req.params.id;
  const stats = playerStats[id] || { wins: 0, losses: 0 };
  res.json(stats);
});

// ♻️ Réinitialiser stats
app.post('/player/:id/reset', (req, res) => {
  const id = req.params.id;
  playerStats[id] = { wins: 0, losses: 0 };
  saveToFile(PLAYER_FILE, playerStats);
  res.json({ message: "Stats réinitialisées." });
});

// 📂 Voir état du damier
app.get('/game/:gameId', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: "Partie non trouvée." });
  res.json({
    board: displayDamier(game.board),
    turn: game.turn,
    players: game.players
  });
});

// 📜 Liste des parties actives
app.get('/games', (req, res) => {
  const list = Object.entries(games)
    .filter(([_, g]) => g.inProgress)
    .map(([id, g]) => ({ id, players: g.players, turn: g.turn }));
  res.json(list);
});

// 🔥 Lancer serveur
app.listen(port, () => {
  console.log(`📡 API de dames sauvegardée en ligne sur http://localhost:${port}`);
});