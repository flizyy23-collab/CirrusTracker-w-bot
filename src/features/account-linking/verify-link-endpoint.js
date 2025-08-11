const { config } = require('../../core/config');
const accountLinkingService = require('./account-linking-service');
const roleManager = require('./role-manager');
const { getToken } = require('../auth/authentication');

class VerifyLinkEndpoint {
    async call(req, res) {
        try {
            // Expect verification code and token as query parameters
            const { code, token, uuid } = req.query;

            if (!code) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing verification code'
                });
            }

            if (!token || !uuid) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing authentication token or UUID'
                });
            }

            // Verify the authentication token for this UUID
            const tokenObject = await getToken(uuid);
            if (!tokenObject || tokenObject.token !== token || !tokenObject.isAuthenticated()) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid or expired authentication token'
                });
            }

            // Verify the account link with additional UUID validation
            const result = await accountLinkingService.verifyLinkWithAuth(code, uuid);

            if (result.success) {
                // Try to assign linked role in Discord
                try {
                    await roleManager.addLinkedRole(result.link.discordId);
                } catch (roleError) {
                    console.error('Error assigning linked role:', roleError);
                    // Don't fail the verification if role assignment fails
                }

                return res.status(200).json({
                    success: true,
                    message: 'Account successfully linked!',
                    discord_id: result.link.discordId,
                    minecraft_username: result.link.minecraftUsername
                });
            } else {
                return res.status(400).json({
                    success: false,
                    error: result.error
                });
            }

        } catch (error) {
            console.error('Error in verify link endpoint:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }
}

module.exports = { VerifyLinkEndpoint };