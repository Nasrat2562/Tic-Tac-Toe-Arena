const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const games = {};
const users = {};

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Register user
    socket.on('register', (username) => {
        if (!username || username.trim().length < 2) {
            socket.emit('error', 'Name must be at least 2 characters');
            return;
        }
        
        const name = username.trim();
        users[socket.id] = name;
        socket.username = name;
        
        console.log(`${name} registered`);
        socket.emit('registered', { username: name });
        
        // Send available games
        sendGamesList();
    });

    // Create game
    socket.on('create-game', (gameName) => {
        if (!socket.username) {
            socket.emit('error', 'Please register first');
            return;
        }

        const gameId = 'game_' + Date.now();
        const name = gameName?.trim() || `${socket.username}'s Game`;
        
        games[gameId] = {
            id: gameId,
            name: name,
            host: socket.username,
            players: [socket.username],
            board: Array(9).fill(''),
            currentPlayer: 'X',
            status: 'waiting',
            winner: null,
            createdAt: new Date()
        };

        socket.join(gameId);
        socket.currentGameId = gameId;

        console.log(`Game created: ${name}`);
        socket.emit('game-created', games[gameId]);
        sendGamesList();
    });

    // Join game
    socket.on('join-game', (gameId) => {
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

        // Notify all players
        io.to(gameId).emit('game-started', game);
        io.to(gameId).emit('player-joined', {
            player: socket.username,
            game: game
        });

        // Send player info
        game.players.forEach((player, index) => {
            const playerSocket = Object.keys(users).find(id => users[id] === player);
            if (playerSocket) {
                io.to(playerSocket).emit('player-info', {
                    symbol: index === 0 ? 'X' : 'O',
                    isYourTurn: index === 0
                });
            }
        });

        sendGamesList();
    });

    // Make move
    socket.on('make-move', ({ gameId, cellIndex }) => {
        const game = games[gameId];
        if (!game || !socket.username) return;

        if (!game.players.includes(socket.username)) {
            socket.emit('error', 'Not in this game');
            return;
        }

        const playerIndex = game.players.indexOf(socket.username);
        const playerSymbol = playerIndex === 0 ? 'X' : 'O';

        // Validate move
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
            game.winningLine = getWinningLine(game.board);
        } else {
            // Switch turn
            game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
        }

        console.log(`${socket.username} moved ${playerSymbol} to ${cellIndex}`);

        // Broadcast move
        io.to(gameId).emit('move-made', {
            cellIndex: cellIndex,
            symbol: playerSymbol,
            board: game.board,
            currentPlayer: game.currentPlayer,
            gameOver: game.status === 'finished',
            winner: game.winner,
            winningLine: game.winningLine
        });

        // Update turn info
        if (game.status === 'playing') {
            game.players.forEach((player, index) => {
                const playerSocket = Object.keys(users).find(id => users[id] === player);
                if (playerSocket) {
                    const symbol = index === 0 ? 'X' : 'O';
                    io.to(playerSocket).emit('turn-update', {
                        isYourTurn: game.currentPlayer === symbol
                    });
                }
            });
        }
    });

    // Get games
    socket.on('get-games', () => {
        sendGamesList(socket);
    });

    // Leave game
    socket.on('leave-game', (gameId) => {
        if (games[gameId] && socket.username) {
            const game = games[gameId];
            game.players = game.players.filter(p => p !== socket.username);
            
            if (game.players.length === 0) {
                delete games[gameId];
            } else {
                game.status = 'waiting';
                game.board = Array(9).fill('');
                game.currentPlayer = 'X';
                game.winner = null;
                io.to(gameId).emit('game-updated', game);
            }
            
            socket.leave(gameId);
            sendGamesList();
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
            
            sendGamesList();
        }
        
        delete users[socket.id];
    });

    // Helper functions
    function sendGamesList(targetSocket = null) {
        const availableGames = Object.values(games)
            .filter(game => game.status === 'waiting')
            .map(game => ({
                id: game.id,
                name: game.name,
                host: game.host,
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

    function getWinningLine(board) {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return pattern;
            }
        }

        return null;
    }

    // Send initial games list
    sendGamesList(socket);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        time: new Date().toISOString(),
        games: Object.keys(games).length,
        users: Object.keys(users).length
    });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});
