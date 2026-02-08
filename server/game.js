class GameManager {
    constructor(database) {
        this.games = new Map();
        this.db = database;
    }

    createGame(host, name) {
        const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const game = {
            id: gameId,
            name: name || `${host}'s Game`,
            host: host,
            players: [host],
            board: Array(9).fill(''),
            currentPlayer: 'X',
            status: 'waiting',
            winner: null,
            winningLine: null,
            createdAt: new Date().toISOString()
        };
        
        this.games.set(gameId, game);
        return game;
    }

    getGame(gameId) {
        return this.games.get(gameId);
    }

    removeGame(gameId) {
        this.games.delete(gameId);
    }

    getAvailableGames() {
        return Array.from(this.games.values())
            .filter(game => game.status === 'waiting' && game.players.length < 2)
            .map(game => ({
                id: game.id,
                name: game.name,
                host: game.host,
                players: game.players,
                status: game.status
            }));
    }

    checkWin(board) {
        const winningLines = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
            [0, 4, 8], [2, 4, 6]             // diagonals
        ];

        for (const line of winningLines) {
            const [a, b, c] = line;
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return { winner: board[a], line };
            }
        }

        // Check for draw
        if (board.every(cell => cell !== '')) {
            return { winner: 'draw', line: null };
        }

        return null;
    }
}

module.exports = GameManager;