const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../../core/config");
const accountLinkingService = require("../../features/account-linking/account-linking-service");
const roleManager = require("../../features/account-linking/role-manager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Discord account from your Minecraft account'),
    
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;

            // Check if user has a linked account
            const existingLink = await accountLinkingService.getLink(discordId);
            if (!existingLink) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF9500)
                    .setTitle('⚠️ Not Linked')
                    .setDescription('Your Discord account is not linked to any Minecraft account.')
                    .setFooter({ text: 'Use /link to link your account.' });

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Remove the link
            const success = await accountLinkingService.unlinkByDiscord(discordId);

            if (success) {
                // Remove linked role if configured
                try {
                    await roleManager.removeLinkedRole(discordId);
                } catch (roleError) {
                    console.error('Error removing linked role:', roleError);
                }

                const verifiedAtUnix = Math.floor(new Date(existingLink.verified_at).getTime() / 1000);
                
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Account Unlinked')
                    .setDescription(`Your Discord account has been successfully unlinked from **${existingLink.minecraft_username}**.`)
                    .addFields(
                        { name: 'Previously Linked Since', value: `<t:${verifiedAtUnix}:R>`, inline: true }
                    )
                    .setFooter({ text: 'You can link to a new Minecraft account using /link.' });

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Unlink Failed')
                    .setDescription('Failed to unlink your account. Please try again.');

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

        } catch (error) {
            console.error('Error in unlink command:', error);
            
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