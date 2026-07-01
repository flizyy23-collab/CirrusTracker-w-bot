const mysql = require('mysql2/promise');
const request = require('request');
const {getPlayerGuildInfo} = require("../features/player/wynn-api");
const { config } = require("./config");
const {removeToken} = require("../features/auth/authentication");
const {requestUsername} = require("./utilities");

let pool;

function databaseInit() {

    pool = mysql.createPool({
        host: config.get("sql.host"),
        port: config.get("sql.port") || 3306,
        user: config.get("sql.user"),
        password: config.get("sql.password"),
        database: config.get("sql.database"),
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        timezone: 'Z' // Force UTC timezone
    });

    createTables();
}

async function createTables() {
    try {
        const connection = await pool.getConnection();

        const createRaidTableQuery = `
            CREATE TABLE IF NOT EXISTS raids (
                id INT AUTO_INCREMENT PRIMARY KEY,
                raid INT NOT NULL,
                player_1 VARCHAR(36) NOT NULL,
                player_2 VARCHAR(36) NOT NULL,
                player_3 VARCHAR(36) NOT NULL,
                player_4 VARCHAR(36) NOT NULL,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reporter VARCHAR(36) NOT NULL,
                season_rating INT(5) DEFAULT 0 NOT NULL,
                guild_xp INT(11) DEFAULT 0 NOT NULL
            );
        `;

        await connection.execute(createRaidTableQuery);

        const createPlayerTableQuery = `
            CREATE TABLE IF NOT EXISTS players (
                uuid VARCHAR(36) NOT NULL PRIMARY KEY,
                username VARCHAR(16) NOT NULL,
                guild VARCHAR(4) DEFAULT NULL,
                guild_rank INT DEFAULT NULL,
                needs_aspects BOOLEAN DEFAULT 1 NOT NULL,
                discord_id VARCHAR(20) DEFAULT NULL,
                INDEX idx_discord_id (discord_id)
            );
        `;

        await connection.execute(createPlayerTableQuery);

        const createAspectTableQuery = `
            CREATE TABLE IF NOT EXISTS aspects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                giver VARCHAR(36) NOT NULL,
                receiver VARCHAR(36) NOT NULL,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reporter VARCHAR(36) NOT NULL
            );
        `;

        await connection.execute(createAspectTableQuery);

        const createAccountLinksTableQuery = `
            CREATE TABLE IF NOT EXISTS account_links (
                id INT AUTO_INCREMENT PRIMARY KEY,
                discord_id VARCHAR(20) NOT NULL,
                minecraft_uuid VARCHAR(36) NOT NULL,
                minecraft_username VARCHAR(16) NOT NULL,
                verification_code VARCHAR(10) NOT NULL,
                verified BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                verified_at TIMESTAMP NULL DEFAULT NULL,
                expires_at TIMESTAMP NOT NULL,
                UNIQUE KEY unique_discord (discord_id),
                UNIQUE KEY unique_minecraft (minecraft_uuid),
                INDEX idx_verification_code (verification_code),
                INDEX idx_verified (verified)
            );
        `;

        await connection.execute(createAccountLinksTableQuery);

        // Add discord_id column to players table if it doesn't exist
        try {
            await connection.execute(`
                ALTER TABLE players 
                ADD COLUMN IF NOT EXISTS discord_id VARCHAR(20) DEFAULT NULL,
                ADD INDEX IF NOT EXISTS idx_discord_id (discord_id);
            `);
        } catch (alterErr) {
            // Ignore errors if column already exists
            console.log("Discord_id column may already exist, continuing...");
        }

        // Add guild_rank column to players table if it doesn't exist
        try {
            await connection.execute(`
                ALTER TABLE players 
                ADD COLUMN IF NOT EXISTS guild_rank INT DEFAULT NULL;
            `);
        } catch (alterErr) {
            // Ignore errors if column already exists
            console.log("Guild_rank column may already exist, continuing...");
        }

        // Add owed_override column for manual aspect overrides
        try {
            await connection.execute(`
                ALTER TABLE players 
                ADD COLUMN IF NOT EXISTS owed_override FLOAT DEFAULT NULL;
            `);
        } catch (alterErr) {
            console.log("owed_override column may already exist, continuing...");
        }

        // Migrate existing verified links to players table
        try {
            const migrationQuery = `
                UPDATE players p
                INNER JOIN account_links al ON p.uuid = al.minecraft_uuid
                SET p.discord_id = al.discord_id
                WHERE al.verified = TRUE AND p.discord_id IS NULL;
            `;
            
            const [migrationResult] = await connection.execute(migrationQuery);
            if (migrationResult.affectedRows > 0) {
                console.log(`Migrated ${migrationResult.affectedRows} verified account links to players table`);
            }
        } catch (migrationErr) {
            console.log("Migration may have already been completed or no verified links exist");
        }

        // Create name_aliases table for tracking old/changed usernames
        try {
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS name_aliases (
                    old_name VARCHAR(30) NOT NULL PRIMARY KEY,
                    current_name VARCHAR(30) NOT NULL
                );
            `);
        } catch (aliasErr) {
            console.log("name_aliases table may already exist, continuing...");
        }

        // Create giveaways table
        try {
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS giveaways (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    channel_id VARCHAR(20) NOT NULL,
                    message_id VARCHAR(20) DEFAULT NULL,
                    host_id VARCHAR(20) NOT NULL,
                    title VARCHAR(256) NOT NULL,
                    prizes TEXT NOT NULL,
                    winner_count INT NOT NULL DEFAULT 1,
                    mode VARCHAR(20) NOT NULL DEFAULT 'equal',
                    allow_unlinked BOOLEAN DEFAULT TRUE,
                    weights TEXT DEFAULT '{}',
                    entries TEXT DEFAULT '[]',
                    winners TEXT DEFAULT '[]',
                    ends_at TIMESTAMP NOT NULL,
                    ended BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
        } catch (giveawayErr) {
            console.log("giveaways table may already exist, continuing...");
        }

        // Add new columns to giveaways if they don't exist
        try {
            await connection.execute(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'equal'`);
            await connection.execute(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS allow_unlinked BOOLEAN DEFAULT TRUE`);
            await connection.execute(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS weights TEXT DEFAULT '{}'`);
            await connection.execute(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS excluded TEXT DEFAULT '[]'`);
        } catch (e) {
            console.log("Giveaway columns may already exist, continuing...");
        }

        // Migration: make player_2/3/4 nullable and add player_count for variable-size raids
        try {
            await connection.execute(`ALTER TABLE raids MODIFY COLUMN player_2 VARCHAR(36) DEFAULT NULL`);
            await connection.execute(`ALTER TABLE raids MODIFY COLUMN player_3 VARCHAR(36) DEFAULT NULL`);
            await connection.execute(`ALTER TABLE raids MODIFY COLUMN player_4 VARCHAR(36) DEFAULT NULL`);
            await connection.execute(`ALTER TABLE raids ADD COLUMN IF NOT EXISTS player_count TINYINT NOT NULL DEFAULT 4`);
        } catch (e) {
            console.log("Raids columns may already be updated, continuing...");
        }

        // Migration: add weight_config column to giveaways
        try {
            await connection.execute(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS weight_config TEXT DEFAULT '{}'`);
        } catch (e) {
            console.log("Giveaway weight_config column may already exist, continuing...");
        }

        // Create world_events table for Annihilation event tracking
        try {
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS world_events (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    event_name VARCHAR(100) NOT NULL,
                    scheduled_time TIMESTAMP NOT NULL,
                    is_predicted BOOLEAN DEFAULT FALSE,
                    api_status VARCHAR(20) DEFAULT 'unknown',
                    last_api_check TIMESTAMP NULL DEFAULT NULL,
                    last_api_error TEXT DEFAULT NULL,
                    api_retry_count INT DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_event (event_name),
                    INDEX idx_scheduled_time (scheduled_time)
                );
            `);
        } catch (worldEventsErr) {
            console.log("world_events table may already exist, continuing...");
        }

        connection.release();
    } catch (err) {
        console.error("Error creating table: ", err);
    }
}

async function insertRaid(raid, players, reporter, seasonRating, guildXP) {
    try {
        const connection = await pool.getConnection();
        const playerCount = players.length;
        const p1 = players[0] || null;
        const p2 = players[1] || null;
        const p3 = players[2] || null;
        const p4 = players[3] || null;

        const insertQuery = `
            INSERT INTO raids (raid, player_1, player_2, player_3, player_4, player_count, reporter, season_rating, guild_xp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;

        await connection.execute(insertQuery, [raid, p1, p2, p3, p4, playerCount, reporter, seasonRating, guildXP]);

        // Increment owed_override by aspects per player (2 total / playerCount)
        const aspectsPerPlayer = 2 / playerCount;
        for (const playerUuid of players) {
            await connection.execute(
                `UPDATE players SET owed_override = owed_override + ? WHERE uuid = ? AND owed_override IS NOT NULL`,
                [aspectsPerPlayer, playerUuid]
            );
        }

        connection.release();
    } catch (err) {
        console.error("Error inserting raid: ", err);
    }
}

async function checkRecentRaidExists(raid, players) {
    try {
        const connection = await pool.getConnection();
        const playerCount = players.length;
        // Build conditions for each player slot
        let conditions = [`raid = ?`, `player_count = ?`];
        let params = [raid, playerCount];

        for (let i = 0; i < 4; i++) {
            if (i < playerCount) {
                conditions.push(`player_${i + 1} IN (${players.map(() => '?').join(', ')})`);
                params.push(...players);
            } else {
                conditions.push(`player_${i + 1} IS NULL`);
            }
        }
        conditions.push(`time > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`);

        const query = `SELECT id FROM raids WHERE ${conditions.join(' AND ')} LIMIT 1`;
        const [rows] = await connection.execute(query, params);
        connection.release();
        return rows.length > 0;
    } catch (err) {
        console.error("Error checking for recent raid: ", err);
        return false;
    }
}

async function insertAspect(giver, receiver, reporter) {
    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO aspects (giver, receiver, reporter)
            VALUES (?, ?, ?);
        `;

        await connection.execute(insertQuery, [giver, receiver, reporter]);

        // If player has an owed_override, decrement it by 1
        await connection.execute(
            `UPDATE players SET owed_override = owed_override - 1 WHERE uuid = ? AND owed_override IS NOT NULL`,
            [receiver]
        );

        connection.release();
    } catch (err) {
        console.error("Error inserting aspect: ", err);
    }
}

async function setAspects(receiverUuid, owedAmount, reporter) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            `UPDATE players SET owed_override = ? WHERE uuid = ?`,
            [owedAmount, receiverUuid]
        );
        connection.release();
        console.log(`Set owed_override for ${receiverUuid} to ${owedAmount} (by ${reporter})`);
    } catch (err) {
        console.error("Error setting aspects: ", err);
    }
}

async function checkForRecentRaid(player) {
    try {

        const query = `
            SELECT * FROM raids
            WHERE (player_1 = ? OR player_2 = ? OR player_3 = ? OR player_4 = ?)
            AND time > DATE_SUB(NOW(), INTERVAL 1 MINUTE);
        `;

        const [rows] = await connection.execute(query, [player, player, player, player]);
        connection.release();
        return rows.length > 0;
    } catch (err) {
        console.error("Error checking for recent raid: ", err);
    }

    return true;
}

async function getPlayerUUID(username) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT uuid FROM players
            WHERE username = ?;
        `;

        const [rows] = await connection.execute(query, [username]);
        connection.release();
        return rows[0].uuid;
    } catch (err) {
        return null;
    }
}

