const { getPool } = require("../../core/database");

const SNAPSHOT_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours
const MIN_GUILD_LEVEL = 80;
const BATCH_SIZE = 5;
const BATCH_DELAY = 1500; // 1.5s between batches

let snapshotInterval;

async function initGuildTracking() {
    console.log('Initializing guild tracking service...');
    await createTable();
    
    // First snapshot after 30s (let everything else start)
    setTimeout(() => takeSnapshot().catch(e => console.error('Guild snapshot failed:', e)), 30000);
    snapshotInterval = setInterval(() => takeSnapshot().catch(e => console.error('Guild snapshot failed:', e)), SNAPSHOT_INTERVAL);
}

async function createTable() {
    try {
        await getPool().execute(`
            CREATE TABLE IF NOT EXISTS guild_snapshots_tracking (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_prefix VARCHAR(10) NOT NULL,
                guild_name VARCHAR(50) NOT NULL,
                guild_level INT NOT NULL,
                wars INT DEFAULT 0,
                territories INT DEFAULT 0,
                online_members INT DEFAULT 0,
                total_members INT DEFAULT 0,
                total_raids INT DEFAULT 0,
                snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_prefix (guild_prefix),
                INDEX idx_snapshot_time (snapshot_time),
                INDEX idx_prefix_time (guild_prefix, snapshot_time)
            );
        `);
    } catch (e) {
        console.error('Failed to create guild_snapshots_tracking table:', e.message);
    }
}

async function takeSnapshot() {
    console.log('Taking guild snapshot...');
    
    try {
        // Get top guilds by level
        const res = await fetch('https://api.wynncraft.com/v3/leaderboards/guildLevel?resultLimit=200');
        if (!res.ok) {
            console.error('Failed to fetch guild level leaderboard');
            return;
        }
        const data = await res.json();
        
        // Filter to level 80+
        const guilds = Object.entries(data)
            .map(([pos, guild]) => guild)
            .filter(g => g.level >= MIN_GUILD_LEVEL);

        console.log(`Found ${guilds.length} guilds level ${MIN_GUILD_LEVEL}+, fetching details...`);

        let snapshotCount = 0;
        
        // Fetch each guild's details in batches
        for (let i = 0; i < guilds.length; i += BATCH_SIZE) {
            const batch = guilds.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(async (guild) => {
                    const r = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guild.prefix}`);
                    if (!r.ok) return null;
                    const g = await r.json();
                    
                    let online = 0;
                    let totalRaids = 0;
                    const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
                    for (const rank of ranks) {
                        const members = g.members[rank];
                        if (!members) continue;
                        for (const [, memberData] of Object.entries(members)) {
                            if (memberData.online) online++;
                            totalRaids += memberData.globalData?.guildRaids?.total || 0;
                        }
                    }

                    return {
                        prefix: g.prefix,
                        name: g.name,
                        level: g.level,
                        wars: g.wars || 0,
                        territories: g.territories || 0,
                        online,
                        total: g.members.total || 0,
                        totalRaids
                    };
                })
            );

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    const g = result.value;
                    try {
                        await getPool().execute(
                            `INSERT INTO guild_snapshots_tracking (guild_prefix, guild_name, guild_level, wars, territories, online_members, total_members, total_raids)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [g.prefix, g.name, g.level, g.wars, g.territories, g.online, g.total, g.totalRaids]
                        );
                        snapshotCount++;
                    } catch (e) {
                        console.error(`Failed to insert snapshot for ${g.prefix}:`, e.message);
                    }
                }
            }

            // Delay between batches
            if (i + BATCH_SIZE < guilds.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        console.log(`Guild snapshot complete: ${snapshotCount} guilds recorded`);

        // Cleanup old snapshots (keep last 30 days)
        await getPool().execute(`DELETE FROM guild_snapshots_tracking WHERE snapshot_time < DATE_SUB(NOW(), INTERVAL 30 DAY)`);

    } catch (error) {
        console.error('Guild snapshot error:', error.message);
    }
}

async function getGuildLeaderboard(type, days) {
    try {
        const column = type === 'wars' ? 'wars' : type === 'graids' ? 'total_raids' : 'online_members';

        if (days <= 0) {
            // All-time: latest snapshot for each guild
            const [rows] = await getPool().execute(
                `SELECT guild_prefix, guild_name, ${column} as value
                 FROM guild_snapshots_tracking gs1
                 WHERE snapshot_time = (SELECT MAX(snapshot_time) FROM guild_snapshots_tracking gs2 WHERE gs2.guild_prefix = gs1.guild_prefix)
                 ORDER BY ${column} DESC LIMIT 20`
            );
            return rows;
        }

        if (type === 'online') {
            // For online, use average over period
            const [rows] = await getPool().execute(
                `SELECT guild_prefix, guild_name, ROUND(AVG(online_members)) as value
                 FROM guild_snapshots_tracking
                 WHERE snapshot_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY guild_prefix, guild_name
                 ORDER BY value DESC LIMIT 20`,
                [days]
            );
            return rows;
        }

        // For wars/graids: get gain (latest - earliest in period)
        const [rows] = await getPool().execute(
            `SELECT 
                latest.guild_prefix, latest.guild_name,
                (latest.val - earliest.val) as value
             FROM (
                SELECT guild_prefix, guild_name, ${column} as val
                FROM guild_snapshots_tracking gs1
                WHERE snapshot_time = (SELECT MAX(snapshot_time) FROM guild_snapshots_tracking gs2 WHERE gs2.guild_prefix = gs1.guild_prefix)
             ) latest
             INNER JOIN (
                SELECT guild_prefix, ${column} as val
                FROM guild_snapshots_tracking gs1
                WHERE snapshot_time = (
                    SELECT MIN(snapshot_time) FROM guild_snapshots_tracking gs2 
                    WHERE gs2.guild_prefix = gs1.guild_prefix 
                    AND gs2.snapshot_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
                )
             ) earliest ON latest.guild_prefix = earliest.guild_prefix
             WHERE (latest.val - earliest.val) > 0
             ORDER BY value DESC LIMIT 20`,
            [days]
        );
        return rows;
    } catch (error) {
        console.error('Error getting guild leaderboard:', error.message);
        return [];
    }
}

function stopGuildTracking() {
    if (snapshotInterval) {
        clearInterval(snapshotInterval);
        snapshotInterval = null;
    }
}

module.exports = { initGuildTracking, getGuildLeaderboard, stopGuildTracking };
