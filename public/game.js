// Game State
let currentBoard = Array(9).fill('');
let currentPlayer = 'X';
let isMyTurn = false;
let gameActive = false;
let mySymbol = '';
let socket = null;
let username = null;
let currentGame = null;

console.log('Game.js loaded');

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM ready');
    initSocket();
    setupEventListeners();
    initGameBoard();
});

function initSocket() {
    console.log('Initializing socket...');
    
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
        updateConnectionStatus(true);
        document.getElementById('connection-message').textContent = 'Connected! Enter your name.';
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected');
        updateConnectionStatus(false);
        document.getElementById('connection-message').textContent = 'Disconnected';
    });
    
    socket.on('user-registered', (data) => {
        console.log('User registered:', data);
        username = data.username;
        document.getElementById('username-display').textContent = username;
        
        // Show game sections
        document.getElementById('username-section').style.display = 'none';
        document.getElementById('create-game-section').style.display = 'block';
        document.getElementById('games-list-section').style.display = 'block';
        
        // Update waiting screen
        document.getElementById('waiting-screen').innerHTML = `
            <i class="bi bi-person-check display-1 text-success mb-3"></i>
            <h4 class="mb-3 text-light">Welcome, ${username}!</h4>
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
        
        // Clear the board first
        currentBoard = Array(9).fill('');
        
        // Determine my symbol and turn
        if (game.players[0] === username) {
            mySymbol = 'X';
            isMyTurn = true;  // X always starts
        } else if (game.players[1] === username) {
            mySymbol = 'O';
            isMyTurn = false;  // O goes second
        }
        
        // Update board from game state
        currentBoard = [...game.board];
        currentPlayer = game.currentPlayer;
        
        // Show game screen and update display
        showGameScreen(game);
        updateGameInfo(game);
        
        // Reinitialize the game board
        initGameBoard();
        updateGameState();
        
        const opponent = game.players.find(p => p !== username);
        showNotification(`Game started! You are ${mySymbol} vs ${opponent}. ${isMyTurn ? 'Your turn!' : 'Opponent\'s turn!'}`, 'success');
    });
    
    socket.on('move-made', (data) => {
        console.log('Move made:', data);
        
        // Update board
        currentBoard = data.board;
        currentPlayer = data.currentPlayer;
        
        // Update turn status
        isMyTurn = currentPlayer === mySymbol && !data.gameOver;
        
        updateBoardDisplay();
        updateTurnIndicator();
        
        if (data.gameOver) {
            gameActive = false;
            isMyTurn = false;
            
            let message = '';
            if (data.winner === 'draw') {
                message = '🎭 Game ended in a draw!';
            } else if (data.winner === username) {
                message = '🎉 YOU WIN! 🏆';
            } else {
                message = '😢 You lost!';
            }
            
            showNotification(message, data.winner === username ? 'success' : 'warning');
            
            const resultMessage = document.getElementById('result-message');
            const gameResult = document.getElementById('game-result');
            
            if (resultMessage && gameResult) {
                resultMessage.textContent = message;
                gameResult.style.display = 'block';
            }
        }
    });
    
    socket.on('player-left', (player) => {
        console.log('Player left:', player);
        showNotification(`${player} left the game`, 'warning');
        
        if (currentGame) {
            currentGame.status = 'waiting';
            gameActive = false;
            updateGameInfo(currentGame);
        }
    });
    
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        showNotification(error, 'danger');
    });
}

function setupEventListeners() {
    // Set username - FIXED THIS
    document.getElementById('set-username').addEventListener('click', function() {
        const usernameInput = document.getElementById('username-input');
        const name = usernameInput.value.trim();
        
        if (!name) {
            showNotification('Please enter a name', 'warning');
            return;
        }
        
        if (name.length < 2) {
            showNotification('Name must be at least 2 characters', 'warning');
            return;
        }
        
        console.log('Setting username:', name);
        socket.emit('register-user', name);
    });
    
    // Enter key for username
    document.getElementById('username-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('set-username').click();
        }
    });
    
    // Create game
    document.getElementById('create-game-btn').addEventListener('click', function() {
        if (!username) {
            showNotification('Please enter your name first', 'warning');
            return;
        }
        
        const gameNameInput = document.getElementById('game-name-input');
        const gameName = gameNameInput.value.trim() || `${username}'s Game`;
        
        console.log('Creating game:', gameName);
        socket.emit('create-game', {
            host: username,
            name: gameName
        });
        
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
            if (confirm('Are you sure you want to leave this game?')) {
                socket.emit('leave-game', {
                    gameId: currentGame.id,
                    player: username
                });
                hideGameScreen();
                showNotification('You left the game', 'info');
            }
        }
    });
    
    // Rematch
    document.getElementById('rematch-btn').addEventListener('click', function() {
        if (currentGame && socket) {
            socket.emit('request-rematch', {
                gameId: currentGame.id,
                player: username
            });
        }
    });
    
    // New game
    document.getElementById('new-game-btn').addEventListener('click', function() {
        hideGameScreen();
        showNotification('Returned to lobby', 'info');
    });
}

