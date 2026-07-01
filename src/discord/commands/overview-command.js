const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../../core/config");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('overview')
        .setDescription('View a guild overview')
        .addStringOption(option =>
            option.setName('guild')
                .setDescription('Guild tag (default: your guild)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const guildTag = interaction.options.getString('guild') || config.get("guild-tag");

            // Fetch guild data
            const res = await fetch(`https://api.wynncraft.com/v3/guild/prefix/${guildTag}`);
            if (!res.ok) {
                return interaction.editReply({ content: `❌ Guild **${guildTag}** not found.` });
            }
            const guild = await res.json();

            // Count members and online
            const ranks = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
            let totalMembers = 0;
            let onlineCount = 0;
            let owner = 'Unknown';
            const topContributors = [];

            for (const rank of ranks) {
                const members = guild.members[rank];
                if (!members) continue;
                for (const [username, data] of Object.entries(members)) {
                    totalMembers++;
                    if (data.online) onlineCount++;
                    if (rank === 'owner') owner = username;
                    topContributors.push({ username, xp: data.contributed || 0 });
                }
            }

            topContributors.sort((a, b) => b.xp - a.xp);
            const top3 = topContributors.slice(0, 3).map((c, i) => {
                const xpStr = abbreviateNumber(c.xp);
                return `${i + 1}. **${c.username}** — ${xpStr}`;
            }).join('\n');

            // Season ratings
            const seasonRanks = guild.seasonRanks || {};
            const seasonEntries = Object.entries(seasonRanks)
                .map(([season, data]) => ({ season, rating: data.rating }))
                .sort((a, b) => parseInt(b.season.replace('season', '')) - parseInt(a.season.replace('season', '')));
            const last3Seasons = seasonEntries.slice(0, 3).map((s, i) => {
                return `${i + 1}. Season ${s.season.replace('season', '')} — **${s.rating.toLocaleString()}** SR`;
            }).join('\n');

            // Territory count
            const territories = guild.territories || 0;

            // Wars
            const wars = guild.wars || 0;

            // Level & XP
            const level = guild.level || 0;
            const xpPercent = guild.xpPercent || guild.xp_percent || 0;

            // Build embed
            // Guild raids total
            let totalGraids = 0;
            for (const rank of ranks) {
                const members = guild.members[rank];
                if (!members) continue;
                for (const [, data] of Object.entries(members)) {
                    totalGraids += data.globalData?.guildRaids?.total || 0;
                }
            }

            // Build embed with markdown description
            const embed = new EmbedBuilder()
                .setColor(0x00BFFF)
                .setTitle(`${guild.name} [${guild.prefix}]`)
                .setDescription(
                    `### General\n` +
                    `> **Owner:** ${owner}\n` +
                    `> **Online:** ${onlineCount}/${totalMembers}\n` +
                    `> **Level:** ${level} (${xpPercent}% to next)\n` +
                    `> **Members:** ${totalMembers}\n\n` +
                    `### Stats\n` +
                    `> **Territories:** ${territories}\n` +
                    `> **Wars:** ${wars.toLocaleString()}\n` +
                    `> **Guild Raids:** ${totalGraids.toLocaleString()}\n\n` +
                    (last3Seasons.length > 0 ? `### Last 3 Seasons\n${last3Seasons}\n\n` : '') +
                    `### Top Contributors\n${top3}`
                );

            embed.setFooter({ text: `Created: ${new Date(guild.created).toLocaleDateString('en-GB')}` })
                .setTimestamp();

            // Try to get guild banner as thumbnail
            if (guild.banner && guild.banner.base) {
                let bannerUrl = `https://banner.weikuwu.me/api/bannerCreate?filetype=png&base=${guild.banner.base.toLowerCase()}`;
                if (guild.banner.layers && guild.banner.layers.length > 0) {
                    bannerUrl += '&layers=[';
                    const layerParts = guild.banner.layers.map(layer => {
                        let pattern = (layer.pattern || '').toLowerCase();
                        return `{"shape":"${pattern}","color":"${(layer.colour || '').toLowerCase()}"}`;
                    });
                    bannerUrl += layerParts.join(',') + ']';
                }
                embed.setThumbnail(bannerUrl);
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in /overview:', error);
            await interaction.editReply({ content: '❌ Failed to fetch guild data.' });
        }
    }
};

function abbreviateNumber(number) {
    if (number >= 1000000000) return (number / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
    if (number >= 1000000) return (number / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (number >= 1000) return (number / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return number.toString();
}
