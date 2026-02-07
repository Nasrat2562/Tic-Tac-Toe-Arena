// Game State
let currentBoard = Array(9).fill('');
let currentPlayer = 'X';
let isMyTurn = false;
let gameActive = false;
let mySymbol = '';
let socket = null;
let username = null;
let currentGame = null;
let userStats = {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0
};
let notifications = [];
const MAX_NOTIFICATIONS = 50;
let heartbeatInterval = null;

console.log('Game.js loaded');

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM ready');
    initSocket();
    setupEventListeners();
    initGameBoard();
    loadNotifications();
    initTheme();
    initNotificationsDropdown();
});

function initTheme() {
    const savedTheme = localStorage.getItem('tic-tac-toe-theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    updateThemeStyles(savedTheme);
}

function updateThemeStyles(theme) {
    const root = document.documentElement;
    
    if (theme === 'light') {
        root.style.setProperty('--bs-body-color', '#212529');
        root.style.setProperty('--bs-body-bg', '#f8f9fa');
        root.style.setProperty('--bs-secondary-color', '#6c757d');
        root.style.setProperty('--bs-light-bg', '#e9ecef');
        root.style.setProperty('--bs-dark-bg', '#343a40');
        root.style.setProperty('--bs-border-color', '#dee2e6');
        
        document.querySelectorAll('.text-muted').forEach(el => {
            el.style.color = '#6c757d !important';
        });
        
        document.querySelectorAll('.bg-dark').forEach(el => {
            if (!el.classList.contains('stats-card')) {
                el.classList.replace('bg-dark', 'bg-light');
                el.classList.add('border', 'border-secondary');
            }
        });
    } else {
        root.style.setProperty('--bs-body-color', '#f8f9fa');
        root.style.setProperty('--bs-body-bg', '#212529');
        root.style.setProperty('--bs-secondary-color', '#adb5bd');
        root.style.setProperty('--bs-light-bg', '#343a40');
        root.style.setProperty('--bs-dark-bg', '#121416');
        root.style.setProperty('--bs-border-color', '#495057');
        
        document.querySelectorAll('.text-muted').forEach(el => {
            el.style.color = '#adb5bd !important';
        });
        
        document.querySelectorAll('.bg-light').forEach(el => {
            if (!el.classList.contains('stats-card') && el.classList.contains('bg-light')) {
                el.classList.replace('bg-light', 'bg-dark');
                el.classList.remove('border', 'border-secondary');
            }
        });
    }
}

function toggleTheme() {
    const currentTheme = document.body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('tic-tac-toe-theme', newTheme);
    updateThemeIcon(newTheme);
    updateThemeStyles(newTheme);
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
        themeIcon.className = theme === 'dark' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
    }
}

function initNotificationsDropdown() {
    const notificationsDropdown = document.getElementById('notificationsDropdown');
    if (notificationsDropdown) {
        notificationsDropdown.addEventListener('shown.bs.dropdown', function() {
            updateNotificationsPanel();
            markAllNotificationsAsRead();
        });
    }
}

function updateNotificationsPanel() {
    const notificationsList = document.getElementById('notifications-list');
    if (!notificationsList) return;
    
    if (notifications.length === 0) {
        notificationsList.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="bi bi-bell-slash display-6 mb-3"></i>
                <p class="mb-0">No notifications yet</p>
                <small>Game events will appear here</small>
            </div>
        `;
        return;
    }
    
    let notificationsHTML = '';
    
    notifications.forEach(notification => {
        const timeAgo = getTimeAgo(notification.timestamp);
        const iconClass = getNotificationIcon(notification.type);
        const readClass = notification.read ? '' : 'unread';
        
        notificationsHTML += `
            <div class="notification-item mb-2 p-3 rounded ${readClass}" data-id="${notification.id}">
                <div class="d-flex align-items-start">
                    <i class="${iconClass} me-2 mt-1 text-${notification.type}"></i>
                    <div class="flex-grow-1">
                        <div class="small mb-1">${notification.message}</div>
                        <div class="text-muted extra-small">${timeAgo}</div>
                    </div>
                    <button class="btn btn-sm btn-outline-danger delete-notification-btn ms-2" data-id="${notification.id}">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    notificationsList.innerHTML = notificationsHTML;
    
    document.querySelectorAll('.delete-notification-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation();
            const notificationId = parseInt(this.getAttribute('data-id'));
            deleteNotification(notificationId);
        });
    });
}

