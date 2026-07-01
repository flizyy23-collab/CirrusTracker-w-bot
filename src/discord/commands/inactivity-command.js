const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getPool } = require("../../core/database");

const MEMBER_ROLE = '1459228727341744273';
const CHIEF_ROLES = ['1459247694454194381', '1494468807547162655', '1459230233902448803'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inactivity')
        .setDescription('Manage the guild inactivity list')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View current inactivity list'))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add yourself or a player to the inactivity list')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Minecraft username')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('days')
                        .setDescription('How many days inactive')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(365))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for inactivity')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Edit your inactivity entry (or any entry if chief)')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Minecraft username')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('days')
                        .setDescription('New duration in days')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(365))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('New reason')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove yourself or a player from the inactivity list')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Minecraft username')
                        .setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'list') return handleList(interaction);
        if (sub === 'add') return handleAdd(interaction);
        if (sub === 'edit') return handleEdit(interaction);
        if (sub === 'remove') return handleRemove(interaction);
    }
};

async function ensureTable() {
    try {
        await getPool().execute(`
            CREATE TABLE IF NOT EXISTS inactivity_list (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(16) NOT NULL,
                added_by VARCHAR(20) NOT NULL,
                days INT NOT NULL,
                reason VARCHAR(256) DEFAULT NULL,
                return_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_username (username)
            );
        `);
    } catch (e) {}
}

async function handleList(interaction) {
    await interaction.deferReply();
    await ensureTable();

    try {
        // Clean up expired entries
        await getPool().execute(`DELETE FROM inactivity_list WHERE return_date < CURDATE()`);

        const [rows] = await getPool().execute(
            `SELECT username, days, reason, return_date, created_at FROM inactivity_list ORDER BY return_date ASC`
        );

        if (rows.length === 0) {
            return interaction.editReply({ content: 'No players on the inactivity list.' });
        }

        const lines = rows.map(r => {
            const returnUnix = Math.floor(new Date(r.return_date).getTime() / 1000);
            let line = `**${r.username}** — Returns <t:${returnUnix}:R> (${r.days}d)`;
            if (r.reason) line += `\n  └ ${r.reason}`;
            return line;
        });

        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('📋 Inactivity List')
            .setDescription(lines.join('\n\n'))
            .setFooter({ text: `${rows.length} player${rows.length !== 1 ? 's' : ''} inactive` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in /inactivity list:', error);
        await interaction.editReply({ content: '❌ Failed to fetch inactivity list.' });
    }
}

async function handleAdd(interaction) {
    await interaction.deferReply();
    await ensureTable();

    const name = interaction.options.getString('name');
    const days = interaction.options.getInteger('days');
    const reason = interaction.options.getString('reason') || null;

    try {
        // Check if user is adding themselves or someone else
        const { getAccountLink } = require("../../core/database");
        const link = await getAccountLink(interaction.user.id);
        const isSelf = link && link.minecraft_username.toLowerCase() === name.toLowerCase();
        const hasRole = interaction.member.roles.cache.has(MEMBER_ROLE);

        if (!isSelf && !hasRole) {
            return interaction.editReply({ content: '❌ You can only add yourself. Chiefs can add others.' });
        }

        const returnDate = new Date();
        returnDate.setDate(returnDate.getDate() + days);
        const returnStr = returnDate.toISOString().split('T')[0];

        await getPool().execute(
            `INSERT INTO inactivity_list (username, added_by, days, reason, return_date) 
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE days = ?, reason = ?, return_date = ?, added_by = ?, created_at = CURRENT_TIMESTAMP`,
            [name, interaction.user.id, days, reason, returnStr, days, reason, returnStr, interaction.user.id]
        );

        const returnUnix = Math.floor(returnDate.getTime() / 1000);
        await interaction.editReply({ content: `✅ **${name}** added to inactivity list — returns <t:${returnUnix}:R>${reason ? ` (${reason})` : ''}` });
    } catch (error) {
        console.error('Error in /inactivity add:', error);
        await interaction.editReply({ content: '❌ Failed to add to inactivity list.' });
    }
}

async function handleRemove(interaction) {
    await interaction.deferReply();
    await ensureTable();

    const name = interaction.options.getString('name');
    const isChief = CHIEF_ROLES.some(r => interaction.member.roles.cache.has(r));

    try {
        // Check if the entry exists and who added it
        const [rows] = await getPool().execute(
            `SELECT added_by FROM inactivity_list WHERE LOWER(username) = LOWER(?)`,
            [name]
        );

        if (rows.length === 0) {
            return interaction.editReply({ content: `❌ **${name}** is not on the inactivity list.` });
        }

        const addedBySelf = rows[0].added_by === interaction.user.id;

        if (!addedBySelf && !isChief) {
            return interaction.editReply({ content: '❌ You can only remove yourself. Chiefs can remove others.' });
        }

        await getPool().execute(
            `DELETE FROM inactivity_list WHERE LOWER(username) = LOWER(?)`,
            [name]
        );

        await interaction.editReply({ content: `✅ **${name}** removed from the inactivity list.` });
    } catch (error) {
        console.error('Error in /inactivity remove:', error);
        await interaction.editReply({ content: '❌ Failed to remove from inactivity list.' });
    }
}

async function handleEdit(interaction) {
    await interaction.deferReply();
    await ensureTable();

    const name = interaction.options.getString('name');
    const newDays = interaction.options.getInteger('days');
    const newReason = interaction.options.getString('reason');
    const isChief = CHIEF_ROLES.some(r => interaction.member.roles.cache.has(r));

    if (!newDays && newReason === null) {
        return interaction.editReply({ content: '❌ Provide at least `days` or `reason` to edit.' });
    }

    try {
        // Check if entry exists and who added it
        const [rows] = await getPool().execute(
            `SELECT added_by, days, reason, return_date FROM inactivity_list WHERE LOWER(username) = LOWER(?)`,
            [name]
        );

        if (rows.length === 0) {
            return interaction.editReply({ content: `❌ **${name}** is not on the inactivity list.` });
        }

        const addedBySelf = rows[0].added_by === interaction.user.id;

        if (!addedBySelf && !isChief) {
            return interaction.editReply({ content: '❌ You can only edit your own entry. Chiefs can edit anyone.' });
        }

        const updatedDays = newDays || rows[0].days;
        const updatedReason = newReason !== null ? newReason : rows[0].reason;

        const returnDate = new Date();
        returnDate.setDate(returnDate.getDate() + updatedDays);
        const returnStr = returnDate.toISOString().split('T')[0];

        await getPool().execute(
            `UPDATE inactivity_list SET days = ?, reason = ?, return_date = ? WHERE LOWER(username) = LOWER(?)`,
            [updatedDays, updatedReason, returnStr, name]
        );

        const returnUnix = Math.floor(returnDate.getTime() / 1000);
        await interaction.editReply({ content: `✅ **${name}** updated — returns <t:${returnUnix}:R>${updatedReason ? ` (${updatedReason})` : ''}` });
    } catch (error) {
        console.error('Error in /inactivity edit:', error);
        await interaction.editReply({ content: '❌ Failed to edit inactivity entry.' });
    }
}
