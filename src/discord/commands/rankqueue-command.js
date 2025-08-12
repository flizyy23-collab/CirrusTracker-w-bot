const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { rankService } = require('../../features/ranks/rank-service');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rankqueue')
        .setDescription('Check the current rank promotion queue status'),
    
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const queueStatus = rankService.getQueueStatus();
            
            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('🔄 Rank Promotion Queue Status')
                .addFields(
                    { name: 'Queued Promotions', value: queueStatus.queuedPromotions.toString(), inline: true },
                    { name: 'Pending Responses', value: queueStatus.pendingPromotions.toString(), inline: true },
                    { name: 'Retrying Promotions', value: queueStatus.retryPromotions.toString(), inline: true }
                )
                .setTimestamp();

            if (queueStatus.queue.length > 0) {
                const queueList = queueStatus.queue.map(p => {
                    const queuedTime = new Date(p.queuedAt).toLocaleTimeString();
                    return `• **${p.targetUsername}** → Rank ${p.newRank} (queued at ${queuedTime})`;
                }).join('\n');

                embed.addFields({
                    name: 'Queued Promotions Details',
                    value: queueList.substring(0, 1024), // Discord field limit
                    inline: false
                });
            }

            if (queueStatus.retryQueue.length > 0) {
                const retryList = queueStatus.retryQueue.map(r => {
                    const nextRetryTime = new Date(r.nextRetry).toLocaleTimeString();
                    return `• **${r.targetUsername}** → Rank ${r.newRank} (attempt ${r.attempts + 1}, next retry: ${nextRetryTime})`;
                }).join('\n');

                embed.addFields({
                    name: 'Retrying Promotions Details',
                    value: retryList.substring(0, 1024), // Discord field limit
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in rankqueue command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('❌ Command Error')
                .setDescription('An error occurred while checking the queue status.');
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },
};