function deleteNotification(id) {
    notifications = notifications.filter(n => n.id !== id);
    saveNotifications();
    updateNotificationsPanel();
    updateNotificationsBadge();
    showNotification('Notification removed', 'info', false);
}

function markAllNotificationsAsRead() {
    let changed = false;
    notifications.forEach(notification => {
        if (!notification.read) {
            notification.read = true;
            changed = true;
        }
    });
    
    if (changed) {
        saveNotifications();
        updateNotificationsBadge();
    }
}

function getTimeAgo(timestamp) {
    const now = new Date();
    const past = new Date(timestamp);
    const diff = now - past;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return past.toLocaleDateString();
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return 'bi bi-check-circle-fill';
        case 'warning': return 'bi bi-exclamation-triangle-fill';
        case 'danger': return 'bi bi-x-circle-fill';
        case 'info': return 'bi bi-info-circle-fill';
        default: return 'bi bi-bell-fill';
    }
}

function initSocket() {
    console.log('Initializing socket...');
    
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    socket = io({
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    
    socket.on('connect', () => {
        console.log('Connected to server');
        updateConnectionStatus(true);
        document.getElementById('connection-message').textContent = 'Connected! Enter your name.';
        showNotification('Connected to server', 'success', true);
        
        startHeartbeat();
        
        if (username) {
            console.log('Re-registering user:', username);
            socket.emit('register-user', username);
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        updateConnectionStatus(false);
        showNotification('Connection error: ' + error.message, 'danger', true);
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log('Reconnected to server. Attempt:', attemptNumber);
        updateConnectionStatus(true);
        showNotification('Reconnected to server', 'success', true);
        
        if (username) {
            console.log('Re-registering after reconnect:', username);
            socket.emit('register-user', username);
        }
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected. Reason:', reason);
        updateConnectionStatus(false);
        
        if (reason === 'io server disconnect') {
            socket.connect();
        } else {
            document.getElementById('connection-message').textContent = 'Disconnected. Reconnecting...';
            showNotification('Disconnected from server', 'warning', true);
        }
        
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    });
    
    socket.on('user-registered', (data) => {
        console.log('User registered:', data);
        username = data.username;
        document.getElementById('username-display').textContent = username;
        
        loadUserStats();
        
        document.getElementById('username-section').style.display = 'none';
        document.getElementById('create-game-section').style.display = 'block';
        document.getElementById('games-list-section').style.display = 'block';
        
        document.getElementById('waiting-screen').innerHTML = `
            <i class="bi bi-person-check display-1 text-success mb-3"></i>
            <h4 class="mb-3">Welcome, ${username}!</h4>
            <p class="text-muted">Create a game or join an existing one</p>
        `;
        
        showNotification('Welcome! You can now create or join games.', 'success', true);
        
        socket.emit('get-games');
    });
    
    socket.on('games-list', (games) => {
        console.log('Games list received:', games);
        updateGamesList(games);
    });
    
    socket.on('game-created', (game) => {
        console.log('Game created:', game);
        currentGame = game;
        showGameScreen(game);
        updateGameInfo(game);
        showNotification(`Game "${game.name}" created! Waiting for opponent...`, 'info', true);
    });
    
    socket.on('game-started', (game) => {
        console.log('Game started:', game);
        currentGame = game;
        gameActive = true;
        
        currentBoard = Array(9).fill('');
        
        if (game.players[0] === username) {
            mySymbol = 'X';
            isMyTurn = true;
        } else if (game.players[1] === username) {
            mySymbol = 'O';
            isMyTurn = false;
        }
        
        currentBoard = [...game.board];
        currentPlayer = game.currentPlayer;
        
        showGameScreen(game);
        initGameBoard();
        updateGameState();
        
        const opponent = game.players.find(p => p !== username);
        showNotification(`Game started! You are ${mySymbol} vs ${opponent}. ${isMyTurn ? 'Your turn!' : 'Opponent\'s turn!'}`, 'success', true);
        
        enableChat();
    });
    
    socket.on('move-made', (data) => {
        console.log('Move made:', data);
        
        currentBoard = data.board;
        currentPlayer = data.currentPlayer;
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
            
            showNotification(message, data.winner === username ? 'success' : 'warning', true);
            
            const resultMessage = document.getElementById('result-message');
            const gameResult = document.getElementById('game-result');
            
            if (resultMessage && gameResult) {
                resultMessage.textContent = message;
                gameResult.style.display = 'block';
            }
            
            if (currentGame) {
                currentGame.status = 'finished';
                currentGame.winner = data.winner;
                updateGameInfo(currentGame);
            }
            
            socket.emit('get-stats', { username: username });
        }
    });
    
    socket.on('player-left', (data) => {
        console.log('Player left:', data);
        const { player, message, gameId } = data;
        
        if (!currentGame || currentGame.id !== gameId) {
            console.log('Notification for different game, ignoring');
            return;
        }
        
        if (player !== username) {
            showNotification(message, 'warning', true);
            
            if (currentGame) {
                currentGame.status = 'waiting';
                gameActive = false;
                updateGameInfo(currentGame);
                updateTurnIndicator();
                disableChat();
            }
        }
    });
    
    socket.on('player-left-self', (data) => {
        console.log('You left the game:', data);
        const { message, gameId, gameDeleted } = data;
        
        if (currentGame && currentGame.id === gameId) {
            hideGameScreen();
            showNotification(message, 'info', true);
            
            if (gameDeleted) {
                showNotification('Game ended - all players left', 'info', true);
            }
        }
    });
    
    // NEW: Handle when opponent returns to lobby
   socket.on('opponent-returned-to-lobby', (data) => {
    console.log('Opponent returned to lobby:', data);
    const { gameId, player, gameStillExists } = data;
    
    // Make sure this is for our current game
    if (!currentGame || currentGame.id !== gameId) {
        console.log('Not our current game, ignoring');
        return;
    }
    
    showNotification(`${player} returned to lobby. Returning to lobby...`, 'info', true);
    
    // Immediately hide game screen
    hideGameScreen();
    
    // If game still exists on server (we're the last player), tell server we're also leaving
    if (gameStillExists && socket.connected) {
        console.log('Notifying server we are also returning to lobby');
        socket.emit('return-to-lobby', {
            gameId: gameId,
            player: username
        });
    }
    
    // Clear any rematch request
    hideRematchRequest();
});

    
    socket.on('rematch-offered', (data) => {
        const { player, gameId } = data;
        console.log('Rematch offered by:', player, 'for game:', gameId);
        
        // Check if we're still in the same game
        if (!currentGame || currentGame.id !== gameId) {
            console.log('Rematch offer for different game, ignoring');
            socket.emit('reject-rematch', { gameId: gameId, player: username });
            return;
        }
        
        showNotification(`${player} wants a rematch! Click the rematch request below to respond.`, 'info', true);
        showRematchRequest(player, gameId);
    });
    
    socket.on('rematch-started', (game) => {
        console.log('Rematch started:', game);
        
        // Make sure we're still in this game
        if (!currentGame || currentGame.id !== game.id) {
            console.log('Rematch started for different game, ignoring');
            return;
        }
        
        currentGame = game;
        gameActive = true;
        
        currentBoard = Array(9).fill('');
        currentPlayer = 'X';
        
        if (game.players[0] === username) {
            mySymbol = 'X';
            isMyTurn = true;
        } else if (game.players[1] === username) {
            mySymbol = 'O';
            isMyTurn = false;
        }
        
        document.getElementById('game-result').style.display = 'none';
        hideRematchRequest();
        
        initGameBoard();
        updateGameState();
        
        showNotification('Rematch started! X goes first.', 'success', true);
    });
    
    socket.on('rematch-rejected', (player) => {
        console.log('Rematch rejected by:', player);
        showNotification(`${player} rejected the rematch request`, 'warning', true);
        hideRematchRequest();
    });
    
    socket.on('rematch-pending', (message) => {
        showNotification(message, 'info', true);
    });
    
    socket.on('chat-message', (data) => {
        console.log('Chat message received:', data);
        if (data.sender !== username) {
            addChatMessage(data.sender, data.message, false);
        }
    });
    
    socket.on('chat-message-sent', (data) => {
        console.log('Chat message confirmed sent:', data);
        addChatMessage(data.sender, data.message, true);
    });
    
    socket.on('chat-popup-notification', (data) => {
        console.log('Chat popup notification:', data);
        if (data.sender !== username) {
            showChatPopup(data.sender, data.message);
        }
    });
    
    socket.on('user-stats', (stats) => {
        console.log('User stats received:', stats);
        userStats = { ...stats };
        updateStatsDisplay();
        
        localStorage.setItem(`tic-tac-toe-stats-${username}`, JSON.stringify(userStats));
    });
    
    socket.on('heartbeat-response', (data) => {
        console.log('Heartbeat response received:', data);
    });
    
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        showNotification(error, 'danger', true);
    });
}

function startHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }
    
    heartbeatInterval = setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('heartbeat');
        }
    }, 30000);
}

function setupEventListeners() {
    document.getElementById('set-username').addEventListener('click', function() {
        const usernameInput = document.getElementById('username-input');
        const name = usernameInput.value.trim();
        
        if (!name) {
            showNotification('Please enter a name', 'warning', true);
            return;
        }
        
        if (name.length < 2) {
            showNotification('Name must be at least 2 characters', 'warning', true);
            return;
        }
        
        console.log('Setting username:', name);
        socket.emit('register-user', name);
    });
    
    document.getElementById('username-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('set-username').click();
        }
    });
    
    document.getElementById('create-game-btn').addEventListener('click', function() {
        if (!username) {
            showNotification('Please enter your name first', 'warning', true);
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
    
    document.getElementById('game-name-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('create-game-btn').click();
        }
    });
    
    document.getElementById('leave-game').addEventListener('click', function() {
        if (currentGame && socket && socket.connected) {
            if (confirm('Are you sure you want to leave this game?')) {
                console.log('Leaving game:', currentGame.id);
                
                socket.emit('leave-game', {
                    gameId: currentGame.id,
                    player: username
                });
            }
        } else {
            showNotification('Cannot leave game - not connected to server', 'danger', true);
        }
    });
    
    document.getElementById('rematch-btn').addEventListener('click', function() {
        if (currentGame && socket && socket.connected) {
            console.log('Requesting rematch for game:', currentGame.id);
            document.getElementById('game-result').style.display = 'none';
            
            socket.emit('request-rematch', {
                gameId: currentGame.id,
                player: username
            });
            showNotification('Rematch requested! Waiting for opponent...', 'info', true);
        } else {
            showNotification('Cannot request rematch - not connected to server', 'danger', true);
        }
    });
    
    document.getElementById('new-game-btn').addEventListener('click', function() {
    if (currentGame && socket && socket.connected) {
        console.log('Returning to lobby from game:', currentGame.id);
        
        // Store game info before we clear it
        const gameId = currentGame.id;
        const gameName = currentGame.name;
        
        // Notify server
        socket.emit('return-to-lobby', {
            gameId: gameId,
            player: username
        });
        
        console.log(`Requested to leave game: ${gameName} (${gameId})`);
        
        // Clear local state immediately
        hideGameScreen();
        showNotification('Returned to lobby', 'info', true);
        
    } else if (!socket || !socket.connected) {
        showNotification('Cannot return to lobby - not connected to server', 'danger', true);
    } else {
        // No current game, just go to lobby
        hideGameScreen();
        showNotification('Returned to lobby', 'info', true);
    }
});
    
    document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
    
    document.getElementById('chat-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
    
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    const clearNotificationsBtn = document.getElementById('clear-notifications');
    if (clearNotificationsBtn) {
        clearNotificationsBtn.addEventListener('click', clearNotifications);
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    if (!currentGame || !username) {
        showNotification('You must be in a game to chat', 'warning', true);
        return;
    }
    
    if (!socket || !socket.connected) {
        showNotification('Cannot send message - not connected to server', 'danger', true);
        return;
    }
    
    console.log('Sending chat message:', message);
    
    socket.emit('chat-message', {
        gameId: currentGame.id,
        sender: username,
        message: message
    });
    
    chatInput.value = '';
    chatInput.focus();
}

function addChatMessage(sender, message, isOwnMessage) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = `mb-2 ${isOwnMessage ? 'text-end' : ''}`;
    
    messageElement.innerHTML = `
        <div class="d-inline-block p-2 rounded ${isOwnMessage ? 'bg-primary text-white' : 'bg-secondary text-white'}">
            <small class="fw-bold">${isOwnMessage ? 'You' : sender}</small>
            <div>${message}</div>
            <small class="opacity-75">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showChatPopup(sender, message) {
    const popup = document.createElement('div');
    popup.className = 'position-fixed chat-popup-notification';
    popup.style.cssText = `
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        min-width: 300px;
        max-width: 400px;
        animation: slideInUp 0.3s ease-out;
        background: linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%);
        color: white;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        overflow: hidden;
    `;
    
    popup.innerHTML = `
        <div class="p-3">
            <div class="d-flex align-items-center mb-2">
                <i class="bi bi-chat-left-text-fill me-2 fs-5"></i>
                <strong class="flex-grow-1">New message from ${sender}</strong>
                <button type="button" class="btn-close btn-close-white" onclick="this.parentElement.parentElement.remove()"></button>
            </div>
            <div class="p-2 bg-dark bg-opacity-50 rounded">
                <p class="mb-0">${message}</p>
            </div>
            <div class="mt-2 text-end">
                <small class="text-white-50">Click to open chat</small>
            </div>
        </div>
    `;
    
    popup.addEventListener('click', function() {
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.focus();
        }
        this.remove();
    });
    
    setTimeout(() => {
        if (popup.parentNode) {
            popup.remove();
        }
    }, 10000);
    
    document.body.appendChild(popup);
}

function enableChat() {
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    
    if (chatInput && sendChatBtn) {
        chatInput.disabled = false;
        chatInput.placeholder = 'Type your message...';
        sendChatBtn.disabled = false;
        chatInput.focus();
    }
}

function disableChat() {
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    
    if (chatInput && sendChatBtn) {
        chatInput.disabled = true;
        chatInput.placeholder = 'Join a game to chat...';
        sendChatBtn.disabled = true;
        chatInput.value = '';
    }
}

function initGameBoard() {
    console.log('Initializing game board... Current board:', currentBoard);
    const board = document.getElementById('tic-tac-toe-board');
    
    if (!board) {
        console.error('Game board element not found!');
        return;
    }
    
    board.innerHTML = '';
    
    for (let i = 0; i < 9; i++) {
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.dataset.index = i;
        cell.textContent = currentBoard[i] || '';
        
        if (!currentBoard[i]) {
            cell.classList.add('cell-empty');
        }
        
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
        showNotification('Game is not active yet', 'warning', true);
        return;
    }
    
    if (!isMyTurn) {
        showNotification('Wait for your turn!', 'warning', true);
        return;
    }
    
    if (currentBoard[index]) {
        showNotification('This cell is already taken!', 'warning', true);
        return;
    }
    
    if (currentGame && socket && socket.connected) {
        console.log('Making move at index:', index);
        socket.emit('make-move', {
            gameId: currentGame.id,
            cellIndex: index,
            player: username
        });
    } else {
        showNotification('Cannot make move - not connected to server', 'danger', true);
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
        
        if (!cellValue) {
            cell.classList.add('cell-empty');
        }
        
        if (cellValue === 'X') {
            cell.classList.add('x');
        } else if (cellValue === 'O') {
            cell.classList.add('o');
        }
        
        if (!gameActive || !isMyTurn || cellValue) {
            cell.classList.add('disabled');
        } else {
            cell.classList.remove('disabled');
            cell.classList.add('cell-hover');
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
        const joinableGames = games.filter(game => 
            game.status === 'waiting' && 
            game.playerCount < 2 &&
            game.players.length > 0
        );
        
        if (joinableGames.length === 0) {
            gamesList.innerHTML = `
                <div class="text-center text-muted p-4">
                    <i class="bi bi-hourglass-split display-6 mb-2"></i>
                    <p class="mb-0">No games available to join</p>
                    <small>Create your own game!</small>
                </div>
            `;
        } else {
            joinableGames.forEach(game => {
                const gameItem = document.createElement('div');
                gameItem.className = 'game-item p-3 mb-2 rounded';
                gameItem.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <div class="fw-bold">${game.name}</div>
                            <small class="text-muted">
                                <i class="bi bi-person-fill"></i> ${game.host} | 
                                <i class="bi bi-people-fill"></i> ${game.playerCount}/2 |
                                <span class="badge bg-warning">
                                    ⏳ Waiting for player
                                </span>
                            </small>
                        </div>
                        <button class="btn btn-sm btn-primary join-game-btn">
                            <i class="bi bi-joystick"></i> Join
                        </button>
                    </div>
                `;
                gamesList.appendChild(gameItem);
                
                const joinBtn = gameItem.querySelector('.join-game-btn');
                joinBtn.addEventListener('click', () => {
                    if (!username) {
                        showNotification('Please enter your name first', 'warning', true);
                        return;
                    }
                    
                    if (!socket || !socket.connected) {
                        showNotification('Cannot join game - not connected to server', 'danger', true);
                        return;
                    }
                    
                    if (game.playerCount >= 2) {
                        showNotification('Game is already full', 'warning', true);
                        return;
                    }
                    
                    console.log('Joining game:', game.id);
                    socket.emit('join-game', {
                        gameId: game.id,
                        player: username
                    });
                    
                    showNotification(`Joining "${game.name}"...`, 'info', true);
                });
            });
        }
    }
    
    if (gamesCount) {
        gamesCount.textContent = games.length;
    }
}

