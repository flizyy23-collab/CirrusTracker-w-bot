class PacketHandler {
    constructor() {
        this.packets = new Map();
        this.registerDefaultPackets();
    }

    registerPacket(packetType, handler) {
        this.packets.set(packetType, handler);
    }

    handlePacket(client, packet) {
        const handler = this.packets.get(packet.type);

        if (handler) return handler(client, packet);
        else throw new Error(`Unknown packet type: ${packet.type}`);
    }

    registerDefaultPackets() {

        // Ping packet
        this.registerPacket('ping', async (client, packet) => {
            return {
                type: 'pong',
                data: {
                    timestamp: Date.now(),
                    clientId: client.id
                }
            };
        });

        // Heartbeat packet
        this.registerPacket('heartbeat', async (client, packet) => {
            client.lastHeartbeat = Date.now();
            return null;
        });

        // Incoming chat message packet
        this.registerPacket('chat_message', async (client, packet) => {
            const { message, channel } = packet.data;
            
            return null;
        });

        // Connect to Wynncraft
        this.registerPacket('connect', async (client, packet) => {
            return {
                type: 'connect_ack',
                data: {
                    message: 'Connection acknowledged',
                    clientId: client.id,
                    timestamp: Date.now()
                }
            }
        });

        // Disconnect from Wynncraft
        this.registerPacket('disconnect', async (client, packet) => {
            client.shouldDisconnect = true;
            return {
                type: 'disconnect_ack',
                data: {
                    message: 'Disconnect acknowledged'
                }
            };
        });
    }
}

module.exports = { PacketHandler };