async function getPlayerUsername(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT username FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows[0].username;
    } catch (err) {
        return null;
    }
}

async function insertPlayer(uuid, username) {
    let { guild, guildRank } = await getPlayerGuildInfo(uuid);

    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO players (uuid, username, guild, guild_rank, needs_aspects)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE username = VALUES(username), guild = VALUES(guild), guild_rank = VALUES(guild_rank);
        `;

        await connection.execute(insertQuery, [uuid, username, guild, guildRank, 1]);
        connection.release();
    } catch (err) {
        console.error("Error inserting player: ", err);
    }
}

async function getGuild(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT guild FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows[0].guild;
    } catch (err) {
        console.error("Error getting player guild: ", err);
    }

    return null;
}

async function updateGuild(uuid) {
    let { guild, guildRank } = await getPlayerGuildInfo(uuid);
    
    const guildTag = config.get("guild-tag")

    if (!guild || guild !== guildTag) {
        removeToken(uuid);
    }

    try {
        const connection = await pool.getConnection();

        const updateQuery = `
            UPDATE players
            SET guild = ?, guild_rank = ?
            WHERE uuid = ?;
        `;

        await connection.execute(updateQuery, [guild, guildRank, uuid]);
        connection.release();
    } catch (err) {
        console.error("Error updating guild: ", err);
    }
}

async function updateUsername(uuid) {
    let username = await requestUsername(uuid);

    let previousUsername = await getPlayerUsername(uuid);
    if (username === previousUsername) return;

    try {
        const connection = await pool.getConnection();

        const updateQuery = `
            UPDATE players
            SET username = ?
            WHERE uuid = ?;
        `;

        await connection.execute(updateQuery, [username, uuid]);
        connection.release();
    } catch (err) {
        console.error("Error updating guild: ", err);
    }
}

async function getRaids(uuid, timestamp = null, endTimestamp = null) {
    try {
        const connection = await pool.getConnection();

        let query = `
            SELECT * FROM raids
            WHERE (player_1 = ? OR player_2 = ? OR player_3 = ? OR player_4 = ?)
        `;

        const params = [uuid, uuid, uuid, uuid];

        if (timestamp) {
            query += ` AND time > ?`;
            params.push(timestamp);
        }

        if (endTimestamp) {
            query += ` AND time < ?`;
            params.push(endTimestamp);
        }

        const [rows] = await connection.execute(query, params);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting raids: ", err);
    }

    return [];
}

async function getRaidCount(raidId = null, timestamp = null) {
    try {
        const connection = await pool.getConnection();
        
        let query = `SELECT COUNT(*) as count FROM raids`;
        const params = [];
        const conditions = [];
        
        if (raidId !== null) {
            conditions.push(`raid = ?`);
            params.push(raidId);
        }
        
        if (timestamp) {
            conditions.push(`time > ?`);
            params.push(timestamp);
        }
        
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }
        
        const [rows] = await connection.execute(query, params);
        
        connection.release();
        return rows[0].count;
    } catch (err) {
        console.error("Error getting raid count: ", err);
        return 0;
    }
}

async function getAspects(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM aspects
            WHERE receiver = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting aspects: ", err);
    }

    return [];
}

async function getOwedAspects() {

    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        const query = `
            SELECT * FROM players WHERE guild = ?;
        `;

        const [rows] = await connection.execute(query, [config.get("guild-tag")]);

        for (const row of rows) {
            let uuid = row.uuid;
            let needsAspects = row.needs_aspects;

            if (!needsAspects) continue;

            let owedAspects;
            if (row.owed_override !== null && row.owed_override !== undefined) {
                owedAspects = row.owed_override;
            } else {
                let aspects = await getAspects(uuid);
                let raids = await getRaids(uuid);
                let totalAspects = aspects.length;
                // Calculate owed based on actual player count per raid (2 aspects / playerCount)
                let earnedAspects = 0;
                for (const raid of raids) {
                    const playerCount = raid.player_count || 4;
                    earnedAspects += 2 / playerCount;
                }
                owedAspects = earnedAspects - totalAspects;
            }

            playerMap.set(uuid, owedAspects);
        }

        connection.release();


        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        return playerMap;
    } catch (err) {
        console.error("Error getting owed aspects: ", err);
    }

    return [];
}

async function getLeaderboard(raid, timestamp = null, endTimestamp = null) {
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        const query = `
            SELECT uuid FROM players;
        `;

        const [rows] = await connection.execute(query);

        for (const row of rows) {
            let uuid = row.uuid;
            let raids = await getRaids(uuid, timestamp, endTimestamp);

            let raidCount = 0;
            for (const raidRow of raids) {
                if (raid === -1 || raidRow.raid === raid) raidCount++;
            }

            playerMap.set(uuid, raidCount);
        }

        connection.release();

        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let leaderArray = [...playerMap.entries()];
        leaderArray = leaderArray.filter(([key, value]) => value > 0);
        playerMap = new Map(leaderArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting leaderboard: ", err);
    }

    return [];
}

async function getGXPLeaderboard(timestamp = null, endTimestamp = null) {
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        let query = `SELECT player_1, player_2, player_3, player_4, player_count, guild_xp FROM raids`;
        let params = [];
        const conditions = [];

        if (timestamp) {
            conditions.push(`time > ?`);
            params.push(timestamp);
        }
        if (endTimestamp) {
            conditions.push(`time < ?`);
            params.push(endTimestamp);
        }
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        const [rows] = await connection.execute(query, params);

        for (const row of rows) {
            const playerCount = row.player_count || 4;
            let guildXP = row.guild_xp / playerCount;

            if (row.player_1) playerMap.set(row.player_1, (playerMap.get(row.player_1) || 0) + guildXP);
            if (row.player_2) playerMap.set(row.player_2, (playerMap.get(row.player_2) || 0) + guildXP);
            if (row.player_3) playerMap.set(row.player_3, (playerMap.get(row.player_3) || 0) + guildXP);
            if (row.player_4) playerMap.set(row.player_4, (playerMap.get(row.player_4) || 0) + guildXP);
        }

        connection.release();

        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let leaderArray = [...playerMap.entries()];
        leaderArray = leaderArray.filter(([key, value]) => value > 0);
        playerMap = new Map(leaderArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting GXP leaderboard: ", err);
    }

    return [];
}


async function getPlayers() {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM players;
        `;

        const [rows] = await connection.execute(query);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting players: ", err);
    }

    return [];
}