function showGameScreen(game) {
    console.log('Showing game screen for:', game.name);
    
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('games-list-section').style.display = 'none';
    document.getElementById('create-game-section').style.display = 'none';
    
    document.getElementById('game-board-container').style.display = 'block';
    document.getElementById('current-game-info').style.display = 'block';
    
    if (gameActive) {
        document.getElementById('chat-section').style.display = 'block';
    } else {
        document.getElementById('chat-section').style.display = 'none';
    }
    
    document.getElementById('game-name-display').textContent = game.name;
    document.getElementById('game-title').textContent = game.name;
    
    updateGameInfo(game);
    updateGameState();
}

function hideGameScreen() {
    console.log('Hiding game screen');
    
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
    
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
    
    disableChat();
    hideRematchRequest();
    
    currentBoard = Array(9).fill('');
    gameActive = false;
    isMyTurn = false;
    currentGame = null;
    mySymbol = '';
    
    updateBoardDisplay();
    updateTurnIndicator();
    
    if (socket && socket.connected) {
        socket.emit('get-games');
    }
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
            if (gameActive) {
                gameStatus.textContent = isMyTurn ? '✅ YOUR TURN!' : '⏳ Opponent\'s turn...';
                gameStatus.className = `small ${isMyTurn ? 'text-success' : 'text-warning'}`;
            } else {
                gameStatus.textContent = '🎮 Game in progress';
                gameStatus.className = 'small text-info';
            }
        } else if (game.status === 'finished') {
            if (game.winner === 'draw') {
                gameStatus.textContent = '🏁 Game ended in a draw';
            } else if (game.winner === username) {
                gameStatus.textContent = '🏆 YOU WON!';
            } else {
                gameStatus.textContent = '😢 Game finished - You lost';
            }
            gameStatus.className = 'small text-muted';
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
    console.log('Updating game state. Game active:', gameActive);
    
    updateBoardDisplay();
    updateTurnIndicator();
    
    if (currentGame) {
        updateGameInfo(currentGame);
    }
    
    const chatSection = document.getElementById('chat-section');
    if (chatSection) {
        if (gameActive && currentGame) {
            chatSection.style.display = 'block';
            enableChat();
        } else {
            chatSection.style.display = 'none';
            disableChat();
        }
    }
    
    if (gameActive) {
        document.getElementById('game-result').style.display = 'none';
    }
}

function updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    if (!turnIndicator) return;
    
    if (!currentGame) {
        turnIndicator.textContent = '🎮 No active game';
        turnIndicator.className = 'alert alert-secondary';
        return;
    }
    
    if (currentGame.status === 'waiting') {
        turnIndicator.textContent = '⏳ Waiting for opponent...';
        turnIndicator.className = 'alert alert-warning';
        return;
    }
    
    if (currentGame.status === 'finished') {
        if (currentGame.winner === 'draw') {
            turnIndicator.textContent = '🏁 Game ended in a draw';
        } else if (currentGame.winner === username) {
            turnIndicator.textContent = '🏆 YOU WON!';
        } else {
            turnIndicator.textContent = '😢 Game finished';
        }
        turnIndicator.className = 'alert alert-info';
        return;
    }
    
    if (!gameActive) {
        turnIndicator.textContent = '⏸️ Game paused';
        turnIndicator.className = 'alert alert-secondary';
        return;
    }
    
    if (isMyTurn) {
        turnIndicator.textContent = `✅ YOUR TURN! (${mySymbol})`;
        turnIndicator.className = 'alert alert-success';
    } else {
        turnIndicator.textContent = `⏳ OPPONENT'S TURN (${mySymbol === 'X' ? 'O' : 'X'})`;
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

function showNotification(message, type = 'info', store = false) {
    if (store) {
        const notification = {
            id: Date.now(),
            message: message,
            type: type,
            timestamp: new Date().toISOString(),
            read: false
        };
        notifications.unshift(notification);
        
        if (notifications.length > MAX_NOTIFICATIONS) {
            notifications.pop();
        }
        
        saveNotifications();
        updateNotificationsBadge();
        
        const notificationsList = document.getElementById('notifications-list');
        if (notificationsList && document.querySelector('.dropdown-menu.show')) {
            updateNotificationsPanel();
        }
    }
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show position-fixed notification-toast`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; animation: slideInRight 0.3s ease-out;';
    
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

function showRematchRequest(player, gameId) {
    const rematchRequest = document.getElementById('rematch-request');
    if (!rematchRequest) return;
    
    rematchRequest.innerHTML = `
        <div class="alert alert-info alert-dismissible fade show">
            <div class="d-flex align-items-center">
                <i class="bi bi-arrow-clockwise me-2"></i>
                <div class="flex-grow-1">
                    <strong>${player}</strong> wants a rematch!
                </div>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-success" id="accept-rematch">
                        <i class="bi bi-check-lg"></i> Accept
                    </button>
                    <button class="btn btn-danger" id="reject-rematch">
                        <i class="bi bi-x-lg"></i> Reject
                    </button>
                </div>
                <button type="button" class="btn-close ms-2" data-bs-dismiss="alert"></button>
            </div>
        </div>
    `;
    
    rematchRequest.style.display = 'block';
    
    document.getElementById('accept-rematch').addEventListener('click', function() {
        console.log('Accepting rematch for game:', gameId);
        socket.emit('accept-rematch', {
            gameId: gameId,
            player: username
        });
        rematchRequest.style.display = 'none';
    });
    
    document.getElementById('reject-rematch').addEventListener('click', function() {
        console.log('Rejecting rematch for game:', gameId);
        socket.emit('reject-rematch', {
            gameId: gameId,
            player: username
        });
        rematchRequest.style.display = 'none';
    });
}

function hideRematchRequest() {
    const rematchRequest = document.getElementById('rematch-request');
    if (rematchRequest) {
        rematchRequest.style.display = 'none';
        rematchRequest.innerHTML = '';
    }
}

function loadUserStats() {
    if (socket && socket.connected) {
        socket.emit('get-stats', { username: username });
    }
    
    const savedStats = localStorage.getItem(`tic-tac-toe-stats-${username}`);
    if (savedStats) {
        const localStats = JSON.parse(savedStats);
        setTimeout(() => {
            if (userStats.gamesPlayed === 0) {
                userStats = { ...localStats };
                updateStatsDisplay();
            }
        }, 1000);
    }
}

function updateStatsDisplay() {
    const winRate = userStats.gamesPlayed > 0 
        ? Math.round((userStats.wins / userStats.gamesPlayed) * 100) 
        : 0;
    
    const statsContainer = document.getElementById('player-stats');
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="col-6 mb-3">
                <div class="p-3 bg-dark rounded stats-card">
                    <div class="h2 mb-1 text-primary">${userStats.gamesPlayed}</div>
                    <small>Games</small>
                </div>
            </div>
            <div class="col-6 mb-3">
                <div class="p-3 bg-dark rounded stats-card">
                    <div class="h2 mb-1 text-success">${userStats.wins}</div>
                    <small>Wins</small>
                </div>
            </div>
            <div class="col-6">
                <div class="p-3 bg-dark rounded stats-card">
                    <div class="h2 mb-1 text-warning">${userStats.losses}</div>
                    <small>Losses</small>
                </div>
            </div>
            <div class="col-6">
                <div class="p-3 bg-dark rounded stats-card">
                    <div class="h2 mb-1 text-info">${winRate}%</div>
                    <small>Win Rate</small>
                </div>
            </div>
        `;
    }
}

function loadNotifications() {
    const savedNotifications = localStorage.getItem(`tic-tac-toe-notifications-${username}`);
    if (savedNotifications) {
        notifications = JSON.parse(savedNotifications);
        updateNotificationsBadge();
    }
}

function saveNotifications() {
    if (username) {
        localStorage.setItem(`tic-tac-toe-notifications-${username}`, JSON.stringify(notifications));
    }
}

function updateNotificationsBadge() {
    const unreadCount = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notifications-badge');
    if (badge) {
        badge.textContent = unreadCount;
        badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
}

function clearNotifications() {
    notifications = [];
    saveNotifications();
    updateNotificationsBadge();
    updateNotificationsPanel();
    showNotification('All notifications cleared', 'info', false);
}

document.addEventListener('visibilitychange', function() {
    if (!document.hidden && socket && !socket.connected) {
        console.log('Attempting to reconnect...');
        socket.connect();
    }
});

window.addEventListener('beforeunload', function() {
    if (socket && socket.connected) {
        socket.disconnect();
    }
});



