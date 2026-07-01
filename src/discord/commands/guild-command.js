const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const { config } = require("../../core/config");
const { getGuildLeaderboard } = require("../../features/guild-tracking/guild-tracking-service");

const TABS = [
    { label: '3-6 days', minMs: 3 * 86400000, maxMs: 7 * 86400000 },
    { label: '7-13 days', minMs: 7 * 86400000, maxMs: 14 * 86400000 },
    { label: '14-20 days', minMs: 14 * 86400000, maxMs: 21 * 86400000 },
    { label: '21-30 days', minMs: 21 * 86400000, maxMs: 31 * 86400000 },
    { label: '30 days+', minMs: 31 * 86400000, maxMs: Infinity },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guild')
        .setDescription('Guild management commands')
        .addSubcommand(sub =>
            sub.setName('inactivity')
                .setDescription('Check inactive guild members grouped by duration'))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('Guild leaderboard between guilds')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Leaderboard type')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Wars', value: 'wars' },
                            { name: 'Guild Raids', value: 'graids' },
                            { name: 'Online Members', value: 'online' }
                        ))
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Time period')
                        .addChoices(
                            { name: 'Last 3 days', value: '3' },
                            { name: 'Last 7 days', value: '7' },
                            { name: 'Last 2 weeks', value: '14' },
                            { name: 'Last 3 weeks', value: '21' },
                            { name: 'All time', value: '0' }
                        ))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'inactivity') return handleInactivity(interaction);
        if (sub === 'leaderboard') return handleGuildLeaderboard(interaction);
    }
};

