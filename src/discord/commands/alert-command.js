const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { SocketMessageHandler } = require("../../features/websocket/socket-message-handler");
const { config } = require("../../core/config");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('alert')
        .setDescription('Send a guild announcement or alert to all connected clients')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The alert message to send')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('guild-alert')
                .setDescription('Whether this is a guild alert (true) or regular announcement (false)')
                .setRequired(false)),
    async execute(interaction) {
        // Check if user has required role
        const alertConfig = config.get('alert-command');
        const requiredRoleId = alertConfig['required-role-id'];
        
        if (requiredRoleId && !interaction.member.roles.cache.has(requiredRoleId)) {
            const noPermissionEmbed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Permission Denied')
                .setDescription('You do not have permission to use this command.')
                .setTimestamp();
            
            await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
            return;
        }

        const message = interaction.options.getString('message');
        const guildAlert = interaction.options.getBoolean('guild-alert') ?? true;

        try {
            SocketMessageHandler.announceToClient(guildAlert, message);
            
            const alertType = guildAlert ? 'Guild Alert' : 'Announcement';
            const embed = new EmbedBuilder()
                .setColor(guildAlert ? 0xFF6B6B : 0x00D4AA)
                .setTitle(`${alertType} Sent Successfully`)
                .setDescription(`**Message:** ${message}`)
                .addFields(
                    { name: 'Type', value: alertType, inline: true },
                    { name: 'Status', value: '✅ Delivered', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Guild Alert System' });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error sending alert:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Alert Failed')
                .setDescription('Failed to send alert. Please try again.')
                .setTimestamp();

            await interaction.reply({ embeds: [errorEmbed] });
        }
    },
};