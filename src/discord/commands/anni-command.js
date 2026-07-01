const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAnniStatus, manualStartParty, closePartySignup } = require("../../features/anni/anni-service");

const CHIEF_ROLES = ['1459247694454194381', '1494468807547162655', '1459230233902448803'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('anni')
        .setDescription('Prelude to Annihilation event management')
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('View next Annihilation event'))
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Manually start party signup (chiefs only)'))
        .addSubcommand(sub =>
            sub.setName('close')
                .setDescription('Close party signup (chiefs only)')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'info') return handleInfo(interaction);
        if (sub === 'start') return handleStart(interaction);
        if (sub === 'close') return handleClose(interaction);
    }
};

async function handleInfo(interaction) {
    await interaction.deferReply();

    try {
        const anniStatus = await getAnniStatus();
        if (!anniStatus) {
            return interaction.editReply({ content: '❌ Failed to load Annihilation event data.' });
        }

        const unix = Math.floor(anniStatus.time.getTime() / 1000);
        const color = anniStatus.status === 'active' ? 0xFF6B6B : anniStatus.status === 'imminent' ? 0xFFB366 : 0x4ECDC4;
        
        let statusEmoji = '⏳';
        let statusText = 'Upcoming';
        if (anniStatus.status === 'active') {
            statusEmoji = '🔴';
            statusText = 'Active Now!';
        } else if (anniStatus.status === 'imminent') {
            statusEmoji = '⚠️';
            statusText = 'Starting Soon (< 1h)';
        } else if (anniStatus.status === 'ended') {
            statusEmoji = '✅';
            statusText = 'Ended';
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${statusEmoji} ${statusText}`)
            .setDescription(`**Prelude to Annihilation**`)
            .addFields(
                { name: 'Time', value: `<t:${unix}:f>\n<t:${unix}:R>`, inline: true },
                { name: 'Confirmed', value: anniStatus.isPredicted ? '❌ Predicted' : '✅ From API', inline: true },
            )
            .setFooter({ text: anniStatus.apiStatus === 'confirmed' ? 'Last updated < 1 min ago' : `Status: ${anniStatus.apiStatus} (retry ${anniStatus.retryCount}/${5})` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in /anni info:', error);
        await interaction.editReply({ content: '❌ Failed to fetch event info.' });
    }
}

async function handleStart(interaction) {
    const isChief = CHIEF_ROLES.some(r => interaction.member.roles.cache.has(r));
    if (!isChief) {
        return interaction.reply({ content: '❌ Only chiefs can manually start party signup.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        await manualStartParty(interaction.channel);
        await interaction.editReply({ content: '✅ Party signup started!' });
    } catch (error) {
        console.error('Error in /anni start:', error);
        await interaction.editReply({ content: '❌ Failed to start party signup.' });
    }
}

async function handleClose(interaction) {
    const isChief = CHIEF_ROLES.some(r => interaction.member.roles.cache.has(r));
    if (!isChief) {
        return interaction.reply({ content: '❌ Only chiefs can close party signup.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        await closePartySignup();
        await interaction.editReply({ content: '✅ Party signup closed and buttons disabled.' });
    } catch (error) {
        console.error('Error in /anni close:', error);
        await interaction.editReply({ content: '❌ Failed to close party signup.' });
    }
}
