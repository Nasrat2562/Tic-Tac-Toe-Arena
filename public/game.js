// Game State
let currentBoard = Array(9).fill('');
let currentPlayer = 'X';
let isMyTurn = false;
let gameActive = false;
let mySymbol = '';
let socket = null;
let username = null;
let currentGame = null;

console.log('TicTacToe initializing...');

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded');
    initSocket();
    setupEventListeners();
    initGameBoard();
});

function initSocket() {
    console.log('Connecting to server...');
    
    // Connect to current host
    socket = io();
    
    socket.on('connect', () => {
        console.log('✅ Connected');
        updateConnectionStatus(true);
        document.getElementById('connection-message').textContent = 'Connected! Enter your name.';
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Disconnected');
        updateConnectionStatus(false);
        document.getElementById('connection-message').textContent = 'Disconnected';
    });
    
    socket.on('registered', (data) => {
        console.log('Registered:', data.username);
        username = data.username;
        document.getElementById('username-display').textContent = username;
        
        // Show game sections
        document.getElementById('username-section').style.display = 'none';
        document.getElementById('create-game-section').style.display = 'block';
        document.getElementById('games-list-section').style.display = 'block';
        
        // Update waiting screen
        document.getElementById('waiting-screen').innerHTML = `
            <i class="bi bi-person-check display-1 text-success mb-3"></i>
            <h4 class="mb-3">Welcome, ${username}!</h4>
            <p class="text-muted">Create a game or join an existing one</p>
        `;
        
        showNotification('Welcome! You can now create or join games.', 'success');
        
        // Get games list
        socket.emit('get-games');
    });
    
    socket.on('games-list', (games) => {
        console.log('Games list:', games);
        updateGamesList(games);
    });
    
    socket.on('game-created', (game) => {
        console.log('Game created:', game);
        currentGame = game;
        showGameScreen(game);
        updateGameInfo(game);
        showNotification(`Game "${game.name}" created! Waiting for opponent...`, 'info');
    });
    
    socket.on('game-started', (game) => {
        console.log('Game started:', game);
        currentGame = game;
        gameActive = true;
        currentBoard = game.board;
        
        // Get player info
        socket.emit('get-games'); // Request updated games
        
        showNotification('Game started!', 'success');
        updateGameState();
    });
    
    socket.on('player-info', (data) => {
        console.log('Player info:', data);
        mySymbol = data.symbol;
        isMyTurn = data.isYourTurn;
        
        document.getElementById('turn-indicator').textContent = 
            isMyTurn ? `✅ Your turn (${mySymbol})` : `⏳ Waiting for opponent...`;
        
        if (isMyTurn) {
            showNotification(`You are ${mySymbol}. Your turn first!`, 'success');
        }
    });
    
    socket.on('move-made', (data) => {
        console.log('Move made:', data);
        
        // Update board
        currentBoard = data.board;
        currentPlayer = data.currentPlayer;
        
        // Update UI
        updateBoardDisplay();
        
        if (data.gameOver) {
            gameActive = false;
            isMyTurn = false;
            
            let message = '';
            if (data.winner === 'draw') {
                message = '🎭 Draw game!';
            } else if (data.winner === username) {
                message = '🎉 You win!';
            } else {
                message = '😢 You lose!';
            }
            
            showNotification(message, data.winner === username ? 'success' : 'warning');
            
            document.getElementById('result-message').textContent = message;
            document.getElementById('game-result').style.display = 'block';
            
            // Highlight winning cells
            if (data.winningLine) {
                data.winningLine.forEach(index => {
                    const cell = document.querySelector(`.cell[data-index="${index}"]`);
                    if (cell) cell.classList.add('winning');
                });
            }
        } else {
            // Update turn indicator
            isMyTurn = currentPlayer === mySymbol;
            document.getElementById('turn-indicator').textContent = 
                isMyTurn ? `✅ Your turn (${mySymbol})` : `⏳ Opponent's turn`;
        }
    });
    
    socket.on('turn-update', (data) => {
        console.log('Turn update:', data);
        isMyTurn = data.isYourTurn;
        
        document.getElementById('turn-indicator').textContent = 
            isMyTurn ? `✅ Your turn (${mySymbol})` : `⏳ Opponent's turn`;
        
        if (isMyTurn) {
            showNotification('Your turn!', 'info');
        }
    });
    
    socket.on('player-joined', (data) => {
        console.log('Player joined:', data);
        showNotification(`${data.player} joined the game!`, 'info');
        
        if (currentGame && currentGame.id === data.game.id) {
            currentGame = data.game;
            updateGameInfo(currentGame);
        }
    });
    
    socket.on('player-left', (player) => {
        console.log('Player left:', player);
        showNotification(`${player} left the game`, 'warning');
        
        if (currentGame) {
            currentGame.status = 'waiting';
            updateGameInfo(currentGame);
        }
    });
    
    socket.on('error', (error) => {
        console.error('Error:', error);
        showNotification(error, 'danger');
    });
}

