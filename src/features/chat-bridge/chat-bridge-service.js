const { DiscordWebhook } = require('../../core/discord-webhook');
const { wsManager } = require('../websocket/websocket');
const { config } = require('../../core/config');
const accountLinkingService = require('../account-linking/account-linking-service');
const { rankService } = require('../ranks/rank-service');
const {requestUUID} = require("../../core/utilities");
const {analyzeAndFormatItems} = require("./encoded-item");
const emojiMap = require('./emoji-map.json');


class ChatBridgeService {
    constructor() {
        this.discordWebhook = new DiscordWebhook();
        this.messageCache = new Map();
        this.nickCache = new Map(); // nick → real IGN mapping
        this.cacheExpiry = 5000; // 5 seconds
        this.cleanupInterval = 30000; // 30 seconds

        this.config = config.get('chat-bridge');
        
        this.startCleanup();
    }

    setDiscordClient(client) {
        this.discordWebhook.setDiscordClient(client);
    }

    generateMessageHash(username, message, timestamp = null) {
        // Hash only by username+message — dedup window handled by cache expiry
        return `${username}:${message}`;
    }

    generateContentHash(message) {
        // Content-only hash to catch same message reported with different usernames (nick vs real name)
        return `content:${message}`;
    }

    isDuplicateMessage(username, message, timestamp = null) {
        const hash = this.generateMessageHash(username, message, timestamp);
        const contentHash = this.generateContentHash(message);
        
        if (this.messageCache.has(hash) || this.messageCache.has(contentHash)) {
            return true;
        }
        
        this.messageCache.set(hash, Date.now());
        this.messageCache.set(contentHash, Date.now());
        return false;
    }

