let pool;

function getPool() {
    if (pool) return pool;
    return require("../../core/database").getPool();
}

const onlinePlayers = new Map(); // username -> { loginTime, server }
const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

function initPlaytime(dbPool) {
    pool = dbPool;
    createTable();
    
    // On startup: close ALL unclosed sessions AND purge bad pre-fix data
    setTimeout(async () => {
        try {
            // Delete all bad data before the fix was deployed
            const [purged] = await getPool().execute(
                `DELETE FROM playtime_sessions WHERE login_time < '2026-06-26 00:00:00'`
            );
            if (purged.affectedRows > 0) {
                console.log(`Purged ${purged.affectedRows} pre-fix playtime sessions`);
            }
            
            // Close any unclosed sessions (prevents inflation from restarts)
            const [result] = await getPool().execute(
                `UPDATE playtime_sessions 
                 SET logout_time = NOW(), duration_minutes = LEAST(TIMESTAMPDIFF(MINUTE, login_time, NOW()), 1440)
                 WHERE logout_time IS NULL`
            );
            if (result.affectedRows > 0) {
                console.log(`Closed ${result.affectedRows} stale playtime sessions on startup`);
            }
        } catch (e) {
            console.error('Cleanup failed:', e.message);
        }
        
        // Start polling AFTER cleanup is done
        pollOnlineStatus();
        setInterval(pollOnlineStatus, POLL_INTERVAL);
    }, 15000);
    
    console.log('Playtime tracking initialized - global (polling every 2 min)');
}

async function createTable() {
    try {
        await getPool().execute(`
            CREATE TABLE IF NOT EXISTS playtime_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uuid VARCHAR(36) NOT NULL,
                username VARCHAR(16) NOT NULL,
                login_time TIMESTAMP NOT NULL,
                logout_time TIMESTAMP NULL DEFAULT NULL,
                duration_minutes INT DEFAULT NULL,
                server VARCHAR(10) DEFAULT NULL,
                INDEX idx_uuid (uuid),
                INDEX idx_username (username),
                INDEX idx_login_time (login_time),
                INDEX idx_logout_time (logout_time)
            );
        `);
        // Add username index if missing (migration)
        try {
            await getPool().execute(`ALTER TABLE playtime_sessions ADD INDEX IF NOT EXISTS idx_username (username)`);
        } catch (e) {}
    } catch (err) {
        console.error('Failed to create playtime_sessions table:', err.message);
    }
}

async function pollOnlineStatus() {
    try {
        const res = await fetch('https://api.wynncraft.com/v3/player');
        if (!res.ok) return;

        const data = await res.json();
        const currentlyOnline = new Set();

        // data.players is { username: "server", ... }
        for (const [username, server] of Object.entries(data.players || {})) {
            currentlyOnline.add(username);

            // New login detected
            if (!onlinePlayers.has(username)) {
                onlinePlayers.set(username, {
                    loginTime: new Date(),
                    server
                });
                await recordLogin(username, server);
            }
        }

        // Check for logouts
        for (const [username, info] of onlinePlayers.entries()) {
            if (!currentlyOnline.has(username)) {
                onlinePlayers.delete(username);
                await recordLogout(username);
            }
        }
    } catch (err) {
        console.error('Playtime poll error:', err.message);
    }
}

async function recordLogin(username, server) {
    try {
        await getPool().execute(
            `INSERT INTO playtime_sessions (uuid, username, login_time, server) VALUES (?, ?, NOW(), ?)`,
            [username, username, server || null]
        );
    } catch (err) {
        console.error(`Failed to record login for ${username}:`, err.message);
    }
}

async function recordLogout(username) {
    try {
        await getPool().execute(
            `UPDATE playtime_sessions 
             SET logout_time = NOW(), duration_minutes = TIMESTAMPDIFF(MINUTE, login_time, NOW())
             WHERE username = ? AND logout_time IS NULL
             ORDER BY login_time DESC LIMIT 1`,
            [username]
        );
    } catch (err) {
        console.error(`Failed to record logout for ${username}:`, err.message);
    }
}

async function getPlaytime(username, hours) {
    try {
        const [rows] = await getPool().execute(
            `SELECT 
                COALESCE(SUM(
                    CASE 
                        WHEN logout_time IS NULL THEN LEAST(TIMESTAMPDIFF(MINUTE, login_time, NOW()), 1440)
                        ELSE LEAST(duration_minutes, 1440)
                    END
                ), 0) as total_minutes,
                COUNT(*) as session_count
             FROM playtime_sessions 
             WHERE username = ? AND login_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
            [username, hours]
        );
        return rows[0];
    } catch (err) {
        console.error(`Failed to get playtime for ${username}:`, err.message);
        return { total_minutes: 0, session_count: 0 };
    }
}

async function getGuildPlaytimeLeaderboard(hours, limit = 10) {
    try {
        const { config } = require("../../core/config");
        const guildTag = config.get("guild-tag");
        
        const [rows] = await getPool().execute(
            `SELECT 
                ps.uuid, ps.username,
                COALESCE(SUM(
                    CASE 
                        WHEN ps.logout_time IS NULL THEN LEAST(TIMESTAMPDIFF(MINUTE, ps.login_time, NOW()), 1440)
                        ELSE LEAST(ps.duration_minutes, 1440)
                    END
                ), 0) as total_minutes,
                COUNT(*) as session_count
             FROM playtime_sessions ps
             INNER JOIN players p ON LOWER(ps.username) = LOWER(p.username)
             WHERE ps.login_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)
               AND p.guild = ?
             GROUP BY ps.uuid, ps.username
             ORDER BY total_minutes DESC
             LIMIT ?`,
            [hours, guildTag, limit]
        );
        return rows;
    } catch (err) {
        console.error('Failed to get playtime leaderboard:', err.message);
        return [];
    }
}

function getOnlineCount() {
    return onlinePlayers.size;
}

function getOnlinePlayers() {
    return [...onlinePlayers.entries()].map(([uuid, info]) => ({
        uuid,
        username: info.username,
        server: info.server,
        since: info.loginTime
    }));
}

async function getDailyPlaytime(username, days) {
    try {
        const [rows] = await getPool().execute(
            `SELECT 
                DATE(login_time) as day,
                COALESCE(SUM(
                    CASE 
                        WHEN logout_time IS NULL THEN LEAST(TIMESTAMPDIFF(MINUTE, login_time, NOW()), 1440)
                        ELSE LEAST(duration_minutes, 1440)
                    END
                ), 0) as total_minutes
             FROM playtime_sessions 
             WHERE username = ? AND login_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
             GROUP BY DATE(login_time)
             ORDER BY day ASC`,
            [username, days]
        );

        // Fill in missing days with 0
        const result = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const found = rows.find(r => {
                const rowDate = new Date(r.day).toISOString().split('T')[0];
                return rowDate === dateStr;
            });
            const dayLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            result.push({
                label: dayLabel,
                date: dateStr,
                minutes: found ? Math.min(found.total_minutes, 1440) : 0
            });
        }
        return result;
    } catch (err) {
        console.error(`Failed to get daily playtime for ${uuid}:`, err.message);
        return [];
    }
}

module.exports = { initPlaytime, getPlaytime, getGuildPlaytimeLeaderboard, getOnlineCount, getOnlinePlayers, getDailyPlaytime };
