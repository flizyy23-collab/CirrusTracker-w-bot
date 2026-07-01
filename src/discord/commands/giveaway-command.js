const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { createGiveaway, setGiveawayMessageId, getGiveaway, getGiveawayByMessageId, getGiveawayByTitle, addGiveawayEntry, endGiveaway, getActiveGiveaways, getAccountLink, getAccountLinkByUsername, getLeaderboard, getGXPLeaderboard, updateGiveawayWeights, fetchLiveGuildMembers, setGiveawayWeightConfig } = require("../../core/database");

const GIVEAWAY_ROLE_ID = "1469399156228493343";
const GIVEAWAY_ANNOUNCE_CHANNEL = "1515140551069007902";

const MODE_LABELS = {
    equal: 'Equal',
    raids: 'Raids Weighted',
    xp: 'GXP Weighted',
    manual: 'Manual Weights',
    guild_roster: 'Guild Roster — Equal',
    guild_roster_raids: 'Guild Roster — Raids Weighted',
    guild_roster_xp: 'Guild Roster — GXP Weighted',
    guild_roster_manual: 'Guild Roster — Manual Weights'
};

function parseDuration(str) {
    const regex = /(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)/gi;
    let total = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
        const num = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        if (unit.startsWith('m')) total += num * 60 * 1000;
        else if (unit.startsWith('h')) total += num * 60 * 60 * 1000;
        else if (unit.startsWith('d')) total += num * 24 * 60 * 60 * 1000;
    }
    return total > 0 ? total : null;
}

function buildGiveawayEmbed(giveaway, ended = false) {
    const prizes = giveaway.prizes || [];
    const prizeList = prizes.length > 0 ? prizes.map((p, i) => `> **${i + 1}.** ${p}`).join('\n') : '> No prizes specified';
    const entries = giveaway.entries || [];
    const mode = giveaway.mode || 'equal';
    const isGuildRoster = mode.startsWith('guild_roster');

    const embed = new EmbedBuilder()
        .setColor(ended ? 0x95A5A6 : 0xF1C40F)
        .setTitle(`🎉  ${giveaway.title}`);

    if (ended) {
        const winners = giveaway.winners || [];
        const prizeAssignments = giveaway.prize_assignments || prizes;
        const winnerText = winners.length > 0
            ? winners.map((w, i) => {
                const prize = prizeAssignments[i] || prizeAssignments[prizeAssignments.length - 1] || 'Prize';
                const display = isGuildRoster ? `**${w}**` : `<@${w}>`;
                return `🏆 ${display} — ${prize}`;
            }).join('\n')
            : '*No valid entries*';

        embed.setDescription(
            `## Prizes\n${prizeList}\n\n` +
            `## Winners\n${winnerText}\n\n` +
            `📊 **${entries.length}** entries`
        );
        embed.setFooter({ text: '🔒 Giveaway ended' });
        embed.setTimestamp();
    } else {
        const endsAtUnix = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
        const modeLabel = MODE_LABELS[mode] || 'Equal';

        let rosterInfo = '';
        if (isGuildRoster) {
            const excluded = giveaway.excluded || [];
            const totalMembers = entries.length + excluded.length;
            rosterInfo = `\n👥 **Eligible:** ${entries.length}/${totalMembers} guild members`;
        }

        let entryText;
        if (isGuildRoster) {
            entryText = `👥 All guild members are automatically entered`;
        } else {
            entryText = `📊 **${entries.length}** entries\n\n**Click the button below to enter!**`;
        }

        embed.setDescription(
            ((giveaway.weight_config?.note) ? `> *${giveaway.weight_config.note}*\n\n` : '') +
            `## Prizes\n${prizeList}\n\n` +
            `🏆 **Winners:** ${giveaway.winner_count}\n` +
            `🎲 **Mode:** ${modeLabel}` +
            `${rosterInfo}\n` +
            `⏰ **Ends:** <t:${endsAtUnix}:R> (<t:${endsAtUnix}:f>)\n\n` +
            `${entryText}`
        );
        embed.setFooter({ text: `Giveaway #${giveaway.id}` });
    }

    return embed;
}

