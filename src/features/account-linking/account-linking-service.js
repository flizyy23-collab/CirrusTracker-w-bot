const crypto = require('crypto');
const { config } = require('../../core/config');
const { requestUUID } = require('../../core/utilities');
const { 
    createAccountLink, 
    verifyAccountLink, 
    getAccountLink, 
    getAccountLinkByMinecraft, 
    removeAccountLink, 
    removeAccountLinkByMinecraft,
    cleanupExpiredLinks
} = require('../../core/database');

class AccountLinkingService {
    constructor() {
        this.startCleanupTimer();
    }

    /**
     * Generate a secure random verification code
     * @returns {string} 6-character alphanumeric code
     */
    generateVerificationCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /**
     * Create a new account linking request
     * @param {string} discordId - Discord user ID
     * @param {string} minecraftUsername - Minecraft username
     * @returns {Object} { success: boolean, code?: string, error?: string }
     */
    async initiateLink(discordId, minecraftUsername) {
        try {
            // Check if Discord account is already linked
            const existingLink = await getAccountLink(discordId);
            if (existingLink) {
                return {
                    success: false,
                    error: 'Your Discord account is already linked to a Minecraft account. Use `/unlink` first.'
                };
            }

            // Validate and get Minecraft UUID and capitalized username
            const uuidAndName = await requestUUID(minecraftUsername);
            if (!uuidAndName) {
                return {
                    success: false,
                    error: 'Invalid Minecraft username. Please check the spelling and try again.'
                };
            }
            const { uuid: minecraftUuid, name: capitalizedMinecraftUsername } = uuidAndName;

            // Check if Minecraft account is already linked to another Discord account
            const existingMinecraftLink = await getAccountLinkByMinecraft(minecraftUuid);
            if (existingMinecraftLink) {
                return {
                    success: false,
                    error: 'This Minecraft account is already linked to another Discord account.'
                };
            }

            // Generate verification code and expiry
            const verificationCode = this.generateVerificationCode();
            const expiryMinutes = config.get('account-linking.verification-expiry-minutes') || 15;
            const now = new Date();
            const expiresAt = new Date(now.getTime() + (expiryMinutes * 60 * 1000));

            // Create the link in database
            const success = await createAccountLink(
                discordId, 
                minecraftUuid, 
                capitalizedMinecraftUsername, 
                verificationCode, 
                expiresAt
            );

            if (success) {
                return {
                    success: true,
                    code: verificationCode,
                    minecraftUsername: capitalizedMinecraftUsername,
                    expiryMinutes: expiryMinutes,
                    expiresAt: expiresAt
                };
            } else {
                return {
                    success: false,
                    error: 'Failed to create account link. Please try again.'
                };
            }

        } catch (err) {
            console.error('Error initiating account link:', err);
            return {
                success: false,
                error: 'An unexpected error occurred. Please try again later.'
            };
        }
    }

    /**
     * Verify an account link using the verification code
     * @param {string} verificationCode - The verification code
     * @returns {Object} { success: boolean, link?: Object, error?: string }
     */
    async verifyLink(verificationCode) {
        try {
            const link = await verifyAccountLink(verificationCode);
            
            if (link) {
                return {
                    success: true,
                    link: link
                };
            } else {
                return {
                    success: false,
                    error: 'Invalid or expired verification code.'
                };
            }
        } catch (err) {
            console.error('Error verifying account link:', err);
            return {
                success: false,
                error: 'An unexpected error occurred during verification.'
            };
        }
    }

    /**
     * Verify an account link using the verification code and UUID authentication
     * @param {string} verificationCode - The verification code
     * @param {string} authenticatedUuid - The UUID of the authenticated Minecraft player
     * @returns {Object} { success: boolean, link?: Object, error?: string }
     */
    async verifyLinkWithAuth(verificationCode, authenticatedUuid) {
        try {
            // First get the link without verifying it to check UUID match
            const { getUnverifiedAccountLink } = require('../../core/database');
            const unverifiedLink = await getUnverifiedAccountLink(verificationCode);
            
            if (!unverifiedLink) {
                return {
                    success: false,
                    error: 'Invalid or expired verification code.'
                };
            }

            // Verify that the authenticated UUID matches the one in the link BEFORE verifying
            if (unverifiedLink.minecraft_uuid !== authenticatedUuid) {
                return {
                    success: false,
                    error: 'Authentication token does not match the Minecraft account being linked.'
                };
            }

            // Now that we've verified the UUID matches, we can safely verify the link
            const link = await verifyAccountLink(verificationCode);
            
            if (!link) {
                return {
                    success: false,
                    error: 'Failed to verify account link.'
                };
            }

            return {
                success: true,
                link: link
            };
        } catch (err) {
            console.error('Error verifying account link with auth:', err);
            return {
                success: false,
                error: 'An unexpected error occurred during verification.'
            };
        }
    }

    /**
     * Get account link for a Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Object|null} Account link or null
     */
    async getLink(discordId) {
        try {
            return await getAccountLink(discordId);
        } catch (err) {
            console.error('Error getting account link:', err);
            return null;
        }
    }

    /**
     * Get account link for a Minecraft player
     * @param {string} minecraftUuid - Minecraft UUID
     * @returns {Object|null} Account link or null
     */
    async getLinkByMinecraft(minecraftUuid) {
        try {
            return await getAccountLinkByMinecraft(minecraftUuid);
        } catch (err) {
            console.error('Error getting account link by minecraft:', err);
            return null;
        }
    }

    /**
     * Remove account link by Discord ID
     * @param {string} discordId - Discord user ID
     * @returns {boolean} Success status
     */
    async unlinkByDiscord(discordId) {
        try {
            return await removeAccountLink(discordId);
        } catch (err) {
            console.error('Error unlinking by Discord:', err);
            return false;
        }
    }

    /**
     * Remove account link by Minecraft UUID
     * @param {string} minecraftUuid - Minecraft UUID
     * @returns {boolean} Success status
     */
    async unlinkByMinecraft(minecraftUuid) {
        try {
            return await removeAccountLinkByMinecraft(minecraftUuid);
        } catch (err) {
            console.error('Error unlinking by Minecraft:', err);
            return false;
        }
    }

    /**
     * Start the cleanup timer for expired links
     */
    startCleanupTimer() {
        // Clean up expired links every 10 minutes
        setInterval(async () => {
            try {
                const cleaned = await cleanupExpiredLinks();
                if (cleaned > 0) {
                    console.log(`Cleaned up ${cleaned} expired account linking requests`);
                }
            } catch (err) {
                console.error('Error during cleanup:', err);
            }
        }, 10 * 60 * 1000); // 10 minutes

        // Initial cleanup on startup
        setTimeout(async () => {
            try {
                const cleaned = await cleanupExpiredLinks();
                if (cleaned > 0) {
                    console.log(`Initial cleanup: removed ${cleaned} expired account linking requests`);
                }
            } catch (err) {
                console.error('Error during initial cleanup:', err);
            }
        }, 5000); // 5 seconds after startup
    }
}

module.exports = new AccountLinkingService();