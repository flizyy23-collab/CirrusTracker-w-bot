const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { config } = require("../../core/config");
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const width = 800;
const height = 400;
const chartCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#2b2d31' });
const ITEMS_PER_PAGE = 10;
const COLLECTOR_TIME = 600000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gxp')
        .setDescription('Guild XP leaderboard')
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View guild XP leaderboard'))
        .addSubcommand(sub =>
            sub.setName('player')
                .setDescription('View a player\'s GXP contribution')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Minecraft username')
                        .setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'leaderboard') return handleLeaderboard(interaction);
        if (sub === 'player') return handlePlayer(interaction);
    }
};

async function handleLeaderboard(interaction) {
    await interaction.deferReply();

    try {
        const guildTag = config.get("guild-tag");
        const res = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guildTag}`);
        if (!res.ok) {
            return interaction.editReply({ content: '❌ Failed to fetch guild data from Wynncraft API.' });
        }

        const guild = await res.json();
        const entries = [];
        const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];

        for (const rank of ranks) {
            const members = guild.members[rank];
            if (!members) continue;
            for (const [username, data] of Object.entries(members)) {
                entries.push({ name: username, xp: data.contributed || 0 });
            }
        }

        entries.sort((a, b) => b.xp - a.xp);
        if (!entries.length) {
            return interaction.editReply({ content: '❌ No guild XP data available.' });
        }

        const chartBuffer = await generateGxpChart(entries.slice(0, ITEMS_PER_PAGE), guild.name);
        const attachment = new AttachmentBuilder(chartBuffer, { name: 'gxp.png' });
        const totalPages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
        let currentPage = 0;

        const buildEmbed = (page) => {
            const start = page * ITEMS_PER_PAGE;
            const pageEntries = entries.slice(start, start + ITEMS_PER_PAGE);
            const table = buildTable(
                '#   Player                GXP',
                pageEntries.map((entry, index) => `${String(start + index + 1).padEnd(4)}${truncateText(entry.name, 20).padEnd(20)}${getAbbreviatedNumber(entry.xp).padStart(10)}`),
            );

            const embed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle(`Guild XP Leaderboard — ${guild.name}`)
                .setDescription(table)
                .setFooter({ text: `${entries.length} total members • Page ${page + 1}/${totalPages}` })
                .setTimestamp();

            if (page === 0) embed.setImage('attachment://gxp.png');
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
        console.error('Error fetching GXP leaderboard:', error);
        await interaction.editReply({ content: '❌ Failed to fetch guild XP data.' });
    }
}

async function handlePlayer(interaction) {
    await interaction.deferReply();

    const name = interaction.options.getString('name');

    try {
        const guildTag = config.get("guild-tag");
        const res = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guildTag}`);
        if (!res.ok) {
            return interaction.editReply({ content: '❌ Failed to fetch guild data.' });
        }

        const guild = await res.json();
        const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
        let playerData = null;
        let playerRank = null;

        for (const rank of ranks) {
            const members = guild.members[rank];
            if (!members) continue;
            for (const [username, data] of Object.entries(members)) {
                if (username.toLowerCase() === name.toLowerCase()) {
                    playerData = { username, ...data };
                    playerRank = rank;
                    break;
                }
            }
            if (playerData) break;
        }

        if (!playerData) {
            return interaction.editReply({ content: `❌ **${name}** not found in the guild.` });
        }

        const allMembers = [];
        for (const rank of ranks) {
            const members = guild.members[rank];
            if (!members) continue;
            for (const [username, data] of Object.entries(members)) {
                allMembers.push({ username, xp: data.contributed || 0 });
            }
        }
        allMembers.sort((a, b) => b.xp - a.xp);
        const position = allMembers.findIndex(member => member.username.toLowerCase() === name.toLowerCase()) + 1;

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`${playerData.username} — Guild XP`)
            .setThumbnail(`https://vzge.me/bust/128/${playerData.username}`)
            .setDescription(
                `**Contributed:** ${getAbbreviatedNumber(playerData.contributed || 0)}\n` +
                `**Rank:** #${position} / ${allMembers.length}\n` +
                `**Guild Rank:** ${playerRank.charAt(0).toUpperCase() + playerRank.slice(1)}`
            )
            .setFooter({ text: guild.name })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching player GXP:', error);
        await interaction.editReply({ content: '❌ Failed to fetch player GXP data.' });
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

async function generateGxpChart(entries, guildName) {
    const totalXp = entries.reduce((sum, entry) => sum + entry.xp, 0);
    const subtitle = `Total shown: ${getAbbreviatedNumber(totalXp)}`;

    const config = {
        type: 'bar',
        data: {
            labels: entries.map(entry => entry.name),
            datasets: [{
                label: 'GXP',
                data: entries.map(entry => entry.xp),
                backgroundColor: '#2ECC7188',
                borderColor: '#2ECC71',
                borderWidth: 2,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                title: {
                    display: true,
                    text: [`Guild XP Leaderboard — ${guildName}`, subtitle],
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
                        callback: value => getAbbreviatedNumber(value)
                    },
                    grid: { color: '#3a3c4266' }
                },
                y: {
                    ticks: { color: '#ffffff', font: { size: 12 } },
                    grid: { display: false }
                }
            }
        }
    };

    return chartCanvas.renderToBuffer(config);
}

function getAbbreviatedNumber(number) {
    if (number >= 1000000000) return `${(number / 1000000000).toFixed(1).replace(/\.0$/, '')}B`;
    if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return number.toString();
}
