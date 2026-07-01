const {Client, GatewayIntentBits, Collection, Events} = require("discord.js");
const {join} = require("path");
const { get: getConfig } = require('../core/config');
const token = getConfig('token');
const {readdirSync} = require("fs");
const { chatBridge } = require('../features/chat-bridge/chat-bridge-service');
const { rankService } = require('../features/ranks/rank-service');
const { tempVCService } = require('../features/temp-vc/temp-vc-service');
require('./deploy-commands');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ] 
});

client.commands = new Collection();

const foldersPath = join(__dirname, 'commands');
const commandFiles = readdirSync(foldersPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const filePath = join(foldersPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.login(token).then(r => {
    console.log("Discord Bot Logged in")
}).catch(console.error);

// Initialize role manager when client is ready
client.once('ready', () => {
    console.log(`Discord bot ready as ${client.user.tag}`);
    
    // Initialize the role manager now that the client is ready
    const roleManager = require('../features/account-linking/role-manager');
    roleManager.init(client);
    
    // Initialize the chat bridge with Discord client
    chatBridge.setDiscordClient(client);
    console.log('Chat bridge initialized with Discord client');
    
    // Initialize the rank service with Discord client
    rankService.setDiscordClient(client);
    console.log('Rank service initialized with Discord client');
    
    // Initialize temp VC service
    tempVCService.setDiscordClient(client);
    console.log('Temp VC service initialized with Discord client');
    
    // Initialize Annihilation tracker with Discord client
    const { initAnni } = require('../features/anni/anni-service');
    initAnni(client);
    console.log('Annihilation tracker initialized with Discord client');
    
    // Restore active giveaway timers
    const giveawayCommand = client.commands.get('giveaway');
    if (giveawayCommand && giveawayCommand.restoreGiveawayTimers) {
        giveawayCommand.restoreGiveawayTimers(client);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    // Handle button interactions (giveaway join, etc.)
    if (interaction.isButton()) {
        try {
            const giveawayCommand = interaction.client.commands.get('giveaway');
            if (giveawayCommand && interaction.customId.startsWith('giveaway_')) {
                await giveawayCommand.handleButton(interaction);
            }

            const ticketCommand = interaction.client.commands.get('ticket');
            if (ticketCommand && (interaction.customId === 'ticket_open' || interaction.customId === 'ticket_close' || interaction.customId === 'ticket_guild' || interaction.customId === 'ticket_community')) {
                await ticketCommand.handleButton(interaction);
            }
        } catch (error) {
            console.error('Button interaction error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
            }
        }
        return;
    }

    // Handle modal submissions (giveaway weights + exclude)
    if (interaction.isModalSubmit()) {
        try {
            const giveawayCommand = interaction.client.commands.get('giveaway');
            if (giveawayCommand && (interaction.customId.startsWith('giveaway_weights_modal_') || interaction.customId.startsWith('giveaway_exclude_modal_') || interaction.customId.startsWith('giveaway_raid_scale_modal_') || interaction.customId.startsWith('giveaway_gxp_scale_modal_'))) {
                await giveawayCommand.handleModal(interaction);
            }
        } catch (error) {
            console.error('Modal interaction error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const allowedChannelId = getConfig('bot-channel-id');
    const additionalAllowedChannels = ['1485453164982435962', '1462894897487941757', '1516402150622629908'];
    const universalAllowedChannels = ['1484510982712725504'];
    const isLinkCommand = interaction.commandName === 'link' || interaction.commandName === 'unlink';
    const isGiveawayCommand = interaction.commandName === 'giveaway';
    const isTicketCommand = interaction.commandName === 'ticket';
    const isTodoCommand = interaction.commandName === 'todo';
    const isPurgeCommand = interaction.commandName === 'purge';
    const todoChannel = '1471928225234948192';
    const isAnniCommand = interaction.commandName === 'anni';
    const isInactivityCommand = interaction.commandName === 'inactivity';
    const botCommandChannel = '1459300995711631454';
    const botCommands = ['stats', 'guild', 'territory', 'gxp', 'hq', 'overview', 'playtime', 'raids', 'sr', 'wars'];
    const isBotCommand = botCommands.includes(interaction.commandName);
    const checkChannels = ['1471928225234948192', '1459300995711631454', '1459254010132566046'];
    const inactivityChannels = ['1471928225234948192', '1459300995711631454', '1466834463970427167'];
    if (allowedChannelId && interaction.channelId !== allowedChannelId && !universalAllowedChannels.includes(interaction.channelId) && !additionalAllowedChannels.includes(interaction.channelId) && !isGiveawayCommand && !isTicketCommand && !isPurgeCommand && !(isTodoCommand && interaction.channelId === todoChannel) && !(isBotCommand && checkChannels.includes(interaction.channelId)) && !(isAnniCommand && checkChannels.includes(interaction.channelId)) && !(isInactivityCommand && inactivityChannels.includes(interaction.channelId)) && !(isLinkCommand && additionalAllowedChannels.includes(interaction.channelId))) {
        return interaction.reply({ content: `Commands can only be used in <#${allowedChannelId}>.`, ephemeral: true });
    }

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

client.on(Events.MessageCreate, async message => {
    let body = message.content
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        console.log(`accept`);
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            body = `${attachment.url} ${message.content}`;
        }
    }
    await chatBridge.handleDiscordMessage(message.author, body, message.channel.id);
});

client.on('error', (error) => {
    console.error('Discord client error:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error?.message);
});

module.exports = { client };