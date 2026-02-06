const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Game state
const games = {};
const users = {};

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    // REGISTER USER - FIXED
    socket.on('register-user', (username) => {
        console.log('Register user called with:', username);
        
        if (!username || username.trim().length < 2) {
            socket.emit('error', 'Name must be at least 2 characters');
            return;
        }
        
        const name = username.trim();
        users[socket.id] = name;
        socket.username = name;
        
        console.log(`✅ User registered: ${name}`);
        
        // Send registered event back to client
        socket.emit('user-registered', { username: name });
        
        // Send initial games list
        sendGamesList(socket);
    });
    
    // CREATE GAME - FIXED
    socket.on('create-game', (data) => {
        console.log('Create game called with:', data);
        
        if (!socket.username) {
            socket.emit('error', 'Please register first');
            return;
        }
        
        const gameId = 'game_' + Date.now();
        const gameName = (data && data.name) ? data.name.trim() : `${socket.username}'s Game`;
        
        games[gameId] = {
            id: gameId,
            name: gameName,
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
        
        console.log(`🎮 Game created: ${gameName}`);
        
        // Send game-created event back to creator
        socket.emit('game-created', games[gameId]);
        
        // Update games list for everyone
        sendGamesList();
    });
    
    // JOIN GAME - FIXED
    socket.on('join-game', (data) => {
        console.log('Join game called with:', data);
        
        if (!socket.username) {
            socket.emit('error', 'Please register first');
            return;
        }
        
        const gameId = data && data.gameId;
        if (!gameId || !games[gameId]) {
            socket.emit('error', 'Game not found');
            return;
        }
        
        const game = games[gameId];
        
        if (game.players.length >= 2) {
            socket.emit('error', 'Game is full');
            return;
        }
        
        if (game.players.includes(socket.username)) {
            socket.emit('error', 'Already in this game');
            return;
        }
        
        // Add player to game
        game.players.push(socket.username);
        game.status = 'playing';
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`🎯 ${socket.username} joined ${game.name}`);
        
        // Notify both players that game has started
        io.to(gameId).emit('game-started', game);
        
        // Send player info to each player
        game.players.forEach((player, index) => {
            const playerSymbol = index === 0 ? 'X' : 'O';
            const isYourTurn = index === 0; // X goes first
            
            // Find socket for this player
            const playerSocketId = Object.keys(users).find(id => users[id] === player);
            if (playerSocketId) {
                io.to(playerSocketId).emit('player-info', {
                    symbol: playerSymbol,
                    isYourTurn: isYourTurn,
                    currentPlayer: 'X'
                });
            }
        });
        
        // Update games list
        sendGamesList();
    });
    
    // MAKE MOVE - FIXED
    socket.on('make-move', (data) => {
        console.log('Make move called with:', data);
        
        if (!socket.username) {
            socket.emit('error', 'Please register first');
            return;
        }
        
        const gameId = data && data.gameId;
        const cellIndex = data && data.cellIndex;
        
        const game = games[gameId];
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }
        
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
        
        // Make the move
        game.board[cellIndex] = playerSymbol;
        
        // Check for win
        const result = checkWin(game.board);
        if (result) {
            game.status = 'finished';
            game.winner = result === 'draw' ? 'draw' : 
                         result === 'X' ? game.players[0] : game.players[1];
            game.winningLine = getWinningLine(game.board);
        } else {
            // Switch player
            game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
        }
        
        console.log(`🎲 ${socket.username} placed ${playerSymbol} at ${cellIndex}`);
        
        // Broadcast move to all players in the game
        io.to(gameId).emit('move-made', {
            cellIndex: cellIndex,
            symbol: playerSymbol,
            board: game.board,
            currentPlayer: game.currentPlayer,
            gameStatus: game.status,
            winner: game.winner,
            winningLine: game.winningLine
        });
        
        // Update turn info for players
        if (game.status === 'playing') {
            game.players.forEach((player, index) => {
                const playerSocketId = Object.keys(users).find(id => users[id] === player);
                if (playerSocketId) {
                    const symbol = index === 0 ? 'X' : 'O';
                    io.to(playerSocketId).emit('turn-update', {
                        isYourTurn: game.currentPlayer === symbol
                    });
                }
            });
        }
    });
    
    // GET GAMES - FIXED
    socket.on('get-games', () => {
        sendGamesList(socket);
    });
    
    // LEAVE GAME - FIXED
    socket.on('leave-game', (data) => {
        const gameId = data && data.gameId;
        
        if (gameId && games[gameId] && socket.username) {
            const game = games[gameId];
            game.players = game.players.filter(p => p !== socket.username);
            
            if (game.players.length === 0) {
                delete games[gameId];
            } else {
                game.status = 'waiting';
                game.board = Array(9).fill('');
                game.currentPlayer = 'X';
                game.winner = null;
                io.to(gameId).emit('player-left', { player: socket.username });
                io.to(gameId).emit('game-updated', game);
            }
            
            socket.leave(gameId);
            delete socket.currentGameId;
            sendGamesList();
        }
    });
    
    // CHAT MESSAGE
    socket.on('chat-message', (data) => {
        const gameId = data && data.gameId;
        if (gameId && games[gameId]) {
            io.to(gameId).emit('chat-message', {
                player: socket.username,
                message: data.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // REQUEST REMATCH
    socket.on('request-rematch', (data) => {
        const gameId = data && data.gameId;
        const game = games[gameId];
        
        if (game && game.players.length === 2) {
            // Reset game state
            game.board = Array(9).fill('');
            game.status = 'playing';
            game.currentPlayer = 'X';
            game.winner = null;
            game.winningLine = null;
            
            // Swap players for fairness
            game.players = [game.players[1], game.players[0]];
            
            io.to(gameId).emit('rematch-started', game);
            
            // Send new player info
            game.players.forEach((player, index) => {
                const playerSocketId = Object.keys(users).find(id => users[id] === player);
                if (playerSocketId) {
                    const symbol = index === 0 ? 'X' : 'O';
                    io.to(playerSocketId).emit('player-info', {
                        symbol: symbol,
                        isYourTurn: index === 0,
                        currentPlayer: 'X'
                    });
                }
            });
        }
    });
    
    // DISCONNECT
    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.username || 'Anonymous'}`);
        
        if (socket.currentGameId && games[socket.currentGameId] && socket.username) {
            const game = games[socket.currentGameId];
            game.players = game.players.filter(p => p !== socket.username);
            
            if (game.players.length === 0) {
                delete games[socket.currentGameId];
            } else {
                game.status = 'waiting';
                io.to(socket.currentGameId).emit('player-left', { player: socket.username });
            }
            
            sendGamesList();
        }
        
        delete users[socket.id];
    });
    
    // Helper function to send games list
    function sendGamesList(targetSocket = null) {
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
            targetSocket.emit('game-list', availableGames);
        } else {
            io.emit('game-list', availableGames);
        }
    }
    
    // Check for win
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
    
    // Get winning line
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
        timestamp: new Date().toISOString(),
        games: Object.keys(games).length,
        users: Object.keys(users).length
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
