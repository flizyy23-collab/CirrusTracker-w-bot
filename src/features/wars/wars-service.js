const { config } = require("../../core/config");

let pool;
const SNAPSHOT_INTERVAL = 6 * 60 * 60 * 1000; // Every 6 hours

function getPool() {
    if (pool) return pool;
    return require("../../core/database").getPool();
}

function initWars(dbPool) {
    pool = dbPool;
    createTable();
    // Initial snapshot after 15 seconds
    setTimeout(takeSnapshot, 15000);
    setInterval(takeSnapshot, SNAPSHOT_INTERVAL);
    console.log('Wars tracking initialized (snapshot every 6h)');
}

async function createTable() {
    try {
        await getPool().execute(`
            CREATE TABLE IF NOT EXISTS war_snapshots (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uuid VARCHAR(36) NOT NULL,
                username VARCHAR(16) NOT NULL,
                wars INT NOT NULL,
                snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_uuid (uuid),
                INDEX idx_snapshot_time (snapshot_time)
            );
        `);
    } catch (err) {
        console.error('Failed to create war_snapshots table:', err.message);
    }
}

async function takeSnapshot() {
    try {
        const guildTag = config.get("guild-tag");
        const res = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guildTag}`);
        if (!res.ok) return;

        const guild = await res.json();
        const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
        const values = [];
        const params = [];

        for (const rank of ranks) {
            const members = guild.members[rank];
            if (!members) continue;
            for (const [username, data] of Object.entries(members)) {
                const wars = data.globalData?.wars || 0;
                values.push('(?, ?, ?, NOW())');
                params.push(data.uuid, username, wars);
            }
        }

        if (values.length > 0) {
            await getPool().execute(
                `INSERT INTO war_snapshots (uuid, username, wars, snapshot_time) VALUES ${values.join(', ')}`,
                params
            );
        }
    } catch (err) {
        console.error('War snapshot error:', err.message);
    }
}

async function getPlayerWars(username, hours) {
    try {
        // Get latest snapshot for this player
        const [latest] = await getPool().execute(
            `SELECT wars, username FROM war_snapshots WHERE LOWER(username) = LOWER(?) ORDER BY snapshot_time DESC LIMIT 1`,
            [username]
        );
        if (latest.length === 0) return null;

        // Get oldest snapshot within the period
        const [oldest] = await getPool().execute(
            `SELECT wars FROM war_snapshots WHERE LOWER(username) = LOWER(?) AND snapshot_time >= DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY snapshot_time ASC LIMIT 1`,
            [username, hours]
        );

        const currentWars = latest[0].wars;
        const baseWars = oldest.length > 0 ? oldest[0].wars : currentWars;

        return {
            username: latest[0].username,
            total: currentWars,
            gained: currentWars - baseWars
        };
    } catch (err) {
        console.error('Failed to get player wars:', err.message);
        return null;
    }
}

async function getWarsLeaderboard(hours, limit = 10) {
    try {
        // Get latest snapshot per player
        const [latest] = await getPool().execute(
            `SELECT w1.uuid, w1.username, w1.wars 
             FROM war_snapshots w1
             INNER JOIN (SELECT uuid, MAX(snapshot_time) as max_time FROM war_snapshots GROUP BY uuid) w2
             ON w1.uuid = w2.uuid AND w1.snapshot_time = w2.max_time`
        );

        // Get oldest snapshot per player within the period
        const [oldest] = await getPool().execute(
            `SELECT w1.uuid, w1.wars 
             FROM war_snapshots w1
             INNER JOIN (SELECT uuid, MIN(snapshot_time) as min_time FROM war_snapshots WHERE snapshot_time >= DATE_SUB(NOW(), INTERVAL ? HOUR) GROUP BY uuid) w2
             ON w1.uuid = w2.uuid AND w1.snapshot_time = w2.min_time`,
            [hours]
        );

        const oldestMap = new Map();
        for (const row of oldest) {
            oldestMap.set(row.uuid, row.wars);
        }

        const results = [];
        for (const row of latest) {
            const base = oldestMap.get(row.uuid) || row.wars;
            const gained = row.wars - base;
            results.push({ username: row.username, total: row.wars, gained });
        }

        results.sort((a, b) => b.gained - a.gained);
        return results.filter(r => r.gained > 0).slice(0, limit);
    } catch (err) {
        console.error('Failed to get wars leaderboard:', err.message);
        return [];
    }
}

async function getAllTimeLeaderboard(limit = 10) {
    try {
        const [rows] = await getPool().execute(
            `SELECT w1.username, w1.wars 
             FROM war_snapshots w1
             INNER JOIN (SELECT uuid, MAX(snapshot_time) as max_time FROM war_snapshots GROUP BY uuid) w2
             ON w1.uuid = w2.uuid AND w1.snapshot_time = w2.max_time
             ORDER BY w1.wars DESC
             LIMIT ?`,
            [limit]
        );
        return rows;
    } catch (err) {
        console.error('Failed to get all-time wars leaderboard:', err.message);
        return [];
    }
}

async function getDailyWars(username, days) {
    try {
        const [rows] = await getPool().execute(
            `SELECT DATE(snapshot_time) as day, MIN(wars) as min_wars, MAX(wars) as max_wars
             FROM war_snapshots 
             WHERE LOWER(username) = LOWER(?) AND snapshot_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
             GROUP BY DATE(snapshot_time)
             ORDER BY day ASC`,
            [username, days]
        );

        // Calculate daily gains from snapshot differences
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
                gained: found ? (found.max_wars - found.min_wars) : 0
            });
        }
        return result;
    } catch (err) {
        console.error(`Failed to get daily wars for ${username}:`, err.message);
        return [];
    }
}

module.exports = { initWars, getPlayerWars, getWarsLeaderboard, getAllTimeLeaderboard, getDailyWars };