async function handleInactivity(interaction) {
    await interaction.deferReply();

    try {
        const guildTag = config.get("guild-tag");
        const res = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guildTag}`);
        if (!res.ok) {
            return interaction.editReply({ content: '❌ Failed to fetch guild data.' });
        }
        const guild = await res.json();

        // Collect all members with lastJoin from guild API directly
        const now = Date.now();
        const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
        const offlinePlayers = [];

        for (const rank of ranks) {
            const members = guild.members[rank];
            if (!members) continue;
            for (const [username, data] of Object.entries(members)) {
                if (data.online || !data.lastJoin) continue;
                const lastJoinMs = new Date(data.lastJoin).getTime();
                const inactiveMs = now - lastJoinMs;
                if (inactiveMs >= TABS[0].minMs) {
                    offlinePlayers.push({
                        name: username,
                        lastJoin: lastJoinMs,
                        inactiveMs: inactiveMs
                    });
                }
            }
        }

        offlinePlayers.sort((a, b) => b.inactiveMs - a.inactiveMs);

        console.log(`Guild inactivity: found ${offlinePlayers.length} inactive players`);

        // Group into tabs
        const tabData = TABS.map(tab => ({
            label: tab.label,
            players: offlinePlayers.filter(p => p.inactiveMs >= tab.minMs && p.inactiveMs < tab.maxMs)
        }));

        // Build embeds for each tab
        const embeds = tabData.map((tab, i) => {
            const embed = new EmbedBuilder()
                .setColor(0xFF6B6B)
                .setTitle(`Inactivity — ${tab.label}`)
                .setFooter({ text: `Page ${i + 1}/${TABS.length} • ${guild.name} • ${offlinePlayers.length} inactive members total` })
                .setTimestamp();

            if (tab.players.length === 0) {
                embed.setDescription('No inactive members in this range.');
            } else {
                const lines = tab.players.map(p => {
                    const d = new Date(p.lastJoin);
                    const dd = String(d.getDate()).padStart(2, '0');
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const yyyy = d.getFullYear();
                    const unix = Math.floor(p.lastJoin / 1000);
                    return `**${p.name}** — Last online ${dd}/${mm}/${yyyy} (<t:${unix}:R>)`;
                });
                embed.setDescription(lines.join('\n'));
            }

            return embed;
        });

        let currentPage = 0;

        const getRow = (page) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('inactivity_back')
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('inactivity_next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === embeds.length - 1),
            );
        };

        const message = await interaction.editReply({
            embeds: [embeds[currentPage]],
            components: [getRow(currentPage)]
        });

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120000
        });

        collector.on('collect', async (btn) => {
            if (btn.user.id !== interaction.user.id) {
                return btn.reply({ content: 'Only the command user can navigate.', ephemeral: true });
            }

            if (btn.customId === 'inactivity_back') currentPage--;
            if (btn.customId === 'inactivity_next') currentPage++;

            await btn.update({
                embeds: [embeds[currentPage]],
                components: [getRow(currentPage)]
            });
        });

        collector.on('end', async () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('inactivity_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('inactivity_next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(true),
            );
            await message.edit({ components: [disabledRow] }).catch(() => {});
        });

    } catch (error) {
        console.error('Error in /guild inactivity:', error);
        await interaction.editReply({ content: '❌ Failed to fetch inactivity data.' });
    }
}

async function handleGuildLeaderboard(interaction) {
    await interaction.deferReply();

    const type = interaction.options.getString('type');
    const timeframe = parseInt(interaction.options.getString('timeframe') || '0');

    try {
        let entries;

        // For all-time, use Wynncraft API directly (more complete data)
        if (timeframe === 0) {
            if (type === 'wars') {
                const res = await fetch('https://api.wynncraft.com/v3/leaderboards/guildWars?resultLimit=20');
                if (!res.ok) return interaction.editReply({ content: '❌ Failed to fetch leaderboard.' });
                const data = await res.json();
                entries = Object.entries(data)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([, g]) => ({ guild_prefix: g.prefix, guild_name: g.name, value: g.wars }));
            } else if (type === 'graids') {
                const res = await fetch('https://api.wynncraft.com/v3/leaderboards/guildTotalRaids?resultLimit=20');
                if (!res.ok) return interaction.editReply({ content: '❌ Failed to fetch leaderboard.' });
                const data = await res.json();
                entries = Object.entries(data)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([, g]) => ({ guild_prefix: g.prefix, guild_name: g.name, value: g.metadata?.completions || g.score || 0 }));
            } else {
                // Online: use tracked data or fallback message
                entries = await getGuildLeaderboard(type, timeframe);
            }
        } else {
            // Timeframe-based: use tracked data
            entries = await getGuildLeaderboard(type, timeframe);
        }

        if (!entries || entries.length === 0) {
            return interaction.editReply({ content: '❌ No data available yet. The bot needs at least one snapshot cycle (3h) to show timeframe data.' });
        }

        const periodLabels = { 0: 'All Time', 3: 'Last 3 Days', 7: 'Last 7 Days', 14: 'Last 2 Weeks', 21: 'Last 3 Weeks' };
        const periodLabel = periodLabels[timeframe] || 'All Time';
        const typeLabels = { wars: 'Wars', graids: 'Graids', online: 'Online Members' };
        const typeLabel = typeLabels[type];
        const colors = { wars: 0xFF4444, graids: 0x2ECC71, online: 0x00BFFF };

        const header = '#   Guild                      Value';
        const separator = '─'.repeat(45);
        const lines = entries.map((g, i) => {
            const rank = (i + 1).toString().padEnd(4);
            const name = `[${g.guild_prefix}] ${g.guild_name}`.padEnd(27);
            const val = type === 'online' ? `${g.value} avg` : (timeframe > 0 ? `+${Number(g.value).toLocaleString()}` : Number(g.value).toLocaleString());
            return `${rank}${name}${val}`;
        });

        const tableContent = `\`\`\`\n${header}\n${separator}\n${lines.join('\n')}\n\`\`\``;

        const embed = new EmbedBuilder()
            .setColor(colors[type])
            .setTitle(`Guild ${typeLabel} Leaderboard`)
            .setDescription(tableContent)
            .setFooter({ text: `Top ${entries.length} guilds (lvl 80+) • ${periodLabel}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in /guild leaderboard:', error);
        await interaction.editReply({ content: '❌ Failed to fetch guild leaderboard.' });
    }
}
