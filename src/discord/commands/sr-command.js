const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const width = 800;
const height = 400;
const chartCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#2b2d31' });
const ITEMS_PER_PAGE = 10;
const COLLECTOR_TIME = 600000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sr')
        .setDescription('View seasonal rating leaderboard or guild history')
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View top guilds in the current season'))
        .addSubcommand(sub =>
            sub.setName('tag')
                .setDescription('View a guild\'s SR history')
                .addStringOption(option =>
                    option.setName('guild')
                        .setDescription('Guild tag (e.g. Crrs)')
                        .setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'leaderboard') {
            await handleLeaderboard(interaction);
        } else {
            const tag = interaction.options.getString('guild').trim();
            await handleGuild(interaction, tag);
        }
    }
};

async function getCurrentSeason() {
    const res = await fetch('https://api.wynncraft.com/v3/leaderboards/types');
    const types = await res.json();
    let maxSeason = 0;
    for (const type of types) {
        const match = type.match(/^guildSeason(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxSeason) maxSeason = num;
        }
    }
    return maxSeason;
}

async function handleLeaderboard(interaction) {
    await interaction.deferReply();

    try {
        const currentSeason = await getCurrentSeason();
        const res = await fetch(`https://api.wynncraft.com/v3/leaderboards/guildSeason${currentSeason}?resultLimit=200`);
        const data = await res.json();

        const entries = Object.entries(data)
            .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
            .map(([pos, guild]) => ({
                name: guild.name,
                prefix: guild.prefix,
                rank: parseInt(pos, 10),
                score: guild.score,
            }));

        if (!entries.length) {
            return interaction.editReply({ content: '❌ No seasonal rating data available.' });
        }

        const chartBuffer = await generateSRChart(entries.slice(0, ITEMS_PER_PAGE), currentSeason);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'sr.png' });
        const totalPages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
        let currentPage = 0;

        const buildEmbed = (page) => {
            const start = page * ITEMS_PER_PAGE;
            const pageEntries = entries.slice(start, start + ITEMS_PER_PAGE);
            const table = buildTable(
                '#   Guild                   SR',
                pageEntries.map(entry => {
                    const guildLabel = truncateText(`[${entry.prefix}] ${entry.name}`, 23).padEnd(23);
                    return `${String(entry.rank).padEnd(4)}${guildLabel}${entry.score.toLocaleString().padStart(10)}`;
                }),
            );

            const embed = new EmbedBuilder()
                .setColor(0x00BFFF)
                .setTitle(`Season ${currentSeason} SR Leaderboard`)
                .setDescription(table)
                .setFooter({ text: `${entries.length} guilds • Wynncraft Seasonal Rating • Page ${page + 1}/${totalPages}` })
                .setTimestamp();

            if (page === 0) embed.setImage('attachment://sr.png');
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
        console.error('Error fetching SR leaderboard:', error);
        await interaction.editReply({ content: '❌ Failed to fetch leaderboard data.' });
    }
}

async function handleGuild(interaction, tag) {
    await interaction.deferReply();

    try {
        const currentSeason = await getCurrentSeason();
        const seasonData = [];
        const seasons = [];
        for (let season = currentSeason; season >= 0; season--) {
            seasons.push(season);
        }

        for (let i = 0; i < seasons.length; i += 8) {
            const batch = seasons.slice(i, i + 8);
            const results = await Promise.allSettled(
                batch.map(async (season) => {
                    const res = await fetch(`https://api.wynncraft.com/v3/leaderboards/guildSeason${season}?resultLimit=500`);
                    if (!res.ok) return null;
                    const data = await res.json();
                    const found = Object.entries(data).find(([, guild]) => guild.prefix.toLowerCase() === tag.toLowerCase());
                    if (!found) return null;

                    return {
                        season,
                        score: found[1].score,
                        rank: parseInt(found[0], 10),
                        name: found[1].name,
                        prefix: found[1].prefix,
                    };
                })
            );

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    seasonData.push(result.value);
                }
            }
        }

        if (!seasonData.length) {
            return interaction.editReply({ content: `❌ Guild with tag **${tag}** not found in any season.` });
        }

        seasonData.sort((a, b) => b.season - a.season);
        const guildName = seasonData[0].name;
        const guildPrefix = seasonData[0].prefix;
        const totalSR = seasonData.reduce((sum, entry) => sum + entry.score, 0);
        const bestSeason = seasonData.reduce((best, entry) => entry.score > best.score ? entry : best);

        const table = buildTable(
            'Season   SR           Rank',
            seasonData.map(entry => `${String(entry.season).padEnd(9)}${entry.score.toLocaleString().padStart(11)}   #${String(entry.rank).padStart(3)}`),
        );

        const embed = new EmbedBuilder()
            .setColor(0x00BFFF)
            .setTitle(`${guildName} (${guildPrefix}) Season Rankings`)
            .setDescription(table)
            .addFields(
                { name: 'Total SR', value: totalSR.toLocaleString(), inline: true },
                { name: 'Best Season', value: `Season ${bestSeason.season} — ${bestSeason.score.toLocaleString()} SR (#${bestSeason.rank})`, inline: true },
                { name: 'Seasons Active', value: `${seasonData.length}`, inline: true },
            )
            .setFooter({ text: `${seasonData.length} season(s) • Wynncraft Seasonal Rating` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching guild SR history:', error);
        await interaction.editReply({ content: '❌ Failed to fetch guild data.' });
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

function truncateText(value, length) {
    return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

async function generateSRChart(entries, season) {
    const config = {
        type: 'bar',
        data: {
            labels: entries.map(entry => `[${entry.prefix}] ${entry.name}`),
            datasets: [{
                label: 'SR',
                data: entries.map(entry => entry.score),
                backgroundColor: '#00BFFF88',
                borderColor: '#00BFFF',
                borderWidth: 2,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                title: {
                    display: true,
                    text: `Season ${season} SR Leaderboard`,
                    color: '#ffffff',
                    font: { size: 16, weight: 'bold' }
                },
                legend: { display: false }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        color: '#aaaaaa',
                        callback: value => value >= 1000 ? `${(value / 1000).toFixed(0)}K` : value
                    },
                    grid: { color: '#3a3c4266' }
                },
                y: {
                    ticks: { color: '#ffffff', font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    };

    return chartCanvas.renderToBuffer(config);
}
