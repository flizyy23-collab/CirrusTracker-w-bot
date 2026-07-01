const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const axios = require('axios');
const { getPlayerUUID, getRaids, getPlayerUsername, getLeaderboard } = require("../../core/database");
const { raids, daysToTimestamp } = require("../../core/utilities");
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const width = 800;
const height = 400;
const chartCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#2b2d31' });
const ITEMS_PER_PAGE = 10;
const COLLECTOR_TIME = 600000;

const TIMEFRAME_CHOICES = [
    { name: 'Last 3 days', value: '3' },
    { name: 'Last 7 days', value: '7' },
    { name: 'Last 2 weeks', value: '14' },
    { name: 'Last 3 weeks', value: '21' },
    { name: 'All time', value: 'all' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raids')
        .setDescription('View raid stats and leaderboards')
        .addSubcommand(sub =>
            sub.setName('player')
                .setDescription('View a player\'s guild raid stats')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Minecraft username')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('days')
                        .setDescription('Time period in days')))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('Guild raid leaderboard')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Leaderboard type')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Graids', value: 'graids' },
                            { name: 'Raids', value: 'raids' }
                        ))
                .addStringOption(option =>
                    option.setName('raid')
                        .setDescription('Filter by specific raid')
                        .addChoices(
                            { name: 'All Raids', value: 'all' },
                            { name: 'NOTG', value: '0' },
                            { name: 'NOL', value: '1' },
                            { name: 'TCC', value: '2' },
                            { name: 'TNA', value: '3' },
                            { name: 'WTP', value: '4' }
                        ))
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Timeframe (only for graids)')
                        .addChoices(...TIMEFRAME_CHOICES))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'player') return handlePlayer(interaction);
        if (sub === 'leaderboard') return handleLeaderboard(interaction);
    }
};

async function handlePlayer(interaction) {
    let playerName = interaction.options.getString('name');
    const uuid = await getPlayerUUID(playerName);

    let days = interaction.options.getString('days');
    if (days) days = parseInt(days, 10);

    if (!uuid) {
        return interaction.reply({ content: `❌ Player **${playerName}** not found in the database.`, ephemeral: true });
    }

    await interaction.deferReply();
    playerName = await getPlayerUsername(uuid);

    const raidCounts = [0, 0, 0, 0, 0];
    const raidsData = await getRaids(uuid, daysToTimestamp(days ? days : -1));
    for (const raidEntry of raidsData) {
        if (raidEntry.raid >= 0 && raidEntry.raid < 5) raidCounts[raidEntry.raid]++;
    }

    const raidNames = [
        'Nest of the Grootslangs',
        "Orphion's Nexus of Light",
        'The Canyon Colossus',
        'The Nameless Anomaly',
        'The Wartorn Palace'
    ];

    const header = 'Raid                      Runs';
    const separator = '─'.repeat(38);
    const lines = raidNames.map((name, i) => {
        return `${name.padEnd(26)}${String(raidCounts[i]).padStart(6)}`;
    });
    const total = raidCounts.reduce((a, b) => a + b, 0);
    const tableContent = `\`\`\`\n${header}\n${separator}\n${lines.join('\n')}\n${separator}\nTotal${String(total).padStart(29)}\n\`\`\``;

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`${playerName} — Guild Raids`)
        .setDescription(`*${days ? `Last ${days} Day${days !== 1 ? 's' : ''}` : 'All Time'}*\n${tableContent}`)
        .setThumbnail(`https://vzge.me/bust/128/${playerName}`)
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

async function handleLeaderboard(interaction) {
    const type = interaction.options.getString('type');
    const raidFilter = interaction.options.getString('raid') || 'all';
    const timeframe = interaction.options.getString('timeframe') || 'all';

    if (type === 'raids') {
        return handleRaidsLeaderboard(interaction, raidFilter);
    }

    // Graids leaderboard
    let timestamp;
    let timeframeDescription;

    if (timeframe !== 'all') {
        const days = parseInt(timeframe, 10);
        timestamp = daysToTimestamp(days);
        const labels = { '3': 'Last 3 Days', '7': 'Last 7 Days', '14': 'Last 2 Weeks', '21': 'Last 3 Weeks' };
        timeframeDescription = labels[timeframe] || `Last ${days} Days`;
    } else {
        timestamp = daysToTimestamp(-1);
        timeframeDescription = 'All Time';
    }

    const raid = raidFilter === 'all' ? -1 : parseInt(raidFilter, 10);

    if (raid === -1) {
        const combinedData = new Map();
        for (let raidId = 0; raidId < 5; raidId++) {
            const leaderData = await getLeaderboard(raidId, timestamp);
            for (const [uuid, raidCount] of leaderData) {
                combinedData.set(uuid, (combinedData.get(uuid) || 0) + raidCount);
            }
        }
        const entries = [];
        for (const [uuid, count] of combinedData) {
            const playerName = await getPlayerUsername(uuid);
            entries.push({ name: playerName, count });
        }
        entries.sort((a, b) => b.count - a.count);
        return showLeaderboard(interaction, entries, 'All Guild Raids', timeframeDescription);
    }

    const leaderData = await getLeaderboard(raid, timestamp);
    const entries = [];
    for (const [uuid, raidCount] of leaderData) {
        const playerName = await getPlayerUsername(uuid);
        entries.push({ name: playerName, count: raidCount });
    }

    const raidName = raids.find(r => r.id === raid)?.name || 'Unknown';
    return showLeaderboard(interaction, entries, raidName, timeframeDescription);
}

