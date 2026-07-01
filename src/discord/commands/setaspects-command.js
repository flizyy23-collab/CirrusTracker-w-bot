const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getPlayerUUID, getPlayerUsername, setAspects } = require("../../core/database");

const CHIEF_ROLE_ID = '1459230233902448803';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setaspects')
        .setDescription('Manually set how many aspects a player is owed (overrides calculation)')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The Wynncraft username of the player')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('owed')
                .setDescription('The number of aspects this player is owed (can be negative)')
                .setRequired(true)),
    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has('Administrator');
        const isChief = interaction.member.roles.cache.has(CHIEF_ROLE_ID);
        if (!isAdmin && !isChief) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const playerName = interaction.options.getString('player');
        const owed = interaction.options.getNumber('owed');

        const uuid = await getPlayerUUID(playerName);
        if (!uuid) {
            await interaction.reply({ content: `Could not find player **${playerName}** in the database. They need to have done at least one guild raid first.`, ephemeral: true });
            return;
        }

        const resolvedName = await getPlayerUsername(uuid) || playerName;

        await setAspects(uuid, owed, interaction.user.username);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('Aspects Updated')
            .setDescription(`**${resolvedName}** is now owed **${owed}** aspects`)
            .setFooter({ text: `Updated by ${interaction.user.username}` });

        await interaction.reply({ embeds: [embed] });
    },
};
