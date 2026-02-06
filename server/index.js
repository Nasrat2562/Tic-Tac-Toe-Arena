const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Game management
const games = new Map();
const users = new Map(); // socket.id -> username

// Game model
class Game {
    constructor(id, host, name) {
        this.id = id;
        this.name = name;
        this.host = host;
        this.players = [host];
        this.board = Array(9).fill('');
        this.currentPlayer = 'X';
        this.status = 'waiting'; // waiting, playing, finished
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
        
        // Determine player's symbol
        const playerSymbol = this.players[0] === player ? 'X' : 'O';
        
        // Check if it's player's turn
        if (this.currentPlayer !== playerSymbol) return false;
        
        // Check if cell is empty
        if (this.board[cellIndex] !== '') return false;
        
        // Make the move
        this.board[cellIndex] = playerSymbol;
        
        // Check for win
        const result = this.checkWin();
        if (result) {
            this.status = 'finished';
            this.winner = result.winner === 'draw' ? 'draw' : 
                         result.winner === 'X' ? this.players[0] : this.players[1];
            this.winningLine = result.line;
        } else {
            // Switch player
            this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        }
        
        return true;
    }
    
    checkWin() {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
            [0, 4, 8], [2, 4, 6]             // diagonals
        ];
        
        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
                return { winner: this.board[a], line: pattern };
            }
        }
        
        // Check for draw
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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Register user
    socket.on('register-user', (username) => {
        users.set(socket.id, username);
        socket.username = username;
        
        console.log(`User registered: ${username}`);
        
        // Send available games
        socket.emit('user-registered', { username });
        updateGamesList();
    });
    
    // Create game
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
        
        // Join the game room
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`Game created: ${gameName} by ${username} (ID: ${gameId})`);
        
        // Send game info to creator
        socket.emit('game-created', game.getInfo());
        
        // Update games list for everyone
        updateGamesList();
    });
    
    // Join game
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
        
        // Add player to game
        const success = game.addPlayer(username);
        if (!success) {
            socket.emit('error', { message: 'Could not join game' });
            return;
        }
        
        // Join the game room
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`${username} joined game ${gameId}`);
        
        // Notify both players
        io.to(gameId).emit('player-joined', {
            player: username,
            game: game.getInfo()
        });
        
        // Start the game if 2 players
        if (game.players.length === 2) {
            io.to(gameId).emit('game-started', game.getInfo());
            
            // Send initial turn info
            game.players.forEach((playerName, index) => {
                const playerSocket = getSocketByUsername(playerName);
                if (playerSocket) {
                    playerSocket.emit('turn-update', {
                        isYourTurn: index === 0, // First player (X) starts
                        yourSymbol: index === 0 ? 'X' : 'O',
                        currentPlayer: 'X'
                    });
                }
            });
        }
        
        // Update games list
        updateGamesList();
    });
    
    // Make a move
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
        
        // Make the move
        const success = game.makeMove(cellIndex, username);
        if (!success) {
            socket.emit('error', { message: 'Invalid move' });
            return;
        }
        
        console.log(`${username} made move at ${cellIndex} in game ${gameId}`);
        
        // Broadcast move to all in game room
        io.to(gameId).emit('move-made', {
            cellIndex,
            symbol: game.board[cellIndex],
            player: username,
            nextPlayer: game.currentPlayer,
            board: game.board
        });
        
        // Send game update
        io.to(gameId).emit('game-update', game.getInfo());
        
        // Send turn updates
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
        
        // Check if game is over
        if (game.status === 'finished') {
            io.to(gameId).emit('game-over', {
                winner: game.winner,
                winningLine: game.winningLine,
                board: game.board
            });
            
            // Remove game after 30 seconds
            setTimeout(() => {
                games.delete(gameId);
                updateGamesList();
            }, 30000);
        }
        
        // Update games list if game is full
        if (game.players.length === 2) {
            updateGamesList();
        }
    });
    
    // Leave game
    socket.on('leave-game', ({ gameId, player }) => {
        const game = games.get(gameId);
        if (game) {
            // Remove player from game
            game.players = game.players.filter(p => p !== player);
            
            // If no players left, remove game
            if (game.players.length === 0) {
                games.delete(gameId);
            } else {
                // Notify remaining player
                socket.to(gameId).emit('player-left', { player });
                
                // Reset game if it was playing
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
    
    // Chat message
    socket.on('chat-message', ({ gameId, player, message }) => {
        io.to(gameId).emit('chat-message', {
            player,
            message,
            timestamp: new Date().toISOString()
        });
    });
    
    // Request rematch
    socket.on('request-rematch', ({ gameId, player }) => {
        const game = games.get(gameId);
        if (game && game.players.length === 2) {
            // Reset game
            game.board = Array(9).fill('');
            game.status = 'playing';
            game.currentPlayer = 'X';
            game.winner = null;
            game.winningLine = null;
            
            // Swap players for fairness
            game.players = [game.players[1], game.players[0]];
            
            io.to(gameId).emit('rematch-started', game.getInfo());
            
            // Send turn updates
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
    
    // Get available games
    socket.on('get-games', () => {
        updateGamesList(socket);
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        const username = users.get(socket.id);
        if (username) {
            users.delete(socket.id);
            
            // Handle if user was in a game
            if (socket.currentGameId) {
                const game = games.get(socket.currentGameId);
                if (game) {
                    // Remove player from game
                    game.players = game.players.filter(p => p !== username);
                    
                    // Notify other players
                    socket.to(socket.currentGameId).emit('player-left', { player: username });
                    
                    // If no players left, remove game
                    if (game.players.length === 0) {
                        games.delete(socket.currentGameId);
                    }
                    
                    updateGamesList();
                }
            }
        }
    });
    
    // Helper function to get socket by username
    function getSocketByUsername(username) {
        for (const [socketId, socketUser] of users.entries()) {
            if (socketUser === username) {
                return io.sockets.sockets.get(socketId);
            }
        }
        return null;
    }
    
    // Update games list for all or specific socket
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
    
    // Send initial games list
    updateGamesList(socket);
});

// API endpoints
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        activeGames: games.size,
        activeUsers: users.size
    });
});

app.get('/api/games', (req, res) => {
    const gameList = Array.from(games.values()).map(game => game.getInfo());
    res.json(gameList);
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