    async handleMinecraftMessage(client, packet) {
        const { username, message, displayName, rawMessage } = packet.data;

        if (!username || !message) {
            console.warn('Invalid chat message packet: missing username or message');
            return null;
        }

        // Nick resolution: trust only the mod's hover text resolution (displayName ≠ username)
        let resolvedUsername = username;
        if (displayName && displayName !== username) {
            console.log(`Nick resolved: ${displayName} → ${username}`);
        }

        // Check dedup BEFORE any async calls to prevent race conditions
        if (this.isDuplicateMessage(resolvedUsername, message)) {
            console.log(`Duplicate message filtered: ${resolvedUsername}: ${message}`);
            return null;
        }

        // Block messages containing @ to prevent pings on Discord
        if (message.includes('@')) {
            console.log(`Blocked message with @: ${resolvedUsername}: ${message}`);
            return null;
        }

        // Server-side username filters (catches messages from old mod versions too)
        const userLower = resolvedUsername.toLowerCase();
        const filteredUsers = ['wynncraft', 'system', 'finder', 'old', 'new', 'best', 'commands', 'config', 'latest', 'elapsed', 'app', 'item', 'killed', 'time', 'chests', 'challenges', 'blacksmith', 'damage'];
        if (filteredUsers.includes(userLower)) {
            console.log(`Filtered system message from: ${resolvedUsername}`);
            return null;
        }
        if (userLower.includes('party') || userLower.includes('trade market') || userLower.includes('embodiment') || userLower.includes('key collector') || userLower.includes('the canyon colossus')) {
            console.log(`Filtered system message from: ${resolvedUsername}`);
            return null;
        }

        // Filter content patterns
        if (message.includes("can't identify this item") || message.includes('wynnmod') || message.toLowerCase().includes('modrinth') || /^Pinged\s*\(/.test(message)) {
            console.log(`Filtered system content: ${resolvedUsername}: ${message}`);
            return null;
        }

        // Filter raid timer summaries (e.g. "01:20.455 (3.8M) Slime Gathering: ...")
        if (/\d{2}:\d{2}\.\d{3}/.test(message)) {
            console.log(`Filtered raid timer: ${resolvedUsername}: ${message}`);
            return null;
        }

        // Filter location shares (party/mod)
        if (message.includes('My location is at')) {
            console.log(`Filtered location share: ${resolvedUsername}: ${message}`);
            return null;
        }

        // Filter usernames with spaces (MC usernames never have spaces — catches raid area names etc.)
        if (resolvedUsername.includes(' ')) {
            console.log(`Filtered multi-word username: ${resolvedUsername}: ${message}`);
            return null;
        }

        // Filter coordinate-only messages (likely /msg coords leaking) e.g. [123, 0, 132]
        if (/^\s*\[[\d\s,.-]+\]\s*$/.test(message)) {
            console.log(`Filtered coords message: ${resolvedUsername}: ${message}`);
            return null;
        }

        const uuidAndName = await requestUUID(resolvedUsername);
        const uuid = uuidAndName?.uuid || null;

        console.log(`Processing Minecraft message: ${resolvedUsername}: ${message}: ${uuid}`);
        
        let messageData = message;
        let success = false;

        // Fix URLs broken by Minecraft line wrapping (a space gets inserted at the wrap point)
        if (typeof messageData === 'string' && messageData.match(/https?:\/\//)) {
            let prev;
            do {
                prev = messageData;
                messageData = messageData.replace(/(https?:\/\/\S+)\s+(\S+)/g, (match, before, after) => {
                    // Merge if before ends mid-path (with / or incomplete segment) OR after has URL chars
                    const beforeEndsOpen = before.match(/[\/\.\-\_\~\+\%]$/) || before.match(/[=&?#]$/);
                    const afterHasUrlChars = after.match(/[\/\.\?\=\&\%\#\-]/);
                    if (beforeEndsOpen || afterHasUrlChars) {
                        return before + after;
                    }
                    return match;
                });
            } while (messageData !== prev);
        }

        // Check both rawMessage and regular message for item hashes
        const itemSource = (rawMessage && rawMessage.includes('\u{F0000}\u{F0100}')) ? rawMessage : message;
        if (itemSource.includes('\u{F0000}\u{F0100}')) {
            console.log(`Item hash detected in message from ${resolvedUsername}`);
            
            try {
                messageData = await analyzeAndFormatItems(itemSource);
                console.log(`Successfully processed item analysis for ${resolvedUsername}`);
            } catch (error) {
                console.error(`Error processing item hash from ${resolvedUsername}:`, error.message);
                console.log(`Falling back to original message for ${resolvedUsername}`);
            }
        }

        success = await this.discordWebhook.sendMinecraftSkinMessage(resolvedUsername, messageData, uuid);
        
        if (success) {
            console.log(`Bridged message to Discord from ${resolvedUsername}`);
        } else {
            console.error(`Failed to bridge message to Discord from ${resolvedUsername}`);
        }

        return {
            type: 'chat_message_ack',
            data: {
                success: success,
                timestamp: Date.now()
            }
        };
    }

    async handleDiscordMessage(author, content, channelId) {
        if (!this.config.enabled) return;
        
        if (channelId !== this.config['channel-id']) return;

        if (author.bot) return;

        // Check if the Discord user has a linked Minecraft account
        const accountLink = await accountLinkingService.getLink(author.id);
        if (!accountLink) {
            console.log(`Discord user ${author.username} (${author.id}) is not linked to a Minecraft account - message not bridged`);
            return;
        }

        // Use the linked Minecraft username instead of Discord username
        const minecraftUsername = accountLink.minecraft_username;
        const minecraftUuid = accountLink.minecraft_uuid;
        
        // Replace Discord custom emojis with Unicode chars for in-game rendering
        let message = content.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
            if (emojiMap[id]) return emojiMap[id].char;
            return `:${name}:`;
        });

        // Replace standard Unicode emojis with text names
        const unicodeEmojiMap = {
            '😭': ':sob:',
            '💀': ':skull:',
        };
        for (const [emoji, text] of Object.entries(unicodeEmojiMap)) {
            message = message.replaceAll(emoji, text);
        }

        // Get the user's rank information (optional - don't block bridge if rank not found)
        const userRank = await rankService.getMemberRank(author.id);
        let rank = userRank ? userRank.identifier : 'Member';

        console.log(`Processing Discord message from ${author.username} (linked as ${minecraftUsername}${userRank ? ` - ${userRank.identifier}` : ''}): ${message}`);

        const messageData = {
            type: 'discord_chat_message',
            data: {
                username: minecraftUsername,
                message: message,
                timestamp: Date.now(),
                uuid: minecraftUuid,
                avatarUrl: `https://crafatar.com/avatars/${minecraftUuid}?size=64&default=MHF_Steve&overlay`,
                rank: rank
            }
        };

        wsManager.broadcast(messageData.type, messageData.data);
        console.log(`Bridged message to Minecraft clients from ${minecraftUsername} (Discord: ${author.username}${userRank ? ` - ${userRank.identifier}` : ''})`);
        
    }

    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredEntries = [];
            
            for (const [hash, timestamp] of this.messageCache.entries()) {
                if (now - timestamp > this.cacheExpiry) {
                    expiredEntries.push(hash);
                }
            }
            
            expiredEntries.forEach(hash => this.messageCache.delete(hash));
            
            if (expiredEntries.length > 0) {
                console.log(`Cleaned up ${expiredEntries.length} expired message cache entries`);
            }
        }, this.cleanupInterval);
    }

    getStats() {
        return {
            cacheSize: this.messageCache.size,
            cacheExpiry: this.cacheExpiry,
            cleanupInterval: this.cleanupInterval
        };
    }
}

const chatBridge = new ChatBridgeService();

module.exports = { ChatBridgeService, chatBridge };