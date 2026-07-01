const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { rankService } = require('../../features/ranks/rank-service');

const CHIEF_ROLE_ID = '1459230233902448803';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setrank')
        .setDescription('Set a member\'s rank in Discord and in-game')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member to promote')
                .setRequired(true))
        .addStringOption(option => {
            const choice = option.setName('rank')
                .setDescription('The rank to set')
                .setRequired(true);
            
            // Add choices for each rank
            const ranks = rankService.getAllRanks();
            for (const rank of ranks) {
                // Don't allow promoting to rank 6 (owner) - manually set only
                if (rank['ingame-rank'] !== 6) {
                    choice.addChoices({ name: rank.identifier, value: rank.key });
                }
            }
            
            return choice;
        }),
    
    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('member');
            const newRankKey = interaction.options.getString('rank');
            const setterDiscordId = interaction.user.id;

            await interaction.deferReply({ ephemeral: true });

            // Get rank configuration
            const newRankConfig = rankService.getRankConfig(newRankKey);
            if (!newRankConfig) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ Invalid Rank')
                    .setDescription(`The rank "${newRankKey}" does not exist.`);
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Check if target user is in the guild
            const guild = interaction.guild;
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ Member Not Found')
                    .setDescription('The specified user is not a member of this server.');
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Check if setter has admin permissions or appropriate rank
            const setterMember = interaction.member;
            const isAdmin = setterMember.permissions.has('Administrator');
            const isChief = setterMember.roles.cache.has(CHIEF_ROLE_ID);
            const setterRank = await rankService.getMemberRank(setterDiscordId);
            
            if (!isAdmin && !isChief && !setterRank) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ Insufficient Permissions')
                    .setDescription('You do not have a rank or admin permissions that allow you to set other members\' ranks.');
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Attempt to set the rank
            const result = await rankService.setMemberRank(targetUser.id, newRankKey, setterDiscordId);

            if (!result.success) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ Rank Change Failed')
                    .setDescription(result.error || 'An unknown error occurred.');
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Success - create response embed
            const successEmbed = new EmbedBuilder()
                .setColor(0x00ff00) // Green for success
                .setTitle('✅ Rank Updated Successfully')
                .setDescription(result.message)
                .addFields(
                    { name: 'Member', value: `${targetMember.displayName} (${targetUser.username})`, inline: true },
                    { name: 'New Rank', value: `<@&${newRankConfig['discord-role-id']}> (${newRankConfig.identifier})`, inline: true },
                    { name: 'Set By', value: `${interaction.member.displayName}${isAdmin ? ' (Admin)' : setterRank ? ` (${setterRank.identifier})` : ''}`, inline: true }
                )
                .setTimestamp();

            // Add additional status information
            if (result.queued) {
                successEmbed.addFields({
                    name: '⏳ Queued for In-Game Promotion',
                    value: 'No eligible clients online. Promotion will be processed when someone connects.',
                    inline: false
                });
            } else if (result.completed) {
                successEmbed.addFields({
                    name: '✅ In-Game Promotion Completed',
                    value: `Successfully promoted in-game by rank ${result.selectedPromoterRank} member.`,
                    inline: false
                });
            } else if (result.timedOut && result.willRetry) {
                successEmbed.addFields({
                    name: '⏰ In-Game Promotion Timed Out',
                    value: 'No response received, but will retry automatically every minute until successful.',
                    inline: false
                });
            } else if (result.error && result.requested) {
                successEmbed.addFields({
                    name: '❌ In-Game Promotion Failed',
                    value: result.error,
                    inline: false
                });
            } else if (result.requested && !result.completed) {
                successEmbed.addFields({
                    name: '🎮 In-Game Promotion Sent',
                    value: `Promotion request sent to rank ${result.selectedPromoterRank} member. Waiting for response...`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [successEmbed] });

            // Log the rank change
            const setterInfo = isAdmin ? 'Admin' : isChief ? 'Chief' : (setterRank ? setterRank.identifier : 'Unknown');
            console.log(`Rank change: ${interaction.user.username} (${setterInfo}) set ${targetUser.username} to ${newRankConfig.identifier}`);

        } catch (error) {
            console.error('Error in setrank command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('❌ Command Error')
                .setDescription('An unexpected error occurred while processing the rank change.');
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },
};