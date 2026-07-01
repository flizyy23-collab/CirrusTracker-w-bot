const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getPlaytime } = require("../../features/playtime/playtime-service");
const { getPlayerWars } = require("../../features/wars/wars-service");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View a player\'s overview stats')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Minecraft username')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        const name = interaction.options.getString('name');

        try {
            // Fetch player data from Wynncraft API
            const res = await fetch(`https://api.wynncraft.com/v3/player/${name}?fullResult`);
            if (!res.ok) {
                return interaction.editReply({ content: `❌ Player **${name}** not found on Wynncraft.` });
            }
            const player = await res.json();

            // Class levels (sorted highest to lowest by combat level)
            const classes = [];
            if (player.characters) {
                for (const [id, char] of Object.entries(player.characters)) {
                    classes.push({
                        type: char.type,
                        level: char.level,
                        totalLevel: char.totalLevel
                    });
                }
            }
            classes.sort((a, b) => b.level - a.level);
            const topClasses = classes.slice(0, 8);
            const classLines = topClasses.map(c =>
                `**${c.type}** — Lv ${c.level} (Total: ${c.totalLevel})`
            );

            // Playtime (last 14 days from tracking + all-time from API)
            const allTimeHours = player.playtime || 0;
            const allTimeH = Math.floor(allTimeHours);
            const allTimeM = Math.round((allTimeHours - allTimeH) * 60);

            const tracked = await getPlaytime(player.username, 336); // 14 days
            const trackedH = Math.floor(tracked.total_minutes / 60);
            const trackedM = tracked.total_minutes % 60;
            const dailyAvg = tracked.total_minutes > 0 ? Math.round(tracked.total_minutes / 14) : 0;
            const avgH = Math.floor(dailyAvg / 60);
            const avgM = dailyAvg % 60;

            // Raids
            const totalRaids = player.globalData?.raids?.total || 0;
            const raidList = player.globalData?.raids?.list || {};

            // Wars
            const totalWars = player.globalData?.wars || 0;
            const warData = await getPlayerWars(player.username, 336); // 14 days
            const warsGained = warData ? warData.gained : 0;

            // Guild info
            const guild = player.guild;
            const guildStr = guild ? `${guild.name} [${guild.prefix}] — ${guild.rank}` : 'None';

            // Build embed
            const embed = new EmbedBuilder()
                .setColor(0x00BFFF)
                .setTitle(player.username)
                .setThumbnail(`https://vzge.me/bust/256/${player.uuid}`)
                .addFields(
                    { name: 'Guild', value: guildStr, inline: false },
                    { name: 'Classes', value: classLines.length > 0 ? classLines.join('\n') : 'None', inline: false },
                    { name: 'Playtime', value: [
                        `All Time: **${allTimeH}h ${allTimeM}m**`,
                        `Last 14 days: **${trackedH}h ${trackedM}m** (${tracked.session_count} sessions)`,
                        `Daily avg (14d): **${avgH}h ${avgM}m**`,
                    ].join('\n'), inline: false },
                    { name: 'Wars', value: `Total: **${totalWars.toLocaleString()}**\nLast 14 days: **+${warsGained.toLocaleString()}**`, inline: true },
                    { name: 'Raids', value: `Total: **${totalRaids.toLocaleString()}**`, inline: true },
                )
                .setFooter({ text: `Last seen: ${player.lastJoin ? new Date(player.lastJoin).toLocaleDateString() : 'Unknown'}` })
                .setTimestamp();

            // Add raid breakdown if they have raids
            if (Object.keys(raidList).length > 0) {
                const raidLines = Object.entries(raidList)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([raid, count]) => `${raid}: ${count}`);
                embed.addFields({ name: 'Raid Breakdown (Top 5)', value: `\`\`\`${raidLines.join('\n')}\`\`\``, inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in /check:', error);
            await interaction.editReply({ content: '❌ Failed to fetch player data.' });
        }
    }
};