async function getPlayersByGuild(guildTag) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM players WHERE guild = ?;
        `;

        const [rows] = await connection.execute(query, [guildTag]);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting players by guild: ", err);
    }

    return [];
}

async function toggleNeedsAspects(uuid) {
    try {
        const connection = await pool.getConnection();

        const updateQuery = `
            UPDATE players
            SET needs_aspects = NOT needs_aspects
            WHERE uuid = ?;
        `;

        await connection.execute(updateQuery, [uuid]);

        const selectQuery = `
            SELECT needs_aspects
            FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(selectQuery, [uuid]);
        connection.release();

        return rows[0];
    } catch (err) {
        console.error("Error toggling needs aspects: ", err);
        return null;
    }
}

// Account linking functions
async function createAccountLink(discordId, minecraftUuid, minecraftUsername, verificationCode, expiresAt) {
    try {
        const connection = await pool.getConnection();
        
        // Delete any existing unverified link for this discord user
        await connection.execute(
            'DELETE FROM account_links WHERE discord_id = ? AND verified = FALSE', 
            [discordId]
        );
        
        // Convert JavaScript Date to MySQL timestamp format
        const mysqlExpiresAt = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
        
        const insertQuery = `
            INSERT INTO account_links (discord_id, minecraft_uuid, minecraft_username, verification_code, expires_at)
            VALUES (?, ?, ?, ?, ?);
        `;
        
        await connection.execute(insertQuery, [discordId, minecraftUuid, minecraftUsername, verificationCode, mysqlExpiresAt]);
        connection.release();
        return true;
    } catch (err) {
        console.error("Error creating account link: ", err);
        return false;
    }
}

