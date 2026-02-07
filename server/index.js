const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    pingTimeout: 60000,
    pingInterval: 25000,
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const publicPath = path.resolve(__dirname, '../public');

app.use(express.static(publicPath, {
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath);
        if (ext === '.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'public, max-age=3600');
        } else if (ext === '.css') {
            res.setHeader('Content-Type', 'text/css');
            res.setHeader('Cache-Control', 'public, max-age=3600');
        } else if (ext === '.html') {
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

const games = {};
const users = {};
const userStatistics = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('register-user', (username) => {
        if (!username || username.trim() === '') {
            socket.emit('error', 'Please enter a name');
            return;
        }
        
        const name = username.trim();
        users[socket.id] = name;
        socket.username = name;
        
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
        socket.emit('user-stats', userStatistics[name]);
        
        broadcastGames();
    });
    
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
            rematchRequests: new Set()
        };
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`Game created: ${gameName} by ${socket.username}`);
        socket.emit('game-created', games[gameId]);
        broadcastGames();
    });
    
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
        
        game.players.push(socket.username);
        game.status = 'playing';
        game.playerCount = 2;
        game.rematchRequests.clear();
        
        socket.join(gameId);
        socket.currentGameId = gameId;
        
        console.log(`${socket.username} joined ${game.name}`);
        
        game.board = Array(9).fill('');
        game.currentPlayer = 'X';
        game.winner = null;
        
        io.to(gameId).emit('game-started', game);
        
        broadcastGames();
    });
    
    socket.on('make-move', ({ gameId, cellIndex, player }) => {
        const game = games[gameId];
        if (!game || !socket.username) return;
        
        if (!game.players.includes(socket.username)) {
            socket.emit('error', 'Not in this game');
            return;
        }
        
        const playerIndex = game.players.indexOf(socket.username);
        const playerSymbol = playerIndex === 0 ? 'X' : 'O';
        
        if (game.currentPlayer !== playerSymbol) {
            socket.emit('error', 'Not your turn');
            return;
        }
        
        if (game.board[cellIndex] !== '') {
            socket.emit('error', 'Cell already taken');
            return;
        }
        
        game.board[cellIndex] = playerSymbol;
        
        const result = checkWin(game.board);
        let gameOver = false;
        let winner = null;
        
        if (result) {
            game.status = 'finished';
            gameOver = true;
            if (result === 'draw') {
                winner = 'draw';
                game.players.forEach(player => {
                    if (userStatistics[player]) {
                        userStatistics[player].draws++;
                        userStatistics[player].gamesPlayed++;
                        const playerSocket = getSocketByUsername(player);
                        if (playerSocket) {
                            playerSocket.emit('user-stats', userStatistics[player]);
                        }
                    }
                });
            } else {
                winner = result === 'X' ? game.players[0] : game.players[1];
                const loser = game.players.find(p => p !== winner);
                
                if (userStatistics[winner]) {
                    userStatistics[winner].wins++;
                    userStatistics[winner].gamesPlayed++;
                    const winnerSocket = getSocketByUsername(winner);
                    if (winnerSocket) {
                        winnerSocket.emit('user-stats', userStatistics[winner]);
                    }
                }
                
                if (userStatistics[loser]) {
                    userStatistics[loser].losses++;
                    userStatistics[loser].gamesPlayed++;
                    const loserSocket = getSocketByUsername(loser);
                    if (loserSocket) {
                        loserSocket.emit('user-stats', userStatistics[loser]);
                    }
                }
            }
            game.winner = winner;
        } else {
            game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
        }
        
        console.log(`${socket.username} moved ${playerSymbol} to ${cellIndex}. Next: ${game.currentPlayer}. Game over: ${gameOver}`);
        
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
    
    socket.on('get-games', () => {
        broadcastGames(socket);
    });
    
    socket.on('leave-game', ({ gameId, player }) => {
        if (games[gameId] && socket.username) {
            const game = games[gameId];
            const leavingUsername = socket.username;
            
            if (!game.players.includes(leavingUsername)) {
                socket.emit('error', 'You are not in this game');
                return;
            }
            
            game.players = game.players.filter(p => p !== leavingUsername);
            game.playerCount = game.players.length;
            
            console.log(`${leavingUsername} leaving game ${gameId}. Remaining players: ${game.players}`);
            
            if (game.players.length === 0) {
                delete games[gameId];
                
                socket.emit('player-left-self', { 
                    message: 'You left the game',
                    gameId: gameId,
                    gameDeleted: true
                });
            } else {
                game.status = 'waiting';
                game.board = Array(9).fill('');
                game.currentPlayer = 'X';
                game.winner = null;
                game.rematchRequests.clear();
                
                socket.to(gameId).emit('player-left', { 
                    player: leavingUsername,
                    message: `${leavingUsername} left the game`,
                    gameId: gameId
                });
                
                socket.emit('player-left-self', { 
                    message: 'You left the game',
                    gameId: gameId,
                    gameDeleted: false
                });
            }
            
            socket.leave(gameId);
            socket.currentGameId = null;
            broadcastGames();
        }
    });
    
    // NEW: Force opponent to return to lobby when player chooses "New Game"
    socket.on('return-to-lobby', ({ gameId, player }) => {
    const game = games[gameId];
    if (!game || !socket.username) {
        socket.emit('error', 'Game not found');
        return;
    }
    
    if (!game.players.includes(socket.username)) {
        socket.emit('error', 'You are not in this game');
        return;
    }
    
    console.log(`${socket.username} returning to lobby from game ${gameId}`);
    console.log(`Current players in game: ${game.players}`);
    
    // Remove player from the game
    game.players = game.players.filter(p => p !== socket.username);
    game.playerCount = game.players.length;
    
    console.log(`After removal - Players left: ${game.players}`);
    
    // Remove player from socket room
    socket.leave(gameId);
    socket.currentGameId = null;
    
    // Check if this was the last player
    if (game.players.length === 0) {
        // COMPLETELY DELETE THE GAME - This is the key fix!
        console.log(`Game ${gameId} (${game.name}) has NO players left. DELETING game.`);
        delete games[gameId];
        
        // Notify player
        socket.emit('player-left-self', {
            message: 'You returned to lobby',
            gameId: gameId,
            gameDeleted: true
        });
    } else {
        // There are still players in the game
        game.status = 'waiting';
        game.board = Array(9).fill('');
        game.currentPlayer = 'X';
        game.winner = null;
        game.rematchRequests.clear();
        
        // Notify remaining players
        const opponent = game.players.find(p => p !== socket.username);
        if (opponent) {
            const opponentSocket = getSocketByUsername(opponent);
            if (opponentSocket) {
                console.log(`Notifying ${opponent} to also return to lobby`);
                opponentSocket.emit('opponent-returned-to-lobby', {
                    gameId: gameId,
                    player: socket.username,
                    gameStillExists: true
                });
            }
        }
        
        // Notify the leaving player
        socket.emit('player-left-self', {
            message: 'You returned to lobby',
            gameId: gameId,
            gameDeleted: false
        });
    }
    
    // Always broadcast updated games list
    broadcastGames();
    console.log(`Games list updated after ${socket.username} returned to lobby`);
});
    
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
        
        game.rematchRequests.add(socket.username);
        
        const opponent = game.players.find(p => p !== socket.username);
        if (opponent) {
            const opponentSocket = getSocketByUsername(opponent);
            if (opponentSocket) {
                console.log(`Sending rematch offer to ${opponent} from ${socket.username}`);
                opponentSocket.emit('rematch-offered', {
                    player: socket.username,
                    gameId: gameId
                });
            } else {
                console.log(`Opponent ${opponent} not connected, cannot send rematch request`);
                socket.emit('error', 'Opponent is not connected');
                game.rematchRequests.delete(socket.username);
                return;
            }
        }
        
        if (game.rematchRequests.size === 2) {
            startRematch(gameId);
        } else {
            socket.emit('rematch-pending', 'Rematch request sent to opponent. Waiting for their response...');
        }
    });
    
    socket.on('accept-rematch', ({ gameId, player }) => {
        const game = games[gameId];
        if (!game || !socket.username) return;
        
        if (!game.players.includes(socket.username)) {
            socket.emit('error', 'You are not in this game');
            return;
        }
        
        console.log(`${socket.username} accepted rematch for game ${gameId}`);
        
        // Check if opponent is still in the game (hasn't returned to lobby)
        const opponent = game.players.find(p => p !== socket.username);
        if (!opponent) {
            socket.emit('error', 'Opponent has left the game');
            return;
        }
        
        const opponentSocket = getSocketByUsername(opponent);
        if (!opponentSocket) {
            socket.emit('error', 'Opponent is not connected');
            return;
        }
        
        game.rematchRequests.add(socket.username);
        
        if (game.rematchRequests.size === 2) {
            startRematch(gameId);
        }
    });
    
    socket.on('reject-rematch', ({ gameId, player }) => {
        const game = games[gameId];
        if (!game || !socket.username) return;
        
        if (!game.players.includes(socket.username)) {
            socket.emit('error', 'You are not in this game');
            return;
        }
        
        console.log(`${socket.username} rejected rematch for game ${gameId}`);
        
        game.rematchRequests.clear();
        
        const opponent = game.players.find(p => p !== socket.username);
        if (opponent) {
            const opponentSocket = getSocketByUsername(opponent);
            if (opponentSocket) {
                opponentSocket.emit('rematch-rejected', socket.username);
            }
        }
    });
    
    socket.on('chat-message', (data) => {
        const { gameId, sender, message } = data;
        const game = games[gameId];
        
        if (!game || !game.players.includes(sender)) {
            socket.emit('error', 'Cannot send message to this game');
            return;
        }
        
        console.log(`Chat message from ${sender} in game ${gameId}: ${message}`);
        
        socket.emit('chat-message-sent', {
            sender: sender,
            message: message,
            timestamp: new Date().toISOString()
        });
        
        socket.to(gameId).emit('chat-message', {
            sender: sender,
            message: message,
            timestamp: new Date().toISOString()
        });
        
        socket.to(gameId).emit('chat-popup-notification', {
            sender: sender,
            message: message,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('get-stats', ({ username }) => {
        if (userStatistics[username]) {
            socket.emit('user-stats', userStatistics[username]);
        } else {
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
    
    socket.on('heartbeat', () => {
        socket.emit('heartbeat-response', { timestamp: Date.now() });
    });
    
    socket.on('disconnect', (reason) => {
        console.log(`${socket.username || 'Anonymous'} disconnected. Reason: ${reason}`);
        
        if (socket.currentGameId && games[socket.currentGameId]) {
            const game = games[socket.currentGameId];
            const leavingPlayer = socket.username;
            
            if (leavingPlayer && game.players.includes(leavingPlayer)) {
                game.players = game.players.filter(p => p !== leavingPlayer);
                game.playerCount = game.players.length;
                
                console.log(`${leavingPlayer} disconnected from game ${socket.currentGameId}. Remaining players: ${game.players}`);
                
                if (game.players.length === 0) {
                    delete games[socket.currentGameId];
                } else {
                    game.status = 'waiting';
                    game.board = Array(9).fill('');
                    game.currentPlayer = 'X';
                    game.winner = null;
                    game.rematchRequests.clear();
                    
                    io.to(socket.currentGameId).emit('player-left', { 
                        player: leavingPlayer,
                        message: `${leavingPlayer} disconnected`,
                        gameId: socket.currentGameId
                    });
                }
                
                broadcastGames();
            }
        }
        
        delete users[socket.id];
    });
    
    function broadcastGames(targetSocket = null) {
    // CRITICAL: Only show games that actually have players AND are waiting
    const availableGames = Object.values(games)
        .filter(game => {
            // Must have at least one player
            const hasPlayers = game.players.length > 0;
            // Must be waiting for players
            const isWaiting = game.status === 'waiting';
            // Must have room for more players
            const hasRoom = game.playerCount < 2;
            
            const shouldShow = hasPlayers && isWaiting && hasRoom;
            
            if (!shouldShow && hasPlayers) {
                console.log(`Game ${game.id} filtered out - Status: ${game.status}, Players: ${game.players}, PlayerCount: ${game.playerCount}`);
            }
            
            return shouldShow;
        })
        .map(game => ({
            id: game.id,
            name: game.name,
            host: game.host,
            players: game.players,
            playerCount: game.playerCount,
            status: game.status,
            winner: game.winner
        }));

    console.log(`📋 Broadcasting ${availableGames.length} available games:`);
    availableGames.forEach(game => {
        console.log(`  - ${game.name} (${game.id}): ${game.playerCount}/2 players, Status: ${game.status}`);
    });
    
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
                const socket = io.sockets.sockets.get(socketId);
                if (socket && socket.connected) {
                    return socket;
                }
            }
        }
        return null;
    }
    
    function startRematch(gameId) {
        const game = games[gameId];
        if (!game) return;
        
        // Check if both players are still connected
        for (const player of game.players) {
            const playerSocket = getSocketByUsername(player);
            if (!playerSocket) {
                console.log(`Player ${player} not connected, cannot start rematch`);
                
                // Notify the other player
                const otherPlayer = game.players.find(p => p !== player);
                if (otherPlayer) {
                    const otherSocket = getSocketByUsername(otherPlayer);
                    if (otherSocket) {
                        otherSocket.emit('error', 'Opponent is not connected');
                    }
                }
                return;
            }
        }
        
        game.board = Array(9).fill('');
        game.currentPlayer = 'X';
        game.status = 'playing';
        game.winner = null;
        game.rematchRequests.clear();
        
        console.log(`Starting rematch for game: ${game.name}`);
        
        io.to(gameId).emit('rematch-started', game);
        
        broadcastGames();
    }
    
    setTimeout(() => {
        broadcastGames(socket);
    }, 1000);
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeGames: Object.keys(games).length,
        activeUsers: Object.keys(users).length,
        totalPlayers: Object.keys(userStatistics).length,
        connections: io.engine.clientsCount
    });
});

app.get('/api/stats/:username', (req, res) => {
    const username = req.params.username;
    if (userStatistics[username]) {
        res.json(userStatistics[username]);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.get('*', (req, res) => {
    const filePath = path.join(publicPath, 'index.html');
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(filePath);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`📁 Serving static files from: ${publicPath}`);
});

