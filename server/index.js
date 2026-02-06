const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Configure Socket.io
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Fix MIME types for static files
app.use((req, res, next) => {
    const ext = path.extname(req.path);
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };
    
    if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
    }
    
    next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public'), {
    setHeaders: (res, path) => {
        const ext = path.extname(path);
        if (ext === '.js') {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (ext === '.css') {
            res.setHeader('Content-Type', 'text/css');
        } else if (ext === '.html') {
            res.setHeader('Content-Type', 'text/html');
        }
    }
}));

// Game management (same as before)
const games = new Map();
const users = new Map();

class Game {
    constructor(id, host, name) {
        this.id = id;
        this.name = name;
        this.host = host;
        this.players = [host];
        this.board = Array(9).fill('');
        this.currentPlayer = 'X';
        this.status = 'waiting';
        this.winner = null;
        this.winningLine = null;
        this.createdAt = new Date();
    }
    
    addPlayer(player) {
        if (this.players.length < 2 && !this.players.includes(player)) {
            this.players.push(player);
            if (this.players.length === 2) {
                this.status = 'playing';
            }
            return true;
        }
        return false;
    }
    
    makeMove(cellIndex, player) {
        if (this.status !== 'playing') return false;
        
        const playerSymbol = this.players[0] === player ? 'X' : 'O';
        
        if (this.currentPlayer !== playerSymbol) return false;
        if (this.board[cellIndex] !== '') return false;
        
        this.board[cellIndex] = playerSymbol;
        
        const result = this.checkWin();
        if (result) {
            this.status = 'finished';
            this.winner = result.winner === 'draw' ? 'draw' : 
                         result.winner === 'X' ? this.players[0] : this.players[1];
            this.winningLine = result.line;
        } else {
            this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        }
        
        return true;
    }
    
    checkWin() {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];
        
        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
                return { winner: this.board[a], line: pattern };
            }
        }
        
        if (this.board.every(cell => cell !== '')) {
            return { winner: 'draw', line: null };
        }
        
        return null;
    }
    
    getInfo() {
        return {
            id: this.id,
            name: this.name,
            host: this.host,
            players: this.players,
            status: this.status,
            board: this.board,
            currentPlayer: this.currentPlayer,
            winner: this.winner,
            createdAt: this.createdAt
        };
    }
}

