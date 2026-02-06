// Game State
let currentBoard = Array(9).fill('');
let currentPlayer = 'X';
let isMyTurn = false;
let gameActive = false;
let mySymbol = '';
let socketClient = null;

console.log('Game.js loaded!');

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded. Initializing...');
    
    // Initialize elements
    initializeElements();
    
    // Initialize game board
    initializeGameBoard();
    
    // Initialize socket
    initializeSocket();
    
    // Setup event listeners
    setupEventListeners();
    
    // Add some debug style to make sure board is visible
    setTimeout(() => {
        const board = document.getElementById('tic-tac-toe-board');
        if (board) {
            console.log('Board found, checking children:', board.children.length);
            
            // Force add test X/O to first few cells
            const cells = board.querySelectorAll('.cell');
            cells.forEach((cell, index) => {
                // Test: Show numbers in cells so we can see them
                cell.textContent = index;
                cell.style.color = '#ffffff'; // Force white color
                cell.style.fontWeight = 'bold';
                cell.style.fontSize = '2rem';
            });
            
            // Remove numbers after 3 seconds
            setTimeout(() => {
                cells.forEach(cell => {
                    cell.textContent = '';
                });
            }, 3000);
        }
    }, 1000);
});

function initializeElements() {
    console.log('Getting DOM elements...');
    
    // Store elements in window for debugging
    window.elements = {
        usernameInput: document.getElementById('username-input'),
        setUsernameBtn: document.getElementById('set-username'),
        usernameDisplay: document.getElementById('username-display'),
        usernameSection: document.getElementById('username-section'),
        createGameSection: document.getElementById('create-game-section'),
        gamesListSection: document.getElementById('games-list-section'),
        gamesList: document.getElementById('games-list'),
        gamesCount: document.getElementById('games-count'),
        gameNameInput: document.getElementById('game-name-input'),
        createGameBtn: document.getElementById('create-game-btn'),
        currentGameInfo: document.getElementById('current-game-info'),
        leaveGameBtn: document.getElementById('leave-game'),
        playerStats: document.getElementById('player-stats'),
        waitingScreen: document.getElementById('waiting-screen'),
        gameBoardContainer: document.getElementById('game-board-container'),
        chatSection: document.getElementById('chat-section'),
        ticTacToeBoard: document.getElementById('tic-tac-toe-board'),
        turnIndicator: document.getElementById('turn-indicator'),
        gameNameDisplay: document.getElementById('game-name-display'),
        gameResult: document.getElementById('game-result'),
        resultMessage: document.getElementById('result-message'),
        rematchBtn: document.getElementById('rematch-btn'),
        newGameBtn: document.getElementById('new-game-btn'),
        chatMessages: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        sendChatBtn: document.getElementById('send-chat-btn'),
        gameTitle: document.getElementById('game-title'),
        gameStatus: document.getElementById('game-status'),
        playersInfo: document.getElementById('players-info')
    };
    
    console.log('Elements initialized:', window.elements);
}

function initializeGameBoard() {
    console.log('Initializing game board...');
    const board = window.elements.ticTacToeBoard;
    
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
        
        // Force visible styles
        cell.style.color = '#ffffff';
        cell.style.fontWeight = 'bold';
        cell.style.fontSize = '3rem';
        
        cell.addEventListener('click', () => {
            console.log(`Cell ${i} clicked. Current value: "${currentBoard[i]}"`);
            handleCellClick(i);
        });
        
        board.appendChild(cell);
    }
    
    console.log('Game board created with', board.children.length, 'cells');
    updateBoardDisplay();
}

function updateBoardDisplay() {
    console.log('Updating board display...');
    const board = window.elements.ticTacToeBoard;
    if (!board) return;
    
    const cells = board.querySelectorAll('.cell');
    
    cells.forEach((cell, index) => {
        const cellValue = currentBoard[index];
        console.log(`Cell ${index}: "${cellValue}"`);
        
        // Update cell text
        cell.textContent = cellValue;
        
        // Reset classes
        cell.className = 'cell';
        
        // Add symbol class for styling
        if (cellValue === 'X') {
            cell.classList.add('x');
            cell.style.color = '#ffc107'; // Yellow for X
        } else if (cellValue === 'O') {
            cell.classList.add('o');
            cell.style.color = '#0dcaf0'; // Cyan for O
        } else {
            cell.style.color = '#ffffff'; // White for empty
        }
        
        // Disable if not active
        if (!gameActive || !isMyTurn || cellValue) {
            cell.classList.add('disabled');
        } else {
            cell.classList.remove('disabled');
        }
    });
}

