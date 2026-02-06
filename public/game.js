// Game State
let currentBoard = Array(9).fill('');
let currentPlayer = 'X';
let isMyTurn = false;
let gameActive = false;
let mySymbol = '';
let socket = null;
let username = null;
let currentGame = null;

console.log('Game.js loaded!');

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded. Initializing...');
    
    // Initialize socket first
    initializeSocket();
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize game board
    initializeGameBoard();
});

function initializeSocket() {
    console.log('Initializing socket connection...');
    
    // Connect to server
    socket = io();
    
    // Socket event handlers
    socket.on('connect', () => {
        console.log('✅ Connected to server');
        updateConnectionStatus(true);
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Disconnected from server');
        updateConnectionStatus(false);
    });
    
    socket.on('user-registered', (data) => {
        console.log('User registered:', data);
        username = data.username;
        document.getElementById('username-display').textContent = username;
        
        // Show game creation section
        document.getElementById('username-section').style.display = 'none';
        document.getElementById('create-game-section').style.display = 'block';
        document.getElementById('games-list-section').style.display = 'block';
        
        // Update waiting screen
        document.getElementById('waiting-screen').innerHTML = `
            <i class="bi bi-person-check display-1 text-success mb-3"></i>
            <h4 class="mb-3 text-light">Welcome, ${username}!</h4>
            <p class="text-muted">Create a game or join an existing one</p>
        `;
    });
    
    socket.on('game-list', (games) => {
        console.log('Available games:', games);
        updateGamesList(games);
    });
    
    socket.on('game-created', (game) => {
        console.log('Game created:', game);
        currentGame = game;
        showGameScreen(game);
        showNotification(`Game "${game.name}" created! Waiting for opponent...`, 'info');
    });
    
    socket.on('player-joined', (data) => {
        console.log('Player joined:', data);
        if (currentGame && currentGame.id === data.game.id) {
            currentGame = data.game;
            updateGameInfo(currentGame);
            showNotification(`${data.player} joined the game!`, 'info');
            addChatMessage('System', `${data.player} joined the game`);
        }
    });
    
    socket.on('game-started', (game) => {
        console.log('Game started:', game);
        currentGame = game;
        gameActive = true;
        
        // Determine my symbol
        if (game.players[0] === username) {
            mySymbol = 'X';
        } else if (game.players[1] === username) {
            mySymbol = 'O';
        }
        
        updateGameState(game);
        showNotification(`Game started! You are ${mySymbol}`, 'success');
        addChatMessage('System', `Game started! ${game.players[0]} is X, ${game.players[1]} is O`);
    });
    
    socket.on('turn-update', (data) => {
        console.log('Turn update:', data);
        isMyTurn = data.isYourTurn;
        mySymbol = data.yourSymbol;
        currentPlayer = data.currentPlayer;
        
        updateTurnIndicator();
        
        if (isMyTurn) {
            showNotification('Your turn! Place ' + mySymbol, 'success');
            addChatMessage('System', `It's ${username}'s turn (${mySymbol})`);
        }
    });
    
    socket.on('move-made', (data) => {
        console.log('Move made:', data);
        
        // Update board
        currentBoard = data.board;
        currentPlayer = data.nextPlayer;
        
        // Check if it's my turn
        if (currentGame && username) {
            isMyTurn = currentPlayer === mySymbol && gameActive;
        }
        
        updateBoardDisplay();
        updateTurnIndicator();
        
        if (data.player !== username) {
            showNotification(`${data.player} placed ${data.symbol}`, 'info');
        }
    });
    
    socket.on('game-update', (game) => {
        console.log('Game updated:', game);
        if (currentGame && game.id === currentGame.id) {
            currentGame = game;
            updateGameInfo(game);
        }
    });
    
    socket.on('game-over', (result) => {
        console.log('Game over:', result);
        gameActive = false;
        isMyTurn = false;
        
        let message = '';
        let type = 'info';
        
        if (result.winner === 'draw') {
            message = '🎭 Game ended in a draw!';
        } else if (result.winner === username) {
            message = '🎉 You won the game! 🏆';
            type = 'success';
        } else {
            message = '😢 You lost the game';
            type = 'warning';
        }
        
        showNotification(message, type);
        
        const resultMessage = document.getElementById('result-message');
        const gameResult = document.getElementById('game-result');
        
        if (resultMessage && gameResult) {
            resultMessage.textContent = message;
            gameResult.style.display = 'block';
        }
        
        // Highlight winning cells
        if (result.winningLine) {
            result.winningLine.forEach(index => {
                const cell = document.querySelector(`.cell[data-index="${index}"]`);
                if (cell) cell.classList.add('winning');
            });
        }
        
        updateTurnIndicator();
    });
    
    socket.on('chat-message', (data) => {
        console.log('Chat message:', data);
        addChatMessage(data.player, data.message, data.player === username);
    });
    
    socket.on('player-left', (data) => {
        console.log('Player left:', data);
        showNotification(`${data.player} left the game`, 'warning');
        addChatMessage('System', `${data.player} left the game`);
        
        if (currentGame) {
            currentGame.status = 'waiting';
            gameActive = false;
            updateGameInfo(currentGame);
            updateTurnIndicator();
        }
    });
    
    socket.on('rematch-started', (game) => {
        console.log('Rematch started:', game);
        currentGame = game;
        gameActive = true;
        
        // Reset board
        currentBoard = Array(9).fill('');
        updateBoardDisplay();
        
        // Hide result
        document.getElementById('game-result').style.display = 'none';
        
        // Remove winning highlights
        document.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('winning');
        });
        
        showNotification('Rematch started!', 'info');
        addChatMessage('System', 'Rematch started! Players swapped sides.');
    });
    
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        showNotification(error.message || 'An error occurred', 'danger');
    });
}

