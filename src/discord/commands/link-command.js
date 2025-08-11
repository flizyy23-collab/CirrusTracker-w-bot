const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../../core/config");
const accountLinkingService = require("../../features/account-linking/account-linking-service");
const roleManager = require("../../features/account-linking/role-manager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to your Minecraft account')
        .addStringOption(option =>
            option.setName('minecraft-username')
                .setDescription('Your Minecraft username')
                .setRequired(true)
        ),
    
    async execute(interaction) {
        try {
            const minecraftUsername = interaction.options.getString('minecraft-username');
            const discordId = interaction.user.id;
            
            // Check if user has required role
            const hasRequiredRole = await roleManager.hasRequiredRole(discordId);
            if (!hasRequiredRole) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Permission Denied')
                    .setDescription('You do not have the required role to use this command.');

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Check if user is already linked
            const existingLink = await accountLinkingService.getLink(discordId);
            if (existingLink) {
                const verifiedAtUnix = Math.floor(new Date(existingLink.verified_at).getTime() / 1000);
                
                const embed = new EmbedBuilder()
                    .setColor(0xFF9500)
                    .setTitle('⚠️ Already Linked')
                    .setDescription(`Your Discord account is already linked to **${existingLink.minecraft_username}**.`)
                    .addFields(
                        { name: 'Linked Since', value: `<t:${verifiedAtUnix}:R>`, inline: true }
                    )
                    .setFooter({ text: 'Use /unlink to remove the current link first.' });

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Initiate the linking process
            const result = await accountLinkingService.initiateLink(discordId, minecraftUsername);

            if (result.success) {
                const unixTimestamp = Math.floor(result.expiresAt.getTime() / 1000);
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('🔗 Account Linking Started')
                    .setDescription(`To complete the linking process, run this command in Minecraft:`)
                    .addFields(
                        { 
                            name: '📋 Command to Run', 
                            value: `\`\`\`/tbgm verify ${result.code}\`\`\``,
                            inline: false 
                        },
                        { 
                            name: '⏰ Expires', 
                            value: `<t:${unixTimestamp}:R> (at <t:${unixTimestamp}:t>)`,
                            inline: true 
                        },
                        { 
                            name: '👤 Minecraft Account', 
                            value: result.minecraftUsername,
                            inline: true 
                        }
                    )
                    .setFooter({ text: 'The verification code will expire automatically. Authentication required.' });

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Linking Failed')
                    .setDescription(result.error);

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

        } catch (error) {
            console.error('Error in link command:', error);
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Error')
                .setDescription('An unexpected error occurred. Please try again later.');

            if (interaction.replied || interaction.deferred) {
                return await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    }
};