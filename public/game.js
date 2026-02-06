// Game State
let currentBoard = Array(9).fill('');
let currentPlayer = 'X';
let isMyTurn = false;
let gameActive = false;
let mySymbol = '';
let socket = null;
let username = null;
let currentGame = null;

console.log('🎮 TicTacToe Arena Initializing...');

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('📱 DOM loaded');
    
    // Initialize socket
    initializeSocket();
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize game board
    initializeGameBoard();
    
    // Add welcome message
    setTimeout(() => {
        if (socket && socket.connected) {
            showNotification('Connected to server! Enter your name to start playing.', 'success');
        }
    }, 1000);
});

function initializeSocket() {
    console.log('🔌 Connecting to server...');
    
    // Connect to server
    const socketUrl = window.location.hostname === 'localhost' 
        ? 'http://localhost:3000'
        : window.location.origin;
    
    console.log('🌐 Socket URL:', socketUrl);
    socket = io(socketUrl);
    
    // Socket event handlers
    socket.on('connect', () => {
        console.log('✅ Connected to server');
        updateConnectionStatus(true);
        document.getElementById('connection-text').textContent = 'Connected';
        document.getElementById('connection-message').textContent = 'Connected! Enter your name.';
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Disconnected from server');
        updateConnectionStatus(false);
        document.getElementById('connection-text').textContent = 'Disconnected';
        document.getElementById('connection-message').textContent = 'Disconnected from server';
    });
    
    socket.on('registered', (data) => {
        console.log('👤 Registered:', data.username);
        username = data.username;
        document.getElementById('username-display').textContent = username;
        
        // Show game creation section
        document.getElementById('username-section').style.display = 'none';
        document.getElementById('create-game-section').style.display = 'block';
        document.getElementById('games-list-section').style.display = 'block';
        
        // Update waiting screen
        document.getElementById('waiting-screen').innerHTML = `
            <div class="mb-4">
                <i class="bi bi-person-check display-1 text-success"></i>
            </div>
            <h4 class="mb-3">Welcome, ${username}!</h4>
            <p class="text-muted mb-4">Create a game or join an existing one</p>
            <div class="alert alert-dark border-success">
                <i class="bi bi-info-circle me-2"></i>
                Ready to play! Choose an option below.
            </div>
        `;
        
        showNotification(`Welcome ${username}! You can now create or join games.`, 'success');
        
        // Request games list
        socket.emit('get-games');
    });
    
    socket.on('games-list', (games) => {
        console.log('📋 Available games:', games);
        updateGamesList(games);
    });
    
    socket.on('game-created', (game) => {
        console.log('🎮 Game created:', game);
        currentGame = game;
        showGameScreen(game);
        updateGameInfo(game);
        showNotification(`Game "${game.name}" created! Waiting for opponent...`, 'info');
        addChatMessage('System', `Game "${game.name}" created. Waiting for opponent...`);
    });
    
    socket.on('game-started', (game) => {
        console.log('🚀 Game started:', game);
        currentGame = game;
        gameActive = true;
        
        // Determine my symbol
        if (game.players[0] === username) {
            mySymbol = 'X';
            isMyTurn = true;
        } else if (game.players[1] === username) {
            mySymbol = 'O';
            isMyTurn = false;
        }
        
        // Update game state
        currentBoard = game.board;
        currentPlayer = game.currentPlayer;
        
        updateGameState(game);
        updatePlayersDisplay(game);
        
        const opponent = game.players.find(p => p !== username);
        showNotification(`Game started! You are ${mySymbol} vs ${opponent}`, 'success');
        addChatMessage('System', `🎮 GAME STARTED! ${game.players[0]} (X) vs ${game.players[1]} (O)`);
        addChatMessage('System', `${username === game.players[0] ? 'You' : game.players[0]} goes first!`);
    });
    
    socket.on('game-updated', (game) => {
        console.log('🔄 Game updated:', game);
        if (currentGame && game.id === currentGame.id) {
            currentGame = game;
            updateGameInfo(game);
            updatePlayersDisplay(game);
        }
    });
    
    socket.on('player-info', (data) => {
        console.log('👤 Player info:', data);
        if (data.player === username) {
            mySymbol = data.symbol;
            isMyTurn = data.isYourTurn;
            updateTurnIndicator();
            
            if (isMyTurn) {
                showNotification('Your turn! Place ' + mySymbol, 'success');
                addChatMessage('System', `${username}'s turn (${mySymbol})`);
            }
        }
    });
    
    socket.on('move-made', (data) => {
        console.log('🎲 Move made:', data);
        
        // Update board
        currentBoard = data.board;
        currentPlayer = data.currentPlayer;
        
        // Update turn status
        isMyTurn = currentPlayer === mySymbol && data.gameStatus === 'playing';
        
        // Update UI
        updateBoardDisplay();
        updateTurnIndicator();
        
        // If game is over
        if (data.gameStatus === 'finished') {
            gameActive = false;
            isMyTurn = false;
            
            let message = '';
            let type = 'info';
            
            if (data.winner === 'draw') {
                message = '🎭 Game ended in a draw!';
            } else if (data.winner === username) {
                message = '🎉 YOU WIN! 🏆';
                type = 'success';
            } else {
                message = '😢 You lost! Better luck next time.';
                type = 'warning';
            }
            
            showNotification(message, type);
            
            const resultMessage = document.getElementById('result-message');
            const gameResult = document.getElementById('game-result');
            
            if (resultMessage && gameResult) {
                resultMessage.textContent = message;
                gameResult.style.display = 'block';
            }
            
            addChatMessage('System', `Game over! ${message}`);
        }
    });
    
    socket.on('player-left', (player) => {
        console.log('👋 Player left:', player);
        showNotification(`${player} left the game`, 'warning');
        addChatMessage('System', `${player} left the game`);
        
        if (currentGame) {
            currentGame.status = 'waiting';
            gameActive = false;
            updateGameInfo(currentGame);
            updateTurnIndicator();
        }
    });
    
    socket.on('error', (error) => {
        console.error('❌ Socket error:', error);
        showNotification(error || 'An error occurred', 'danger');
    });
}