function setupEventListeners() {
    // Set username
    document.getElementById('set-username').addEventListener('click', () => {
        const usernameInput = document.getElementById('username-input');
        const name = usernameInput.value.trim();
        
        if (!name) {
            showNotification('Please enter a name', 'warning');
            return;
        }
        
        socket.emit('register-user', name);
    });
    
    // Create game
    document.getElementById('create-game-btn').addEventListener('click', () => {
        if (!username) {
            showNotification('Please enter your name first', 'warning');
            return;
        }
        
        const gameNameInput = document.getElementById('game-name-input');
        const gameName = gameNameInput.value.trim() || `${username}'s Game`;
        
        socket.emit('create-game', {
            host: username,
            name: gameName
        });
        
        gameNameInput.value = '';
    });
    
    // Leave game
    document.getElementById('leave-game').addEventListener('click', () => {
        if (currentGame) {
            if (confirm('Are you sure you want to leave the game?')) {
                socket.emit('leave-game', {
                    gameId: currentGame.id,
                    player: username
                });
                hideGameScreen();
                showNotification('You left the game', 'info');
            }
        }
    });
    
    // Chat
    document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // Rematch
    document.getElementById('rematch-btn').addEventListener('click', () => {
        if (currentGame) {
            socket.emit('request-rematch', {
                gameId: currentGame.id,
                player: username
            });
        }
    });
    
    // New game
    document.getElementById('new-game-btn').addEventListener('click', () => {
        if (currentGame) {
            socket.emit('leave-game', {
                gameId: currentGame.id,
                player: username
            });
        }
        hideGameScreen();
    });
}

function initializeGameBoard() {
    console.log('Initializing game board...');
    const board = document.getElementById('tic-tac-toe-board');
    
    if (!board) {
        console.error('Game board element not found!');
        return;
    }
    
    // Clear the board
    board.innerHTML = '';
    
    // Create 9 cells
    for (let i = 0; i < 9; i++) {
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.dataset.index = i;
        cell.textContent = '';
        
        cell.addEventListener('click', () => {
            handleCellClick(i);
        });
        
        board.appendChild(cell);
    }
    
    console.log('Game board created with', board.children.length, 'cells');
    updateBoardDisplay();
}

