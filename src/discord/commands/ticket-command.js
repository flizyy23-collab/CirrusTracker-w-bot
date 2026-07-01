const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, PermissionsBitField } = require("discord.js");

const STAFF_ROLE_ID = "1459230233902448803";
const ADMIN_ROLE_ID = "1459247694454194381";
const TICKET_PANEL_CHANNEL_ID = "1509010662188126248";
const TICKET_LOG_CHANNEL_ID = "1514523602467422288";
const TEST_CHANNEL_ID = "1484510982712725504";

// Check if this interaction is in the production guild (has the ticket panel channel)
function isProductionGuild(guild) {
    return guild.channels.cache.has(TICKET_PANEL_CHANNEL_ID);
}

function hasStaffRole(member) {
    return member.roles.cache.has(STAFF_ROLE_ID) ||
           member.roles.cache.has(ADMIN_ROLE_ID) ||
           member.permissions.has(PermissionFlagsBits.Administrator);
}

function buildPanelEmbeds() {
    const mainEmbed = new EmbedBuilder()
        .setColor(0xB4DDFF)
        .setTitle('Cirrus Applications')
        .setDescription(
            'Want to apply for guild member or community member? Click a corresponding button below to open a private ticket for your application.\n\n' +
            '**Requirements (Guild Member):**\n' +
            '- Level 110+ (flexible in some circumstances)\n' +
            '- Must be an active player with 100+ hours\n' +
            '- 20+ raids completed (preferred)'
        );

    const bannerEmbed = new EmbedBuilder()
        .setColor(0xB4DDFF)
        .setImage('https://cdn.discordapp.com/attachments/1520326968501997669/1520893188447928410/Untitled.png');

    return [mainEmbed, bannerEmbed];
}

function buildPanelButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_guild')
            .setLabel('Guild Member')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('☁️'),
        new ButtonBuilder()
            .setCustomId('ticket_community')
            .setLabel('Community Member')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🫒')
            .setDisabled(true)
    );
}

function buildTicketWelcomeEmbed(user, type) {
    if (type === 'guild') {
        return new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('Guild Member Application')
            .setDescription(
                `Welcome <@${user.id}>!\n\n` +
                'A staff member will be with you shortly.\n' +
                'Please provide the following information:\n\n' +
                '**1.** Your Minecraft IGN\n' +
                '**2.** Your region (EU/NA/AS)\n' +
                '**3.** Your age (optional)\n\n' +
                'A staff member can close this ticket with `/ticket close`.'
            )
            .setFooter({ text: `Guild application by ${user.username}` })
            .setTimestamp();
    } else {
        return new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Community Member Application')
            .setDescription(
                `Welcome <@${user.id}>!\n\n` +
                'A staff member will be with you shortly.\n' +
                'Please tell us a bit about yourself:\n\n' +
                '**1.** Your Minecraft IGN\n' +
                '**2.** How did you find us?\n\n' +
                'A staff member can close this ticket with `/ticket close`.'
            )
            .setFooter({ text: `Community application by ${user.username}` })
            .setTimestamp();
    }
}

function buildCloseButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
    );
}

async function generateTranscript(channel) {
    const messages = [];
    let lastId = null;

    // Fetch all messages (100 at a time)
    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        messages.push(...batch.values());
        lastId = batch.last().id;
        if (batch.size < 100) break;
    }

    // Sort oldest first
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Build transcript text
    const lines = messages
        .filter(m => !m.author.bot || m.embeds.length === 0) // skip bot embeds, keep bot text
        .map(m => {
            const time = m.createdAt.toISOString().replace('T', ' ').substring(0, 19);
            let content = m.content || '';
            if (m.attachments.size > 0) {
                const attachments = m.attachments.map(a => a.url).join('\n');
                content += (content ? '\n' : '') + attachments;
            }
            return `[${time}] ${m.author.username}: ${content}`;
        })
        .filter(l => l.trim().length > 0);

    return lines.join('\n');
}