async function verifyAccountLink(verificationCode) {
    try {
        const connection = await pool.getConnection();
        
        // Check if code exists and hasn't expired
        const selectQuery = `
            SELECT * FROM account_links 
            WHERE verification_code = ? AND verified = FALSE AND expires_at > NOW();
        `;
        
        const [rows] = await connection.execute(selectQuery, [verificationCode]);
        
        if (rows.length === 0) {
            connection.release();
            return null; // Code not found or expired
        }
        
        const link = rows[0];
        
        // Update to verified
        const updateQuery = `
            UPDATE account_links 
            SET verified = TRUE, verified_at = UTC_TIMESTAMP() 
            WHERE id = ?;
        `;
        
        await connection.execute(updateQuery, [link.id]);
        
        // Add or update the player with discord_id
        await insertPlayer(link.minecraft_uuid, link.minecraft_username);
        
        const updatePlayerQuery = `
            UPDATE players 
            SET discord_id = ? 
            WHERE uuid = ?;
        `;
        
        await connection.execute(updatePlayerQuery, [link.discord_id, link.minecraft_uuid]);
        
        connection.release();
        
        return {
            discordId: link.discord_id,
            minecraftUuid: link.minecraft_uuid,
            minecraftUsername: link.minecraft_username
        };
    } catch (err) {
        console.error("Error verifying account link: ", err);
        return null;
    }
}

