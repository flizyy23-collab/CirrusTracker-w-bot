const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getPlayerUUID, getPlayerUsername, setAspects, getRaids } = require("../../core/database");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setaspects')
        .setDescription('Manually set how many aspects a player has received')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The Wynncraft username of the player')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('The total number of aspects this player has received')
                .setRequired(true)
                .setMinValue(0)),
    async execute(interaction) {
        const playerName = interaction.options.getString('player');
        const amount = interaction.options.getNumber('amount');

        const uuid = await getPlayerUUID(playerName);
        if (!uuid) {
            await interaction.reply({ content: `Could not find player **${playerName}** in the database. They need to have done at least one guild raid first.`, ephemeral: true });
            return;
        }

        const resolvedName = await getPlayerUsername(uuid) || playerName;

        const raids = await getRaids(uuid);
        // Work backwards: if we want them to be owed X, then received = raids*0.5 - X
        const received = (raids.length * 0.5) - amount;

        await setAspects(uuid, received, interaction.user.username);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('Aspects Updated')
            .setDescription(`**${resolvedName}** is now owed **${amount}** aspects`)
            .addFields(
                { name: 'Total Raids', value: `\`\`\`${raids.length}\`\`\``, inline: true },
                { name: 'Aspects Owed', value: `\`\`\`${amount}\`\`\``, inline: true }
            )
            .setFooter({ text: `Updated by ${interaction.user.username}` });

        await interaction.reply({ embeds: [embed] });
    },
};
