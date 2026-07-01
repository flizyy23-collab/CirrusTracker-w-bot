const { ChannelType, PermissionFlagsBits } = require('discord.js');

class TempVCService {
    constructor() {
        this.activeChannels = new Map(); // channelId -> { ownerId, createdAt }
        this.joinChannelId = '1517948466419204379';
        this.categoryId = '1517949278385864844';
        this.blockedWords = ['nigger', 'nigga', 'faggot', 'fag', 'retard', 'kys', 'niger', 'bitch', 'niga'];
    }

    setDiscordClient(client) {
        this.client = client;
        this.setupListeners();
        console.log('Temp VC service initialized');
    }

    isNameAllowed(name) {
        const lower = name.toLowerCase();
        return !this.blockedWords.some(word => lower.includes(word));
    }

    setupListeners() {
        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            // User joined the "Join to Create" channel
            if (newState.channelId === this.joinChannelId && oldState.channelId !== this.joinChannelId) {
                // Check if user has the required role
                if (!newState.member.roles.cache.has('1459228727341744273')) {
                    try {
                        await newState.disconnect();
                    } catch (e) {}
                    return;
                }
                await this.createTempVC(newState);
            }

            // User left a voice channel (disconnected or moved)
            if (oldState.channelId && oldState.channelId !== newState.channelId && this.activeChannels.has(oldState.channelId)) {
                console.log(`User left temp VC ${oldState.channelId}, checking if empty...`);
                setTimeout(async () => {
                    try {
                        const channel = await this.client.channels.fetch(oldState.channelId).catch(() => null);
                        if (!channel) {
                            this.activeChannels.delete(oldState.channelId);
                            return;
                        }
                        console.log(`Temp VC ${oldState.channelId} has ${channel.members.size} members`);
                        if (channel.members.size === 0) {
                            await this.deleteTempVC(oldState.channelId);
                        }
                    } catch (e) {
                        console.error('Error checking temp VC:', e.message);
                        this.activeChannels.delete(oldState.channelId);
                    }
                }, 2000);
            }
        });

        // Handle channel updates (rename) to check blocked words
        this.client.on('channelUpdate', async (oldChannel, newChannel) => {
            if (!this.activeChannels.has(newChannel.id)) return;
            if (oldChannel.name === newChannel.name) return;

            if (!this.isNameAllowed(newChannel.name)) {
                const vcData = this.activeChannels.get(newChannel.id);
                try {
                    await newChannel.setName(`${newChannel.guild.members.cache.get(vcData.ownerId)?.displayName || 'User'}'s VC`);
                    console.log(`Blocked inappropriate VC name: "${newChannel.name}"`);
                } catch (e) {
                    console.error('Error reverting VC name:', e.message);
                }
            }
        });
    }

    async createTempVC(voiceState) {
        try {
            const member = voiceState.member;
            const guild = voiceState.guild;

            const channel = await guild.channels.create({
                name: `${member.displayName}'s VC`,
                type: ChannelType.GuildVoice,
                parent: this.categoryId,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.Connect],
                    },
                    {
                        id: '1459228727341744273',
                        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.MuteMembers,
                            PermissionFlagsBits.DeafenMembers,
                            PermissionFlagsBits.MoveMembers,
                            PermissionFlagsBits.Connect,
                        ],
                    },
                ],
            });

            // Move the user to their new channel
            await member.voice.setChannel(channel);

            this.activeChannels.set(channel.id, {
                ownerId: member.id,
                createdAt: Date.now(),
            });

            console.log(`Temp VC created: ${channel.name} (${channel.id}) by ${member.displayName}`);
        } catch (error) {
            console.error('Error creating temp VC:', error.message);
        }
    }

    async deleteTempVC(channelId) {
        try {
            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (channel) {
                const name = channel.name;
                await channel.delete();
                console.log(`Temp VC deleted: ${name} (${channelId})`);
            }
            this.activeChannels.delete(channelId);
        } catch (error) {
            console.error('Error deleting temp VC:', error.message);
            this.activeChannels.delete(channelId);
        }
    }

    isTempVC(channelId) {
        return this.activeChannels.has(channelId);
    }

    getStats() {
        return { activeChannels: this.activeChannels.size };
    }
}

const tempVCService = new TempVCService();

module.exports = { tempVCService };