async function getAccountLink(discordId) {
    try {
        const connection = await pool.getConnection();
        
        const selectQuery = `
            SELECT p.uuid, p.username, p.guild, p.needs_aspects, p.discord_id, al.verified_at
            FROM players p
            LEFT JOIN account_links al ON p.uuid = al.minecraft_uuid AND al.verified = TRUE
            WHERE p.discord_id = ?;
        `;
        
        const [rows] = await connection.execute(selectQuery, [discordId]);
        connection.release();
        
        if (rows.length === 0) return null;
        
        const player = rows[0];
        return {
            discord_id: player.discord_id,
            minecraft_uuid: player.uuid,
            minecraft_username: player.username,
            verified: true,
            verified_at: player.verified_at
        };
    } catch (err) {
        console.error("Error getting account link: ", err);
        return null;
    }
}

async function getAccountLinkByMinecraft(minecraftUuid) {
    try {
        const connection = await pool.getConnection();
        
        const selectQuery = `
            SELECT p.uuid, p.username, p.guild, p.needs_aspects, p.discord_id
            FROM players p
            WHERE p.uuid = ? AND p.discord_id IS NOT NULL;
        `;
        
        const [rows] = await connection.execute(selectQuery, [minecraftUuid]);
        connection.release();
        
        if (rows.length === 0) return null;
        
        const player = rows[0];
        return {
            discord_id: player.discord_id,
            minecraft_uuid: player.uuid,
            minecraft_username: player.username,
            verified: true
        };
    } catch (err) {
        console.error("Error getting account link by minecraft: ", err);
        return null;
    }
}

async function getAccountLinkByUsername(username) {
    try {
        const connection = await pool.getConnection();
        
        const selectQuery = `
            SELECT p.uuid, p.username, p.guild, p.needs_aspects, p.discord_id, al.verified_at
            FROM players p
            LEFT JOIN account_links al ON p.uuid = al.minecraft_uuid AND al.verified = TRUE
            WHERE LOWER(p.username) = LOWER(?) AND p.discord_id IS NOT NULL;
        `;
        
        const [rows] = await connection.execute(selectQuery, [username]);
        connection.release();
        
        if (rows.length === 0) return null;
        
        const player = rows[0];
        return {
            discord_id: player.discord_id,
            minecraft_uuid: player.uuid,
            minecraft_username: player.username,
            verified: true,
            verified_at: player.verified_at
        };
    } catch (err) {
        console.error("Error getting account link by username: ", err);
        return null;
    }
}

async function removeAccountLink(discordId) {
    try {
        const connection = await pool.getConnection();
        
        // Remove from account_links table
        const deleteQuery = `
            DELETE FROM account_links WHERE discord_id = ?;
        `;
        
        await connection.execute(deleteQuery, [discordId]);
        
        // Clear discord_id from players table
        const updatePlayerQuery = `
            UPDATE players 
            SET discord_id = NULL 
            WHERE discord_id = ?;
        `;
        
        const [result] = await connection.execute(updatePlayerQuery, [discordId]);
        connection.release();
        
        return result.affectedRows > 0;
    } catch (err) {
        console.error("Error removing account link: ", err);
        return false;
    }
}

async function removeAccountLinkByMinecraft(minecraftUuid) {
    try {
        const connection = await pool.getConnection();
        
        // Remove from account_links table
        const deleteQuery = `
            DELETE FROM account_links WHERE minecraft_uuid = ?;
        `;
        
        await connection.execute(deleteQuery, [minecraftUuid]);
        
        // Clear discord_id from players table
        const updatePlayerQuery = `
            UPDATE players 
            SET discord_id = NULL 
            WHERE uuid = ?;
        `;
        
        const [result] = await connection.execute(updatePlayerQuery, [minecraftUuid]);
        connection.release();
        
        return result.affectedRows > 0;
    } catch (err) {
        console.error("Error removing account link by minecraft: ", err);
        return false;
    }
}

async function getUnverifiedAccountLink(verificationCode) {
    try {
        const connection = await pool.getConnection();
        
        // Get unverified link without marking it as verified
        const selectQuery = `
            SELECT * FROM account_links 
            WHERE verification_code = ? AND verified = FALSE AND expires_at > NOW();
        `;
        
        const [rows] = await connection.execute(selectQuery, [verificationCode]);
        connection.release();
        
        if (rows.length === 0) {
            return null; // Code not found or expired
        }
        
        return rows[0];
    } catch (err) {
        console.error("Error getting unverified account link: ", err);
        return null;
    }
}

