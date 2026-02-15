const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'pastes.db'));

db.serialize(() => {
    // 1. Таблица паст (Обновленная структура с client_ip)
    db.run(`
        CREATE TABLE IF NOT EXISTS pastes (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            language TEXT DEFAULT 'text',
            client_ip TEXT,
            created_at INTEGER,
            expires_at INTEGER DEFAULT NULL, 
            burn_view_count INTEGER DEFAULT 0
        )
    `);

    // 2. Таблица забаненных IP (Новая)
    db.run(`
        CREATE TABLE IF NOT EXISTS blocked_ips (
            ip TEXT PRIMARY KEY,
            reason TEXT,
            banned_at INTEGER
        )
    `);
});

module.exports = {
    // Создание пасты: теперь принимает и сохраняет IP
    createPaste: (id, content, language = 'text', burnCount = 0, expiresAt = null, ip = 'unknown') => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO pastes (id, content, language, burn_view_count, expires_at, created_at, client_ip) VALUES (?, ?, ?, ?, ?, ?, ?)';
            const params = [id, content, language, burnCount, expiresAt, Date.now(), ip];
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    },

    // Получение пасты (для пользователя - с проверкой сжигания)
    getPaste: (id) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM pastes WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else if (!row) resolve(null);
                else {
                    // Проверка на истечение времени
                    if (row.expires_at && Date.now() > row.expires_at) {
                        db.run('DELETE FROM pastes WHERE id = ?', [id]);
                        resolve(null);
                    } else {
                        resolve(row);
                    }
                }
            });
        });
    },

    // Удаление пасты
    deletePaste: (id) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM pastes WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // --- ФУНКЦИИ АДМИНА ---

    // Получить статистику (общее количество)
    getStats: () => {
        return new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM pastes', (err, row) => {
                if(err) reject(err);
                else resolve(row);
            });
        });
    },

    // Получить список всех паст (с IP и превью)
    getAllPastesAdmin: () => {
        return new Promise((resolve, reject) => {
            // Берем последние 100, сортируем по новизне
            db.all('SELECT id, language, created_at, expires_at, client_ip, burn_view_count, substr(content, 1, 50) as preview FROM pastes ORDER BY created_at DESC LIMIT 100', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Получить полный контент для админа (без удаления/сжигания)
    getPasteContentAdmin: (id) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT content FROM pastes WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.content : null);
            });
        });
    },

    // Забанить IP
    banIP: (ip, reason = 'Spam') => {
        return new Promise((resolve, reject) => {
            db.run('INSERT OR IGNORE INTO blocked_ips (ip, reason, banned_at) VALUES (?, ?, ?)', [ip, reason, Date.now()], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // Проверить, забанен ли IP
    isBanned: (ip) => {
        return new Promise((resolve) => {
            db.get('SELECT ip FROM blocked_ips WHERE ip = ?', [ip], (err, row) => {
                resolve(!!row); // Вернет true если найден, false если нет
            });
        });
    },
    getBannedIPs: () => {
            return new Promise((resolve, reject) => {
                db.all('SELECT * FROM blocked_ips ORDER BY banned_at DESC', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        },

        // Разбанить IP
    unbanIP: (ip) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM blocked_ips WHERE ip = ?', [ip], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }    
};