function handleCellClick(index) {
    console.log(`Cell ${index} clicked. Game active: ${gameActive}, My turn: ${isMyTurn}`);
    
    if (!gameActive) {
        showNotification('Game is not active yet', 'warning');
        return;
    }
    
    if (!isMyTurn) {
        showNotification('Wait for your turn!', 'warning');
        return;
    }
    
    if (currentBoard[index]) {
        showNotification('This cell is already taken!', 'warning');
        return;
    }
    
    if (currentGame && socket) {
        console.log('Making move at index:', index);
        
        // Immediately update UI for instant feedback
        currentBoard[index] = mySymbol;
        isMyTurn = false; // Prevent further moves until server confirms
        
        updateBoardDisplay();
        updateTurnIndicator();
        
        // Send move to server
        socket.emit('make-move', {
            gameId: currentGame.id,
            cellIndex: index,
            player: username
        });
    }
}

function updateBoardDisplay() {
    const board = document.getElementById('tic-tac-toe-board');
    if (!board) return;
    
    const cells = board.querySelectorAll('.cell');
    
    cells.forEach((cell, index) => {
        const cellValue = currentBoard[index];
        cell.textContent = cellValue;
        cell.className = 'cell';
        
        if (cellValue === 'X') {
            cell.classList.add('x');
        } else if (cellValue === 'O') {
            cell.classList.add('o');
        }
        
        // Disable cell if not player's turn or already taken
        if (!gameActive || !isMyTurn || cellValue) {
            cell.classList.add('disabled');
        } else {
            cell.classList.remove('disabled');
        }
    });
}

