const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const Database = require('./database');
const Game = require('./game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'TicTacToe Multiplayer'
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        const db = new Database();
        const stats = await db.getLeaderboard();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Socket.io setup
const db = new Database();
const gameManager = new Game(db);

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
        socket.onAny((eventName, ...args) => {
        console.log(`[${socket.id}] Event: ${eventName}`, args);
    });
    // Register user
    socket.on('register-user', async (username) => {
        try {
            await db.registerUser(username);
            socket.username = username;
            console.log(`User registered: ${username}`);
            
            // Send initial stats
            const stats = await db.getUserStats(username);
            socket.emit('stats-update', stats);
            
            // Send current games list
            const games = gameManager.getAvailableGames();
            socket.emit('game-list', games);
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });
    
    // Create game
    socket.on('create-game', async ({ host, name }) => {
        try {
            const game = await gameManager.createGame(host, name);
            socket.join(game.id);
            socket.gameId = game.id;
            
            // Notify all clients
            io.emit('game-list', gameManager.getAvailableGames());
            socket.emit('game-started', game);
            
            console.log(`Game created: ${name} by ${host}`);
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });
    
    // Join game
    socket.on('join-game', async ({ gameId, player }) => {
        try {
            const game = gameManager.getGame(gameId);
            if (!game) {
                throw new Error('Game not found');
            }
            
            if (game.players.length >= 2) {
                throw new Error('Game is full');
            }
            
            game.players.push(player);
            socket.join(gameId);
            socket.gameId = gameId;
            
            // If two players joined, start the game
            if (game.players.length === 2) {
                game.status = 'playing';
                game.currentPlayer = 'X';
                
                // Notify both players
                io.to(gameId).emit('game-started', game);
                io.to(gameId).emit('chat-message', {
                    player: 'System',
                    message: `Game started! ${game.players[0]} is X, ${game.players[1]} is O`
                });
            }
            
            // Notify all about player joining
            socket.to(gameId).emit('player-joined', player);
            io.emit('game-list', gameManager.getAvailableGames());
            
            console.log(`${player} joined game ${gameId}`);
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });
    
    // Make a move
    socket.on('make-move', ({ gameId, cellIndex, player }) => {
        try {
            const game = gameManager.getGame(gameId);
            if (!game) {
                throw new Error('Game not found');
            }
            
            if (game.status !== 'playing') {
                throw new Error('Game is not active');
            }
            
            // Determine if it's player's turn
            const playerSymbol = game.players[0] === player ? 'X' : 'O';
            if (game.currentPlayer !== playerSymbol) {
                throw new Error('Not your turn');
            }
            
            if (game.board[cellIndex] !== '') {
                throw new Error('Cell already taken');
            }
            
            // Make the move
            const symbol = game.currentPlayer;
            game.board[cellIndex] = symbol;
            
            // Check for win
            const result = gameManager.checkWin(game.board);
            
            if (result) {
                // Game over
                game.status = 'finished';
                game.winner = result.winner === 'draw' ? 'draw' : 
                    result.winner === 'X' ? game.players[0] : game.players[1];
                game.winningLine = result.line;
                
                // Update stats
                db.updateGameStats(game.players[0], game.players[1], game.winner);
                
                // Notify players
                io.to(gameId).emit('game-over', {
                    winner: game.winner,
                    winningLine: game.winningLine
                });
                
                // Update stats for both players
                game.players.forEach(async (playerName) => {
                    const stats = await db.getUserStats(playerName);
                    io.to(gameId).emit('stats-update', stats);
                });
            } else {
                // Switch player
                game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
            }
            
            // Broadcast move to all in game room
            io.to(gameId).emit('move-made', {
                cellIndex,
                symbol,
                nextPlayer: game.currentPlayer
            });
            
            // Send updated game state
            io.to(gameId).emit('game-update', game);
            
        } catch (error) {
            socket.emit('error', { message: error.message });
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
        try {
            const game = gameManager.getGame(gameId);
            if (!game) return;
            
            // Reset game
            game.board = Array(9).fill('');
            game.status = 'playing';
            game.currentPlayer = 'X';
            game.winner = null;
            game.winningLine = null;
            
            // Swap player symbols for fairness
            game.players = [game.players[1], game.players[0]];
            
            io.to(gameId).emit('game-started', game);
            io.to(gameId).emit('chat-message', {
                player: 'System',
                message: 'Rematch started! Players swapped sides.'
            });
            
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });
    
    // Leave game
    socket.on('leave-game', ({ gameId, player }) => {
        const game = gameManager.getGame(gameId);
        if (game) {
            // Remove player
            game.players = game.players.filter(p => p !== player);
            
            if (game.players.length === 0) {
                // No players left, remove game
                gameManager.removeGame(gameId);
            } else {
                // Notify remaining player
                socket.to(gameId).emit('player-left', player);
                socket.to(gameId).emit('chat-message', {
                    player: 'System',
                    message: `${player} left the game`
                });
                
                // Reset game to waiting state
                if (game.status === 'playing') {
                    game.status = 'waiting';
                    game.board = Array(9).fill('');
                    game.currentPlayer = 'X';
                    game.winner = null;
                    game.winningLine = null;
                }
            }
            
            socket.leave(gameId);
            socket.gameId = null;
            io.emit('game-list', gameManager.getAvailableGames());
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        if (socket.gameId && socket.username) {
            const game = gameManager.getGame(socket.gameId);
            if (game) {
                // Handle player disconnection
                game.players = game.players.filter(p => p !== socket.username);
                
                if (game.players.length === 0) {
                    gameManager.removeGame(socket.gameId);
                } else {
                    io.to(socket.gameId).emit('player-left', socket.username);
                    io.to(socket.gameId).emit('chat-message', {
                        player: 'System',
                        message: `${socket.username} disconnected`
                    });
                    
                    if (game.status === 'playing') {
                        game.status = 'waiting';
                        game.board = Array(9).fill('');
                        game.currentPlayer = 'X';
                    }
                }
                
                io.emit('game-list', gameManager.getAvailableGames());
            }
        }
    });
});

// Catch-all route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'Server is working!',
        timestamp: new Date().toISOString(),
        games: Array.from(gameManager.games.values()).length
    });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});