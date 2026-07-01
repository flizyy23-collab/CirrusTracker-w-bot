const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../../core/config");
const accountLinkingService = require("../../features/account-linking/account-linking-service");
const roleManager = require("../../features/account-linking/role-manager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Discord account from your Minecraft account')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('(Admin) The Discord user to unlink')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('minecraft-username')
                .setDescription('(Admin) Unlink by Minecraft username (for users who left Discord)')
                .setRequired(false)
        ),
    
    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            const mcUsername = interaction.options.getString('minecraft-username');

            // If using minecraft-username option, require admin
            if (mcUsername) {
                const isAdmin = interaction.member.permissions.has('Administrator');
                if (!isAdmin) {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('❌ Permission Denied')
                        .setDescription('You need Administrator permissions to unlink by Minecraft username.');
                    return await interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const link = await accountLinkingService.getLinkByUsername(mcUsername);
                if (!link) {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF9500)
                        .setTitle('⚠️ Not Found')
                        .setDescription(`No linked account found for Minecraft username **${mcUsername}**.`);
                    return await interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const success = await accountLinkingService.unlinkByDiscord(link.discord_id);
                if (success) {
                    try {
                        await roleManager.removeLinkedRole(link.discord_id);
                    } catch (roleError) {}

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('✅ Account Unlinked')
                        .setDescription(`**${link.minecraft_username}** (Discord: <@${link.discord_id}>) has been unlinked.`)
                        .setFooter({ text: 'Unlinked by admin.' });
                    return await interaction.reply({ embeds: [embed], ephemeral: true });
                } else {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('❌ Unlink Failed')
                        .setDescription('Failed to unlink the account. Please try again.');
                    return await interaction.reply({ embeds: [embed], ephemeral: true });
                }
            }
            
            // If targeting another user, require admin
            if (targetUser && targetUser.id !== interaction.user.id) {
                const isAdmin = interaction.member.permissions.has('Administrator');
                if (!isAdmin) {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('❌ Permission Denied')
                        .setDescription('You need Administrator permissions to unlink other users.');
                    return await interaction.reply({ embeds: [embed], ephemeral: true });
                }
            }

            const discordId = targetUser ? targetUser.id : interaction.user.id;
            const isSelf = discordId === interaction.user.id;

            // Check if user has a linked account
            const existingLink = await accountLinkingService.getLink(discordId);
            if (!existingLink) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF9500)
                    .setTitle('⚠️ Not Linked')
                    .setDescription(isSelf 
                        ? 'Your Discord account is not linked to any Minecraft account.'
                        : `<@${discordId}> is not linked to any Minecraft account.`)
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
                    .setDescription(isSelf
                        ? `Your Discord account has been successfully unlinked from **${existingLink.minecraft_username}**.`
                        : `<@${discordId}> has been successfully unlinked from **${existingLink.minecraft_username}**.`)
                    .addFields(
                        { name: 'Previously Linked Since', value: `<t:${verifiedAtUnix}:R>`, inline: true }
                    )
                    .setFooter({ text: isSelf ? 'You can link to a new Minecraft account using /link.' : 'Unlinked by admin.' });

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Unlink Failed')
                    .setDescription('Failed to unlink the account. Please try again.');

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