function setupEventListeners() {
    // Set username
    document.getElementById('set-username').addEventListener('click', () => {
        const usernameInput = document.getElementById('username-input');
        const name = usernameInput.value.trim();
        
        if (!name) {
            showNotification('Please enter your name', 'warning');
            return;
        }
        
        if (name.length < 2) {
            showNotification('Name must be at least 2 characters', 'warning');
            return;
        }
        
        socket.emit('register', name);
    });
    
    // Enter key for username
    document.getElementById('username-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('set-username').click();
        }
    });
    
    // Create game
    document.getElementById('create-game-btn').addEventListener('click', () => {
        if (!username) {
            showNotification('Please enter your name first', 'warning');
            return;
        }
        
        const gameNameInput = document.getElementById('game-name-input');
        const gameName = gameNameInput.value.trim() || `${username}'s Arena`;
        
        socket.emit('create-game', gameName);
        gameNameInput.value = '';
    });
    
    // Enter key for game name
    document.getElementById('game-name-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('create-game-btn').click();
        }
    });
    
    // Refresh games
    document.getElementById('refresh-games').addEventListener('click', () => {
        socket.emit('get-games');
        showNotification('Refreshing games list...', 'info');
    });
    
    // Leave game
    document.getElementById('leave-game').addEventListener('click', () => {
        if (currentGame) {
            if (confirm('Are you sure you want to leave this game?')) {
                socket.emit('leave-game', currentGame.id);
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
            // Reset game state
            currentBoard = Array(9).fill('');
            gameActive = true;
            isMyTurn = mySymbol === 'X';
            currentPlayer = 'X';
            
            updateBoardDisplay();
            updateTurnIndicator();
            document.getElementById('game-result').style.display = 'none';
            
            showNotification('Rematch started!', 'info');
            addChatMessage('System', 'Rematch started!');
        }
    });
    
    // New game
    document.getElementById('new-game-btn').addEventListener('click', () => {
        hideGameScreen();
        showNotification('Returned to lobby', 'info');
    });
}

function initializeGameBoard() {
    console.log('🎲 Initializing game board...');
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
        cell.className = 'game-cell';
        cell.dataset.index = i;
        cell.textContent = '';
        
        cell.addEventListener('click', () => {
            handleCellClick(i);
        });
        
        board.appendChild(cell);
    }
    
    console.log('✅ Game board initialized with', board.children.length, 'cells');
    updateBoardDisplay();
}

function handleCellClick(index) {
    console.log(`🎯 Cell ${index} clicked. Game active: ${gameActive}, My turn: ${isMyTurn}`);
    
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
        console.log(`🎲 Making move at index ${index} in game ${currentGame.id}`);
        
        // Send move to server
        socket.emit('make-move', {
            gameId: currentGame.id,
            cellIndex: index
        });
        
        // Show immediate feedback
        showNotification(`Placing ${mySymbol}...`, 'info');
    }
}

