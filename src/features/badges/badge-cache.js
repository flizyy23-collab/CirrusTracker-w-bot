const { getLeaderboard } = require("../../core/database");

class BadgeCacheService {
    constructor() {
        this.playerBadgeCache = new Map(); // Stores player badges by UUID
        this.leaderboardCache = new Map();
        this.isCalculating = false;
        this.isInitialized = false;
    }

    /**
     * Initialize the cache service (call after database is ready)
     */
    async initialize() {
        if (this.isInitialized) return;
        
        console.log('Initializing badge cache service...');
        try {
            await this.updateCache();


            // Set up periodic cache refresh (every 5 minutes)
            setInterval(() => this.updateCache(), 5 * 60 * 1000);
            
            this.isInitialized = true;
            console.log('Badge cache service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize badge cache service:', error);
            this.isInitialized = false;
        }
    }

    /**
     * Update badge cache
     */
    async updateCache() {
        if (this.isCalculating) return;
        
        this.isCalculating = true;
        try {
            console.log('Updating badge cache...');
            this.playerBadgeCache.clear();
            this.leaderboardCache.clear();
            
            // Process each raid leaderboard
            for (let raidId = -1; raidId <= 3; raidId++) {
                try {
                    const leaderboard = await getLeaderboard(raidId);
                    const leaderboardArray = Array.from(leaderboard.keys());
                    this.leaderboardCache.set(raidId, leaderboardArray);
                    
                    // Top 3 for each raid
                    for (let position = 0; position < 3 && position < leaderboardArray.length; position++) {
                        const uuid = leaderboardArray[position];
                        if (uuid) {
                            this.addPlayerBadge(uuid, this.getRaidBadgeId(raidId, position + 1));
                        }
                    }
                } catch (error) {
                    console.error(`Error caching leaderboard for raid ${raidId}:`, error);
                }
            }
            
            console.log('Badge cache updated successfully');
        } catch (error) {
            console.error('Error updating badge cache:', error);
        } finally {
            this.isCalculating = false;
        }
    }


    /**
     * Get raid badge ID based on raid and position
     */
    getRaidBadgeId(raidId, position) {
        const raidNames = ['NOTG', 'NOL', 'TCC', 'TNA'];
        if (raidId === -1) {
            return `ALL_TOP_${position}`;
        }
        const raidName = raidNames[raidId] || 'UNKNOWN';
        return `${raidName}_TOP_${position}`;
    }

    /**
     * Add a badge to a player's cache
     */
    addPlayerBadge(uuid, badgeId) {
        if (!this.playerBadgeCache.has(uuid)) {
            this.playerBadgeCache.set(uuid, []);
        }
        const playerBadges = this.playerBadgeCache.get(uuid);
        if (!playerBadges.includes(badgeId)) {
            playerBadges.push(badgeId);
        }
    }

    /**
     * Get cached badges for a player (instant response)
     */
    getPlayerBadges(uuid) {
        return this.playerBadgeCache.get(uuid) || [];
    }

    /**
     * Get cached leaderboard for a raid (instant response)
     */
    getCachedLeaderboard(raidId) {
        return this.leaderboardCache.get(raidId) || [];
    }
}

const badgeCacheService = new BadgeCacheService();

module.exports = { BadgeCacheService, badgeCacheService };