function initGameBoard() {
    console.log('Initializing game board... Current board:', currentBoard);
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
        cell.textContent = currentBoard[i] || '';
        
        cell.addEventListener('click', function() {
            handleCellClick(i);
        });
        
        board.appendChild(cell);
    }
    
    updateBoardDisplay();
}

function handleCellClick(index) {
    console.log(`Cell ${index} clicked. Game active: ${gameActive}, My turn: ${isMyTurn}, Cell value: ${currentBoard[index]}`);
    
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
        
        // Disable cell if not player's turn or already taken or game not active
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
            <div class="text-center text-muted p-4">
                <i class="bi bi-emoji-frown display-6 mb-2"></i>
                <p class="mb-0">No games available</p>
                <small>Create the first game!</small>
            </div>
        `;
    } else {
        games.forEach(game => {
            const gameItem = document.createElement('div');
            gameItem.className = 'game-item p-3 mb-2 bg-dark rounded';
            gameItem.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <div class="fw-bold">${game.name}</div>
                        <small class="text-muted">
                            <i class="bi bi-person-fill"></i> ${game.host} | 
                            <i class="bi bi-people-fill"></i> ${game.playerCount}/2 |
                            <span class="${game.status === 'waiting' ? 'text-warning' : 'text-success'}">
                                ${game.status === 'waiting' ? '⏳ Waiting' : '🎮 Playing'}
                            </span>
                        </small>
                    </div>
                    <button class="btn btn-sm btn-primary join-game-btn" 
                            ${game.playerCount >= 2 ? 'disabled' : ''}>
                        <i class="bi bi-joystick"></i> Join
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
                
                if (game.playerCount >= 2) {
                    showNotification('Game is full!', 'warning');
                    return;
                }
                
                console.log('Joining game:', game.id);
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
    
    document.getElementById('game-name-display').textContent = game.name;
    
    // Update game info
    updateGameInfo(game);
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
    mySymbol = '';
    updateBoardDisplay();
    
    // Get updated games list
    socket.emit('get-games');
}

function updateGameInfo(game) {
    const gameTitle = document.getElementById('game-title');
    const gameStatus = document.getElementById('game-status');
    const playersInfo = document.getElementById('players-info');
    
    if (gameTitle) gameTitle.textContent = game.name;
    
    if (gameStatus) {
        if (game.status === 'waiting') {
            gameStatus.textContent = '⏳ Waiting for opponent...';
            gameStatus.className = 'small text-warning';
        } else if (game.status === 'playing') {
            gameStatus.textContent = isMyTurn ? '✅ YOUR TURN!' : '⏳ Opponent\'s turn...';
            gameStatus.className = `small ${isMyTurn ? 'text-success' : 'text-warning'}`;
        } else {
            gameStatus.textContent = '🎮 Game in progress';
            gameStatus.className = 'small text-success';
        }
    }
    
    if (playersInfo && game.players) {
        playersInfo.innerHTML = `
            <strong>Players:</strong><br>
            ${game.players.map((p, index) => `
                <span class="${p === username ? 'text-warning fw-bold' : 'text-light'}">
                    • ${p} (${index === 0 ? 'X' : 'O'})${p === game.host ? ' 👑' : ''}
                </span>
            `).join('<br>')}
        `;
    }
}

function updateGameState() {
    updateBoardDisplay();
    updateTurnIndicator();
    updateGameInfo(currentGame);
    
    // Hide result if game is active
    if (gameActive) {
        document.getElementById('game-result').style.display = 'none';
    }
}

function updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    if (!turnIndicator) return;
    
    if (!gameActive || !currentGame) {
        turnIndicator.textContent = '⏸️ Game Paused';
        turnIndicator.className = 'alert alert-secondary';
        return;
    }
    
    if (currentGame.status === 'waiting') {
        turnIndicator.textContent = '⏳ Waiting for opponent...';
        turnIndicator.className = 'alert alert-warning';
        return;
    }
    
    if (isMyTurn) {
        turnIndicator.textContent = `✅ YOUR TURN! (${mySymbol})`;
        turnIndicator.className = 'alert alert-success';
    } else {
        turnIndicator.textContent = `⏳ OPPONENT'S TURN`;
        turnIndicator.className = 'alert alert-warning';
    }
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.className = `status-indicator ${connected ? 'bg-success connected' : 'bg-danger disconnected'}`;
        statusElement.title = connected ? 'Connected' : 'Disconnected';
    }
}

function showNotification(message, type = 'info') {
    // Create notification
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    
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
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

// Reset game board
function resetGameBoard() {
    currentBoard = Array(9).fill('');
    if (currentGame) {
        currentBoard = [...currentGame.board];
    }
    initGameBoard();
    updateBoardDisplay();
}