function updateBoardDisplay() {
    const board = document.getElementById('tic-tac-toe-board');
    if (!board) return;
    
    const cells = board.querySelectorAll('.game-cell');
    
    cells.forEach((cell, index) => {
        const cellValue = currentBoard[index];
        cell.textContent = cellValue;
        cell.className = 'game-cell';
        
        if (cellValue === 'X') {
            cell.classList.add('x');
        } else if (cellValue === 'O') {
            cell.classList.add('o');
        }
        
        // Disable cell if not player's turn or already taken
        if (!gameActive || !isMyTurn || cellValue) {
            cell.classList.add('disabled');
            cell.style.cursor = 'not-allowed';
        } else {
            cell.classList.remove('disabled');
            cell.style.cursor = 'pointer';
        }
    });
}

function updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    if (!turnIndicator) return;
    
    if (!gameActive) {
        turnIndicator.textContent = '⏸️ Game Paused';
        turnIndicator.className = 'turn-indicator alert alert-secondary';
        turnIndicator.style.animation = 'none';
        return;
    }
    
    if (isMyTurn) {
        turnIndicator.textContent = `✅ YOUR TURN (${mySymbol})`;
        turnIndicator.className = 'turn-indicator alert alert-success';
        turnIndicator.style.animation = 'glow 2s infinite alternate';
        
        // Enable chat
        document.getElementById('chat-input').disabled = false;
        document.getElementById('chat-input').placeholder = 'Chat with opponent...';
        document.getElementById('send-chat-btn').disabled = false;
    } else {
        turnIndicator.textContent = `⏳ OPPONENT'S TURN (${currentPlayer})`;
        turnIndicator.className = 'turn-indicator alert alert-warning';
        turnIndicator.style.animation = 'none';
        
        // Still enable chat
        document.getElementById('chat-input').disabled = false;
        document.getElementById('chat-input').placeholder = 'Chat with opponent...';
        document.getElementById('send-chat-btn').disabled = false;
    }
}