async function closeTicket(interaction, channel) {
    // Check if this is actually a ticket channel
    if (!channel.name.startsWith('ticket-')) {
        return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
    }

    await interaction.deferReply();

    // Generate transcript
    const transcript = await generateTranscript(channel);
    const ticketOwner = channel.topic || 'Unknown';

    // Build log embed
    const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`Ticket Closed — ${channel.name}`)
        .setDescription(
            `**Opened by** — ${ticketOwner}\n` +
            `**Closed by** — <@${interaction.user.id}>\n` +
            `**Channel** — ${channel.name}`
        )
        .setTimestamp();

    // Send transcript to log channel (production only)
    if (isProductionGuild(interaction.guild)) {
        try {
            const logChannel = await interaction.client.channels.fetch(TICKET_LOG_CHANNEL_ID);
            if (logChannel) {
                if (transcript.length > 0) {
                    const buffer = Buffer.from(transcript, 'utf-8');
                    await logChannel.send({
                        embeds: [logEmbed],
                        files: [{
                            attachment: buffer,
                            name: `${channel.name}-transcript.txt`
                        }]
                    });
                } else {
                    logEmbed.addFields({ name: 'Transcript', value: 'No messages found.' });
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }
        } catch (err) {
            console.error('Error saving ticket transcript:', err.message);
        }
    }

    // Notify and delete channel
    await interaction.editReply('Ticket closing in 5 seconds...');
    setTimeout(async () => {
        try {
            await channel.delete();
        } catch (err) {
            console.error('Error deleting ticket channel:', err.message);
        }
    }, 5000);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket system')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Post the ticket panel in this channel')
        )
        .addSubcommand(sub =>
            sub.setName('close')
                .setDescription('Close the current ticket')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'setup') {
            if (!hasStaffRole(interaction.member)) {
                return interaction.reply({ content: 'Only staff can set up the ticket panel.', ephemeral: true });
            }

            // Only allow setup in the designated panel channel or test channel
            if (interaction.channelId !== TICKET_PANEL_CHANNEL_ID && interaction.channelId !== TEST_CHANNEL_ID) {
                return interaction.reply({ content: `This command can only be used in <#${TICKET_PANEL_CHANNEL_ID}>.`, ephemeral: true });
            }

            const embeds = buildPanelEmbeds();
            const row = buildPanelButton();
            await interaction.channel.send({ embeds: embeds, components: [row] });
            await interaction.reply({ content: 'Ticket panel posted!', ephemeral: true });

        } else if (sub === 'close') {
            if (!hasStaffRole(interaction.member)) {
                return interaction.reply({ content: 'Only staff can close tickets.', ephemeral: true });
            }

            await closeTicket(interaction, interaction.channel);
        }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;

        if (customId === 'ticket_guild' || customId === 'ticket_community') {
            const ticketType = customId === 'ticket_guild' ? 'guild' : 'community';
            // Check if user already has an open ticket
            const guild = interaction.guild;
            const isProd = isProductionGuild(guild);
            const channelName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

            const existing = guild.channels.cache.find(
                ch => ch.name === channelName && ch.name.startsWith('ticket-')
            );

            if (existing) {
                return interaction.reply({
                    content: `You already have an open ticket: <#${existing.id}>`,
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                // Create private channel
                const createOptions = {
                    name: channelName,
                    type: ChannelType.GuildText,
                    topic: `<@${interaction.user.id}> — ${ticketType} application`,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.SendMessages,
                                PermissionsBitField.Flags.ReadMessageHistory,
                                PermissionsBitField.Flags.AttachFiles
                            ]
                        }
                    ]
                };

                // Add staff role perms in production
                if (isProd) {
                    createOptions.permissionOverwrites.push({
                        id: STAFF_ROLE_ID,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages
                        ]
                    });
                    createOptions.permissionOverwrites.push({
                        id: ADMIN_ROLE_ID,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages
                        ]
                    });
                }

                const ticketChannel = await guild.channels.create(createOptions);

                // Send welcome message with close button
                const welcomeEmbed = buildTicketWelcomeEmbed(interaction.user, ticketType);
                const closeRow = buildCloseButton();
                await ticketChannel.send({ embeds: [welcomeEmbed], components: [closeRow] });

                // Ping the Chief role
                if (isProd) {
                    await ticketChannel.send('<@&1459230233902448803>');
                }

                await interaction.editReply(`Your ticket has been created: <#${ticketChannel.id}>`);
            } catch (err) {
                console.error('Error creating ticket channel:', err);
                await interaction.editReply('Failed to create ticket. Please try again or contact staff.');
            }

        } else if (customId === 'ticket_close') {
            if (!hasStaffRole(interaction.member)) {
                return interaction.reply({ content: 'Only staff can close tickets.', ephemeral: true });
            }

            await closeTicket(interaction, interaction.channel);
        }
    }
};