function handleCellClick(index) {
    console.log(`Cell ${index} clicked. Game active: ${gameActive}, My turn: ${isMyTurn}, Current value: "${currentBoard[index]}"`);
    
    if (!gameActive || !isMyTurn || currentBoard[index]) {
        console.log('Cannot make move');
        return;
    }
    
    if (socketClient && socketClient.currentGame) {
        console.log('Making move at index:', index);
        
        // Update local board immediately for visual feedback
        currentBoard[index] = mySymbol;
        updateBoardDisplay();
        
        // Send move to server
        socketClient.makeMove(socketClient.currentGame.id, index);
    }
}

// Simple Socket Client
class SimpleSocketClient {
    constructor() {
        console.log('Creating socket client...');
        try {
            this.socket = io();
            this.username = null;
            this.currentGame = null;
            
            this.socket.on('connect', () => {
                console.log('✅ Connected to server');
                updateConnectionStatus(true);
            });
            
            this.socket.on('disconnect', () => {
                console.log('❌ Disconnected');
                updateConnectionStatus(false);
            });
            
            this.socket.on('game-started', (game) => {
                console.log('🚀 Game started:', game);
                this.currentGame = game;
                showGameScreen(game);
            });
            
            this.socket.on('move-made', (data) => {
                console.log('🎮 Move received:', data);
                // Server will send correct move
            });
            
            this.socket.on('error', (error) => {
                console.error('Socket error:', error);
            });
            
        } catch (error) {
            console.error('Failed to create socket:', error);
        }
    }
    
    setUsername(username) {
        console.log('Setting username:', username);
        this.username = username;
        this.socket.emit('register-user', username);
    }
    
    createGame(gameName) {
        console.log('Creating game:', gameName);
        this.socket.emit('create-game', {
            host: this.username,
            name: gameName || `${this.username}'s Game`
        });
    }
    
    makeMove(gameId, cellIndex) {
        console.log('Sending move:', { gameId, cellIndex });
        this.socket.emit('make-move', {
            gameId,
            cellIndex,
            player: this.username
        });
    }
}

function initializeSocket() {
    console.log('Initializing socket...');
    socketClient = new SimpleSocketClient();
}

function setupEventListeners() {
    // Set username
    if (window.elements.setUsernameBtn) {
        window.elements.setUsernameBtn.addEventListener('click', () => {
            const username = window.elements.usernameInput.value.trim();
            if (username) {
                console.log('Setting username:', username);
                socketClient.setUsername(username);
                window.elements.usernameDisplay.textContent = username;
                window.elements.usernameSection.style.display = 'none';
                window.elements.createGameSection.style.display = 'block';
                window.elements.gamesListSection.style.display = 'block';
                
                // Update waiting screen
                window.elements.waitingScreen.innerHTML = `
                    <i class="bi bi-person-check display-1 text-success mb-3"></i>
                    <h4 class="mb-3 text-light">Welcome, ${username}!</h4>
                    <p class="text-muted">Create a game or join an existing one</p>
                `;
            }
        });
    }
    
    // Create game
    if (window.elements.createGameBtn) {
        window.elements.createGameBtn.addEventListener('click', () => {
            const gameName = window.elements.gameNameInput.value.trim() || 
                            `${socketClient.username}'s Game`;
            console.log('Creating game:', gameName);
            socketClient.createGame(gameName);
        });
    }
}

function showGameScreen(game) {
    console.log('Showing game screen...');
    
    if (window.elements.waitingScreen) {
        window.elements.waitingScreen.style.display = 'none';
    }
    
    if (window.elements.gameBoardContainer) {
        window.elements.gameBoardContainer.style.display = 'block';
    }
    
    if (window.elements.chatSection) {
        window.elements.chatSection.style.display = 'block';
    }
    
    if (window.elements.currentGameInfo) {
        window.elements.currentGameInfo.style.display = 'block';
    }
    
    if (window.elements.gamesListSection) {
        window.elements.gamesListSection.style.display = 'none';
    }
    
    if (window.elements.createGameSection) {
        window.elements.createGameSection.style.display = 'none';
    }
    
    // Update game info
    if (game && window.elements.gameNameDisplay) {
        window.elements.gameNameDisplay.textContent = game.name;
        window.elements.gameNameDisplay.style.color = '#ffffff';
    }
    
    if (window.elements.turnIndicator) {
        window.elements.turnIndicator.textContent = '✅ Your Turn (X)';
        window.elements.turnIndicator.style.color = '#ffffff';
    }
    
    // Activate game
    gameActive = true;
    mySymbol = 'X';
    isMyTurn = true;
    currentBoard = Array(9).fill('');
    
    // Force update board
    updateBoardDisplay();
    
    console.log('Game screen shown! Game active:', gameActive);
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.className = `status-indicator ${connected ? 'bg-success' : 'bg-danger'}`;
        console.log('Connection status:', connected ? 'connected' : 'disconnected');
    }
}