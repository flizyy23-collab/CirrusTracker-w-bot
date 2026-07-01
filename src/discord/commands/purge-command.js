const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete messages in this channel within a date range')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('from')
                .setDescription('Start date (DD-MM-YYYY)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('to')
                .setDescription('End date (DD-MM-YYYY)')
                .setRequired(true)),

    async execute(interaction) {
        const ALLOWED_ROLES = ['1459247694454194381', '1494468807547162655', '1459230233902448803'];
        const hasRole = ALLOWED_ROLES.some(roleId => interaction.member.roles.cache.has(roleId));
        if (!hasRole) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        }

        const fromStr = interaction.options.getString('from');
        const toStr = interaction.options.getString('to');

        // Parse DD-MM-YYYY format
        const fromParts = fromStr.split('-');
        const toParts = toStr.split('-');

        if (fromParts.length !== 3 || toParts.length !== 3) {
            return interaction.reply({ content: '❌ Invalid date format. Use `DD-MM-YYYY`.', ephemeral: true });
        }

        const fromDate = new Date(`${fromParts[2]}-${fromParts[1]}-${fromParts[0]}T00:00:00`);
        const toDate = new Date(`${toParts[2]}-${toParts[1]}-${toParts[0]}T23:59:59.999`);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return interaction.reply({ content: '❌ Invalid date format. Use `DD-MM-YYYY`.', ephemeral: true });
        }

        if (fromDate > toDate) {
            return interaction.reply({ content: '❌ `from` date must be before `to` date.', ephemeral: true });
        }

        // Confirmation
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('purge_confirm').setLabel('Yes, delete messages').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('purge_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );

        const confirmMsg = await interaction.reply({
            content: `⚠️ **Purge Confirmation**\nThis will delete ALL messages in <#${interaction.channel.id}> from **${fromStr}** to **${toStr}**.\n\n` +
                     `Messages older than 14 days will be deleted one by one (~5/sec), which can be slow for large amounts.\n\n` +
                     `Are you sure?`,
            components: [row],
            ephemeral: true,
            fetchReply: true
        });

        try {
            const response = await confirmMsg.awaitMessageComponent({ time: 30000 });

            if (response.customId === 'purge_cancel') {
                return response.update({ content: '❌ Purge cancelled.', components: [] });
            }

            await response.update({ content: '🔄 Starting purge... Scanning messages...', components: [] });

            // Start the purge in the background
            purgeMessages(interaction.channel, fromDate, toDate, interaction);
        } catch (e) {
            await interaction.editReply({ content: '⏰ Confirmation timed out. Purge cancelled.', components: [] });
        }
    }
};

async function purgeMessages(channel, fromDate, toDate, interaction) {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    let deleted = 0;
    let scanned = 0;
    let lastId = null;
    let done = false;

    // Convert toDate to a snowflake to use as 'before' starting point
    // Discord snowflake = (timestamp - DISCORD_EPOCH) << 22
    const DISCORD_EPOCH = 1420070400000n;
    const toSnowflake = ((BigInt(toDate.getTime()) - DISCORD_EPOCH) << 22n).toString();

    // We'll start fetching from the toDate and go backwards
    lastId = toSnowflake;

    const recentMessages = []; // < 14 days old, can bulk delete
    const oldMessages = [];    // > 14 days old, must delete individually

    // Phase 1: Scan and collect all message IDs in the date range
    while (!done) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        let messages;
        try {
            messages = await channel.messages.fetch(options);
        } catch (err) {
            console.error("Error fetching messages during purge:", err.message);
            break;
        }

        if (messages.size === 0) {
            done = true;
            break;
        }

        for (const msg of messages.values()) {
            const msgDate = msg.createdAt;

            // Past our date range (too old), stop scanning
            if (msgDate < fromDate) {
                done = true;
                break;
            }

            // Within range
            if (msgDate >= fromDate && msgDate <= toDate) {
                if (msgDate >= fourteenDaysAgo) {
                    recentMessages.push(msg.id);
                } else {
                    oldMessages.push(msg.id);
                }
            }
        }

        lastId = messages.last()?.id;
        scanned += messages.size;

        // Progress update every 1000 messages scanned
        if (scanned % 1000 < 100) {
            try {
                await interaction.editReply({
                    content: `🔍 Scanning... ${scanned} messages checked, ${recentMessages.length + oldMessages.length} found in range so far...`
                });
            } catch (e) {}
        }
    }

    const total = recentMessages.length + oldMessages.length;

    if (total === 0) {
        return interaction.editReply({ content: '✅ No messages found in that date range.' });
    }

    await interaction.editReply({
        content: `📋 Found **${total}** messages to delete.\n` +
                 `• **${recentMessages.length}** recent (bulk delete)\n` +
                 `• **${oldMessages.length}** old (individual delete)\n\n` +
                 `🔄 Deleting...`
    });

    // Phase 2: Bulk delete recent messages (< 14 days old)
    if (recentMessages.length > 0) {
        for (let i = 0; i < recentMessages.length; i += 100) {
            const batch = recentMessages.slice(i, i + 100);
            try {
                await channel.bulkDelete(batch);
                deleted += batch.length;
            } catch (err) {
                console.error("Bulk delete error:", err.message);
                // Fall back to individual delete for this batch
                for (const msgId of batch) {
                    try {
                        const msg = await channel.messages.fetch(msgId);
                        await msg.delete();
                        deleted++;
                        await sleep(250);
                    } catch (e) {}
                }
            }
        }

        try {
            await interaction.editReply({
                content: `🔄 Bulk deleted **${deleted}/${total}** messages. Now deleting old messages...`
            });
        } catch (e) {}
    }

    // Phase 3: Individual delete old messages (> 14 days old)
    let lastUpdate = Date.now();
    for (let i = 0; i < oldMessages.length; i++) {
        try {
            const msg = await channel.messages.fetch(oldMessages[i]);
            await msg.delete();
            deleted++;
        } catch (err) {
            // Message may already be deleted, skip
            deleted++;
        }

        // Rate limit: ~5 per second
        await sleep(220);

        // Progress update every 50 deletions or every 30 seconds
        if (deleted % 50 === 0 || Date.now() - lastUpdate > 30000) {
            lastUpdate = Date.now();
            const elapsed = Math.round((Date.now() - lastUpdate) / 1000);
            const remaining = total - deleted;
            const eta = remaining > 0 ? Math.round(remaining * 0.22) : 0;
            const etaMin = Math.floor(eta / 60);
            const etaSec = eta % 60;

            try {
                await interaction.editReply({
                    content: `🔄 Deleting... **${deleted}/${total}** messages removed.\n` +
                             `⏱️ Estimated time remaining: ${etaMin}m ${etaSec}s`
                });
            } catch (e) {}
        }
    }

    try {
        await interaction.editReply({
            content: `✅ **Purge complete!** Deleted **${deleted}** messages from **${formatDate(fromDate)}** to **${formatDate(toDate)}**.`
        });
    } catch (e) {
        // If the interaction expired, send a regular message
        try {
            await channel.send(`✅ **Purge complete!** Deleted **${deleted}** messages.`);
        } catch (e2) {}
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date) {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
}