function updateGamesList(games) {
    const gamesList = document.getElementById('games-list');
    const gamesCount = document.getElementById('games-count');
    
    if (!gamesList) return;
    
    gamesList.innerHTML = '';
    
    if (games.length === 0) {
        gamesList.innerHTML = `
            <div class="text-center text-muted p-4">
                <i class="bi bi-emoji-frown display-6 mb-3"></i>
                <p class="mb-2">No games available</p>
                <small>Create the first game!</small>
            </div>
        `;
    } else {
        games.forEach(game => {
            const gameItem = document.createElement('div');
            gameItem.className = 'game-list-item bg-dark text-light border-secondary p-3';
            gameItem.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1 fw-bold">${game.name}</h6>
                        <div class="d-flex gap-3 small text-muted">
                            <span><i class="bi bi-person-fill"></i> ${game.host}</span>
                            <span><i class="bi bi-people-fill"></i> ${game.players.length}/2</span>
                            <span><i class="bi bi-clock"></i> Just now</span>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-primary join-game-btn px-3" 
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
                
                console.log(`🎯 Joining game: ${game.id}`);
                socket.emit('join-game', game.id);
                
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
    
    // Initialize chat with welcome messages
    addChatMessage('System', `Welcome to "${game.name}"!`);
    addChatMessage('System', 'Players take turns placing X and O.');
    addChatMessage('System', 'First to get 3 in a row wins!');
}

function hideGameScreen() {
    document.getElementById('waiting-screen').style.display = 'block';
    document.getElementById('waiting-screen').innerHTML = `
        <div class="mb-4">
            <i class="bi bi-joystick display-1 text-muted"></i>
        </div>
        <h4 class="mb-3">Welcome back, ${username}!</h4>
        <p class="text-muted mb-4">Create a game or join an existing one</p>
        <div class="alert alert-dark border-primary">
            <i class="bi bi-info-circle me-2"></i>
            Ready to play again? Choose an option below.
        </div>
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
    updateTurnIndicator();
    
    // Request updated games list
    socket.emit('get-games');
}

function updateGameInfo(game) {
    const gameTitle = document.getElementById('game-title');
    const gameStatus = document.getElementById('game-status');
    const playersInfo = document.getElementById('players-info');
    
    if (gameTitle) gameTitle.textContent = game.name;
    
    if (gameStatus) {
        gameStatus.textContent = game.status === 'waiting' ? '⏳ Waiting for opponent...' : '🎮 Game in progress';
        gameStatus.className = `small mb-2 ${game.status === 'waiting' ? 'text-warning' : 'text-success'}`;
    }
    
    if (playersInfo && game.players) {
        playersInfo.innerHTML = `
            <div class="d-flex flex-column gap-2">
                ${game.players.map(p => `
                    <div class="player-badge ${game.players[0] === p ? 'player-x' : 'player-o'}">
                        <i class="bi bi-person-circle"></i>
                        <span class="${p === username ? 'text-warning fw-bold' : 'text-light'}">
                            ${p}${p === game.host ? ' (Host)' : ''} 
                            ${p === username ? '(You)' : ''}
                        </span>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

function updatePlayersDisplay(game) {
    const playersDisplay = document.getElementById('players-display');
    if (!playersDisplay) return;
    
    playersDisplay.innerHTML = `
        <div class="col-6">
            <div class="player-badge player-x">
                <i class="bi bi-person-circle fs-4"></i>
                <div>
                    <div class="fw-bold">${game.players[0] || 'Waiting...'}</div>
                    <small class="text-muted">Player X${game.players[0] === username ? ' (You)' : ''}</small>
                </div>
            </div>
        </div>
        <div class="col-6">
            <div class="player-badge player-o">
                <i class="bi bi-person-circle fs-4"></i>
                <div>
                    <div class="fw-bold">${game.players[1] || 'Waiting...'}</div>
                    <small class="text-muted">Player O${game.players[1] === username ? ' (You)' : ''}</small>
                </div>
            </div>
        </div>
    `;
}

function updateGameState(game) {
    currentBoard = game.board || Array(9).fill('');
    currentPlayer = game.currentPlayer || 'X';
    gameActive = game.status === 'playing';
    
    updateBoardDisplay();
    updateTurnIndicator();
    updatePlayersDisplay(game);
    
    // Hide result if game is active
    if (gameActive) {
        document.getElementById('game-result').style.display = 'none';
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    
    if (!message || !currentGame) return;
    
    addChatMessage(username, message, true);
    chatInput.value = '';
    
    // In a real app, you would send this to the server:
    // socket.emit('chat-message', { gameId: currentGame.id, message: message });
}

function addChatMessage(sender, message, isOwn = false) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
    
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    if (sender === 'System') {
        messageDiv.innerHTML = `<em class="text-warning"><i class="bi bi-info-circle me-1"></i>${message}</em>`;
        messageDiv.className = 'chat-message system';
    } else {
        messageDiv.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <div>
                    <strong class="${isOwn ? 'text-primary' : 'text-info'}">${sender}:</strong> 
                    <span class="text-light">${message}</span>
                </div>
                <small class="text-muted">${time}</small>
            </div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    const connectionText = document.getElementById('connection-text');
    
    if (statusElement) {
        statusElement.className = `status-indicator ${connected ? 'bg-success connected' : 'bg-danger disconnected'}`;
        statusElement.title = connected ? 'Connected to server' : 'Disconnected';
    }
    
    if (connectionText) {
        connectionText.textContent = connected ? 'Connected' : 'Disconnected';
        connectionText.className = connected ? 'text-success' : 'text-danger';
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification alert alert-${type} alert-dismissible fade show position-fixed`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        min-width: 300px;
        max-width: 400px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;
    
    const icons = {
        'success': 'bi-check-circle-fill',
        'warning': 'bi-exclamation-triangle-fill',
        'danger': 'bi-x-circle-fill',
        'info': 'bi-info-circle-fill'
    };
    
    notification.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="bi ${icons[type] || 'bi-info-circle-fill'} me-3 fs-5"></i>
            <div class="flex-grow-1">${message}</div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

// Initialize stats
function updatePlayerStats(stats = { games: 0, wins: 0, losses: 0, winRate: 0 }) {
    const statCards = document.querySelectorAll('.stat-value');
    if (statCards.length >= 4) {
        statCards[0].textContent = stats.games || 0;
        statCards[1].textContent = stats.wins || 0;
        statCards[2].textContent = stats.losses || 0;
        statCards[3].textContent = (stats.winRate || 0) + '%';
    }
}

// Initialize with default stats
updatePlayerStats();
