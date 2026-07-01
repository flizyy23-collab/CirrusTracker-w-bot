const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../../core/config");
const path = require('path');
const fs = require('fs');

const TERRITORIES_PATH = path.join(__dirname, '../../assets/territories.json');
let territoryData = null;

function loadTerritoryData() {
    if (!territoryData) {
        territoryData = JSON.parse(fs.readFileSync(TERRITORIES_PATH, 'utf8'));
    }
    return territoryData;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hq')
        .setDescription('Find the best HQ locations for a guild\'s territories')
        .addStringOption(option =>
            option.setName('guild')
                .setDescription('Guild tag (default: your guild)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const guildTag = interaction.options.getString('guild') || config.get("guild-tag");
            const territories = loadTerritoryData();

            // Fetch current territory ownership
            const res = await fetch('https://api.wynncraft.com/v3/guild/list/territory');
            if (!res.ok) {
                return interaction.editReply({ content: '❌ Failed to fetch territory data.' });
            }
            const liveData = await res.json();

            // Find territories owned by this guild
            const ownedTerritories = {};
            let guildName = guildTag;
            for (const [terrName, data] of Object.entries(liveData)) {
                if (data.guild.prefix.toLowerCase() === guildTag.toLowerCase()) {
                    ownedTerritories[terrName] = data;
                    guildName = data.guild.name;
                }
            }

            if (Object.keys(ownedTerritories).length === 0) {
                return interaction.editReply({ content: `❌ Guild **${guildTag}** doesn't hold any territories.` });
            }

            // Score each territory as a potential HQ
            const scores = [];

            for (const hqCandidate of Object.keys(ownedTerritories)) {
                const connections = [];
                const externals = [];
                const visited = new Set();
                const queue = [{ name: hqCandidate, dist: 0 }];

                while (queue.length > 0) {
                    const { name: current, dist } = queue.shift();
                    if (visited.has(current) || dist > 3) continue;
                    visited.add(current);

                    if (dist === 1 && current in ownedTerritories) {
                        connections.push(current);
                    }

                    if (dist > 0 && current in ownedTerritories && current !== hqCandidate) {
                        externals.push(current);
                    }

                    // Get trading routes from static data
                    const terrInfo = territories[current];
                    if (terrInfo && terrInfo['Trading Routes']) {
                        for (const conn of terrInfo['Trading Routes']) {
                            if (!visited.has(conn)) {
                                queue.push({ name: conn, dist: dist + 1 });
                            }
                        }
                    }
                }

                const multiplier = (1.5 + (externals.length * 0.25)) * (1.0 + (connections.length * 0.30));
                const score = Math.round(multiplier * 100);

                scores.push({
                    territory: hqCandidate,
                    score,
                    connections: connections.length,
                    externals: externals.length
                });
            }

            // Sort by score descending
            scores.sort((a, b) => b.score - a.score);

            // Display top 15
            const top = scores.slice(0, 15);
            
            // Build formatted table
            const header = '#   Territory                 Strength';
            const separator = '─'.repeat(56);
            const lines = top.map((s, i) => {
                const rank = (i + 1).toString().padEnd(4);
                const name = s.territory.padEnd(25);
                return `${rank}${name}${s.score}% - Conns: ${s.connections}, Exts: ${s.externals}`;
            });

            const tableContent = `\`\`\`\n${header}\n${separator}\n${lines.join('\n')}\n\`\`\``;

            const embed = new EmbedBuilder()
                .setColor(0xF39C12)
                .setTitle(`Best HQ Locations — ${guildName} [${guildTag.toUpperCase()}]`)
                .setDescription(tableContent)
                .setFooter({ text: `${Object.keys(ownedTerritories).length} territories • Higher % = better HQ` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in /hq:', error);
            await interaction.editReply({ content: '❌ Failed to calculate HQ locations.' });
        }
    }
};
