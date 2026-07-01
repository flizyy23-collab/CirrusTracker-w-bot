const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

function getPool() {
    return require("../../core/database").getPool();
}

function initTodo() {
    createTable();
    scheduleWeeklyReset();
    console.log('Todo system initialized');
}

async function createTable() {
    try {
        await getPool().execute(`
            CREATE TABLE IF NOT EXISTS guild_todos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                task TEXT NOT NULL,
                added_by VARCHAR(32) NOT NULL,
                added_by_name VARCHAR(32) NOT NULL,
                is_permanent BOOLEAN DEFAULT FALSE,
                completed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (err) {
        console.error('Failed to create guild_todos table:', err.message);
    }
}

function scheduleWeeklyReset() {
    setInterval(async () => {
        const now = new Date();
        if (now.getUTCDay() === 1 && now.getUTCHours() === 23 && now.getUTCMinutes() === 59) {
            await resetWeekly();
        }
    }, 60 * 1000);
}

async function resetWeekly() {
    try {
        await getPool().execute(`UPDATE guild_todos SET completed = FALSE WHERE is_permanent = TRUE`);
        await getPool().execute(`DELETE FROM guild_todos WHERE is_permanent = FALSE AND completed = TRUE`);
        console.log('Weekly todo reset complete');
    } catch (err) {
        console.error('Failed to reset todos:', err.message);
    }
}

async function getTasks() {
    const [rows] = await getPool().execute(
        `SELECT id, task, added_by_name, is_permanent, completed FROM guild_todos ORDER BY is_permanent DESC, completed ASC, id ASC`
    );
    return rows;
}

async function addTask(task, userId, username, isPermanent) {
    await getPool().execute(
        `INSERT INTO guild_todos (task, added_by, added_by_name, is_permanent) VALUES (?, ?, ?, ?)`,
        [task, userId, username, isPermanent]
    );
}

async function removeTask(id) {
    const [result] = await getPool().execute(`DELETE FROM guild_todos WHERE id = ?`, [id]);
    return result.affectedRows > 0;
}

async function completeTask(id) {
    const [result] = await getPool().execute(`UPDATE guild_todos SET completed = TRUE WHERE id = ? AND completed = FALSE`, [id]);
    return result.affectedRows > 0;
}

const ALLOWED_ROLES = [
    '1459247694454194381',
    '1494468807547162655',
    '1459230233902448803',
];

function hasPermission(member) {
    return ALLOWED_ROLES.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
    initTodo,
    data: new SlashCommandBuilder()
        .setName('todo')
        .setDescription('Shared guild to-do list for chiefs')
        .addSubcommand(sub =>
            sub.setName('show')
                .setDescription('Display the current to-do list'))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a one-time task')
                .addStringOption(option =>
                    option.setName('task')
                        .setDescription('Task description')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('addpermanent')
                .setDescription('Add a permanent weekly recurring task')
                .addStringOption(option =>
                    option.setName('task')
                        .setDescription('Task description')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('done')
                .setDescription('Mark one or more tasks as completed')
                .addStringOption(option =>
                    option.setName('number')
                        .setDescription('Task number(s), e.g. 1, 2, 3')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Permanently remove a task from the list')
                .addIntegerOption(option =>
                    option.setName('number')
                        .setDescription('Task number from the list')
                        .setRequired(true)
                        .setMinValue(1))),

    async execute(interaction) {
        if (!hasPermission(interaction.member)) {
            return interaction.reply({ content: '❌ Chiefs+ only.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        switch (sub) {
            case 'show': return handleShow(interaction);
            case 'add': return handleAdd(interaction, false);
            case 'addpermanent': return handleAdd(interaction, true);
            case 'done': return handleDone(interaction);
            case 'remove': return handleRemove(interaction);
        }
    }
};

async function handleShow(interaction) {
    const tasks = await getTasks();

    if (tasks.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('📋 Guild To-Do List')
            .setDescription('*No tasks. Use `/todo add` or `/todo addpermanent`.*')
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    const permanent = tasks.filter(task => task.is_permanent);
    const oneTime = tasks.filter(task => !task.is_permanent);
    let description = '';

    if (permanent.length > 0) {
        description += '**🔁 Weekly Recurring**\n';
        for (const task of permanent) {
            const num = tasks.indexOf(task) + 1;
            const check = task.completed ? '✅' : '⬜';
            const strike = task.completed ? '~~' : '';
            description += `${check} \`#${num}\` ${strike}${task.task}${strike}\n`;
        }
        description += '\n';
    }

    if (oneTime.length > 0) {
        description += '**📌 Tasks**\n';
        for (const task of oneTime) {
            const num = tasks.indexOf(task) + 1;
            const check = task.completed ? '✅' : '⬜';
            const strike = task.completed ? '~~' : '';
            description += `${check} \`#${num}\` ${strike}${task.task}${strike} *(${task.added_by_name})*\n`;
        }
    }

    const pending = tasks.filter(task => !task.completed).length;
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📋 Guild To-Do List')
        .setDescription(description)
        .setFooter({ text: `${pending} pending • Resets Monday 23:59 GMT` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleAdd(interaction, isPermanent) {
    const task = interaction.options.getString('task');
    await addTask(task, interaction.user.id, interaction.user.displayName, isPermanent);

    const label = isPermanent ? '🔁 permanent' : '📌';
    await interaction.reply({ content: `✅ Added ${label} task: **${task}**` });
}

async function handleDone(interaction) {
    const rawNumbers = interaction.options.getString('number');
    const taskNumbers = parseTaskNumbers(rawNumbers);

    if (!taskNumbers.length) {
        return interaction.reply({ content: '❌ Invalid task number list. Use formats like `1` or `1, 2, 3`.', ephemeral: true });
    }

    const tasks = await getTasks();
    const invalidNumbers = taskNumbers.filter(number => number < 1 || number > tasks.length);
    if (invalidNumbers.length) {
        return interaction.reply({ content: `❌ Invalid task number${invalidNumbers.length > 1 ? 's' : ''}: ${invalidNumbers.join(', ')}`, ephemeral: true });
    }

    const completedTasks = [];
    const alreadyCompletedTasks = [];

    for (const number of taskNumbers) {
        const task = tasks[number - 1];
        const success = await completeTask(task.id);
        if (success) completedTasks.push(`\`#${number}\` ~~${task.task}~~`);
        else alreadyCompletedTasks.push(`\`#${number}\` ${task.task}`);
    }

    const parts = [];
    if (completedTasks.length) parts.push(`✅ Done:\n${completedTasks.join('\n')}`);
    if (alreadyCompletedTasks.length) parts.push(`⚠️ Already completed:\n${alreadyCompletedTasks.join('\n')}`);
    await interaction.reply({ content: parts.join('\n\n') });
}

async function handleRemove(interaction) {
    const number = interaction.options.getInteger('number');
    const tasks = await getTasks();

    if (number > tasks.length || number < 1) {
        return interaction.reply({ content: '❌ Invalid task number.', ephemeral: true });
    }

    const task = tasks[number - 1];
    await removeTask(task.id);
    await interaction.reply({ content: `🗑️ Removed: **${task.task}**` });
}

function parseTaskNumbers(input) {
    const parts = input.split(',').map(part => part.trim()).filter(Boolean);
    if (!parts.length) return [];

    const numbers = parts.map(part => Number.parseInt(part, 10));
    if (numbers.some(number => Number.isNaN(number))) return [];
    return [...new Set(numbers)];
}
