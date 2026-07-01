const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getPlayerWars, getWarsLeaderboard, getAllTimeLeaderboard, getDailyWars } = require("../../features/wars/wars-service");
const { generateWarsChart, generateWarsLeaderboardChart } = require("../../features/wars/wars-chart");

const TIMEFRAME_CHOICES = [
    { name: 'Last 7 days', value: '168' },
    { name: 'Last 14 days', value: '336' },
    { name: 'Last 30 days', value: '720' },
    { name: 'All Time', value: 'all' },
];
const ITEMS_PER_PAGE = 10;
const COLLECTOR_TIME = 600000;
const MAX_LEADERBOARD_ENTRIES = 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wars')
        .setDescription('View war counts and leaderboard')
        .addSubcommand(sub =>
            sub.setName('player')
                .setDescription('View a player\'s war count')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Minecraft username')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Timeframe for wars gained')
                        .addChoices(...TIMEFRAME_CHOICES)))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View wars leaderboard')
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Timeframe')
                        .addChoices(...TIMEFRAME_CHOICES))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'player') {
            await handlePlayer(interaction);
        } else {
            await handleLeaderboard(interaction);
        }
    }
};

async function handlePlayer(interaction) {
    await interaction.deferReply();

    const name = interaction.options.getString('name');
    const timeframeValue = interaction.options.getString('timeframe') || '168';
    const hours = timeframeValue === 'all' ? 999999 : parseInt(timeframeValue, 10);
    const timeframeLabel = getTimeframeLabel(timeframeValue);
    const data = await getPlayerWars(name, hours);

    if (!data) {
        return interaction.editReply({ content: `❌ Player **${name}** not found in war tracking data.` });
    }

    const embed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setTitle(`${data.username}'s Wars`)
        .addFields(
            { name: 'Timeframe', value: timeframeLabel, inline: true },
            { name: 'Total Wars', value: `${data.total.toLocaleString()}`, inline: true },
            { name: 'Gained', value: `+${data.gained.toLocaleString()}`, inline: true },
        )
        .setFooter({ text: 'War data tracked every 6 hours' })
        .setTimestamp();

    if (timeframeValue !== 'all') {
        const days = Math.ceil(parseInt(timeframeValue, 10) / 24);
        const dailyData = await getDailyWars(name, days);
        const chartBuffer = await generateWarsChart(dailyData, data.username, timeframeLabel);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'wars.png' });
        embed.setImage('attachment://wars.png');
        await interaction.editReply({ embeds: [embed], files: [attachment] });
    } else {
        await interaction.editReply({ embeds: [embed] });
    }
}

async function handleLeaderboard(interaction) {
    await interaction.deferReply();

    const timeframeValue = interaction.options.getString('timeframe') || '168';
    const timeframeLabel = getTimeframeLabel(timeframeValue);
    const isAllTime = timeframeValue === 'all';

    try {
        const data = isAllTime
            ? await getAllTimeLeaderboard(MAX_LEADERBOARD_ENTRIES)
            : await getWarsLeaderboard(parseInt(timeframeValue, 10), MAX_LEADERBOARD_ENTRIES);

        if (!data.length) {
            return interaction.editReply({ content: `❌ No war data available yet for ${timeframeLabel.toLowerCase()}.` });
        }

        const chartBuffer = await generateWarsLeaderboardChart(data.slice(0, ITEMS_PER_PAGE), timeframeLabel, isAllTime);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'wars_lb.png' });
        const totalPages = Math.max(1, Math.ceil(data.length / ITEMS_PER_PAGE));
        let currentPage = 0;

        const buildEmbed = (page) => {
            const start = page * ITEMS_PER_PAGE;
            const pageEntries = data.slice(start, start + ITEMS_PER_PAGE);
            const table = buildTable(
                '#   Player                Wars',
                pageEntries.map((entry, index) => formatLeaderboardRow(
                    start + index + 1,
                    entry.username,
                    isAllTime ? entry.wars : entry.gained,
                )),
            );

            const embed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle(`Wars Leaderboard — ${timeframeLabel}`)
                .addFields({ name: 'Timeframe', value: timeframeLabel, inline: true })
                .setDescription(table)
                .setFooter({ text: `${data.length} players • Tracked every 6 hours • Page ${page + 1}/${totalPages}` })
                .setTimestamp();

            if (page === 0) embed.setImage('attachment://wars_lb.png');
            return embed;
        };

        const message = await interaction.editReply({
            embeds: [buildEmbed(currentPage)],
            files: [attachment],
            components: totalPages > 1 ? [buildPaginationRow(currentPage, totalPages)] : [],
            fetchReply: true,
        });

        if (totalPages <= 1) return;

        const filter = buttonInteraction => (
            (buttonInteraction.customId === 'lb_prev' || buttonInteraction.customId === 'lb_next') &&
            buttonInteraction.user.id === interaction.user.id
        );
        const collector = message.createMessageComponentCollector({ filter, time: COLLECTOR_TIME });

        collector.on('collect', async buttonInteraction => {
            if (buttonInteraction.customId === 'lb_prev' && currentPage > 0) currentPage--;
            else if (buttonInteraction.customId === 'lb_next' && currentPage < totalPages - 1) currentPage++;

            await buttonInteraction.update({
                embeds: [buildEmbed(currentPage)],
                components: [buildPaginationRow(currentPage, totalPages)],
            });
        });

        collector.on('end', async () => {
            await interaction.editReply({ components: [] }).catch(() => {});
        });
    } catch (error) {
        console.error('Error fetching wars leaderboard:', error);
        await interaction.editReply({ content: '❌ Failed to fetch wars leaderboard data.' });
    }
}

function buildPaginationRow(currentPage, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lb_prev').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
        new ButtonBuilder().setCustomId('lb_next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
    );
}

function buildTable(header, rows) {
    const separator = '────────────────────────────────────────';
    return `\`\`\`\n${header}\n${separator}\n${rows.join('\n')}\n\`\`\``;
}

function formatLeaderboardRow(rank, username, warsValue) {
    return `${String(rank).padEnd(4)}${truncateText(username, 20).padEnd(20)}${warsValue.toLocaleString().padStart(8)}`;
}

function truncateText(value, length) {
    return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

function getTimeframeLabel(value) {
    switch (value) {
        case '168': return 'Last 7 days';
        case '336': return 'Last 14 days';
        case '720': return 'Last 30 days';
        case 'all': return 'All Time';
        default: return `Last ${value} hours`;
    }
}