function buildPublicEmbed(giveaway) {
    const prizes = giveaway.prizes || [];
    const prizeList = prizes.length > 0 ? prizes.map((p, i) => `> **${i + 1}.** ${p}`).join('\n') : '> TBD';
    const endsAtUnix = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
    const mode = giveaway.mode || 'equal';
    const isGuildRoster = mode.startsWith('guild_roster');
    const modeLabel = MODE_LABELS[mode] || 'Equal';
    const entries = giveaway.entries || [];

    let rosterInfo = '';
    if (isGuildRoster) {
        const excluded = giveaway.excluded || [];
        const totalMembers = entries.length + excluded.length;
        rosterInfo = `\n👥 **Eligible:** ${entries.length}/${totalMembers} guild members`;
    }

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`🎉  ${giveaway.title}`)
        .setDescription(
            ((giveaway.weight_config?.note) ? `> *${giveaway.weight_config.note}*\n\n` : '') +
            `## Prizes\n${prizeList}\n\n` +
            `🏆 **Winners:** ${giveaway.winner_count}\n` +
            `🎲 **Mode:** ${modeLabel}` +
            `${rosterInfo}\n` +
            `⏰ **Ends:** <t:${endsAtUnix}:R> (<t:${endsAtUnix}:f>)\n\n` +
            (isGuildRoster
                ? `All guild members are automatically entered. Good luck! 🍀`
                : `**Join below to enter!**`)
        )
        .setFooter({ text: 'Cirrus Giveaway' })
        .setTimestamp();

    return embed;
}

function buildGiveawayButtons(giveawayId, giveaway, disabled = false) {
    const mode = giveaway.mode || 'equal';
    const isGuildRoster = mode.startsWith('guild_roster');
    const weightMode = isGuildRoster ? (mode === 'guild_roster' ? 'equal' : mode.replace('guild_roster_', '')) : mode;
    const components = [];

    if (!isGuildRoster) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`giveaway_join_${giveawayId}`)
                .setLabel('Join Giveaway')
                .setStyle(ButtonStyle.Success)
                .setDisabled(disabled)
        );

        if (mode === 'manual' && !disabled) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`giveaway_weights_${giveawayId}`)
                    .setLabel('Manage Weights')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        components.push(row);
    }

    // Add "View Weights" button for weighted modes (not equal, not manual, not ended)
    if (!disabled && (weightMode === 'raids' || weightMode === 'xp')) {
        const viewRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`giveaway_view_weights_${giveawayId}`)
                .setLabel('📊 View Weights')
                .setStyle(ButtonStyle.Secondary)
        );
        components.push(viewRow);
    }

    return components;
}

function hasGiveawayRole(member) {
    return member.roles.cache.has(GIVEAWAY_ROLE_ID) ||
           member.permissions.has(PermissionFlagsBits.Administrator);
}

function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function pickWinnersEqual(entries, count) {
    const pool = [...entries];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(count, pool.length));
}

function pickWinnersWeighted(entries, count, weightMap) {
    const winners = [];
    const remaining = [...entries];

    for (let i = 0; i < count && remaining.length > 0; i++) {
        let totalWeight = 0;
        const cumulative = [];
        for (const entry of remaining) {
            const weight = weightMap[entry] || 1;
            totalWeight += weight;
            cumulative.push({ entry, cumWeight: totalWeight });
        }

        const roll = Math.random() * totalWeight;
        let picked = remaining[0];
        for (const c of cumulative) {
            if (roll < c.cumWeight) {
                picked = c.entry;
                break;
            }
        }

        winners.push(picked);
        remaining.splice(remaining.indexOf(picked), 1);
    }

    return winners;
}

async function buildAutoWeights(entries, mode, isGuildRoster, weightConfig = {}) {
    const weightMap = {};
    let dataMap;

    // Date range filtering
    const fromDate = weightConfig.from_date || null;
    const toDate = weightConfig.to_date || null;

    if (mode === 'raids') {
        dataMap = await getLeaderboard(-1, fromDate, toDate);
    } else {
        dataMap = await getGXPLeaderboard(fromDate, toDate);
    }
    if (!dataMap || dataMap.size === 0) return weightMap;

    // Get scaling config
    let unitsPerPoint, pointValue;
    if (mode === 'raids') {
        unitsPerPoint = weightConfig.raids_per_point || 1;
        pointValue = weightConfig.raid_point_value || 1;
    } else {
        unitsPerPoint = weightConfig.gxp_per_point || 1;
        pointValue = weightConfig.gxp_point_value || 1;
    }

    if (isGuildRoster) {
        const allPlayers = await fetchLiveGuildMembers();
        for (const username of entries) {
            const player = allPlayers.find(p => p.username.toLowerCase() === username.toLowerCase());
            if (player) {
                const rawValue = dataMap.get(player.uuid) || 0;
                const scaledWeight = (rawValue / unitsPerPoint) * pointValue;
                if (scaledWeight > 0) weightMap[username] = Math.round(scaledWeight * 1000) / 1000;
            }
        }
    } else {
        for (const discordId of entries) {
            const link = await getAccountLink(discordId);
            if (link && link.minecraft_uuid) {
                const rawValue = dataMap.get(link.minecraft_uuid) || 0;
                const scaledWeight = (rawValue / unitsPerPoint) * pointValue;
                if (scaledWeight > 0) weightMap[discordId] = Math.round(scaledWeight * 1000) / 1000;
            }
        }
    }
    return weightMap;
}

