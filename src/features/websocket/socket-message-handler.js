const { wsManager } = require('./websocket');
const { PACKET_TYPES } = require('./packets');

class SocketMessageHandler {
    static announceToClient(guildAlert, message) {
        console.log(`Broadcasting announcement: Guild Alert: ${guildAlert}, Message: ${message}`);
        
        const announcementData = {
            guild_alert: guildAlert,
            message: message,
            timestamp: Date.now()
        };

        wsManager.broadcast(PACKET_TYPES.CHAT_ANNOUNCEMENT, announcementData);
    }

    static sendDiscordMessageToClients(username, message, uuid, avatarUrl, rank) {
        console.log(`Broadcasting Discord message to clients from ${username}: ${message}`);
        
        const messageData = {
            username: username,
            message: message,
            timestamp: Date.now(),
            uuid: uuid,
            avatarUrl: avatarUrl,
            rank: rank
        };

        wsManager.broadcast(PACKET_TYPES.DISCORD_CHAT_MESSAGE, messageData);
    }
}

module.exports = { SocketMessageHandler };