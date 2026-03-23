const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const axios = require('axios');
const {getPlayerUUID, getRaids, getPlayerUsername} = require("../../core/database");
const {daysToTimestamp} = require("../../core/utilities");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raids')
        .setDescription('Returns data on the given player\'s completed guild raids')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The name of the player')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('days')
                .setDescription('The time period to check for raids')
        ),
    async execute(interaction) {
        let playerName = interaction.options.getString('player');
        let uuid = await getPlayerUUID(playerName);

        let days = interaction.options.getString('days');
        if (days) days = parseInt(days);

        if (!uuid) {
            await interaction.reply(`Unable to find player with the name ${playerName}`);
            return;
        }

        playerName = await getPlayerUsername(uuid);

        let raidCounts = [0, 0, 0, 0]
        let raidsData = await getRaids(uuid, daysToTimestamp((days) ? days : -1));
        for (let i = 0; i < raidsData.length; i++) {
            let raidIndex = raidsData[i].raid;
            raidCounts[raidIndex]++;
        }

        let attachment = null;
        try {
            const response = await axios.get(`https://crafatar.com/renders/head/${uuid}?overlay=true`, { responseType: 'arraybuffer', timeout: 5000 });
            const buffer = Buffer.from(response.data, 'binary');
            attachment = new AttachmentBuilder(buffer, { name: 'thumbnail.png' });
        } catch (e) {
            // crafatar unavailable, skip thumbnail
        }

        const exampleEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setAuthor({ name: 'Player Guild Raid Stats' })
            .setTitle(`**${playerName}**`)
            .setDescription(`*${days ? `Last ${days} Day` + (days !== 1 ? "s" : "") : 'All Time'}*`)
            .addFields(
                { name: '\u200B', value: '\u200B' },
                { name: 'Nest of the Grootslangs', value: `\`\`\`Completions: ${raidCounts[0].toString()}   \`\`\``, inline: true },
                { name: "Orphion's Nexus of Light", value: `\`\`\`Completions: ${raidCounts[1].toString()}   \`\`\``, inline: true },
                { name: '\u200B', value: '\u200B'},
                { name: 'The Canyon Colossus', value: `\`\`\`Completions: ${raidCounts[2].toString()}   \`\`\``, inline: true },
                { name: 'The Nameless Anomaly', value: `\`\`\`Completions: ${raidCounts[3].toString()}   \`\`\``, inline: true }
            )

        if (attachment) exampleEmbed.setThumbnail('attachment://thumbnail.png');
        await interaction.reply({ embeds: [exampleEmbed], files: attachment ? [attachment] : [] });
    },
};