async function endGiveawayById(client, giveawayId) {
    const giveaway = await getGiveaway(giveawayId);
    if (!giveaway || giveaway.ended) return null;

    const mode = giveaway.mode || 'equal';
    const isGuildRoster = mode.startsWith('guild_roster');
    // Extract weight mode: guild_roster_raids -> raids, guild_roster_xp -> xp, guild_roster -> equal
    const weightMode = isGuildRoster ? (mode === 'guild_roster' ? 'equal' : mode.replace('guild_roster_', '')) : mode;
    const weights = giveaway.weights || {};
    let winners;
    let usedWeightMap = null;

    if (Object.keys(weights).length > 0) {
        usedWeightMap = weights;
        winners = pickWinnersWeighted(giveaway.entries, giveaway.winner_count, weights);
    } else if (weightMode === 'raids' || weightMode === 'xp') {
        usedWeightMap = await buildAutoWeights(giveaway.entries, weightMode, isGuildRoster, giveaway.weight_config || {});
        winners = pickWinnersWeighted(giveaway.entries, giveaway.winner_count, usedWeightMap);
    } else {
        winners = pickWinnersEqual(giveaway.entries, giveaway.winner_count);
    }

    const shuffledPrizes = shuffleArray(giveaway.prizes || []);
    await endGiveaway(giveawayId, winners);

    giveaway.winners = winners;
    giveaway.prize_assignments = shuffledPrizes;
    giveaway.ended = true;

    try {
        const channel = await client.channels.fetch(giveaway.channel_id);
        if (channel && giveaway.message_id) {
            // Delete the original giveaway message
            try {
                const message = await channel.messages.fetch(giveaway.message_id);
                if (message) await message.delete();
            } catch (e) { /* message may already be deleted */ }

            // Build winner list and collect Discord mentions
            const mentions = [];
            const winnerLines = winners.length > 0
                ? await Promise.all(winners.map(async (w, i) => {
                    const prize = shuffledPrizes[i] || shuffledPrizes[shuffledPrizes.length - 1] || 'Prize';
                    if (isGuildRoster) {
                        const link = await getAccountLinkByUsername(w);
                        if (link && link.discord_id) {
                            mentions.push(`<@${link.discord_id}>`);
                            return `> 🏆 <@${link.discord_id}> ➜ **${prize}**`;
                        }
                        return `> 🏆 @${w} ➜ **${prize}**`;
                    } else {
                        mentions.push(`<@${w}>`);
                        return `> 🏆 <@${w}> ➜ **${prize}**`;
                    }
                }))
                : ['> No valid entries'];

            // Build top 3 highest odds section
            let top3Text = '';
            if (usedWeightMap && Object.keys(usedWeightMap).length > 0) {
                const totalWeight = Object.values(usedWeightMap).reduce((sum, w) => sum + w, 0);
                const sorted = Object.entries(usedWeightMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
                const medals = ['🥇', '🥈', '🥉'];
                const top3Lines = sorted.map(([name, w], i) => {
                    const percent = totalWeight > 0 ? ((w / totalWeight) * 100).toFixed(1) : '0.0';
                    return `> ${medals[i]} **${name}** — ${percent}%`;
                });
                top3Text = `\n\n## 📊 Highest Odds\n${top3Lines.join('\n')}`;
            }

            // Build prizes list
            const prizeList = (giveaway.prizes || []).map((p, i) => `> **${i + 1}.** ${p}`).join('\n');

            const winnerEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle(`🎉  ${giveaway.title}`)
                .setDescription(
                    `## 🎁 Prizes\n${prizeList}\n\n` +
                    `## 🏆 Winners\n${winnerLines.join('\n')}\n\n` +
                    `**Congratulations!** 🎊` +
                    top3Text +
                    `\n\n━━━━━━━━━━━━━━━━━━━━`
                )
                .setFooter({ text: `Cirrus Giveaway · ${winners.length} winner${winners.length !== 1 ? 's' : ''} · Giveaway #${giveawayId}` })
                .setTimestamp();

            // Put mentions in content so winners get pinged
            let pingText;
            if (mentions.length > 0) {
                pingText = `🎉 Congratulations ${mentions.join(' ')}!`;
            } else {
                pingText = `🎉 <@&1459228727341744273> — Giveaway winners announced!`;
            }
            await channel.send({
                content: pingText,
                embeds: [winnerEmbed]
            });
        }
    } catch (err) {
        console.error("Error updating giveaway message:", err.message);
    }

    return giveaway;
}

let giveawayTimers = new Map();

function scheduleGiveawayEnd(client, giveawayId, endsAt) {
    const delay = new Date(endsAt).getTime() - Date.now();
    if (delay <= 0) {
        endGiveawayById(client, giveawayId);
        return;
    }
    const cappedDelay = Math.min(delay, 24 * 60 * 60 * 1000);
    const timer = setTimeout(async () => {
        giveawayTimers.delete(giveawayId);
        const giveaway = await getGiveaway(giveawayId);
        if (!giveaway || giveaway.ended) return;
        const remaining = new Date(giveaway.ends_at).getTime() - Date.now();
        if (remaining <= 1000) {
            await endGiveawayById(client, giveawayId);
        } else {
            scheduleGiveawayEnd(client, giveawayId, giveaway.ends_at);
        }
    }, cappedDelay);
    giveawayTimers.set(giveawayId, timer);
}

async function restoreGiveawayTimers(client) {
    const active = await getActiveGiveaways();
    for (const g of active) {
        scheduleGiveawayEnd(client, g.id, g.ends_at);
    }
    if (active.length > 0) console.log(`Restored ${active.length} active giveaway timer(s)`);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage giveaways')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Create a new giveaway')
                .addStringOption(opt => opt.setName('title').setDescription('Giveaway title').setRequired(true))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 30m, 2h, 1d 10h)').setRequired(true))
                .addStringOption(opt => opt.setName('prizes').setDescription('Prizes (comma separated for multiple)').setRequired(true))
                .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(20))
                .addStringOption(opt => opt.setName('mode').setDescription('Winner selection mode').setRequired(true)
                    .addChoices(
                        { name: 'Equal', value: 'equal' },
                        { name: 'Raids Weighted', value: 'raids' },
                        { name: 'GXP Weighted', value: 'xp' },
                        { name: 'Manual Weights', value: 'manual' }
                    ))
                .addStringOption(opt => opt.setName('entry_type').setDescription('How players enter').setRequired(true)
                    .addChoices(
                        { name: 'Guild Roster', value: 'guild_roster' },
                        { name: 'Click to Join', value: 'click_to_join' }
                    ))
                .addStringOption(opt => opt.setName('note').setDescription('Optional message to display on the giveaway').setRequired(false))
                .addStringOption(opt => opt.setName('from_date').setDescription('Weight data start date (DD-MM-YYYY) — only count raids/GXP from this date').setRequired(false))
                .addStringOption(opt => opt.setName('to_date').setDescription('Weight data end date (DD-MM-YYYY) — only count raids/GXP until this date').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('manage')
                .setDescription('Manage a guild roster giveaway (exclude players, set weights)')
                .addStringOption(opt => opt.setName('title').setDescription('Giveaway title').setRequired(true))
                .addStringOption(opt => opt.setName('action').setDescription('What to manage')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Exclude players', value: 'exclude' },
                        { name: 'Set manual weights', value: 'weights' },
                        { name: 'Set raid weight scale', value: 'raid_scale' },
                        { name: 'Set GXP weight scale', value: 'gxp_scale' },
                        { name: 'View status', value: 'status' }
                    ))
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('End a giveaway early')
                .addStringOption(opt => opt.setName('title').setDescription('Giveaway title').setRequired(true))
        ),

    async execute(interaction) {
        // Restrict to giveaway channels only
        const allowedGiveawayChannels = [GIVEAWAY_ANNOUNCE_CHANNEL, '1485449189004546258'];
        if (!allowedGiveawayChannels.includes(interaction.channelId)) {
            return interaction.reply({ content: `Giveaway commands can only be used in <#${GIVEAWAY_ANNOUNCE_CHANNEL}>.`, ephemeral: true });
        }

        if (!hasGiveawayRole(interaction.member)) {
            return interaction.reply({ content: `You need the <@&${GIVEAWAY_ROLE_ID}> role to manage giveaways.`, ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'create') {
            const title = interaction.options.getString('title');
            const durationStr = interaction.options.getString('duration');
            const prizesStr = interaction.options.getString('prizes');
            const winnerCount = interaction.options.getInteger('winners');
            const mode = interaction.options.getString('mode');
            const entryType = interaction.options.getString('entry_type');
            const note = interaction.options.getString('note') || null;
            const isGuildRoster = entryType === 'guild_roster';

            const durationMs = parseDuration(durationStr);
            if (!durationMs) {
                return interaction.reply({ content: 'Invalid duration. Use format like `30m`, `2h`, or `1d 10h`.', ephemeral: true });
            }

            const prizes = prizesStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
            const endsAt = new Date(Date.now() + durationMs);

            await interaction.deferReply({ ephemeral: true });

            // For guild roster, populate entries with all guild members
            let initialEntries = null;
            if (isGuildRoster) {
                const guildMembers = await fetchLiveGuildMembers();
                if (!guildMembers || guildMembers.length === 0) {
                    return interaction.editReply('Failed to fetch guild members from Wynncraft API.');
                }
                initialEntries = guildMembers.map(m => m.username);
            }

            // Store mode: for guild_roster combine with weight mode (e.g. guild_roster, guild_roster_raids)
            const dbMode = isGuildRoster ? (mode === 'equal' ? 'guild_roster' : `guild_roster_${mode}`) : mode;

            const giveawayId = await createGiveaway(
                interaction.channelId,
                interaction.user.id,
                title,
                prizes,
                winnerCount,
                endsAt,
                dbMode,
                true
            );

            if (!giveawayId) {
                return interaction.editReply('Failed to create giveaway. Try again later.');
            }

            // Parse and store date range for weighted modes
            const fromDateStr = interaction.options.getString('from_date');
            const toDateStr = interaction.options.getString('to_date');
            if (fromDateStr || toDateStr || note) {
                const weightConfig = {};
                if (fromDateStr) {
                    const parts = fromDateStr.split('-');
                    if (parts.length === 3) {
                        const parsed = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
                        if (!isNaN(parsed.getTime())) weightConfig.from_date = parsed.toISOString();
                    }
                }
                if (toDateStr) {
                    const parts = toDateStr.split('-');
                    if (parts.length === 3) {
                        const parsed = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T23:59:59`);
                        if (!isNaN(parsed.getTime())) weightConfig.to_date = parsed.toISOString();
                    }
                }
                if (note) {
                    weightConfig.note = note;
                }
                if (Object.keys(weightConfig).length > 0) {
                    await setGiveawayWeightConfig(giveawayId, weightConfig);
                }
            }

            // Set initial entries for guild roster mode
            if (initialEntries) {
                const { setGiveawayEntries } = require('../../core/database');
                await setGiveawayEntries(giveawayId, initialEntries);
            }

            const giveaway = await getGiveaway(giveawayId);

            // Send the clean public embed as a separate message in this channel
            const publicEmbed = buildPublicEmbed(giveaway);
            const publicComponents = [];
            if (!isGuildRoster) {
                publicComponents.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`giveaway_join_${giveawayId}`)
                        .setLabel('🎉 Join Giveaway')
                        .setStyle(ButtonStyle.Success)
                ));
            }
            // Add View Weights button for raids/xp weighted modes
            if (mode === 'raids' || mode === 'xp') {
                publicComponents.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`giveaway_view_weights_${giveawayId}`)
                        .setLabel('📊 View Weights')
                        .setStyle(ButtonStyle.Secondary)
                ));
            }
            const sent = await interaction.channel.send({ embeds: [publicEmbed], components: publicComponents });
            await setGiveawayMessageId(giveawayId, sent.id);
            scheduleGiveawayEnd(interaction.client, giveawayId, endsAt);

            await interaction.editReply({ content: `✅ Giveaway **${title}** created.` });

        } else if (sub === 'manage') {
            const title = interaction.options.getString('title');
            const action = interaction.options.getString('action');
            const giveaway = await getGiveawayByTitle(title);

            if (!giveaway) return interaction.reply({ content: `No giveaway found with title "${title}".`, ephemeral: true });
            if (giveaway.ended) return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
            if (!giveaway.mode.startsWith('guild_roster')) return interaction.reply({ content: 'The manage command is only for Guild Roster giveaways.', ephemeral: true });

            if (action === 'status') {
                const entries = giveaway.entries || [];
                const excluded = giveaway.excluded || [];
                const weights = giveaway.weights || {};

                let desc = `**Eligible players** (${entries.length}):\n`;
                desc += entries.map(e => {
                    const w = weights[e];
                    return w ? `${e} (${w}x)` : e;
                }).join(', ');

                if (excluded.length > 0) {
                    desc += `\n\n**Excluded** (${excluded.length}):\n${excluded.join(', ')}`;
                }

                const embed = new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle(`${giveaway.title} — Status`)
                    .setDescription(desc.substring(0, 4096));

                return interaction.reply({ embeds: [embed], ephemeral: true });

            } else if (action === 'exclude') {
                const excluded = giveaway.excluded || [];
                const prefill = excluded.join('\n');

                const modal = new ModalBuilder()
                    .setCustomId(`giveaway_exclude_modal_${giveaway.id}`)
                    .setTitle('Exclude Players');

                const input = new TextInputBuilder()
                    .setCustomId('exclude_input')
                    .setLabel('Players to exclude (one per line)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('PlayerName1\nPlayerName2')
                    .setRequired(false);

                if (prefill) input.setValue(prefill);

                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);

            } else if (action === 'weights') {
                const weights = giveaway.weights || {};
                const prefill = Object.entries(weights).map(([name, w]) => `${name}: ${w}`).join('\n');

                const modal = new ModalBuilder()
                    .setCustomId(`giveaway_weights_modal_${giveaway.id}`)
                    .setTitle('Set Player Weights');

                const input = new TextInputBuilder()
                    .setCustomId('weights_input')
                    .setLabel('Weights (one per line: Name: Weight)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('PlayerName: 5\nAnotherPlayer: 3')
                    .setRequired(true);

                if (prefill) input.setValue(prefill);

                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);

            } else if (action === 'raid_scale') {
                const config = giveaway.weight_config || {};
                const modal = new ModalBuilder()
                    .setCustomId(`giveaway_raid_scale_modal_${giveaway.id}`)
                    .setTitle('Set Raid Weight Scale');

                const unitsInput = new TextInputBuilder()
                    .setCustomId('raids_per_point')
                    .setLabel('How many raids = 1 point of weight?')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 10 (every 10 raids = +1 weight)')
                    .setRequired(true);
                if (config.raids_per_point) unitsInput.setValue(String(config.raids_per_point));

                const valueInput = new TextInputBuilder()
                    .setCustomId('point_value')
                    .setLabel('Weight value per point')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 0.1 (each point adds 0.1 to odds)')
                    .setRequired(true);
                if (config.raid_point_value) valueInput.setValue(String(config.raid_point_value));

                modal.addComponents(
                    new ActionRowBuilder().addComponents(unitsInput),
                    new ActionRowBuilder().addComponents(valueInput)
                );
                return interaction.showModal(modal);

            } else if (action === 'gxp_scale') {
                const config = giveaway.weight_config || {};
                const modal = new ModalBuilder()
                    .setCustomId(`giveaway_gxp_scale_modal_${giveaway.id}`)
                    .setTitle('Set GXP Weight Scale');

                const unitsInput = new TextInputBuilder()
                    .setCustomId('gxp_per_point')
                    .setLabel('How much GXP = 1 point of weight?')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 1000000 (every 1M GXP = +1 weight)')
                    .setRequired(true);
                if (config.gxp_per_point) unitsInput.setValue(String(config.gxp_per_point));

                const valueInput = new TextInputBuilder()
                    .setCustomId('point_value')
                    .setLabel('Weight value per point')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 0.1 (each point adds 0.1 to odds)')
                    .setRequired(true);
                if (config.gxp_point_value) valueInput.setValue(String(config.gxp_point_value));

                modal.addComponents(
                    new ActionRowBuilder().addComponents(unitsInput),
                    new ActionRowBuilder().addComponents(valueInput)
                );
                return interaction.showModal(modal);
            }

        } else if (sub === 'end') {
            const title = interaction.options.getString('title');
            const giveaway = await getGiveawayByTitle(title);

            if (!giveaway) return interaction.reply({ content: `No giveaway found with title "${title}".`, ephemeral: true });
            if (giveaway.ended) return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            await endGiveawayById(interaction.client, giveaway.id);

            if (giveawayTimers.has(giveaway.id)) {
                clearTimeout(giveawayTimers.get(giveaway.id));
                giveawayTimers.delete(giveaway.id);
            }

            await interaction.editReply({ content: `Giveaway **${giveaway.title}** has been ended.` });

        }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;

        // View weights button
        if (customId.startsWith('giveaway_view_weights_')) {
            const giveawayId = parseInt(customId.replace('giveaway_view_weights_', ''));
            const giveaway = await getGiveaway(giveawayId);

            if (!giveaway) return interaction.reply({ content: 'This giveaway no longer exists.', ephemeral: true });
            if (giveaway.ended) return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

            const mode = giveaway.mode || 'equal';
            const isGuildRoster = mode.startsWith('guild_roster');
            const weightMode = isGuildRoster ? (mode === 'guild_roster' ? 'equal' : mode.replace('guild_roster_', '')) : mode;

            const weightMap = await buildAutoWeights(giveaway.entries, weightMode, isGuildRoster, giveaway.weight_config || {});
            const totalWeight = Object.values(weightMap).reduce((sum, w) => sum + w, 0);

            if (Object.keys(weightMap).length === 0) {
                return interaction.editReply({ content: 'No weight data available yet.' });
            }

            // Sort by weight descending
            const sorted = Object.entries(weightMap).sort((a, b) => b[1] - a[1]);
            const typeLabel = weightMode === 'raids' ? 'Raids' : 'GXP';
            const config = giveaway.weight_config || {};
            const fromDate = config.from_date ? new Date(config.from_date).toLocaleDateString('en-GB') : 'All time';
            const toDate = config.to_date ? new Date(config.to_date).toLocaleDateString('en-GB') : 'Now';

            let lines = sorted.map(([name, weight]) => {
                const percent = totalWeight > 0 ? ((weight / totalWeight) * 100).toFixed(1) : '0.0';
                return `**${name}** — ${weight} (${percent}%)`;
            });

            // Truncate if too long
            let desc = `**${typeLabel} Weights** · ${fromDate} → ${toDate}\n\n`;
            if (lines.join('\n').length > 3800) {
                lines = lines.slice(0, 50);
                desc += lines.join('\n') + `\n\n*...and ${sorted.length - 50} more*`;
            } else {
                desc += lines.join('\n');
            }

            const embed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle(`${giveaway.title} — Weight Breakdown`)
                .setDescription(desc)
                .setFooter({ text: `${sorted.length} players · Total weight: ${totalWeight.toFixed(2)}` });

            return interaction.editReply({ embeds: [embed] });
        }

        if (customId.startsWith('giveaway_weights_')) {
            const giveawayId = parseInt(customId.replace('giveaway_weights_', ''));
            const giveaway = await getGiveaway(giveawayId);

            if (!giveaway || giveaway.ended) {
                return interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
            }
            if (!hasGiveawayRole(interaction.member) && interaction.user.id !== giveaway.host_id) {
                return interaction.reply({ content: 'Only the giveaway host or managers can set weights.', ephemeral: true });
            }

            const existingWeights = giveaway.weights || {};
            const prefill = Object.entries(existingWeights).map(([name, w]) => `${name}: ${w}`).join('\n');

            const modal = new ModalBuilder()
                .setCustomId(`giveaway_weights_modal_${giveawayId}`)
                .setTitle('Manage Giveaway Weights');

            const input = new TextInputBuilder()
                .setCustomId('weights_input')
                .setLabel('Enter weights (one per line: Name: Weight)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('PlayerName: 5\nAnotherPlayer: 3\nNewbie: 1')
                .setRequired(true);

            if (prefill) input.setValue(prefill);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (!customId.startsWith('giveaway_join_')) return;

        const giveawayId = parseInt(customId.replace('giveaway_join_', ''));
        const giveaway = await getGiveaway(giveawayId);

        if (!giveaway) return interaction.reply({ content: 'This giveaway no longer exists.', ephemeral: true });
        if (giveaway.ended) return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
        if (giveaway.entries.includes(interaction.user.id)) {
            return interaction.reply({ content: 'You\'ve already entered this giveaway!', ephemeral: true });
        }

        const added = await addGiveawayEntry(giveawayId, interaction.user.id);
        if (!added) return interaction.reply({ content: 'Failed to enter. The giveaway may have ended.', ephemeral: true });

        const updated = await getGiveaway(giveawayId);
        const embed = buildGiveawayEmbed(updated);
        await interaction.update({ embeds: [embed], components: buildGiveawayButtons(giveawayId, updated) });
    },

    async handleModal(interaction) {
        const customId = interaction.customId;

        // Handle exclude modal (guild roster)
        if (customId.startsWith('giveaway_exclude_modal_')) {
            const giveawayId = parseInt(customId.replace('giveaway_exclude_modal_', ''));
            const giveaway = await getGiveaway(giveawayId);

            if (!giveaway || giveaway.ended) {
                return interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
            }

            const input = interaction.fields.getTextInputValue('exclude_input');
            const excludeNames = input ? input.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];

            const guildMembers = await fetchLiveGuildMembers();
            const allUsernames = guildMembers.map(m => m.username);

            const validExcluded = [];
            const invalid = [];
            for (const name of excludeNames) {
                const found = allUsernames.find(u => u.toLowerCase() === name.toLowerCase());
                if (found) validExcluded.push(found);
                else invalid.push(name);
            }

            const newEntries = allUsernames.filter(u => !validExcluded.includes(u));

            const { setGiveawayEntries, setGiveawayExcluded } = require('../../core/database');
            await setGiveawayEntries(giveawayId, newEntries);
            await setGiveawayExcluded(giveawayId, validExcluded);

            const updated = await getGiveaway(giveawayId);
            try {
                const channel = await interaction.client.channels.fetch(updated.channel_id);
                const message = await channel.messages.fetch(updated.message_id);
                if (message) {
                    await message.edit({
                        embeds: [buildGiveawayEmbed(updated)],
                        components: buildGiveawayButtons(giveawayId, updated)
                    });
                }
            } catch (e) { /* non-critical */ }

            let reply = `Updated **${giveaway.title}**: ${newEntries.length} eligible, ${validExcluded.length} excluded.`;
            if (invalid.length > 0) reply += `\n\u26a0\ufe0f Not found: ${invalid.join(', ')}`;
            return interaction.reply({ content: reply, ephemeral: true });
        }

        // Handle weights modal
        if (customId.startsWith('giveaway_weights_modal_')) {
            const giveawayId = parseInt(customId.replace('giveaway_weights_modal_', ''));
            const giveaway = await getGiveaway(giveawayId);

            if (!giveaway || giveaway.ended) {
                return interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
            }

            const input = interaction.fields.getTextInputValue('weights_input');
            const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            const weights = {};
            const errors = [];
            for (const line of lines) {
                const match = line.match(/^(.+?):\s*(\d+(?:\.\d+)?)$/);
                if (match) {
                    const name = match[1].trim();
                    const weight = parseFloat(match[2]);
                    if (weight > 0) weights[name] = weight;
                    else errors.push(`"${line}" — weight must be > 0`);
                } else {
                    errors.push(`"${line}" — invalid format (use Name: Weight)`);
                }
            }

            if (Object.keys(weights).length === 0) {
                return interaction.reply({ content: 'No valid weights found. Use the format `Name: Weight` (one per line).', ephemeral: true });
            }

            await updateGiveawayWeights(giveawayId, weights);

            const updated = await getGiveaway(giveawayId);
            try {
                const channel = await interaction.client.channels.fetch(updated.channel_id);
                const message = await channel.messages.fetch(updated.message_id);
                if (message) {
                    await message.edit({
                        embeds: [buildGiveawayEmbed(updated)],
                        components: buildGiveawayButtons(giveawayId, updated)
                    });
                }
            } catch (e) { /* non-critical */ }

            let reply = `Weights updated for **${giveaway.title}**:\n` +
                Object.entries(weights).map(([n, w]) => `${n} — ${w}x`).join('\n');
            if (errors.length > 0) reply += `\n\n\u26a0\ufe0f Skipped:\n${errors.join('\n')}`;
            return interaction.reply({ content: reply, ephemeral: true });
        }

        // Handle raid scale modal
        if (customId.startsWith('giveaway_raid_scale_modal_')) {
            const giveawayId = parseInt(customId.replace('giveaway_raid_scale_modal_', ''));
            const giveaway = await getGiveaway(giveawayId);

            if (!giveaway || giveaway.ended) {
                return interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
            }

            const raidsPerPoint = parseFloat(interaction.fields.getTextInputValue('raids_per_point'));
            const pointValue = parseFloat(interaction.fields.getTextInputValue('point_value'));

            if (isNaN(raidsPerPoint) || isNaN(pointValue) || raidsPerPoint <= 0 || pointValue <= 0) {
                return interaction.reply({ content: '❌ Both values must be positive numbers.', ephemeral: true });
            }

            const config = giveaway.weight_config || {};
            config.raids_per_point = raidsPerPoint;
            config.raid_point_value = pointValue;
            await setGiveawayWeightConfig(giveawayId, config);

            return interaction.reply({
                content: `✅ Raid weight scale set for **${giveaway.title}**:\n` +
                         `Every **${raidsPerPoint}** raids = **+${pointValue}** weight`,
                ephemeral: true
            });
        }

        // Handle GXP scale modal
        if (customId.startsWith('giveaway_gxp_scale_modal_')) {
            const giveawayId = parseInt(customId.replace('giveaway_gxp_scale_modal_', ''));
            const giveaway = await getGiveaway(giveawayId);

            if (!giveaway || giveaway.ended) {
                return interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
            }

            const gxpPerPoint = parseFloat(interaction.fields.getTextInputValue('gxp_per_point'));
            const pointValue = parseFloat(interaction.fields.getTextInputValue('point_value'));

            if (isNaN(gxpPerPoint) || isNaN(pointValue) || gxpPerPoint <= 0 || pointValue <= 0) {
                return interaction.reply({ content: '❌ Both values must be positive numbers.', ephemeral: true });
            }

            const config = giveaway.weight_config || {};
            config.gxp_per_point = gxpPerPoint;
            config.gxp_point_value = pointValue;
            await setGiveawayWeightConfig(giveawayId, config);

            return interaction.reply({
                content: `✅ GXP weight scale set for **${giveaway.title}**:\n` +
                         `Every **${gxpPerPoint.toLocaleString()}** GXP = **+${pointValue}** weight`,
                ephemeral: true
            });
        }
    },

    restoreGiveawayTimers,
};
