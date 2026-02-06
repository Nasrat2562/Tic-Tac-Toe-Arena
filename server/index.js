const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Simple game management
const games = {};
const users = {};

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
        
        console.log(`${name} registered`);
        socket.emit('user-registered', { username: name });
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
            winner: null
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
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`${socket.username} joined ${game.name}`);
        
        // Start the game
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
        if (result) {
            game.status = 'finished';
            game.winner = result === 'draw' ? 'draw' : 
                         result === 'X' ? game.players[0] : game.players[1];
        } else {
            // Switch turn
            game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
        }
        
        console.log(`${socket.username} moved ${playerSymbol} to ${cellIndex}`);
        
        // Broadcast to all in game
        io.to(gameId).emit('move-made', {
            cellIndex: cellIndex,
            symbol: playerSymbol,
            board: game.board,
            currentPlayer: game.currentPlayer,
            gameOver: game.status === 'finished',
            winner: game.winner
        });
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
            
            if (game.players.length === 0) {
                delete games[gameId];
            } else {
                game.status = 'waiting';
                game.board = Array(9).fill('');
                game.currentPlayer = 'X';
                io.to(gameId).emit('player-left', socket.username);
            }
            
            socket.leave(gameId);
            broadcastGames();
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log(`${socket.username || 'Anonymous'} disconnected`);
        
        if (socket.currentGameId && games[socket.currentGameId]) {
            const game = games[socket.currentGameId];
            game.players = game.players.filter(p => p !== socket.username);
            
            if (game.players.length === 0) {
                delete games[socket.currentGameId];
            } else {
                game.status = 'waiting';
                io.to(socket.currentGameId).emit('player-left', socket.username);
            }
            
            broadcastGames();
        }
        
        delete users[socket.id];
    });
    
    // Helper functions
    function broadcastGames(targetSocket = null) {
        const availableGames = Object.values(games)
            .filter(game => game.status === 'waiting')
            .map(game => ({
                id: game.id,
                name: game.name,
                host: game.host,
                players: game.players,
                playerCount: game.players.length
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
    
    // Send initial games list
    broadcastGames(socket);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeGames: Object.keys(games).length,
        activeUsers: Object.keys(users).length
    });
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