function updateGamesList(games) {
    const gamesList = document.getElementById('games-list');
    const gamesCount = document.getElementById('games-count');
    
    if (!gamesList) return;
    
    gamesList.innerHTML = '';
    
    if (games.length === 0) {
        gamesList.innerHTML = `
            <div class="list-group-item bg-dark text-center text-muted py-4">
                <i class="bi bi-emoji-frown display-6 mb-2"></i>
                <p class="mb-0">No games available. Create one!</p>
            </div>
        `;
    } else {
        games.forEach(game => {
            const gameItem = document.createElement('div');
            gameItem.className = 'list-group-item bg-dark text-light border-secondary game-item';
            gameItem.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1">${game.name}</h6>
                        <small class="text-muted">
                            <i class="bi bi-person-fill"></i> ${game.host} | 
                            <i class="bi bi-people-fill ms-2"></i> ${game.players.length}/2
                        </small>
                    </div>
                    <button class="btn btn-sm btn-primary join-game-btn" 
                            data-game-id="${game.id}"
                            ${game.players.length >= 2 ? 'disabled' : ''}>
                        <i class="bi bi-joystick me-1"></i> Join
                    </button>
                </div>
            `;
            gamesList.appendChild(gameItem);
            
            const joinBtn = gameItem.querySelector('.join-game-btn');
            joinBtn.addEventListener('click', () => {
                if (!username) {
                    showNotification('Please enter your name first', 'warning');
                    return;
                }
                
                socket.emit('join-game', {
                    gameId: game.id,
                    player: username
                });
                
                showNotification(`Joining "${game.name}"...`, 'info');
            });
        });
    }
    
    if (gamesCount) {
        gamesCount.textContent = games.length;
    }
}

function showGameScreen(game) {
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('game-board-container').style.display = 'block';
    document.getElementById('chat-section').style.display = 'block';
    document.getElementById('current-game-info').style.display = 'block';
    document.getElementById('games-list-section').style.display = 'none';
    document.getElementById('create-game-section').style.display = 'none';
    
    // Update game name display
    document.getElementById('game-name-display').textContent = game.name;
}

function hideGameScreen() {
    document.getElementById('waiting-screen').style.display = 'block';
    document.getElementById('waiting-screen').innerHTML = `
        <i class="bi bi-joystick display-1 text-muted mb-3"></i>
        <h4 class="mb-3 text-light">Welcome back, ${username}!</h4>
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
}

function updateGameInfo(game) {
    document.getElementById('game-title').textContent = game.name;
    
    const gameStatus = document.getElementById('game-status');
    if (gameStatus) {
        gameStatus.textContent = game.status === 'waiting' ? '⏳ Waiting for opponent...' : '🎮 Game in progress';
        gameStatus.className = `small ${game.status === 'waiting' ? 'text-warning' : 'text-success'}`;
    }
    
    const playersInfo = document.getElementById('players-info');
    if (playersInfo && game.players) {
        playersInfo.innerHTML = `
            <strong>Players:</strong><br>
            ${game.players.map(p => `
                <span class="${p === username ? 'text-warning fw-bold' : 'text-light'}">
                    • ${p}${p === game.host ? ' (Host)' : ''} 
                    ${p === username ? '(You)' : ''}
                </span>
            `).join('<br>')}
        `;
    }
}

function updateGameState(game) {
    currentBoard = game.board || Array(9).fill('');
    currentPlayer = game.currentPlayer || 'X';
    gameActive = game.status === 'playing';
    
    updateBoardDisplay();
    updateTurnIndicator();
    
    // Hide result if game is active
    if (gameActive) {
        document.getElementById('game-result').style.display = 'none';
    }
}

function updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    if (!turnIndicator) return;
    
    if (!gameActive) {
        turnIndicator.textContent = '⏸️ Game Paused';
        turnIndicator.className = 'alert alert-secondary bg-dark border-secondary d-inline-block px-4 py-2';
        return;
    }
    
    if (isMyTurn) {
        turnIndicator.textContent = `✅ YOUR TURN (${mySymbol})`;
        turnIndicator.className = 'alert alert-success bg-dark border-success d-inline-block px-4 py-2';
        
        // Enable chat
        document.getElementById('chat-input').disabled = false;
        document.getElementById('send-chat-btn').disabled = false;
    } else {
        turnIndicator.textContent = `⏳ OPPONENT'S TURN (${currentPlayer})`;
        turnIndicator.className = 'alert alert-warning bg-dark border-warning d-inline-block px-4 py-2';
        
        // Still enable chat
        document.getElementById('chat-input').disabled = false;
        document.getElementById('send-chat-btn').disabled = false;
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    
    if (!message || !currentGame) return;
    
    socket.emit('chat-message', {
        gameId: currentGame.id,
        player: username,
        message: message
    });
    
    chatInput.value = '';
}

function addChatMessage(sender, message, isOwn = false) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
    
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    if (sender === 'System') {
        messageDiv.innerHTML = `<em class="text-warning">${message}</em>`;
        messageDiv.className = 'chat-message system';
    } else {
        messageDiv.innerHTML = `
            <strong class="${isOwn ? 'text-primary' : 'text-info'}">${sender}:</strong> 
            <span class="text-light">${message}</span>
            <small class="text-muted ms-2">${time}</small>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.className = `status-indicator ${connected ? 'bg-success connected' : 'bg-danger disconnected'}`;
        statusElement.title = connected ? 'Connected to server' : 'Disconnected';
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification alert alert-${type} alert-dismissible fade show`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        min-width: 300px;
        max-width: 400px;
    `;
    
    notification.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="bi ${type === 'success' ? 'bi-check-circle-fill' : 
                         type === 'warning' ? 'bi-exclamation-triangle-fill' : 
                         type === 'danger' ? 'bi-x-circle-fill' : 
                         'bi-info-circle-fill'} me-2"></i>
            <span>${message}</span>
            <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}
