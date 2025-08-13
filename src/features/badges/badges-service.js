const { badgeDefinitions } = require("./badges");
const { badgeCacheService } = require("./badge-cache");

class BadgesService {
    constructor() {
        this.badges = new Map();
        this.initializeBadges();
    }

    /**
     * Initialize badges service (call after database is ready)
     */
    async initialize() {
        try {
            await badgeCacheService.initialize();
            console.log('Badges service initialization completed');
        } catch (error) {
            console.error('Badges service initialization failed:', error);
            // Don't throw - allow server to continue
        }
    }

    registerBadge(id, config) {
        this.badges.set(id, {
            id,
            priority: config.priority || 0,
            condition: config.condition
        });
    }

    getAllBadges() {
        return Array.from(this.badges.values()).sort((a, b) => b.priority - a.priority);
    }

    getBadge(id) {
        return this.badges.get(id) || null;
    }

    async getPlayerBadges(uuid, playerData = null) {
        try {
            // Get badges from cache (instant response)
            const cachedBadgeIds = badgeCacheService.getPlayerBadges(uuid);
            
            // Convert badge IDs to full badge objects with priority
            const earnedBadges = cachedBadgeIds
                .map(badgeId => {
                    const badge = this.badges.get(badgeId);
                    return badge ? {
                        id: badge.id,
                        priority: badge.priority
                    } : null;
                })
                .filter(badge => badge !== null);

            return earnedBadges.sort((a, b) => b.priority - a.priority);
        } catch (error) {
            console.error('Error getting player badges:', error);
            return []; // Return empty array if cache fails
        }
    }

    /**
     * Force refresh badge cache
     */
    async refreshCache() {
        await badgeCacheService.updateCache();
    }

    /**
     * Get cache status
     */
    getCacheStatus() {
        return badgeCacheService.getCacheStatus();
    }

    initializeBadges() {
        for (const badgeDefinition of badgeDefinitions) this.registerBadge(badgeDefinition.id, badgeDefinition);

        console.log(`Badges service initialized with ${this.badges.size} badges`);
    }
}

const badgesService = new BadgesService();

module.exports = { BadgesService, badgesService };