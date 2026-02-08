const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        // Ensure database directory exists
        const dbDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        const dbPath = path.join(dbDir, 'database.sqlite');
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                this.initializeDatabase();
            }
        });
    }

    initializeDatabase() {
        // Create users table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                games_played INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                draws INTEGER DEFAULT 0,
                win_rate REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create game_history table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS game_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT,
                player1 TEXT,
                player2 TEXT,
                winner TEXT,
                board_state TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player1) REFERENCES users(username),
                FOREIGN KEY (player2) REFERENCES users(username)
            )
        `);
    }

    registerUser(username) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR IGNORE INTO users (username) 
                VALUES (?)
            `;
            
            this.db.run(query, [username], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    getUserStats(username) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    username,
                    games_played as gamesPlayed,
                    wins,
                    losses,
                    draws,
                    win_rate as winRate
                FROM users 
                WHERE username = ?
            `;
            
            this.db.get(query, [username], (err, row) => {
                if (err) {
                    reject(err);
                } else if (!row) {
                    // Return default stats if user doesn't exist
                    resolve({
                        username,
                        gamesPlayed: 0,
                        wins: 0,
                        losses: 0,
                        draws: 0,
                        winRate: 0
                    });
                } else {
                    resolve(row);
                }
            });
        });
    }

    updateGameStats(player1, player2, winner) {
        return new Promise((resolve, reject) => {
            // Update player1 stats
            this.updatePlayerStats(player1, winner === player1 ? 'win' : winner === player2 ? 'loss' : 'draw');
            
            // Update player2 stats
            this.updatePlayerStats(player2, winner === player2 ? 'win' : winner === player1 ? 'loss' : 'draw');
            
            resolve();
        });
    }

    updatePlayerStats(username, result) {
        let updateQuery = '';
        
        switch (result) {
            case 'win':
                updateQuery = `
                    UPDATE users 
                    SET games_played = games_played + 1,
                        wins = wins + 1,
                        win_rate = ROUND((CAST(wins + 1 AS FLOAT) / (games_played + 1)) * 100, 2)
                    WHERE username = ?
                `;
                break;
            case 'loss':
                updateQuery = `
                    UPDATE users 
                    SET games_played = games_played + 1,
                        losses = losses + 1,
                        win_rate = ROUND((CAST(wins AS FLOAT) / (games_played + 1)) * 100, 2)
                    WHERE username = ?
                `;
                break;
            case 'draw':
                updateQuery = `
                    UPDATE users 
                    SET games_played = games_played + 1,
                        draws = draws + 1,
                        win_rate = ROUND((CAST(wins AS FLOAT) / (games_played + 1)) * 100, 2)
                    WHERE username = ?
                `;
                break;
        }
        
        this.db.run(updateQuery, [username]);
    }

    getLeaderboard(limit = 10) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    username,
                    games_played as gamesPlayed,
                    wins,
                    losses,
                    draws,
                    win_rate as winRate
                FROM users 
                WHERE games_played > 0
                ORDER BY win_rate DESC, wins DESC
                LIMIT ?
            `;
            
            this.db.all(query, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = Database;