function setupEventListeners() {
    // Set username button
    document.getElementById('set-username').addEventListener('click', function() {
        const usernameInput = document.getElementById('username-input');
        const name = usernameInput.value.trim();
        
        if (name.length < 2) {
            showNotification('Name must be at least 2 characters', 'warning');
            return;
        }
        
        console.log('Setting username:', name);
        socket.emit('register', name);
    });
    
    // Enter key for username
    document.getElementById('username-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('set-username').click();
        }
    });
    
    // Create game button
    document.getElementById('create-game-btn').addEventListener('click', function() {
        const gameNameInput = document.getElementById('game-name-input');
        const gameName = gameNameInput.value.trim() || `${username}'s Game`;
        
        console.log('Creating game:', gameName);
        socket.emit('create-game', gameName);
        gameNameInput.value = '';
    });
    
    // Enter key for game name
    document.getElementById('game-name-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('create-game-btn').click();
        }
    });
    
    // Leave game
    document.getElementById('leave-game').addEventListener('click', function() {
        if (currentGame) {
            if (confirm('Leave this game?')) {
                socket.emit('leave-game', currentGame.id);
                hideGameScreen();
                showNotification('Left the game', 'info');
            }
        }
    });
    
    // Rematch
    document.getElementById('rematch-btn').addEventListener('click', function() {
        if (currentGame) {
            // Reset board
            currentBoard = Array(9).fill('');
            currentPlayer = 'X';
            gameActive = true;
            isMyTurn = mySymbol === 'X';
            
            updateBoardDisplay();
            document.getElementById('game-result').style.display = 'none';
            
            // Remove winning highlights
            document.querySelectorAll('.cell').forEach(cell => {
                cell.classList.remove('winning');
            });
            
            showNotification('Rematch!', 'info');
        }
    });
    
    // New game
    document.getElementById('new-game-btn').addEventListener('click', function() {
        hideGameScreen();
        showNotification('Back to lobby', 'info');
    });
    
    // Chat
    document.getElementById('send-chat-btn').addEventListener('click', function() {
        const chatInput = document.getElementById('chat-input');
        const message = chatInput.value.trim();
        
        if (message && currentGame) {
            // In a real app, send to server
            addChatMessage(username, message, true);
            chatInput.value = '';
        }
    });
    
    document.getElementById('chat-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('send-chat-btn').click();
        }
    });
}

function initGameBoard() {
    console.log('Initializing game board...');
    const board = document.getElementById('tic-tac-toe-board');
    
    if (!board) {
        console.error('Board element not found');
        return;
    }
    
    // Create 9 cells
    for (let i = 0; i < 9; i++) {
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.dataset.index = i;
        cell.textContent = '';
        
        cell.addEventListener('click', function() {
            handleCellClick(i);
        });
        
        board.appendChild(cell);
    }
    
    updateBoardDisplay();
}

function handleCellClick(index) {
    console.log('Cell clicked:', index, 'Game active:', gameActive, 'My turn:', isMyTurn);
    
    if (!gameActive) {
        showNotification('Game not active', 'warning');
        return;
    }
    
    if (!isMyTurn) {
        showNotification('Wait for your turn', 'warning');
        return;
    }
    
    if (currentBoard[index]) {
        showNotification('Cell already taken', 'warning');
        return;
    }
    
    if (currentGame && socket) {
        console.log('Making move at:', index);
        socket.emit('make-move', {
            gameId: currentGame.id,
            cellIndex: index
        });
    }
}

function updateBoardDisplay() {
    const cells = document.querySelectorAll('.cell');
    
    cells.forEach((cell, index) => {
        const value = currentBoard[index];
        cell.textContent = value;
        cell.className = 'cell';
        
        if (value === 'X') {
            cell.classList.add('x');
        } else if (value === 'O') {
            cell.classList.add('o');
        }
        
        if (!gameActive || !isMyTurn || value) {
            cell.classList.add('disabled');
        } else {
            cell.classList.remove('disabled');
        }
    });
}

