/**
 * WebSocket packet handlers for the WynnTracker server
 * Each function represents a specific packet type handler
 */

const PACKET_TYPES = {
    PING: 'ping',
    HEARTBEAT: 'heartbeat',
    CHAT_MESSAGE: 'chat_message',
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    PONG: 'pong',
    CONNECT_ACK: 'connect_ack',
    DISCONNECT_ACK: 'disconnect_ack'
};

const pingHandler = async (client, packet) => {
    return {
        type: PACKET_TYPES.PONG,
        data: {
            timestamp: Date.now(),
            clientId: client.id
        }
    };
};

const heartbeatHandler = async (client, packet) => {
    client.lastHeartbeat = Date.now();
    return null;
};

const chatMessageHandler = async (client, packet) => {
    const { message, channel } = packet.data;
    
    // TODO: Implement chat message handling logic
    // This could involve processing guild chat, parsing commands, etc.
    
    return null;
};

const connectHandler = async (client, packet) => {
    return {
        type: PACKET_TYPES.CONNECT_ACK,
        data: {
            message: 'Connection acknowledged',
            clientId: client.id,
            timestamp: Date.now()
        }
    };
};

const disconnectHandler = async (client, packet) => {
    client.shouldDisconnect = true;
    return {
        type: PACKET_TYPES.DISCONNECT_ACK,
        data: {
            message: 'Disconnect acknowledged'
        }
    };
};

// Map of packet types to their handlers
const PACKET_HANDLERS = {
    [PACKET_TYPES.PING]: pingHandler,
    [PACKET_TYPES.HEARTBEAT]: heartbeatHandler,
    [PACKET_TYPES.CHAT_MESSAGE]: chatMessageHandler,
    [PACKET_TYPES.CONNECT]: connectHandler,
    [PACKET_TYPES.DISCONNECT]: disconnectHandler
};

module.exports = {
    PACKET_TYPES,
    PACKET_HANDLERS,
    pingHandler,
    heartbeatHandler,
    chatMessageHandler,
    connectHandler,
    disconnectHandler
};