async function handleRaidsLeaderboard(interaction, raidFilter) {
    await interaction.deferReply();

    try {
        const { config } = require("../../core/config");
        const guildTag = config.get("guild-tag");
        const res = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guildTag}`);
        if (!res.ok) return interaction.editReply({ content: '❌ Failed to fetch guild data.' });

        const guild = await res.json();
        const entries = [];
        const ranksList = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];

        for (const rank of ranksList) {
            const members = guild.members[rank];
            if (!members) continue;
            for (const [username, data] of Object.entries(members)) {
                const raidData = data.globalData?.raids;
                if (!raidData) continue;
                let count;
                if (raidFilter === 'all') {
                    count = raidData.total || 0;
                } else {
                    const raidName = raids.find(r => r.id === parseInt(raidFilter, 10))?.name;
                    count = raidData.list?.[raidName] || 0;
                }
                if (count > 0) entries.push({ name: username, count });
            }
        }

        entries.sort((a, b) => b.count - a.count);
        const title = raidFilter === 'all' ? 'All Raids' : (raids.find(r => r.id === parseInt(raidFilter, 10))?.name || 'Raids');
        return showLeaderboard(interaction, entries, title, 'Wynncraft API · All Time', true);
    } catch (error) {
        console.error('Error fetching raids leaderboard:', error);
        await interaction.editReply({ content: '❌ Failed to fetch raid leaderboard.' });
    }
}

async function showLeaderboard(interaction, entries, title, timeframeDescription, deferred = false) {
    if (!deferred) await interaction.deferReply();

    const totalPages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
    const chartBuffer = await generateLeaderboardChart(entries, title, timeframeDescription);
    const attachment = new AttachmentBuilder(chartBuffer, { name: 'leaderboard.png' });

    const generateEmbed = (page) => {
        const start = page * ITEMS_PER_PAGE;
        const pageEntries = entries.slice(start, start + ITEMS_PER_PAGE);

        const header = '#   Player                Count';
        const separator = '─'.repeat(40);
        const lines = pageEntries.map((entry, i) => {
            const rank = (start + i + 1).toString().padEnd(4);
            const name = entry.name.substring(0, 22).padEnd(22);
            return `${rank}${name}${entry.count}`;
        });

        const tableContent = `\`\`\`\n${header}\n${separator}\n${lines.join('\n')}\n\`\`\``;

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`${title} Leaderboard`)
            .setDescription(`*${timeframeDescription}*\n${tableContent}`)
            .setFooter({ text: `${entries.length} players • Page ${page + 1}/${totalPages}` });

        if (page === 0) embed.setImage('attachment://leaderboard.png');
        return embed;
    };

    let currentPage = 0;

    const generateActionRow = (page) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lb_prev').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('lb_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
    );

    const embedMessage = await interaction.editReply({
        embeds: [generateEmbed(currentPage)],
        files: [attachment],
        components: totalPages > 1 ? [generateActionRow(currentPage)] : [],
        fetchReply: true
    });

    if (totalPages > 1) {
        const filter = btn => (btn.customId === 'lb_prev' || btn.customId === 'lb_next') && btn.user.id === interaction.user.id;
        const collector = embedMessage.createMessageComponentCollector({ filter, time: COLLECTOR_TIME });

        collector.on('collect', async btn => {
            if (btn.customId === 'lb_prev' && currentPage > 0) currentPage--;
            else if (btn.customId === 'lb_next' && currentPage < totalPages - 1) currentPage++;
            await btn.update({ embeds: [generateEmbed(currentPage)], components: [generateActionRow(currentPage)] });
        });

        collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
    }
}

async function generateLeaderboardChart(entries, title, timeframeDescription) {
    const displayEntries = entries.slice(0, 10);
    const config = {
        type: 'bar',
        data: {
            labels: displayEntries.map(e => e.name),
            datasets: [{
                label: 'Count',
                data: displayEntries.map(e => e.count),
                backgroundColor: '#9B59B688',
                borderColor: '#9B59B6',
                borderWidth: 2,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                title: {
                    display: true,
                    text: [`${title} Leaderboard`, timeframeDescription],
                    color: '#ffffff',
                    font: { size: 16, weight: 'bold' }
                },
                legend: { display: false }
            },
            scales: {
                x: { beginAtZero: true, ticks: { color: '#aaaaaa' }, grid: { color: '#3a3c4266' } },
                y: { ticks: { color: '#ffffff', font: { size: 12 } }, grid: { display: false } }
            }
        }
    };
    return chartCanvas.renderToBuffer(config);
}
