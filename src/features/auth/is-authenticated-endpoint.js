const {getToken, getAuthenticationStatus, validateToken} = require("./authentication");
const {getGuildRank, isPlayerInGuild} = require('../player/wynn-api');
const { config } = require("../../core/config");

// Rate limit auth check failure logs
const authCheckLogCooldowns = new Map();
const AUTH_CHECK_LOG_COOLDOWN = 60 * 1000; // 1 minute

class IsAuthenticatedEndpoint {

    async call(req, res) {
        if (!req.query.uuid) {
            return res.status(400).json({
                authenticated: false,
                error: "Missing UUID parameter"
            });
        }

        const {uuid} = req.query;

        try {
            const authStatus = getAuthenticationStatus(uuid);
            
            if (!authStatus.authenticated) {
                // Rate-limit the log message per UUID
                const now = Date.now();
                const lastLog = authCheckLogCooldowns.get(uuid);
                if (!lastLog || (now - lastLog) >= AUTH_CHECK_LOG_COOLDOWN) {
                    authCheckLogCooldowns.set(uuid, now);
                    console.log(`Authentication check failed for ${uuid}: ${authStatus.reason}`);
                }
                return res.status(401).json({
                    authenticated: false,
                    reason: authStatus.reason,
                    timestamp: new Date().toISOString()
                });
            }

            try {
                const { wsManager } = require('../websocket/websocket');
                const isConnectedViaWS = wsManager.uuidConnections.has(uuid);
                
                if (isConnectedViaWS) {
                    console.log(`UUID ${uuid} has active WebSocket connection, skipping additional validation`);
                    return res.status(200).json({
                        authenticated: true,
                        method: 'websocket_connection',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (wsError) {
            }

            const validationResult = await this.validatePlayerStatus(uuid);
            
            if (!validationResult.valid) {
                console.log(`Player status validation failed for ${uuid}: ${validationResult.reason}`);
                return res.status(403).json({
                    authenticated: false,
                    reason: validationResult.reason,
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(200).json({
                authenticated: true,
                token_created: authStatus.createdAt,
                last_validated: authStatus.lastValidated,
                method: 'token_validation',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`Error checking authentication for UUID ${uuid}:`, error);
            return res.status(500).json({
                authenticated: false,
                error: "Internal server error",
                timestamp: new Date().toISOString()
            });
        }
    }

    async validatePlayerStatus(uuid) {
        try {
            if (!await isPlayerInGuild(uuid)) {
                console.log(`Player ${uuid} is no longer in the guild`);
                return { valid: false, reason: 'Player not in guild' };
            }

            return { valid: true };

        } catch (error) {
            console.error(`Error validating player status for UUID ${uuid}:`, error);
            return { valid: false, reason: 'Validation error' };
        }
    }

    async validateTokenString(req, res) {
        const token = req.query.token || req.headers['authorization'] || req.headers['token'];
        
        if (!token) {
            return res.status(400).json({
                valid: false,
                error: "Missing token parameter"
            });
        }

        try {
            const validation = validateToken(token);
            
            if (!validation.valid) {
                return res.status(401).json({
                    valid: false,
                    reason: validation.reason,
                    timestamp: new Date().toISOString()
                });
            }

            const playerStatus = await this.validatePlayerStatus(validation.uuid);
            
            if (!playerStatus.valid) {
                return res.status(403).json({
                    valid: false,
                    reason: playerStatus.reason,
                    uuid: validation.uuid,
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(200).json({
                valid: true,
                uuid: validation.uuid,
                created_at: validation.createdAt,
                last_validated: validation.lastValidated,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`Error validating token string:`, error);
            return res.status(500).json({
                valid: false,
                error: "Internal server error",
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = { IsAuthenticatedEndpoint }