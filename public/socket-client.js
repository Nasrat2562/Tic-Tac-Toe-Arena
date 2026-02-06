class SocketClient {
    constructor() {
        this.socket = null;
        this.username = null;
        this.currentGame = null;
        this.isConnected = false;
        
        // Event handlers
        this.onGameList = null;
        this.onGameUpdate = null;
        this.onGameStart = null;
        this.onMove = null;
        this.onChatMessage = null;
        this.onGameOver = null;
        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onStatsUpdate = null;
        
        this.connect();
    }

    connect() {
        // Connect to the server (relative URL works since it's on same domain)
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('✅ Connected to server');
            this.isConnected = true;
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            this.isConnected = false;
            this.updateConnectionStatus(false);
        });

        this.socket.on('game-list', (games) => {
            console.log('📋 Games list updated:', games);
            if (this.onGameList) this.onGameList(games);
        });

        this.socket.on('game-update', (game) => {
            console.log('🔄 Game updated:', game);
            if (this.onGameUpdate) this.onGameUpdate(game);
        });

        this.socket.on('game-started', (game) => {
            console.log('🚀 Game started:', game);
            if (this.onGameStart) this.onGameStart(game);
        });

        this.socket.on('move-made', (data) => {
            console.log('🎮 Move made:', data);
            if (this.onMove) this.onMove(data);
        });

        this.socket.on('chat-message', (message) => {
            console.log('💬 Chat message:', message);
            if (this.onChatMessage) this.onChatMessage(message);
        });

        this.socket.on('game-over', (result) => {
            console.log('🏁 Game over:', result);
            if (this.onGameOver) this.onGameOver(result);
        });

        this.socket.on('player-joined', (player) => {
            console.log('👤 Player joined:', player);
            if (this.onPlayerJoined) this.onPlayerJoined(player);
        });

        this.socket.on('player-left', (player) => {
            console.log('👋 Player left:', player);
            if (this.onPlayerLeft) this.onPlayerLeft(player);
        });

        this.socket.on('stats-update', (stats) => {
            console.log('📊 Stats updated:', stats);
            if (this.onStatsUpdate) this.onStatsUpdate(stats);
        });

        this.socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
            this.showNotification(error.message || 'An error occurred', 'danger');
        });
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.className = `status-indicator ${connected ? 'bg-success connected' : 'bg-danger disconnected'}`;
            statusElement.title = connected ? 'Connected' : 'Disconnected';
        }
    }

    showNotification(message, type = 'info') {
        // Create a simple notification
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
        alert.style.top = '20px';
        alert.style.right = '20px';
        alert.style.zIndex = '9999';
        alert.style.minWidth = '300px';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alert);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }

    setUsername(username) {
        if (!username.trim()) {
            this.showNotification('Please enter a name', 'warning');
            return null;
        }
        
        this.username = username.trim();
        this.socket.emit('register-user', this.username);
        console.log('👤 Username set to:', this.username);
        return this.username;
    }

    createGame(gameName) {
        if (!this.username) {
            this.showNotification('Please enter your name first', 'warning');
            return;
        }
        
        const name = gameName || `${this.username}'s Game`;
        console.log('🆕 Creating game:', name);
        this.socket.emit('create-game', {
            host: this.username,
            name: name
        });
    }

    joinGame(gameId) {
        if (!this.username) {
            this.showNotification('Please enter your name first', 'warning');
            return;
        }
        
        console.log('🎯 Joining game:', gameId);
        this.socket.emit('join-game', {
            gameId,
            player: this.username
        });
    }

    makeMove(gameId, cellIndex) {
        if (!this.currentGame || this.currentGame.id !== gameId) {
            console.log('⚠️ Cannot make move - no current game');
            return;
        }
        
        console.log('🎮 Making move at:', cellIndex);
        this.socket.emit('make-move', {
            gameId,
            cellIndex,
            player: this.username
        });
    }

    sendChatMessage(gameId, message) {
        if (!message.trim()) return;
        
        console.log('💬 Sending chat message');
        this.socket.emit('chat-message', {
            gameId,
            player: this.username,
            message: message.trim()
        });
    }

    requestRematch(gameId) {
        console.log('🔄 Requesting rematch');
        this.socket.emit('request-rematch', {
            gameId,
            player: this.username
        });
    }

    leaveGame(gameId) {
        console.log('🚪 Leaving game');
        this.socket.emit('leave-game', {
            gameId,
            player: this.username
        });
        this.currentGame = null;
    }
}