// Socket.io events
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    socket.on('register-user', (username) => {
        users.set(socket.id, username);
        socket.username = username;
        
        console.log(`User registered: ${username}`);
        
        socket.emit('user-registered', { username });
        updateGamesList();
    });
    
    socket.on('create-game', ({ host, name }) => {
        const username = users.get(socket.id);
        if (!username) {
            socket.emit('error', { message: 'Please register first' });
            return;
        }
        
        const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const gameName = name || `${username}'s Game`;
        
        const game = new Game(gameId, username, gameName);
        games.set(gameId, game);
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`Game created: ${gameName} by ${username}`);
        
        socket.emit('game-created', game.getInfo());
        updateGamesList();
    });
    
    socket.on('join-game', ({ gameId, player }) => {
        const username = users.get(socket.id);
        if (!username) {
            socket.emit('error', { message: 'Please register first' });
            return;
        }
        
        const game = games.get(gameId);
        if (!game) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        if (game.players.length >= 2) {
            socket.emit('error', { message: 'Game is full' });
            return;
        }
        
        if (game.players.includes(username)) {
            socket.emit('error', { message: 'You are already in this game' });
            return;
        }
        
        const success = game.addPlayer(username);
        if (!success) {
            socket.emit('error', { message: 'Could not join game' });
            return;
        }
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`${username} joined game ${gameId}`);
        
        io.to(gameId).emit('player-joined', {
            player: username,
            game: game.getInfo()
        });
        
        if (game.players.length === 2) {
            io.to(gameId).emit('game-started', game.getInfo());
            
            game.players.forEach((playerName, index) => {
                const playerSocket = getSocketByUsername(playerName);
                if (playerSocket) {
                    playerSocket.emit('turn-update', {
                        isYourTurn: index === 0,
                        yourSymbol: index === 0 ? 'X' : 'O',
                        currentPlayer: 'X'
                    });
                }
            });
        }
        
        updateGamesList();
    });
    
    socket.on('make-move', ({ gameId, cellIndex, player }) => {
        const username = users.get(socket.id);
        if (!username) {
            socket.emit('error', { message: 'Please register first' });
            return;
        }
        
        const game = games.get(gameId);
        if (!game) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        if (!game.players.includes(username)) {
            socket.emit('error', { message: 'You are not in this game' });
            return;
        }
        
        const success = game.makeMove(cellIndex, username);
        if (!success) {
            socket.emit('error', { message: 'Invalid move' });
            return;
        }
        
        console.log(`${username} made move at ${cellIndex} in game ${gameId}`);
        
        io.to(gameId).emit('move-made', {
            cellIndex,
            symbol: game.board[cellIndex],
            player: username,
            nextPlayer: game.currentPlayer,
            board: game.board
        });
        
        io.to(gameId).emit('game-update', game.getInfo());
        
        game.players.forEach((playerName, index) => {
            const playerSocket = getSocketByUsername(playerName);
            if (playerSocket) {
                const playerSymbol = index === 0 ? 'X' : 'O';
                playerSocket.emit('turn-update', {
                    isYourTurn: game.currentPlayer === playerSymbol && game.status === 'playing',
                    yourSymbol: playerSymbol,
                    currentPlayer: game.currentPlayer
                });
            }
        });
        
        if (game.status === 'finished') {
            io.to(gameId).emit('game-over', {
                winner: game.winner,
                winningLine: game.winningLine,
                board: game.board
            });
            
            setTimeout(() => {
                games.delete(gameId);
                updateGamesList();
            }, 30000);
        }
        
        if (game.players.length === 2) {
            updateGamesList();
        }
    });
    
    socket.on('leave-game', ({ gameId, player }) => {
        const game = games.get(gameId);
        if (game) {
            game.players = game.players.filter(p => p !== player);
            
            if (game.players.length === 0) {
                games.delete(gameId);
            } else {
                socket.to(gameId).emit('player-left', { player });
                
                if (game.status === 'playing') {
                    game.status = 'waiting';
                    game.board = Array(9).fill('');
                    game.currentPlayer = 'X';
                    game.winner = null;
                    game.winningLine = null;
                    io.to(gameId).emit('game-update', game.getInfo());
                }
            }
            
            socket.leave(gameId);
            socket.currentGameId = null;
            updateGamesList();
        }
    });
    
    socket.on('chat-message', ({ gameId, player, message }) => {
        io.to(gameId).emit('chat-message', {
            player,
            message,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('request-rematch', ({ gameId, player }) => {
        const game = games.get(gameId);
        if (game && game.players.length === 2) {
            game.board = Array(9).fill('');
            game.status = 'playing';
            game.currentPlayer = 'X';
            game.winner = null;
            game.winningLine = null;
            game.players = [game.players[1], game.players[0]];
            
            io.to(gameId).emit('rematch-started', game.getInfo());
            
            game.players.forEach((playerName, index) => {
                const playerSocket = getSocketByUsername(playerName);
                if (playerSocket) {
                    const playerSymbol = index === 0 ? 'X' : 'O';
                    playerSocket.emit('turn-update', {
                        isYourTurn: index === 0,
                        yourSymbol: playerSymbol,
                        currentPlayer: 'X'
                    });
                }
            });
        }
    });
    
    socket.on('get-games', () => {
        updateGamesList(socket);
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        const username = users.get(socket.id);
        if (username) {
            users.delete(socket.id);
            
            if (socket.currentGameId) {
                const game = games.get(socket.currentGameId);
                if (game) {
                    game.players = game.players.filter(p => p !== username);
                    socket.to(socket.currentGameId).emit('player-left', { player: username });
                    
                    if (game.players.length === 0) {
                        games.delete(socket.currentGameId);
                    }
                    
                    updateGamesList();
                }
            }
        }
    });
    
    function getSocketByUsername(username) {
        for (const [socketId, socketUser] of users.entries()) {
            if (socketUser === username) {
                return io.sockets.sockets.get(socketId);
            }
        }
        return null;
    }
    
    function updateGamesList(targetSocket = null) {
        const availableGames = Array.from(games.values())
            .filter(game => game.status === 'waiting' && game.players.length < 2)
            .map(game => ({
                id: game.id,
                name: game.name,
                host: game.host,
                players: game.players,
                playerCount: game.players.length
            }));
        
        if (targetSocket) {
            targetSocket.emit('game-list', availableGames);
        } else {
            io.emit('game-list', availableGames);
        }
    }
    
    updateGamesList(socket);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        activeGames: games.size,
        activeUsers: users.size
    });
});

// Serve socket.io client from node_modules
app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, '../node_modules/socket.io/client-dist/socket.io.js'));
});

// Catch-all route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});
