const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getPlaytime, getGuildPlaytimeLeaderboard, getDailyPlaytime } = require("../../features/playtime/playtime-service");
const { generatePlaytimeChart, generateLeaderboardChart } = require("../../features/playtime/playtime-chart");
const { resolveAlias } = require("../../core/database");

const TIMEFRAME_CHOICES = [
    { name: 'All Time', value: 'all' },
    { name: 'Last 24 hours', value: '24' },
    { name: 'Last 3 days', value: '72' },
    { name: 'Last 7 days', value: '168' },
    { name: 'Last 14 days', value: '336' },
    { name: 'Last 30 days', value: '720' },
];
const ITEMS_PER_PAGE = 10;
const COLLECTOR_TIME = 600000;
const MAX_LEADERBOARD_ENTRIES = 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playtime')
        .setDescription('View player playtime or activity leaderboard')
        .addSubcommand(sub =>
            sub.setName('player')
                .setDescription('View a player\'s playtime')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Minecraft username')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Timeframe')
                        .setRequired(true)
                        .addChoices(...TIMEFRAME_CHOICES)))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View guild activity leaderboard')
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Timeframe')
                        .setRequired(true)
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
    const timeframeValue = interaction.options.getString('timeframe');

    try {
        const resolvedName = await resolveAlias(name) || name;

        if (timeframeValue === 'all') {
            const res = await fetch(`https://api.wynncraft.com/v3/player/${resolvedName}`);
            if (!res.ok) {
                return interaction.editReply({ content: `❌ Player **${name}** not found on Wynncraft.` });
            }
            const player = await res.json();
            const playtimeHours = player.playtime || 0;
            const totalHours = Math.floor(playtimeHours);
            const totalMins = Math.round((playtimeHours - totalHours) * 60);

            const embed = new EmbedBuilder()
                .setColor(0x00BFFF)
                .setTitle(`${player.username}'s Playtime`)
                .addFields(
                    { name: 'Timeframe', value: 'All Time', inline: true },
                    { name: 'Total Playtime', value: `${totalHours}h ${totalMins}m`, inline: true },
                )
                .setFooter({ text: 'Data from Wynncraft API' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        const hours = parseInt(timeframeValue, 10);
        const data = await getPlaytime(resolvedName, hours);
        const timeframeLabel = getTimeframeLabel(hours);
        const totalHours = Math.floor(data.total_minutes / 60);
        const totalMins = data.total_minutes % 60;
        const timeStr = totalHours > 0 ? `${totalHours}h ${totalMins}m` : `${totalMins}m`;

        const embed = new EmbedBuilder()
            .setColor(0x00BFFF)
            .setTitle(`${resolvedName}'s Playtime`)
            .addFields(
                { name: 'Timeframe', value: timeframeLabel, inline: true },
                { name: 'Total Playtime', value: timeStr, inline: true },
                { name: 'Sessions', value: `${data.session_count}`, inline: true },
            )
            .setFooter({ text: 'Tracked since playtime service was enabled' })
            .setTimestamp();

        if (data.total_minutes > 0 && data.session_count > 0) {
            const avgSession = Math.round(data.total_minutes / data.session_count);
            embed.addFields({ name: 'Avg Session', value: `${avgSession}m`, inline: true });
        }

        const days = Math.ceil(hours / 24);
        const dailyData = await getDailyPlaytime(resolvedName, days);
        const chartBuffer = await generatePlaytimeChart(dailyData, resolvedName, timeframeLabel);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'playtime.png' });
        embed.setImage('attachment://playtime.png');

        await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (error) {
        console.error('Error fetching playtime:', error);
        await interaction.editReply({ content: '❌ Failed to fetch playtime data.' });
    }
}

async function handleLeaderboard(interaction) {
    await interaction.deferReply();

    const timeframeValue = interaction.options.getString('timeframe');

    try {
        let entries;
        let timeframeLabel;
        let footerSource;

        if (timeframeValue === 'all') {
            const { config } = require("../../core/config");
            const guildTag = config.get("guild-tag");
            const res = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guildTag}`);
            if (!res.ok) {
                return interaction.editReply({ content: '❌ Failed to fetch guild data.' });
            }

            const guild = await res.json();
            entries = [];
            const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
            for (const rank of ranks) {
                const members = guild.members[rank];
                if (!members) continue;
                for (const [username, data] of Object.entries(members)) {
                    const playtime = data.globalData?.playtime || 0;
                    if (playtime > 0) {
                        entries.push({ username, total_minutes: Math.round(playtime * 60), session_count: 0 });
                    }
                }
            }
            entries.sort((a, b) => b.total_minutes - a.total_minutes);
            timeframeLabel = 'All Time';
            footerSource = 'Wynncraft API';
        } else {
            const hours = parseInt(timeframeValue, 10);
            timeframeLabel = getTimeframeLabel(hours);
            entries = await getGuildPlaytimeLeaderboard(hours, MAX_LEADERBOARD_ENTRIES);
            footerSource = 'Tracked playtime';
        }

        if (!entries.length) {
            return interaction.editReply({ content: `❌ No playtime data found for the ${timeframeLabel.toLowerCase()}.` });
        }

        const chartBuffer = await generateLeaderboardChart(entries.slice(0, ITEMS_PER_PAGE), timeframeLabel);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'leaderboard.png' });
        await sendPaginatedLeaderboard(interaction, {
            attachment,
            color: 0x00BFFF,
            entries,
            footerSource,
            timeframeLabel,
            title: `Activity Leaderboard — ${timeframeLabel}`,
        });
    } catch (error) {
        console.error('Error fetching playtime leaderboard:', error);
        await interaction.editReply({ content: '❌ Failed to fetch leaderboard data.' });
    }
}

async function sendPaginatedLeaderboard(interaction, { attachment, color, entries, footerSource, timeframeLabel, title }) {
    const totalPages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
    let currentPage = 0;

    const buildEmbed = (page) => {
        const start = page * ITEMS_PER_PAGE;
        const pageEntries = entries.slice(start, start + ITEMS_PER_PAGE);
        const table = buildTable(
            '#   Player                Playtime',
            pageEntries.map((entry, index) => formatLeaderboardRow(
                start + index + 1,
                entry.username,
                formatPlaytime(entry.total_minutes),
                20,
                12,
            )),
        );

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .addFields({ name: 'Timeframe', value: timeframeLabel, inline: true })
            .setDescription(table)
            .setFooter({ text: `${entries.length} players • ${footerSource} • Page ${page + 1}/${totalPages}` })
            .setTimestamp();

        if (page === 0) embed.setImage('attachment://leaderboard.png');
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

function formatLeaderboardRow(rank, username, value, nameWidth, valueWidth) {
    return `${String(rank).padEnd(4)}${truncateText(username, nameWidth).padEnd(nameWidth)}${value.padStart(valueWidth)}`;
}

function formatPlaytime(totalMinutes) {
    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return totalHours > 0 ? `${totalHours}h ${minutes}m` : `${minutes}m`;
}

function truncateText(value, length) {
    return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

function getTimeframeLabel(hours) {
    switch (hours) {
        case 24: return 'Last 24 hours';
        case 72: return 'Last 3 days';
        case 168: return 'Last 7 days';
        case 336: return 'Last 14 days';
        case 720: return 'Last 30 days';
        default: return `Last ${hours} hours`;
    }
}
