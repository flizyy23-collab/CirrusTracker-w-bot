const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getPlayerUUID, getPlayerUsername, insertAspect } = require("../../core/database");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaspect')
        .setDescription('Record that a guild aspect was given to a player')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The Wynncraft username of the player who received the aspect')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('The number of aspects given')
                .setRequired(true)
                .setMinValue(0.5)),
    async execute(interaction) {
        const playerName = interaction.options.getString('player');
        const amount = interaction.options.getNumber('amount');

        const uuid = await getPlayerUUID(playerName);
        if (!uuid) {
            await interaction.reply({ content: `Could not find player **${playerName}** in the database. They need to have done at least one guild raid first.`, ephemeral: true });
            return;
        }

        const resolvedName = await getPlayerUsername(uuid) || playerName;
        const giver = interaction.user.id; // use Discord ID as giver identifier

        // Each aspect record = 0.5, so insert one record per 0.5 given
        const insertCount = Math.round(amount / 0.5);
        for (let i = 0; i < insertCount; i++) {
            await insertAspect(uuid, uuid, interaction.user.username);
        }

        const embed = new EmbedBuilder()
            .setColor(0x00cc66)
            .setTitle('Aspect Given')
            .setDescription(`**${resolvedName}** has been given **${amount}** aspect${amount !== 1 ? 's' : ''}`)
            .setFooter({ text: `Recorded by ${giver}` });

        await interaction.reply({ embeds: [embed] });
    },
};
