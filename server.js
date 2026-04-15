const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dames_super_secret_key_2024';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes, veuillez réessayer plus tard' }
});
app.use('/api/', limiter);

const SAVES_DIR = path.join(__dirname, 'saved_games');
const BACKUP_DIR = path.join(__dirname, 'backups');

if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dames_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const UserSchema = new mongoose.Schema({
  facebookId: { type: String, unique: true, required: true },
  username: { type: String, default: '' },
  email: { type: String, default: '' },
  password: { type: String, default: null },
  elo: { type: Number, default: 1200 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  bestWinStreak: { type: Number, default: 0 },
  currentWinStreak: { type: Number, default: 0 },
  totalCaptures: { type: Number, default: 0 },
  totalGameTime: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blocked: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  achievements: [{
    name: String,
    unlockedAt: Date,
    description: String
  }]
});

const GameSchema = new mongoose.Schema({
  gameId: { type: String, unique: true, required: true },
  threadId: { type: String, default: '' },
  player1: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  player2: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  board: { type: [[String]], required: true },
  currentTurn: { type: Number, default: 0 },
  status: { type: String, enum: ['waiting', 'active', 'paused', 'completed', 'abandoned'], default: 'waiting' },
  moveHistory: [{
    from: [Number],
    to: [Number],
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    isCapture: { type: Boolean, default: false },
    pieceMoved: String,
    pieceCaptured: String
  }],
  startTime: { type: Date, default: Date.now },
  lastMoveTime: Date,
  endTime: Date,
  gameType: { type: String, enum: ['ai', 'friend', 'tournament', 'practice'], default: 'friend' },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'expert'], default: 'medium' },
  imageMode: { type: Boolean, default: false },
  spectators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  chatLog: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    timestamp: { type: Date, default: Date.now }
  }],
  timeControl: {
    enabled: { type: Boolean, default: false },
    timePerMove: { type: Number, default: 60 },
    player1TimeLeft: Number,
    player2TimeLeft: Number
  }
});

const TournamentSchema = new mongoose.Schema({
  tournamentId: { type: String, unique: true, required: true },
  threadId: { type: String, default: '' },
  name: { type: String, default: 'Tournoi Dames' },
  description: { type: String, default: '' },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  bracket: [{
    round: Number,
    matchId: String,
    player1: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    player2: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    score: String,
    completed: { type: Boolean, default: false },
    gameId: String
  }],
  status: { type: String, enum: ['registering', 'active', 'completed', 'cancelled'], default: 'registering' },
  prize: { type: String, default: '🏆 Champion du tournoi' },
  maxParticipants: { type: Number, default: 16 },
  currentRound: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
});

