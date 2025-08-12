const WebSocket = require('ws');
const crypto = require('crypto');
const { PacketHandler } = require('./packet-handler');
const { findUuidByToken } = require('../auth/authentication');

class WebSocketManager {
    constructor() {
        this.connections = new Map();
        this.uuidConnections = new Map();
        this.packetHandler = new PacketHandler();
        this.wss = null;
    }

    init(server) {
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws',
            perMessageDeflate: false
        });

        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        console.log('WebSocket server initialized');
    }

    handleConnection(ws, req) {
        const clientId = crypto.randomUUID();
        
        const token = req.headers['authorization'] || req.headers['token'] || req.url.split('token=')[1]?.split('&')[0];
        let uuid = null;

        if (token) {
            uuid = findUuidByToken(token);
            if (uuid) {
                console.log(`Authenticated connection for UUID: ${uuid}`);
            } else {
                console.warn(`Invalid token provided: ${token}`);
                ws.close(1008, 'Invalid authentication token');
                return;
            }
        } else {
            console.warn(`No token provided in connection headers`);
            ws.close(1008, 'Missing authentication token');
            return;
        }

        const clientInfo = {
            id: clientId,
            ws: ws,
            ip: req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            connectedAt: new Date(),
            uuid: uuid,
            token: token
        };

        this.connections.set(clientId, clientInfo);
        
        if (uuid) this.addUuidConnection(uuid, clientId);
        
        console.log(`Client connected: ${clientId} UUID: ${uuid || 'unauthenticated'} from ${clientInfo.ip}`);

        // Process any queued promotions for this client
        if (uuid) {
            const { rankService } = require('../ranks/rank-service');
            setTimeout(() => {
                rankService.processQueueForClient(uuid);
            }, 1000); // Small delay to ensure client is fully connected
        }

        //TODO: Change this
        this.sendMessage(ws, 'connection', {
            type: 'authenticated',
            clientId: clientId,
            uuid: uuid,
            timestamp: new Date().toISOString()
        });

        ws.on('message', (data) => {
            this.handleMessage(clientId, data);
        });

        ws.on('close', (code, reason) => {
            this.handleDisconnect(clientId, code, reason);
        });

        ws.on('error', (error) => {
            this.handleError(clientId, error);
        });

        ws.on('pong', () => {
            const client = this.connections.get(clientId);
            if (client) {
                client.lastPong = Date.now();
            }
        });
    }

    async handleMessage(clientId, data) {
        try {
            const packet = JSON.parse(data);
            const client = this.connections.get(clientId);
            
            if (!client) {
                console.warn(`Packet from unknown client: ${clientId}`);
                return;
            }

            console.log(`Packet from ${clientId} (${client.uuid || 'unauthenticated'}):`, packet);
            const response = await this.packetHandler.handlePacket(client, packet);
            
            if (response) this.sendMessage(client.ws, response.type, response.data);
        } catch (error) {
            console.error(`Error handling packet from ${clientId}:`, error);
            const client = this.connections.get(clientId);
            if (client) {
                this.sendError(client.ws, error.message || 'Packet handling error');
            }
        }
    }

    handleDisconnect(clientId, code, reason) {
        const client = this.connections.get(clientId);
        if (client) {
            console.log(`Client disconnected: ${clientId} UUID: ${client.uuid || 'unauthenticated'} (${code}: ${reason})`);
            if (client.uuid) this.removeUuidConnection(client.uuid, clientId);
            
            this.connections.delete(clientId);
        }
    }

    handleError(clientId, error) {
        console.error(`WebSocket error for client ${clientId}:`, error);
        const client = this.connections.get(clientId);
        if (client) {
            if (client.uuid) this.removeUuidConnection(client.uuid, clientId);
            
            client.ws.terminate();
            this.connections.delete(clientId);
        }
    }

    addUuidConnection(uuid, clientId) {
        if (!this.uuidConnections.has(uuid)) this.uuidConnections.set(uuid, new Set());
        this.uuidConnections.get(uuid).add(clientId);
        console.log(`UUID ${uuid} now has ${this.uuidConnections.get(uuid).size} connection(s)`);
    }

    removeUuidConnection(uuid, clientId) {
        if (this.uuidConnections.has(uuid)) {
            this.uuidConnections.get(uuid).delete(clientId);
            if (this.uuidConnections.get(uuid).size === 0) this.uuidConnections.delete(uuid);
        }
    }

    sendMessage(ws, type, data) {
        if (ws.readyState === WebSocket.OPEN) {
            const message = {
                type: type,
                data: data,
                timestamp: new Date().toISOString()
            };
            ws.send(JSON.stringify(message));
        }
    }

    sendError(ws, error) {
        this.sendMessage(ws, 'error', { message: error });
    }

    broadcast(type, data, filter = null) {
        const message = JSON.stringify({
            type: type,
            data: data,
            timestamp: new Date().toISOString()
        });

        this.connections.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                if (!filter || filter(client)) {
                    client.ws.send(message);
                }
            }
        });
    }

    sendToUuid(uuid, type, data) {
        const clientIds = this.uuidConnections.get(uuid);
        if (clientIds) {
            clientIds.forEach(clientId => {
                const client = this.connections.get(clientId);
                if (client && client.ws.readyState === WebSocket.OPEN) {
                    this.sendMessage(client.ws, type, data);
                }
            });
        }
    }

    disconnectUuid(uuid) {
       const clientIds = this.uuidConnections.get(uuid);
       clientIds.forEach(clientId => {
            const client = this.connections.get(clientId);
            if (client) {
                client.ws.close('Disconnected by server');
                this.connections.delete(clientId);
            }
       });
       this.uuidConnections.delete(uuid);
       console.log(`Disconnected all clients for UUID: ${uuid}`);
    }

    startHeartbeat() {
        setInterval(() => {
            this.connections.forEach((client, clientId) => {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.ping();
                } else {
                    this.connections.delete(clientId);
                }
            });
        }, 30000);
    }

    getConnectedClients() {
        return Array.from(this.connections.values()).map(client => ({
            id: client.id,
            ip: client.ip,
            connectedAt: client.connectedAt,
            authenticated: client.authenticated,
            uuid: client.uuid,
            playerStatus: client.playerStatus,
            location: client.location
        }));
    }

    getClientCount() {
        return this.connections.size;
    }

    getConnectedUuids() {
        return Array.from(this.uuidConnections.keys());
    }

    registerPacketHandler(type, handler) {
        this.packetHandler.registerPacket(type, handler);
    }
}

const wsManager = new WebSocketManager();

function websocketInit(server) {
    wsManager.init(server);
    wsManager.startHeartbeat();
    return wsManager;
}

module.exports = { websocketInit, wsManager };