const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { getPlayerUsername, getOwedAspects } = require("../../core/database");

const PAGE_SIZE = 15;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('owed')
        .setDescription('Returns data on players who are owed the most guild aspects'),
    async execute(interaction) {
        let players = await getOwedAspects();
        let fields = [];

        for (const [uuid, owedAspects] of players) {
            let playerName = await getPlayerUsername(uuid);
            const rounded = Math.round(owedAspects * 100) / 100;
            fields.push({ name: playerName, value: `\`\`\`${rounded}\`\`\``, inline: true });
        }

        if (fields.length === 0) {
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x0099FF).setTitle('**Players with most Owed Aspects**').setDescription('No aspect data yet.')] });
            return;
        }

        const totalPages = Math.ceil(fields.length / PAGE_SIZE);
        let currentPage = 0;

        function buildPage(page) {
            const start = page * PAGE_SIZE;
            const chunk = fields.slice(start, start + PAGE_SIZE);
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('**Players with most Owed Aspects**')
                .setDescription("\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af")
                .addFields(...chunk)
                .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
            return embed;
        }

        function buildSearchEmbed(query, results) {
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`**Owed Aspects \u2014 Search: "${query}"**`)
                .setDescription("\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af");
            if (results.length === 0) {
                embed.setDescription(`No player found matching **${query}**.`);
            } else {
                embed.addFields(...results.slice(0, 25));
            }
            return embed;
        }

        function buildButtons(page) {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('owed_prev').setLabel('\u25c0 Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId('owed_next').setLabel('Next \u25b6').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1),
                new ButtonBuilder().setCustomId('owed_search').setLabel('\ud83d\udd0d Search').setStyle(ButtonStyle.Primary)
            );
        }

        function buildSearchButtons() {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('owed_back').setLabel('\u25c0 Back to List').setStyle(ButtonStyle.Secondary)
            );
        }

        const response = await interaction.reply({
            embeds: [buildPage(currentPage)],
            components: [buildButtons(currentPage)],
            fetchReply: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120000
        });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({ content: 'Only the command user can use these buttons.', ephemeral: true });
                return;
            }

            if (i.customId === 'owed_search') {
                const modal = new ModalBuilder()
                    .setCustomId('owed_search_modal')
                    .setTitle('Search Player')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('owed_search_input')
                                .setLabel('Player name')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Enter player name...')
                                .setRequired(true)
                        )
                    );
                await i.showModal(modal);

                try {
                    const modalResponse = await i.awaitModalSubmit({ time: 30000 });
                    const query = modalResponse.fields.getTextInputValue('owed_search_input').toLowerCase();
                    const searchResults = fields.filter(f => f.name.toLowerCase().includes(query));
                    await modalResponse.update({
                        embeds: [buildSearchEmbed(query, searchResults)],
                        components: [buildSearchButtons()]
                    });
                } catch (e) {}
                return;
            }

            if (i.customId === 'owed_back') {
                await i.update({ embeds: [buildPage(currentPage)], components: [buildButtons(currentPage)] });
                return;
            }

            if (i.customId === 'owed_prev') currentPage = Math.max(0, currentPage - 1);
            if (i.customId === 'owed_next') currentPage = Math.min(totalPages - 1, currentPage + 1);
            await i.update({ embeds: [buildPage(currentPage)], components: [buildButtons(currentPage)] });
        });

        collector.on('end', async () => {
            try {
                await response.edit({ components: [] });
            } catch (e) {}
        });
    },
};