function updateGamesList(games) {
    const container = document.getElementById('games-list');
    const count = document.getElementById('games-count');
    
    if (!container) return;
    
    container.innerHTML = '';
    
    if (games.length === 0) {
        container.innerHTML = '<div class="text-center text-muted p-3">No games available</div>';
    } else {
        games.forEach(game => {
            const item = document.createElement('div');
            item.className = 'game-item p-3 mb-2 bg-dark rounded';
            item.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <div class="fw-bold">${game.name}</div>
                        <small class="text-muted">
                            Host: ${game.host} • Players: ${game.playerCount}/2
                        </small>
                    </div>
                    <button class="btn btn-sm btn-primary join-btn" 
                            ${game.playerCount >= 2 ? 'disabled' : ''}>
                        Join
                    </button>
                </div>
            `;
            
            const joinBtn = item.querySelector('.join-btn');
            joinBtn.addEventListener('click', () => {
                if (username) {
                    console.log('Joining game:', game.id);
                    socket.emit('join-game', game.id);
                }
            });
            
            container.appendChild(item);
        });
    }
    
    if (count) {
        count.textContent = games.length;
    }
}

function showGameScreen(game) {
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('game-board-container').style.display = 'block';
    document.getElementById('chat-section').style.display = 'block';
    document.getElementById('current-game-info').style.display = 'block';
    document.getElementById('games-list-section').style.display = 'none';
    document.getElementById('create-game-section').style.display = 'none';
    
    document.getElementById('game-name-display').textContent = game.name;
    
    // Enable chat
    document.getElementById('chat-input').disabled = false;
    document.getElementById('send-chat-btn').disabled = false;
    
    // Add welcome message
    addChatMessage('System', 'Welcome to the game!');
}

function hideGameScreen() {
    document.getElementById('waiting-screen').style.display = 'block';
    document.getElementById('waiting-screen').innerHTML = `
        <i class="bi bi-joystick display-1 text-muted mb-3"></i>
        <h4 class="mb-3">Welcome back, ${username}!</h4>
        <p class="text-muted">Create a game or join an existing one</p>
    `;
    document.getElementById('game-board-container').style.display = 'none';
    document.getElementById('chat-section').style.display = 'none';
    document.getElementById('current-game-info').style.display = 'none';
    document.getElementById('games-list-section').style.display = 'block';
    document.getElementById('create-game-section').style.display = 'block';
    
    // Reset game state
    currentBoard = Array(9).fill('');
    gameActive = false;
    isMyTurn = false;
    currentGame = null;
    updateBoardDisplay();
    
    // Get updated games list
    socket.emit('get-games');
}

function updateGameInfo(game) {
    const title = document.getElementById('game-title');
    const status = document.getElementById('game-status');
    const players = document.getElementById('players-info');
    
    if (title) title.textContent = game.name;
    
    if (status) {
        status.textContent = game.status === 'waiting' ? 
            '⏳ Waiting for opponent...' : '🎮 Game in progress';
        status.className = `small ${game.status === 'waiting' ? 'text-warning' : 'text-success'}`;
    }
    
    if (players && game.players) {
        players.innerHTML = `
            <strong>Players:</strong><br>
            ${game.players.map(p => `
                <span class="${p === username ? 'text-warning' : 'text-light'}">
                    • ${p}${p === game.host ? ' (Host)' : ''}
                </span>
            `).join('<br>')}
        `;
    }
}

function updateGameState() {
    updateBoardDisplay();
    updateTurnIndicator();
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    if (!indicator) return;
    
    if (!gameActive) {
        indicator.textContent = '⏸️ Game paused';
        indicator.className = 'turn-indicator alert alert-secondary';
    } else if (isMyTurn) {
        indicator.textContent = `✅ Your turn (${mySymbol})`;
        indicator.className = 'turn-indicator alert alert-success';
    } else {
        indicator.textContent = `⏳ Opponent's turn`;
        indicator.className = 'turn-indicator alert alert-warning';
    }
}

function addChatMessage(sender, message, isOwn = false) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = `mb-2 ${isOwn ? 'text-end' : ''}`;
    div.innerHTML = `
        <div class="d-inline-block p-2 rounded ${isOwn ? 'bg-primary' : 'bg-secondary'}">
            <small class="fw-bold">${sender}:</small>
            <div>${message}</div>
        </div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function updateConnectionStatus(connected) {
    const indicator = document.getElementById('connection-status');
    if (indicator) {
        indicator.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    }
}

function showNotification(message, type = 'info') {
    // Create a simple notification
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alert);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (alert.parentNode) {
            alert.remove();
        }
    }, 3000);
}