async function cleanupExpiredLinks() {
    try {
        const connection = await pool.getConnection();
        
        const deleteQuery = `
            DELETE FROM account_links 
            WHERE verified = FALSE AND expires_at < NOW();
        `;
        
        const [result] = await connection.execute(deleteQuery);
        connection.release();
        
        return result.affectedRows;
    } catch (err) {
        console.error("Error cleaning up expired links: ", err);
        return 0;
    }
}

async function getPlayersWithVerifiedLinks() {
    try {
        const connection = await pool.getConnection();
        
        const query = `
            SELECT p.uuid, p.username, p.guild, p.needs_aspects, p.discord_id
            FROM players p
            WHERE p.discord_id IS NOT NULL;
        `;
        
        const [rows] = await connection.execute(query);
        connection.release();
        
        // Transform to match expected format
        return rows.map(row => ({
            ...row,
            minecraft_username: row.username
        }));
    } catch (err) {
        console.error("Error getting players with verified links: ", err);
        return [];
    }
}

async function getAccountLinksForPlayers(playerUuids) {
    try {
        if (playerUuids.length === 0) return {};
        
        const connection = await pool.getConnection();
        
        // Create placeholders for IN clause
        const placeholders = playerUuids.map(() => '?').join(',');
        
        const query = `
            SELECT uuid, discord_id, username
            FROM players 
            WHERE uuid IN (${placeholders}) AND discord_id IS NOT NULL;
        `;
        
        const [rows] = await connection.execute(query, playerUuids);
        connection.release();
        
        // Convert to map for quick lookup
        const linkMap = {};
        for (const row of rows) {
            linkMap[row.uuid] = {
                discord_id: row.discord_id,
                minecraft_username: row.username
            };
        }
        
        return linkMap;
    } catch (err) {
        console.error("Error getting account links for players: ", err);
        return {};
    }
}

async function getPlayerByDiscordId(discordId) {
    try {
        const connection = await pool.getConnection();
        
        const query = `
            SELECT * FROM players
            WHERE discord_id = ?;
        `;
        
        const [rows] = await connection.execute(query, [discordId]);
        connection.release();
        
        return rows[0] || null;
    } catch (err) {
        console.error("Error getting player by discord ID: ", err);
        return null;
    }
}

async function syncGuildMembers() {
    const guildName = config.get("guild-name") || "Cirrus";
    const guildTag = config.get("guild-tag");
    console.log(`Syncing guild members for ${guildName}...`);

    try {
        const token = config.get("wynncraft-token");
        const guildData = await new Promise((resolve, reject) => {
            const options = {
                url: `https://api.wynncraft.com/v3/guild/${guildName}`,
                headers: token && token !== "WYNNCRAFT_API_TOKEN" ? { Authorization: `Bearer ${token}` } : {}
            };
            request(options, (error, response, body) => {
                if (!error && response.statusCode === 200) resolve(JSON.parse(body));
                else reject(new Error(error ? error.message : `Status ${response.statusCode}`));
            });
        });

        const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
        let added = 0;
        for (const rank of ranks) {
            const members = guildData.members[rank];
            if (!members) continue;
            for (const [username, data] of Object.entries(members)) {
                try {
                    const connection = await pool.getConnection();
                    const [existing] = await connection.execute('SELECT uuid FROM players WHERE uuid = ?', [data.uuid]);
                    if (existing.length === 0) {
                        await connection.execute(
                            'INSERT INTO players (uuid, username, guild, guild_rank, needs_aspects) VALUES (?, ?, ?, ?, 1)',
                            [data.uuid, username, guildTag, ranks.indexOf(rank)]
                        );
                        added++;
                        console.log(`Added new guild member: ${username} (${data.uuid})`);
                    }
                    connection.release();
                } catch (err) {
                    console.error(`Error syncing member ${username}:`, err.message);
                }
            }
        }
        console.log(`Guild sync complete. Added ${added} new members.`);
    } catch (err) {
        console.error("Error syncing guild members:", err.message);
    }
}

// Fetch current guild members live from Wynncraft API (not DB)
async function fetchLiveGuildMembers() {
    const guildName = config.get("guild-name") || "Cirrus";
    try {
        const token = config.get("wynncraft-token");
        const guildData = await new Promise((resolve, reject) => {
            const options = {
                url: `https://api.wynncraft.com/v3/guild/${guildName}`,
                headers: token && token !== "WYNNCRAFT_API_TOKEN" ? { Authorization: `Bearer ${token}` } : {}
            };
            request(options, (error, response, body) => {
                if (!error && response.statusCode === 200) resolve(JSON.parse(body));
                else reject(new Error(error ? error.message : `Status ${response.statusCode}`));
            });
        });

        const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
        const members = [];
        for (const rank of ranks) {
            const rankMembers = guildData.members[rank];
            if (!rankMembers) continue;
            for (const [username, data] of Object.entries(rankMembers)) {
                members.push({ username, uuid: data.uuid, rank });
            }
        }
        return members;
    } catch (err) {
        console.error("Error fetching live guild members:", err.message);
        return [];
    }
}

