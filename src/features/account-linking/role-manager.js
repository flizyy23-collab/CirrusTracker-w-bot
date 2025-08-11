const { config } = require('../../core/config');

class RoleManager {
    constructor() {
        this.linkedRoleId = null;
        this.guilds = new Map(); // Cache guild objects
        this.initialized = false;
        this.client = null; // Will be set by Discord bot
    }

    init(discordClient) {
        if (this.initialized) return;
        
        this.client = discordClient;
        
        // Get role ID from config
        this.linkedRoleId = config.get('account-linking.linked-role-id');
        
        // Cache guilds now that we have the client
        if (this.client && this.client.readyAt) {
            this.cacheGuilds();
            this.initialized = true;
        } else {
            console.warn('Discord client not ready for role manager initialization');
        }
    }

    cacheGuilds() {
        console.log(`Cached guilds for ${this.client.user.tag} (${this.client.user.id})`);
        this.client.guilds.cache.forEach(guild => {
            console.log(guild.id, guild.name);
            this.guilds.set(guild.id, guild);
        });
        console.log(`Cached ${this.guilds.size} Discord guilds for role management`);
    }

    /**
     * Add linked role to a Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Success status
     */
    async addLinkedRole(discordId) {
        if (!this.linkedRoleId) {
            console.log('No linked role ID configured, skipping role assignment');
            return true;
        }

        if (!this.initialized || !this.client) {
            console.warn('Role manager not initialized or client not available');
            return false;
        }

        try {
            // Try to find the user in any of the cached guilds
            for (const [guildId, guild] of this.guilds) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        await member.roles.add(this.linkedRoleId);
                        console.log(`Added linked role to user ${discordId} in guild ${guild.name}`);
                        return true;
                    }
                } catch (memberError) {
                    // User not in this guild, continue to next
                    continue;
                }
            }

            console.log(`User ${discordId} not found in any cached guilds`);
            return false;

        } catch (error) {
            console.error(`Error adding linked role to user ${discordId}:`, error);
            return false;
        }
    }

    /**
     * Remove linked role from a Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Success status
     */
    async removeLinkedRole(discordId) {
        if (!this.linkedRoleId) {
            console.log('No linked role ID configured, skipping role removal');
            return true;
        }

        if (!this.initialized || !this.client) {
            console.warn('Role manager not initialized or client not available');
            return false;
        }

        try {
            // Try to find the user in any of the cached guilds
            for (const [guildId, guild] of this.guilds) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        await member.roles.remove(this.linkedRoleId);
                        console.log(`Removed linked role from user ${discordId} in guild ${guild.name}`);
                        return true;
                    }
                } catch (memberError) {
                    // User not in this guild, continue to next
                    continue;
                }
            }

            console.log(`User ${discordId} not found in any cached guilds`);
            return false;

        } catch (error) {
            console.error(`Error removing linked role from user ${discordId}:`, error);
            return false;
        }
    }

    /**
     * Check if a user has the required role to use link commands
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Whether user has required role
     */
    async hasRequiredRole(discordId) {
        const requiredRoleId = config.get('account-linking.required-role-id');
        if (!requiredRoleId) {
            return true; // No required role configured, allow everyone
        }

        if (!this.initialized || !this.client) {
            console.warn('Role manager not initialized or client not available');
            return false;
        }

        try {
            // Try to find the user in any of the cached guilds
            for (const [guildId, guild] of this.guilds) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        return member.roles.cache.has(requiredRoleId);
                    }
                } catch (memberError) {
                    // User not in this guild, continue to next
                    continue;
                }
            }

            return false; // User not found in any guild

        } catch (error) {
            console.error(`Error checking required role for user ${discordId}:`, error);
            return false;
        }
    }

    /**
     * Get user display name for logging
     * @param {string} discordId - Discord user ID
     * @returns {Promise<string>} User display name or ID
     */
    async getUserDisplayName(discordId) {
        try {
            for (const [guildId, guild] of this.guilds) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        return member.displayName || member.user.username || discordId;
                    }
                } catch (memberError) {
                    continue;
                }
            }
            return discordId; // Fallback to ID if user not found
        } catch (error) {
            return discordId;
        }
    }
}

module.exports = new RoleManager();