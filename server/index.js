const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Game management
const games = {};
const users = {};
const userStatistics = {}; // Single source of truth for stats

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Register user
    socket.on('register-user', (username) => {
        if (!username || username.trim() === '') {
            socket.emit('error', 'Please enter a name');
            return;
        }
        
        const name = username.trim();
        users[socket.id] = name;
        socket.username = name;
        
        // Initialize user stats if not exists
        if (!userStatistics[name]) {
            userStatistics[name] = {
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                username: name
            };
        }
        
        console.log(`${name} registered`);
        socket.emit('user-registered', { username: name });
        // Send current stats to user
        socket.emit('user-stats', userStatistics[name]);
        
        broadcastGames();
    });
    
    // Create game
    socket.on('create-game', ({ host, name }) => {
        if (!socket.username) {
            socket.emit('error', 'Please register first');
            return;
        }
        
        const gameId = 'game_' + Date.now();
        const gameName = name || `${socket.username}'s Game`;
        
        games[gameId] = {
            id: gameId,
            name: gameName,
            host: socket.username,
            players: [socket.username],
            board: Array(9).fill(''),
            currentPlayer: 'X',
            status: 'waiting',
            winner: null,
            playerCount: 1,
            rematchRequests: new Set() // Track rematch requests
        };
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`Game created: ${gameName}`);
        socket.emit('game-created', games[gameId]);
        broadcastGames();
    });
    
    // Join game
    socket.on('join-game', ({ gameId, player }) => {
        if (!socket.username) {
            socket.emit('error', 'Please register first');
            return;
        }
        
        const game = games[gameId];
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }
        
        if (game.players.length >= 2) {
            socket.emit('error', 'Game is full');
            return;
        }
        
        if (game.players.includes(socket.username)) {
            socket.emit('error', 'Already in this game');
            return;
        }
        
        // Add player
        game.players.push(socket.username);
        game.status = 'playing';
        game.playerCount = 2;
        game.rematchRequests.clear(); // Clear any rematch requests
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`${socket.username} joined ${game.name}`);
        
        // Reset game state for both players
        game.board = Array(9).fill('');
        game.currentPlayer = 'X';
        game.winner = null;
        
        // Notify ALL players that game has started
        io.to(gameId).emit('game-started', game);
        
        broadcastGames();
    });
    
    // Make move
    socket.on('make-move', ({ gameId, cellIndex, player }) => {
        const game = games[gameId];
        if (!game || !socket.username) return;
        
        if (!game.players.includes(socket.username)) {
            socket.emit('error', 'Not in this game');
            return;
        }
        
        const playerIndex = game.players.indexOf(socket.username);
        const playerSymbol = playerIndex === 0 ? 'X' : 'O';
        
        // Validate
        if (game.currentPlayer !== playerSymbol) {
            socket.emit('error', 'Not your turn');
            return;
        }
        
        if (game.board[cellIndex] !== '') {
            socket.emit('error', 'Cell already taken');
            return;
        }
        
        // Make move
        game.board[cellIndex] = playerSymbol;
        
        // Check win
        const result = checkWin(game.board);
        let gameOver = false;
        let winner = null;
        
        if (result) {
            game.status = 'finished';
            gameOver = true;
            if (result === 'draw') {
                winner = 'draw';
                // Update draws for both players - SERVER ONLY UPDATES
                game.players.forEach(player => {
                    if (userStatistics[player]) {
                        userStatistics[player].draws++;
                        userStatistics[player].gamesPlayed++;
                        // Send updated stats to player
                        const playerSocket = getSocketByUsername(player);
                        if (playerSocket) {
                            playerSocket.emit('user-stats', userStatistics[player]);
                        }
                    }
                });
            } else {
                winner = result === 'X' ? game.players[0] : game.players[1];
                const loser = game.players.find(p => p !== winner);
                
                // Update winner stats - SERVER ONLY UPDATES
                if (userStatistics[winner]) {
                    userStatistics[winner].wins++;
                    userStatistics[winner].gamesPlayed++;
                    // Send updated stats to winner
                    const winnerSocket = getSocketByUsername(winner);
                    if (winnerSocket) {
                        winnerSocket.emit('user-stats', userStatistics[winner]);
                    }
                }
                
                // Update loser stats - SERVER ONLY UPDATES
                if (userStatistics[loser]) {
                    userStatistics[loser].losses++;
                    userStatistics[loser].gamesPlayed++;
                    // Send updated stats to loser
                    const loserSocket = getSocketByUsername(loser);
                    if (loserSocket) {
                        loserSocket.emit('user-stats', userStatistics[loser]);
                    }
                }
            }
            game.winner = winner;
        } else {
            // Switch turn
            game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
        }
        
        console.log(`${socket.username} moved ${playerSymbol} to ${cellIndex}. Next: ${game.currentPlayer}. Game over: ${gameOver}`);
        
        // Broadcast to all in game
        io.to(gameId).emit('move-made', {
            cellIndex: cellIndex,
            symbol: playerSymbol,
            board: game.board,
            currentPlayer: game.currentPlayer,
            gameOver: gameOver,
            winner: winner
        });
        
        broadcastGames();
    });
    
    // Get games
    socket.on('get-games', () => {
        broadcastGames(socket);
    });
    
    // Leave game
    socket.on('leave-game', ({ gameId, player }) => {
        if (games[gameId] && socket.username) {
            const game = games[gameId];
            game.players = game.players.filter(p => p !== socket.username);
            game.playerCount = game.players.length;
            
            if (game.players.length === 0) {
                delete games[gameId];
            } else {
                game.status = 'waiting';
                game.board = Array(9).fill('');
                game.currentPlayer = 'X';
                game.winner = null;
                game.rematchRequests.clear();
                io.to(gameId).emit('player-left', socket.username);
            }
            
            socket.leave(gameId);
            socket.currentGameId = null;
            broadcastGames();
        }
    });
    
    // Request rematch
    socket.on('request-rematch', ({ gameId, player }) => {
        const game = games[gameId];
        if (!game || !socket.username) {
            socket.emit('error', 'Game not found');
            return;
        }
        
        if (!game.players.includes(socket.username)) {
            socket.emit('error', 'You are not in this game');
            return;
        }
        
        if (game.status !== 'finished') {
            socket.emit('error', 'Game is not finished yet');
            return;
        }
        
        console.log(`${socket.username} requested rematch for game ${gameId}`);
        
        // Add rematch request
        game.rematchRequests.add(socket.username);
        
        // Notify opponent
        const opponent = game.players.find(p => p !== socket.username);
        if (opponent) {
            // Find opponent's socket
            const opponentSocket = getSocketByUsername(opponent);
            if (opponentSocket) {
                opponentSocket.emit('rematch-offered', socket.username);
            }
        }
        
        // Check if both players have requested rematch
        if (game.rematchRequests.size === 2) {
            // Start rematch
            startRematch(gameId);
        } else {
            // Notify player that request was sent
            socket.emit('rematch-pending', 'Rematch request sent to opponent. Waiting for their response...');
        }
    });
    
    // Chat message - FIXED: Prevent duplicate messages
    socket.on('chat-message', (data) => {
        const { gameId, sender, message } = data;
        const game = games[gameId];
        
        if (!game || !game.players.includes(sender)) {
            socket.emit('error', 'Cannot send message to this game');
            return;
        }
        
        console.log(`Chat message from ${sender} in game ${gameId}: ${message}`);
        
        // First, send confirmation back to sender with their message
        socket.emit('chat-message-sent', {
            sender: sender,
            message: message,
            timestamp: new Date().toISOString()
        });
        
        // Then broadcast to other players in the game
        socket.to(gameId).emit('chat-message', {
            sender: sender,
            message: message,
            timestamp: new Date().toISOString()
        });
    });
    
    // Get user stats
    socket.on('get-stats', ({ username }) => {
        if (userStatistics[username]) {
            socket.emit('user-stats', userStatistics[username]);
        } else {
            // Initialize if not exists
            userStatistics[username] = {
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                username: username
            };
            socket.emit('user-stats', userStatistics[username]);
        }
    });
    
    // Update user stats (from client) - only used for synchronization
    socket.on('update-stats', ({ username, stats }) => {
        // Only update if server doesn't have stats or client has newer data
        if (!userStatistics[username] || stats.gamesPlayed > userStatistics[username].gamesPlayed) {
            userStatistics[username] = { ...stats };
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log(`${socket.username || 'Anonymous'} disconnected`);
        
        if (socket.currentGameId && games[socket.currentGameId]) {
            const game = games[socket.currentGameId];
            game.players = game.players.filter(p => p !== socket.username);
            game.playerCount = game.players.length;
            
            if (game.players.length === 0) {
                delete games[socket.currentGameId];
            } else {
                game.status = 'waiting';
                game.board = Array(9).fill('');
                game.currentPlayer = 'X';
                game.winner = null;
                game.rematchRequests.clear();
                io.to(socket.currentGameId).emit('player-left', socket.username);
            }
            
            broadcastGames();
        }
        
        delete users[socket.id];
    });
    
    // Helper functions
    function broadcastGames(targetSocket = null) {
        const availableGames = Object.values(games)
            .map(game => ({
                id: game.id,
                name: game.name,
                host: game.host,
                players: game.players,
                playerCount: game.playerCount,
                status: game.status,
                winner: game.winner
            }));

        if (targetSocket) {
            targetSocket.emit('games-list', availableGames);
        } else {
            io.emit('games-list', availableGames);
        }
    }
    
    function checkWin(board) {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return board[a];
            }
        }

        if (board.every(cell => cell !== '')) {
            return 'draw';
        }

        return null;
    }
    
    function getSocketByUsername(username) {
        for (const [socketId, user] of Object.entries(users)) {
            if (user === username) {
                return io.sockets.sockets.get(socketId);
            }
        }
        return null;
    }
    
    function startRematch(gameId) {
        const game = games[gameId];
        if (!game) return;
        
        // Reset game state
        game.board = Array(9).fill('');
        game.currentPlayer = 'X';
        game.status = 'playing';
        game.winner = null;
        game.rematchRequests.clear();
        
        console.log(`Starting rematch for game: ${game.name}`);
        
        // Notify all players in the game
        io.to(gameId).emit('rematch-started', game);
        
        broadcastGames();
    }
    
    // Send initial games list
    broadcastGames(socket);
});

// Health check with stats
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeGames: Object.keys(games).length,
        activeUsers: Object.keys(users).length,
        totalPlayers: Object.keys(userStatistics).length
    });
});

// Get user stats API
app.get('/api/stats/:username', (req, res) => {
    const username = req.params.username;
    if (userStatistics[username]) {
        res.json(userStatistics[username]);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// Serve index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});