const SavedGameSchema = new mongoose.Schema({
  saveId: { type: String, unique: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameData: {
    board: [[String]],
    players: [{
      id: String,
      name: String,
      color: String
    }],
    turn: Number,
    moveHistory: Array,
    gameType: String,
    difficulty: String
  },
  saveName: { type: String, default: 'Partie sauvegardée' },
  createdAt: { type: Date, default: Date.now },
  lastAccessed: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Game = mongoose.model('Game', GameSchema);
const Tournament = mongoose.model('Tournament', TournamentSchema);
const SavedGame = mongoose.model('SavedGame', SavedGameSchema);

function generateGameId() {
  return `game_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function generateTournamentId() {
  return `tourney_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function generateSaveId() {
  return `save_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
}

const PION_B = "⚪", PION_N = "⚫", DAME_B = "🔵", DAME_N = "🔴", EMPTY = "🟩";

function createInitialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 8; j++) {
      if ((i + j) % 2 === 1) board[i][j] = PION_N;
    }
  }
  for (let i = 5; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if ((i + j) % 2 === 1) board[i][j] = PION_B;
    }
  }
  return board;
}

function isValidMove(board, from, to, playerColor) {
  const [fx, fy] = from;
  const [tx, ty] = to;
  const piece = board[fx][fy];
  
  if (!piece || board[tx][ty] !== EMPTY) return { valid: false, reason: 'Case non vide ou pièce inexistante' };
  
  const isInside = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
  if (!isInside(fx, fy) || !isInside(tx, ty)) return { valid: false, reason: 'Hors du plateau' };
  
  const hasMandatoryCapture = () => {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (playerColor === 'blanc' && (board[i][j] === PION_B || board[i][j] === DAME_B)) {
          for (let di = -2; di <= 2; di+=2) {
            for (let dj = -2; dj <= 2; dj+=2) {
              const mi = i + di/2, mj = j + dj/2;
              const ti = i + di, tj = j + dj;
              if (isInside(ti, tj) && board[ti][tj] === EMPTY && isInside(mi, mj) && 
                  (board[mi][mj] === PION_N || board[mi][mj] === DAME_N)) {
                return true;
              }
            }
          }
        } else if (playerColor === 'noir' && (board[i][j] === PION_N || board[i][j] === DAME_N)) {
          for (let di = -2; di <= 2; di+=2) {
            for (let dj = -2; dj <= 2; dj+=2) {
              const mi = i + di/2, mj = j + dj/2;
              const ti = i + di, tj = j + dj;
              if (isInside(ti, tj) && board[ti][tj] === EMPTY && isInside(mi, mj) && 
                  (board[mi][mj] === PION_B || board[mi][mj] === DAME_B)) {
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  };
  
  const mandatoryCapture = hasMandatoryCapture();
  
  if (piece === PION_B) {
    if (fx - tx === 1 && Math.abs(ty - fy) === 1 && !mandatoryCapture) {
      return { valid: true, isCapture: false };
    }
    if (fx - tx === 2 && Math.abs(ty - fy) === 2) {
      const midX = fx - 1;
      const midY = fy + (ty - fy) / 2;
      if (!Number.isInteger(midY)) return { valid: false, reason: 'Mouvement invalide' };
      if (board[midX][midY] === PION_N || board[midX][midY] === DAME_N) {
        return { valid: true, isCapture: true, capturedPiece: board[midX][midY], capturePos: [midX, midY] };
      }
    }
  }
  
  if (piece === PION_N) {
    if (tx - fx === 1 && Math.abs(ty - fy) === 1 && !mandatoryCapture) {
      return { valid: true, isCapture: false };
    }
    if (tx - fx === 2 && Math.abs(ty - fy) === 2) {
      const midX = fx + 1;
      const midY = fy + (ty - fy) / 2;
      if (!Number.isInteger(midY)) return { valid: false, reason: 'Mouvement invalide' };
      if (board[midX][midY] === PION_B || board[midX][midY] === DAME_B) {
        return { valid: true, isCapture: true, capturedPiece: board[midX][midY], capturePos: [midX, midY] };
      }
    }
  }
  
  if (piece === DAME_B || piece === DAME_N) {
    if (Math.abs(fx - tx) === Math.abs(fy - ty)) {
      const dx = tx > fx ? 1 : -1, dy = ty > fy ? 1 : -1;
      let x = fx + dx, y = fy + dy;
      let captured = null;
      let capturePos = null;
      
      while (x !== tx && y !== ty) {
        if (board[x][y] !== EMPTY) {
          if (captured) return { valid: false, reason: 'Capture multiple non autorisée' };
          const isEnemy = (piece === DAME_B && (board[x][y] === PION_N || board[x][y] === DAME_N)) ||
                         (piece === DAME_N && (board[x][y] === PION_B || board[x][y] === DAME_B));
          if (isEnemy) {
            captured = board[x][y];
            capturePos = [x, y];
          } else {
            return { valid: false, reason: 'Pièce alliée sur le chemin' };
          }
        }
        x += dx; y += dy;
      }
      if (!mandatoryCapture || captured) {
        return { valid: true, isCapture: !!captured, capturedPiece: captured, capturePos: capturePos };
      }
    }
  }
  return { valid: false, reason: 'Mouvement invalide' };
}

function checkPromotion(board) {
  let promoted = false;
  for (let j = 0; j < 8; j++) {
    if (board[0][j] === PION_B) {
      board[0][j] = DAME_B;
      promoted = true;
    }
    if (board[7][j] === PION_N) {
      board[7][j] = DAME_N;
      promoted = true;
    }
  }
  return promoted;
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { facebookId, username, email, password } = req.body;
    
    let user = await User.findOne({ facebookId });
    if (user) {
      return res.status(400).json({ error: 'Utilisateur déjà existant' });
    }
    
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
    
    user = new User({
      facebookId,
      username: username || `Joueur_${facebookId.slice(-6)}`,
      email: email || '',
      password: hashedPassword,
      lastActive: new Date()
    });
    
    await user.save();
    
    const token = jwt.sign({ userId: user._id, facebookId }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        facebookId: user.facebookId,
        username: user.username,
        email: user.email,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        gamesPlayed: user.gamesPlayed
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { facebookId, password } = req.body;
    
    const user = await User.findOne({ facebookId });
    if (!user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    
    if (user.password) {
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Mot de passe incorrect' });
      }
    }
    
    user.lastActive = new Date();
    await user.save();
    
    const token = jwt.sign({ userId: user._id, facebookId }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        facebookId: user.facebookId,
        username: user.username,
        email: user.email,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        gamesPlayed: user.gamesPlayed
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const authenticate = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Accès non autorisé' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token invalide' });
  }
};

app.post('/api/games/create', authenticate, async (req, res) => {
  try {
    const { player2Id, gameType, difficulty, imageMode, threadId, timeControl } = req.body;
    
    const player1 = await User.findById(req.user.userId);
    let player2 = null;
    
    if (player2Id && gameType !== 'ai') {
      player2 = await User.findOne({ facebookId: player2Id });
      if (!player2) {
        return res.status(404).json({ error: 'Joueur non trouvé' });
      }
    }
    
    const initialBoard = createInitialBoard();
    
    const timeControlData = timeControl ? {
      enabled: true,
      timePerMove: timeControl.timePerMove || 60,
      player1TimeLeft: (timeControl.timePerMove || 60) * 40,
      player2TimeLeft: (timeControl.timePerMove || 60) * 40
    } : { enabled: false };
    
    const game = new Game({
      gameId: generateGameId(),
      threadId: threadId || '',
      player1: player1._id,
      player2: gameType === 'ai' ? null : (player2 ? player2._id : null),
      board: initialBoard,
      currentTurn: 0,
      status: 'active',
      gameType,
      difficulty: difficulty || 'medium',
      imageMode: imageMode || false,
      lastMoveTime: new Date(),
      timeControl: timeControlData
    });
    
    await game.save();
    
    res.json({
      success: true,
      game: {
        gameId: game.gameId,
        board: game.board,
        currentTurn: game.currentTurn,
        status: game.status,
        gameType: game.gameType
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/games/:gameId/move', authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { from, to, playerId } = req.body;
    
    const game = await Game.findOne({ gameId })
      .populate('player1', 'username elo')
      .populate('player2', 'username elo');
    
    if (!game) {
      return res.status(404).json({ error: 'Partie non trouvée' });
    }
    
    if (game.status !== 'active') {
      return res.status(400).json({ error: 'Partie terminée' });
    }
    
    const currentPlayerId = game.currentTurn === 0 ? game.player1._id : game.player2?._id;
    const requestingUser = await User.findById(req.user.userId);
    const isAI = game.gameType === 'ai' && game.currentTurn === 1;
    
    if (!isAI && currentPlayerId && requestingUser._id.toString() !== currentPlayerId.toString()) {
      return res.status(403).json({ error: 'Ce n\'est pas votre tour' });
    }
    
    const playerColor = game.currentTurn === 0 ? 'blanc' : 'noir';
    const moveValidation = isValidMove(game.board, from, to, playerColor);
    
    if (!moveValidation.valid && !isAI) {
      return res.status(400).json({ error: moveValidation.reason || 'Coup invalide' });
    }
    
    if (!isAI) {
      const [fx, fy] = from;
      const [tx, ty] = to;
      const piece = game.board[fx][fy];
      const isCapture = moveValidation.isCapture || false;
      
      game.board[tx][ty] = piece;
      game.board[fx][fy] = EMPTY;
      
      if (isCapture && moveValidation.capturePos) {
        const [cx, cy] = moveValidation.capturePos;
        game.board[cx][cy] = EMPTY;
      }
      
      const promoted = checkPromotion(game.board);
      
      game.moveHistory.push({
        from,
        to,
        player: currentPlayerId,
        timestamp: new Date(),
        isCapture,
        pieceMoved: piece,
        pieceCaptured: moveValidation.capturedPiece || null
      });
      
      if (game.timeControl.enabled) {
        if (game.currentTurn === 0) {
          game.timeControl.player1TimeLeft -= 5;
        } else {
          game.timeControl.player2TimeLeft -= 5;
        }
      }
    }
    
    let hasBlanc = false, hasNoir = false;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (game.board[i][j] === PION_B || game.board[i][j] === DAME_B) hasBlanc = true;
        if (game.board[i][j] === PION_N || game.board[i][j] === DAME_N) hasNoir = true;
      }
    }
    
    if (!hasBlanc || !hasNoir) {
      game.status = 'completed';
      game.endTime = new Date();
      game.winner = hasBlanc ? game.player1._id : game.player2?._id;
      
      const winner = await User.findById(game.winner);
      const loser = await User.findById(game.winner === game.player1._id ? game.player2?._id : game.player1._id);
      
      if (winner && loser) {
        winner.wins++;
        winner.gamesPlayed++;
        winner.currentWinStreak++;
        if (winner.currentWinStreak > winner.bestWinStreak) {
          winner.bestWinStreak = winner.currentWinStreak;
        }
        winner.lastActive = new Date();
        await winner.save();
        
        loser.losses++;
        loser.gamesPlayed++;
        loser.currentWinStreak = 0;
        loser.lastActive = new Date();
        await loser.save();
        
        const eloChange = Math.round(32 * (1 - 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400))));
        winner.elo += eloChange;
        loser.elo -= eloChange;
        await winner.save();
        await loser.save();
      }
    } else {
      game.currentTurn = game.currentTurn === 0 ? 1 : 0;
      game.lastMoveTime = new Date();
    }
    
    await game.save();
    
    res.json({
      success: true,
      game: {
        gameId: game.gameId,
        board: game.board,
        currentTurn: game.currentTurn,
        status: game.status,
        winner: game.winner,
        moveHistory: game.moveHistory.slice(-10),
        moveCount: game.moveHistory.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/games/:gameId', authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const game = await Game.findOne({ gameId })
      .populate('player1', 'username facebookId elo wins losses')
      .populate('player2', 'username facebookId elo wins losses')
      .populate('winner', 'username facebookId');
    
    if (!game) {
      return res.status(404).json({ error: 'Partie non trouvée' });
    }
    
    res.json({
      success: true,
      game: {
        gameId: game.gameId,
        player1: game.player1,
        player2: game.player2,
        winner: game.winner,
        board: game.board,
        currentTurn: game.currentTurn,
        status: game.status,
        gameType: game.gameType,
        moveHistory: game.moveHistory,
        startTime: game.startTime,
        lastMoveTime: game.lastMoveTime,
        moveCount: game.moveHistory.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/games/user/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20, status = 'completed' } = req.query;
    
    const user = await User.findOne({ facebookId: userId });
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    const games = await Game.find({
      $or: [{ player1: user._id }, { player2: user._id }],
      status: status
    })
      .populate('player1', 'username')
      .populate('player2', 'username')
      .populate('winner', 'username')
      .sort({ endTime: -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      games: games.map(g => ({
        gameId: g.gameId,
        opponent: g.player1._id.equals(user._id) ? g.player2 : g.player1,
        winner: g.winner,
        result: g.winner && g.winner._id.equals(user._id) ? 'win' : (g.winner ? 'loss' : 'draw'),
        endTime: g.endTime,
        moveCount: g.moveHistory.length
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/games/:gameId/abandon', authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const game = await Game.findOne({ gameId })
      .populate('player1')
      .populate('player2');
    
    if (!game) {
      return res.status(404).json({ error: 'Partie non trouvée' });
    }
    
    if (game.status !== 'active') {
      return res.status(400).json({ error: 'Partie déjà terminée' });
    }
    
    const abandoningPlayer = await User.findById(req.user.userId);
    const isPlayer1 = game.player1._id.toString() === abandoningPlayer._id.toString();
    const winner = isPlayer1 ? game.player2 : game.player1;
    
    game.status = 'abandoned';
    game.endTime = new Date();
    game.winner = winner?._id || null;
    await game.save();
    
    if (winner) {
      winner.wins++;
      winner.gamesPlayed++;
      await winner.save();
      
      if (abandoningPlayer) {
        abandoningPlayer.losses++;
        abandoningPlayer.gamesPlayed++;
        await abandoningPlayer.save();
      }
    }
    
    res.json({
      success: true,
      message: 'Partie abandonnée',
      winner: winner?.username || 'Joueur'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/games/save', authenticate, async (req, res) => {
  try {
    const { gameId, saveName, gameData } = req.body;
    
    const existingSave = await SavedGame.findOne({ saveId: gameId, userId: req.user.userId });
    if (existingSave) {
      existingSave.gameData = gameData;
      existingSave.lastAccessed = new Date();
      existingSave.saveName = saveName || existingSave.saveName;
      await existingSave.save();
      
      return res.json({
        success: true,
        saveId: existingSave.saveId,
        message: 'Sauvegarde mise à jour'
      });
    }
    
    const savedGame = new SavedGame({
      saveId: generateSaveId(),
      userId: req.user.userId,
      gameData: gameData,
      saveName: saveName || `Partie_${new Date().toLocaleDateString()}`,
      lastAccessed: new Date()
    });
    
    await savedGame.save();
    
    res.json({
      success: true,
      saveId: savedGame.saveId,
      saveName: savedGame.saveName
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/games/saved/list', authenticate, async (req, res) => {
  try {
    const saves = await SavedGame.find({ userId: req.user.userId })
      .sort({ lastAccessed: -1 })
      .limit(50);
    
    res.json({
      success: true,
      saves: saves.map(s => ({
        saveId: s.saveId,
        saveName: s.saveName,
        createdAt: s.createdAt,
        lastAccessed: s.lastAccessed
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/games/saved/:saveId', authenticate, async (req, res) => {
  try {
    const { saveId } = req.params;
    
    const savedGame = await SavedGame.findOne({ saveId, userId: req.user.userId });
    if (!savedGame) {
      return res.status(404).json({ error: 'Sauvegarde non trouvée' });
    }
    
    savedGame.lastAccessed = new Date();
    await savedGame.save();
    
    res.json({
      success: true,
      gameData: savedGame.gameData,
      saveName: savedGame.saveName,
      createdAt: savedGame.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/games/saved/:saveId', authenticate, async (req, res) => {
  try {
    const { saveId } = req.params;
    
    await SavedGame.findOneAndDelete({ saveId, userId: req.user.userId });
    
    res.json({
      success: true,
      message: 'Sauvegarde supprimée'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tournaments/create', authenticate, async (req, res) => {
  try {
    const { threadId, name, description, participants, prize, maxParticipants } = req.body;
    
    const participantUsers = await User.find({ facebookId: { $in: participants } });
    
    const tournament = new Tournament({
      tournamentId: generateTournamentId(),
      threadId: threadId || '',
      name: name || 'Tournoi Dames',
      description: description || '',
      organizer: req.user.userId,
      participants: participantUsers.map(p => p._id),
      prize: prize || '🏆 Champion du tournoi',
      maxParticipants: maxParticipants || 16,
      status: 'registering'
    });
    
    const shuffled = [...participantUsers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) {
        tournament.bracket.push({
          round: 1,
          matchId: `match_${Date.now()}_${i}`,
          player1: shuffled[i]._id,
          player2: shuffled[i + 1]._id,
          completed: false
        });
      }
    }
    
    await tournament.save();
    
    res.json({
      success: true,
      tournament: {
        tournamentId: tournament.tournamentId,
        name: tournament.name,
        participants: tournament.participants.length,
        bracket: tournament.bracket.map(m => ({
          matchId: m.matchId,
          player1: m.player1,
          player2: m.player2,
          completed: m.completed
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tournaments/:tournamentId', authenticate, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    
    const tournament = await Tournament.findOne({ tournamentId })
      .populate('participants', 'username facebookId elo')
      .populate('organizer', 'username')
      .populate('bracket.player1', 'username facebookId')
      .populate('bracket.player2', 'username facebookId')
      .populate('bracket.winner', 'username facebookId');
    
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }
    
    res.json({
      success: true,
      tournament
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tournaments/:tournamentId/join', authenticate, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }
    
    if (tournament.status !== 'registering') {
      return res.status(400).json({ error: 'Les inscriptions sont fermées' });
    }
    
    if (tournament.participants.length >= tournament.maxParticipants) {
      return res.status(400).json({ error: 'Tournoi complet' });
    }
    
    if (tournament.participants.includes(req.user.userId)) {
      return res.status(400).json({ error: 'Déjà inscrit' });
    }
    
    tournament.participants.push(req.user.userId);
    await tournament.save();
    
    res.json({
      success: true,
      participants: tournament.participants.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tournaments/:tournamentId/start', authenticate, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }
    
    if (tournament.organizer.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Seul l\'organisateur peut démarrer le tournoi' });
    }
    
    if (tournament.participants.length < 4) {
      return res.status(400).json({ error: 'Minimum 4 participants requis' });
    }
    
    tournament.status = 'active';
    tournament.currentRound = 1;
    await tournament.save();
    
    res.json({
      success: true,
      message: 'Tournoi démarré'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tournaments/:tournamentId/update-match', authenticate, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { matchId, winnerId, score, gameId } = req.body;
    
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournoi non trouvé' });
    }
    
    const match = tournament.bracket.find(m => m.matchId === matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match non trouvé' });
    }
    
    match.winner = winnerId;
    match.score = score;
    match.completed = true;
    match.gameId = gameId;
    
    const allCompleted = tournament.bracket.filter(m => m.round === tournament.currentRound).every(m => m.completed);
    if (allCompleted && tournament.currentRound < Math.log2(tournament.participants.length)) {
      tournament.currentRound++;
      const winners = tournament.bracket.filter(m => m.completed && m.winner);
      for (let i = 0; i < winners.length; i += 2) {
        if (i + 1 < winners.length) {
          tournament.bracket.push({
            round: tournament.currentRound,
            matchId: `match_${Date.now()}_${i}`,
            player1: winners[i].winner,
            player2: winners[i + 1].winner,
            completed: false
          });
        }
      }
    } else if (allCompleted) {
      tournament.status = 'completed';
      tournament.completedAt = new Date();
    }
    
    await tournament.save();
    
    res.json({
      success: true,
      tournament
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const type = req.query.type || 'elo';
    
    let sortField = {};
    if (type === 'elo') sortField = { elo: -1 };
    else if (type === 'wins') sortField = { wins: -1 };
    else if (type === 'winrate') sortField = { wins: -1, gamesPlayed: 1 };
    else sortField = { elo: -1 };
    
    const leaderboard = await User.find({ gamesPlayed: { $gt: 0 } })
      .sort(sortField)
      .limit(limit)
      .select('username elo wins losses draws gamesPlayed bestWinStreak');
    
    const leaderboardWithStats = leaderboard.map((user, index) => ({
      rank: index + 1,
      username: user.username,
      elo: user.elo,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      gamesPlayed: user.gamesPlayed,
      winRate: user.gamesPlayed > 0 ? Math.round((user.wins / user.gamesPlayed) * 100) : 0,
      bestStreak: user.bestWinStreak
    }));
    
    res.json({
      success: true,
      leaderboard: leaderboardWithStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user/:facebookId/stats', async (req, res) => {
  try {
    const { facebookId } = req.params;
    
    let user = await User.findOne({ facebookId });
    if (!user) {
      user = new User({ facebookId });
      await user.save();
    }
    
    const recentGames = await Game.find({
      $or: [{ player1: user._id }, { player2: user._id }],
      status: 'completed'
    })
      .populate('player1', 'username')
      .populate('player2', 'username')
      .populate('winner', 'username')
      .sort({ endTime: -1 })
      .limit(10);
    
    res.json({
      success: true,
      stats: {
        username: user.username,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        gamesPlayed: user.gamesPlayed,
        bestWinStreak: user.bestWinStreak,
        currentWinStreak: user.currentWinStreak,
        totalCaptures: user.totalCaptures,
        winRate: user.gamesPlayed > 0 ? Math.round((user.wins / user.gamesPlayed) * 100) : 0,
        achievements: user.achievements
      },
      recentGames: recentGames.map(g => ({
        gameId: g.gameId,
        opponent: g.player1._id.equals(user._id) ? g.player2 : g.player1,
        result: g.winner && g.winner._id.equals(user._id) ? 'win' : (g.winner ? 'loss' : 'draw'),
        endTime: g.endTime
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/user/:facebookId/update', authenticate, async (req, res) => {
  try {
    const { facebookId } = req.params;
    const { username, email, password } = req.body;
    
    const user = await User.findOne({ facebookId });
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    if (username) user.username = username;
    if (email) user.email = email;
    if (password) user.password = await bcrypt.hash(password, 10);
    
    user.lastActive = new Date();
    await user.save();
    
    res.json({
      success: true,
      user: {
        username: user.username,
        email: user.email,
        elo: user.elo
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/moves/legal', async (req, res) => {
  try {
    const { board, player } = req.body;
    
    if (!board || !player) {
      return res.status(400).json({ error: 'Board et player requis' });
    }
    
    const moves = [];
    const myPion = player === 'blanc' ? PION_B : PION_N;
    const myDame = player === 'blanc' ? DAME_B : DAME_N;
    
    for (let fx = 0; fx < 8; fx++) {
      for (let fy = 0; fy < 8; fy++) {
        if (board[fx][fy] === myPion || board[fx][fy] === myDame) {
          for (let tx = 0; tx < 8; tx++) {
            for (let ty = 0; ty < 8; ty++) {
              if (fx !== tx || fy !== ty) {
                const validation = isValidMove(board, [fx, fy], [tx, ty], player);
                if (validation.valid) {
                  moves.push([[fx, fy], [tx, ty]]);
                }
              }
            }
          }
        }
      }
    }
    
    res.json(moves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/backup/create', authenticate, async (req, res) => {
  try {
    const backupData = {
      users: await User.find({}).select('-password'),
      games: await Game.find({ status: 'active' }),
      tournaments: await Tournament.find({ status: { $ne: 'completed' } }),
      timestamp: Date.now(),
      createdBy: req.user.userId
    };
    
    const backupFile = path.join(BACKUP_DIR, `backup_${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    
    res.json({
      success: true,
      backupFile: path.basename(backupFile),
      size: fs.statSync(backupFile).size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/backup/restore/:filename', authenticate, async (req, res) => {
  try {
    const { filename } = req.params;
    const backupFile = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(backupFile)) {
      return res.status(404).json({ error: 'Backup non trouvé' });
    }
    
    const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    
    await User.deleteMany({});
    await User.insertMany(backupData.users);
    
    await Game.deleteMany({});
    await Game.insertMany(backupData.games);
    
    await Tournament.deleteMany({});
    await Tournament.insertMany(backupData.tournaments);
    
    res.json({
      success: true,
      message: 'Base de données restaurée',
      restoredAt: backupData.timestamp
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const gameCount = await Game.countDocuments();
  const userCount = await User.countDocuments();
  
  res.json({
    status: 'ok',
    timestamp: new Date(),
    mongodb: dbStatus,
    stats: {
      games: gameCount,
      users: userCount,
      activeGames: await Game.countDocuments({ status: 'active' }),
      saves: await SavedGame.countDocuments()
    },
    version: '3.0.0',
    uptime: process.uptime()
  });
});

app.get('/api/backup/list', authenticate, async (req, res) => {
  try {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        filename: f,
        size: fs.statSync(path.join(BACKUP_DIR, f)).size,
        createdAt: fs.statSync(path.join(BACKUP_DIR, f)).mtime
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    
    res.json({
      success: true,
      backups
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

process.on('SIGINT', async () => {
  console.log('🛑 Arrêt du serveur...');
  await mongoose.connection.close();
  console.log('✅ Connexion MongoDB fermée');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 API Dames démarrée sur le port ${PORT}`);
  console.log(`📊 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connecté' : 'En attente...'}`);
  console.log(`💾 Sauvegardes: ${SAVES_DIR}`);
  console.log(`📁 Backups: ${BACKUP_DIR}`);
});