async function addAlias(oldName, currentName) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            `INSERT INTO name_aliases (old_name, current_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE current_name = ?`,
            [oldName.toLowerCase(), currentName, currentName]
        );
        connection.release();
        return true;
    } catch (err) {
        console.error("Error adding alias:", err.message);
        return false;
    }
}

async function removeAlias(oldName) {
    try {
        const connection = await pool.getConnection();
        const [result] = await connection.execute(
            `DELETE FROM name_aliases WHERE old_name = ?`,
            [oldName.toLowerCase()]
        );
        connection.release();
        return result.affectedRows > 0;
    } catch (err) {
        console.error("Error removing alias:", err.message);
        return false;
    }
}

async function resolveAlias(name) {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(
            `SELECT current_name FROM name_aliases WHERE old_name = ?`,
            [name.toLowerCase()]
        );
        connection.release();
        return rows.length > 0 ? rows[0].current_name : null;
    } catch (err) {
        return null;
    }
}

async function getAliases() {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`SELECT old_name, current_name FROM name_aliases ORDER BY old_name`);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting aliases:", err.message);
        return [];
    }
}

// ---- Giveaway functions ----

async function createGiveaway(channelId, hostId, title, prizes, winnerCount, endsAt, mode = 'equal', allowUnlinked = true) {
    try {
        const connection = await pool.getConnection();
        const [result] = await connection.execute(
            `INSERT INTO giveaways (channel_id, host_id, title, prizes, winner_count, ends_at, mode, allow_unlinked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [channelId, hostId, title, JSON.stringify(prizes), winnerCount, endsAt, mode, allowUnlinked]
        );
        connection.release();
        return result.insertId;
    } catch (err) {
        console.error("Error creating giveaway:", err);
        return null;
    }
}

async function setGiveawayMessageId(giveawayId, messageId) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(`UPDATE giveaways SET message_id = ? WHERE id = ?`, [messageId, giveawayId]);
        connection.release();
    } catch (err) {
        console.error("Error setting giveaway message_id:", err);
    }
}

async function getGiveaway(giveawayId) {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
        connection.release();
        if (rows.length === 0) return null;
        const g = rows[0];
        g.entries = JSON.parse(g.entries || '[]');
        g.prizes = JSON.parse(g.prizes || '[]');
        g.winners = JSON.parse(g.winners || '[]');
        g.weights = JSON.parse(g.weights || '{}');
        g.excluded = JSON.parse(g.excluded || '[]');
        g.weight_config = JSON.parse(g.weight_config || '{}');
        return g;
    } catch (err) {
        console.error("Error getting giveaway:", err);
        return null;
    }
}

async function getGiveawayByMessageId(messageId) {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`SELECT * FROM giveaways WHERE message_id = ?`, [messageId]);
        connection.release();
        if (rows.length === 0) return null;
        const g = rows[0];
        g.entries = JSON.parse(g.entries || '[]');
        g.prizes = JSON.parse(g.prizes || '[]');
        g.winners = JSON.parse(g.winners || '[]');
        g.weights = JSON.parse(g.weights || '{}');
        g.excluded = JSON.parse(g.excluded || '[]');
        g.weight_config = JSON.parse(g.weight_config || '{}');
        return g;
    } catch (err) {
        console.error("Error getting giveaway by message:", err);
        return null;
    }
}

async function getGiveawayByTitle(title) {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`SELECT * FROM giveaways WHERE title = ? ORDER BY id DESC LIMIT 1`, [title]);
        connection.release();
        if (rows.length === 0) return null;
        const g = rows[0];
        g.entries = JSON.parse(g.entries || '[]');
        g.prizes = JSON.parse(g.prizes || '[]');
        g.winners = JSON.parse(g.winners || '[]');
        g.weights = JSON.parse(g.weights || '{}');
        g.excluded = JSON.parse(g.excluded || '[]');
        g.weight_config = JSON.parse(g.weight_config || '{}');
        return g;
    } catch (err) {
        console.error("Error getting giveaway by title:", err);
        return null;
    }
}

async function addGiveawayEntry(giveawayId, userId) {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`SELECT entries FROM giveaways WHERE id = ? AND ended = FALSE`, [giveawayId]);
        if (rows.length === 0) { connection.release(); return false; }
        const entries = JSON.parse(rows[0].entries || '[]');
        if (entries.includes(userId)) { connection.release(); return false; }
        entries.push(userId);
        await connection.execute(`UPDATE giveaways SET entries = ? WHERE id = ?`, [JSON.stringify(entries), giveawayId]);
        connection.release();
        return true;
    } catch (err) {
        console.error("Error adding giveaway entry:", err);
        return false;
    }
}

async function endGiveaway(giveawayId, winners) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            `UPDATE giveaways SET ended = TRUE, winners = ? WHERE id = ?`,
            [JSON.stringify(winners), giveawayId]
        );
        connection.release();
    } catch (err) {
        console.error("Error ending giveaway:", err);
    }
}

async function updateGiveawayWeights(giveawayId, weights) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(`UPDATE giveaways SET weights = ? WHERE id = ?`, [JSON.stringify(weights), giveawayId]);
        connection.release();
    } catch (err) {
        console.error("Error updating giveaway weights:", err);
    }
}

async function setGiveawayEntries(giveawayId, entries) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(`UPDATE giveaways SET entries = ? WHERE id = ?`, [JSON.stringify(entries), giveawayId]);
        connection.release();
    } catch (err) {
        console.error("Error setting giveaway entries:", err);
    }
}

async function setGiveawayExcluded(giveawayId, excluded) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(`UPDATE giveaways SET excluded = ? WHERE id = ?`, [JSON.stringify(excluded), giveawayId]);
        connection.release();
    } catch (err) {
        console.error("Error setting giveaway excluded:", err);
    }
}

async function setGiveawayWeightConfig(giveawayId, weightConfig) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(`UPDATE giveaways SET weight_config = ? WHERE id = ?`, [JSON.stringify(weightConfig), giveawayId]);
        connection.release();
    } catch (err) {
        console.error("Error setting giveaway weight config:", err);
    }
}

async function getActiveGiveaways() {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`SELECT * FROM giveaways WHERE ended = FALSE`);
        connection.release();
        return rows.map(g => {
            g.entries = JSON.parse(g.entries || '[]');
            g.prizes = JSON.parse(g.prizes || '[]');
            g.winners = JSON.parse(g.winners || '[]');
            g.weights = JSON.parse(g.weights || '{}');
            g.excluded = JSON.parse(g.excluded || '[]');
            g.weight_config = JSON.parse(g.weight_config || '{}');
            return g;
        });
    } catch (err) {
        console.error("Error getting active giveaways:", err);
        return [];
    }
}

module.exports = { pool, getPool: () => pool, databaseInit, insertRaid, insertAspect, setAspects, getGXPLeaderboard, getPlayerUUID,
    getPlayerUsername, insertPlayer, getRaids, getRaidCount, getAspects, getOwedAspects, getLeaderboard, updateGuild, updateUsername, getPlayers, getPlayersByGuild, getGuild, toggleNeedsAspects,
    createAccountLink, verifyAccountLink, getAccountLink, getAccountLinkByMinecraft, getAccountLinkByUsername, removeAccountLink, removeAccountLinkByMinecraft, getUnverifiedAccountLink, cleanupExpiredLinks, getPlayersWithVerifiedLinks, getAccountLinksForPlayers, getPlayerByDiscordId, syncGuildMembers, fetchLiveGuildMembers,
    addAlias, removeAlias, resolveAlias, getAliases, checkRecentRaidExists,
    createGiveaway, setGiveawayMessageId, getGiveaway, getGiveawayByMessageId, getGiveawayByTitle, addGiveawayEntry, endGiveaway, getActiveGiveaways, updateGiveawayWeights, setGiveawayEntries, setGiveawayExcluded, setGiveawayWeightConfig,
    getWorldEvent, setWorldEvent, updateWorldEventStatus, logWorldEventError };

async function getWorldEvent(eventName) {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`SELECT * FROM world_events WHERE event_name = ?`, [eventName]);
        connection.release();
        return rows[0] || null;
    } catch (err) {
        console.error("Error getting world event:", err);
        return null;
    }
}

async function setWorldEvent(eventName, scheduledTime, isPredicted = false) {
    try {
        const connection = await pool.getConnection();
        // First try to get existing event
        const [existing] = await connection.execute(`SELECT id FROM world_events WHERE event_name = ?`, [eventName]);
        
        if (existing.length > 0) {
            // Update existing
            await connection.execute(
                `UPDATE world_events SET scheduled_time = ?, is_predicted = ?, updated_at = CURRENT_TIMESTAMP WHERE event_name = ?`,
                [scheduledTime, isPredicted, eventName]
            );
        } else {
            // Insert new
            await connection.execute(
                `INSERT INTO world_events (event_name, scheduled_time, is_predicted, api_status) VALUES (?, ?, ?, 'pending')`,
                [eventName, scheduledTime, isPredicted]
            );
        }
        connection.release();
    } catch (err) {
        console.error("Error setting world event:", err);
    }
}

async function updateWorldEventStatus(eventName, status) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            `UPDATE world_events SET api_status = ?, last_api_check = CURRENT_TIMESTAMP, api_retry_count = 0, last_api_error = NULL WHERE event_name = ?`,
            [status, eventName]
        );
        connection.release();
    } catch (err) {
        console.error("Error updating world event status:", err);
    }
}

async function logWorldEventError(eventName, error) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            `UPDATE world_events SET last_api_check = CURRENT_TIMESTAMP, api_retry_count = api_retry_count + 1, last_api_error = ? WHERE event_name = ?`,
            [error.substring(0, 500), eventName]
        );
        connection.release();
    } catch (err) {
        console.error("Error logging world event error:", err);
    }
}
