const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getPlayerUsername, getOwedAspects, getLeaderboard, getGXPLeaderboard } = require("../../database");
const { raids, daysToTimestamp, getLastPoolReset } = require("../../misc");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gxp')
        .setDescription('Returns guild XP rankings')
        .addStringOption(option =>
            option.setName('period')
                .setDescription('The time period for the leaderboard')
                .addChoices(
                    { name: 'All Time', value: 'all' },
                    { name: 'This Week', value: 'thisweek' },
                    { name: 'Last Week', value: 'lastweek' },
                    { name: 'Custom Days', value: 'custom' }
                )
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('days')
                .setDescription('Number of days (only used when period is "Custom Days")')
        ),
    async execute(interaction) {
        const period = interaction.options.getString('period') || 'all';
        let days = interaction.options.getString('days');
        let timestamp;
        let periodDescription;

        if (period === 'thisweek') {
            timestamp = getLastPoolReset();
            periodDescription = 'This Week';
        } else if (period === 'lastweek') {
            timestamp = getLastPoolReset(1);
            periodDescription = 'Last Week';
        } else if (period === 'custom' && days) {
            days = parseInt(days);
            timestamp = daysToTimestamp(days);
            periodDescription = `Last ${days} Day${days !== 1 ? "s" : ""}`;
        } else {
            timestamp = daysToTimestamp(-1);
            periodDescription = 'All Time';
        }

        let leaderData = await getGXPLeaderboard(timestamp);
        let fields = [];

        for (const [uuid, gxp] of leaderData) {
            let playerName = await getPlayerUsername(uuid);
            fields.push({ name: playerName, value: `\`\`\`${this.getAbreviatedNumber(gxp)}\`\`\``});
        }

        const itemsPerPage = 10;
        const totalPages = Math.ceil(fields.length / itemsPerPage);

        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const currentFields = fields.slice(start, start + itemsPerPage);

            return new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle("Guild XP")
                .setAuthor({ name: 'Guild Raid Leaderboard' })
                .setDescription(`*${periodDescription}*`)
                .addFields(...currentFields)
                .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
        };

        let currentPage = 0;
        const embedMessage = await interaction.reply({ embeds: [generateEmbed(currentPage)], fetchReply: true });

        if (totalPages > 1) {
            const generateActionRow = (page) => {
                return new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('prev')
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('next')
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === totalPages - 1)
                    );
            };

            await interaction.editReply({ components: [generateActionRow(currentPage)] });

            const filter = i => i.customId === 'prev' || i.customId === 'next';
            const collector = embedMessage.createMessageComponentCollector({ filter, time: 600000 });

            collector.on('collect', async i => {
                if (i.customId === 'prev' && currentPage > 0) currentPage--;
                else if (i.customId === 'next' && currentPage < totalPages - 1) currentPage++;

                await i.update({ embeds: [generateEmbed(currentPage)], components: [generateActionRow(currentPage)] });
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] });
            });
        }
    },

    getAbreviatedNumber(number) {
        if (number >= 1000000000) return (number / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
        if (number >= 1000000) return (number / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (number >= 1000) return (number / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return number;
    }
};