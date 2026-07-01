const { getWorldEvent, setWorldEvent, updateWorldEventStatus, logWorldEventError } = require("../../core/database");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType } = require('discord.js');

const EVENT_NAME = 'Prelude to Annihilation';
const POLL_INTERVAL = 60000; // 60 seconds
const EVENT_CYCLE_MS = 3 * 86400000 + 16 * 3600000; // 3 days 16 hours
const MAX_RETRIES = 5;
const AUTO_ANNOUNCE_CHANNEL = '1485449189004546258';
const PARTY_SIZE = 10;
const MAX_PARTIES = 5;

let pollInterval;
let lastKnownStatus = null;
let lastAnnouncedTime = null;
let discordClient = null;

// Party state (in memory, resets on restart)
let parties = []; // array of arrays, each inner array = party of up to 10 members
let partyMessage = null; // the message with party embeds
let partyCollector = null;

const DPS_KEYWORDS = ['laby', 'labyrinth', 'trapper', 'hana', 'acro', 'sharpshooter', 'sharp', 'trance', 'strati', 'mstrati'];
const HEALER_KEYWORDS = ['aco', 'acolyte', 'lb', 'lightbender', 'bender', 'abso', 'lament', 'halc', 'halcyon'];
const TANK_KEYWORDS = ['guard', 'guardian', 'pala', 'paladin'];

function detectRole(build) {
    const words = build.toLowerCase().split(/\s+/);
    for (const w of words) {
        if (DPS_KEYWORDS.includes(w)) return 'dps';
        if (HEALER_KEYWORDS.includes(w)) return 'healer';
        if (TANK_KEYWORDS.includes(w)) return 'tank';
    }
    return null;
}

function getRoleIcon(role) {
    if (role === 'dps') return '⚔️';
    if (role === 'healer') return '❤️‍🩹';
    if (role === 'tank') return '🛡️';
    return '';
}

async function initAnni(client) {
    discordClient = client;
    console.log('Initializing Annihilation event tracker...');
    
    // Check if there's already a confirmed event in DB (don't re-announce on restart)
    const existingEvent = await getWorldEvent(EVENT_NAME);
    if (existingEvent && !existingEvent.is_predicted) {
        lastAnnouncedTime = new Date(existingEvent.scheduled_time).getTime();
        console.log(`Restored last announced anni time: ${existingEvent.scheduled_time}`);
    }
    
    // Always recalculate from baseline if no event or event is in the past
    const lastEvent = new Date('2026-06-22T08:50:00Z'); // June 22 10:50 CET
    
    if (!existingEvent || new Date(existingEvent.scheduled_time).getTime() < Date.now()) {
        let nextPredicted = new Date(lastEvent.getTime() + EVENT_CYCLE_MS);
        const now = Date.now();
        while (nextPredicted.getTime() < now) {
            nextPredicted = new Date(nextPredicted.getTime() + EVENT_CYCLE_MS);
        }
        await setWorldEvent(EVENT_NAME, nextPredicted, true);
        console.log(`Annihilation event initialized, predicted: ${nextPredicted.toISOString()}`);
    }
    
    // Start polling
    await pollAnniEvent();
    pollInterval = setInterval(() => pollAnniEvent().catch(err => console.error('Error in anni poll:', err)), POLL_INTERVAL);
}

async function pollAnniEvent() {
    const event = await getWorldEvent(EVENT_NAME);
    if (!event) return;

    try {
        // Try to fetch from Wynncraft API
        const res = await fetch('https://api.wynncraft.com/v3/map/world-events');
        if (!res.ok) {
            throw new Error(`API returned ${res.status}`);
        }

        const worldEvents = await res.json();
        const eventsArray = Array.isArray(worldEvents) ? worldEvents : Object.values(worldEvents);
        const anniEvent = eventsArray.find(e => e?.name === EVENT_NAME);

        if (anniEvent && anniEvent.schedule) {
            const eventTime = new Date(anniEvent.schedule);
            const dbTime = new Date(event.scheduled_time).getTime();
            const isNewTime = eventTime.getTime() !== dbTime;
            const wasPredicted = event.is_predicted;
            
            if (isNewTime) {
                console.log(`✓ Updated Annihilation event time: ${eventTime.toISOString()}`);
                await setWorldEvent(EVENT_NAME, eventTime, false);
            }
            
            lastKnownStatus = getEventStatus(eventTime);
            await updateWorldEventStatus(EVENT_NAME, 'confirmed');
            
            // Auto-announce if this is a new confirmed event OR was previously predicted
            if (lastAnnouncedTime !== eventTime.getTime() && (isNewTime || wasPredicted)) {
                await announceEvent(eventTime);
                lastAnnouncedTime = eventTime.getTime();
            }
            return;
        } else {
            // No schedule from API — if current event is in the past, predict next one
            const eventDate = new Date(event.scheduled_time);
            if (eventDate.getTime() < Date.now()) {
                const nextPredicted = new Date(eventDate.getTime() + EVENT_CYCLE_MS);
                await setWorldEvent(EVENT_NAME, nextPredicted, true);
                await updateWorldEventStatus(EVENT_NAME, 'predicted');
                lastKnownStatus = getEventStatus(nextPredicted);
                console.log(`Event ended, predicted next: ${nextPredicted.toISOString()}`);
            } else {
                lastKnownStatus = getEventStatus(eventDate);
            }
        }
        
    } catch (error) {
        console.error(`✗ Annihilation event poll failed: ${error.message}`);
        await logWorldEventError(EVENT_NAME, error.message);

        // If retries exceeded and event is old, predict next one
        const event = await getWorldEvent(EVENT_NAME);
        if (event && event.api_retry_count >= MAX_RETRIES) {
            const eventDate = new Date(event.scheduled_time);
            const now = Date.now();
            
            // If predicted event is in the past, predict next one
            if (eventDate.getTime() < now) {
                const nextPredicted = new Date(eventDate.getTime() + EVENT_CYCLE_MS);
                await setWorldEvent(EVENT_NAME, nextPredicted, true);
                console.log(`Predicted next Annihilation event: ${nextPredicted.toISOString()}`);
                await updateWorldEventStatus(EVENT_NAME, 'predicted');
                lastKnownStatus = 'predicted';
            }
        }
    }
}

async function announceEvent(eventTime) {
    if (!discordClient) return;
    
    try {
        const channel = await discordClient.channels.fetch(AUTO_ANNOUNCE_CHANNEL);
        if (!channel) return;

        const unix = Math.floor(eventTime.getTime() / 1000);
        
        // Reset parties for new event
        parties = [[]];
        
        // Send announcement
        const announceEmbed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle('🔔 Annihilation event has been confirmed!')
            .setDescription(`<t:${unix}:f> — <t:${unix}:R>`)
            .setTimestamp();

        await channel.send({ content: '<@&1462636169799139481>', embeds: [announceEmbed] });

        // Send party signup message
        const { embeds, components } = buildPartyMessage(eventTime);
        partyMessage = await channel.send({ embeds, components });
        
        // Start collector for buttons
        startPartyCollector(channel, eventTime);
        
        console.log(`✓ Announced Annihilation event with party signup to channel ${AUTO_ANNOUNCE_CHANNEL}`);
    } catch (error) {
        console.error(`✗ Failed to announce event:`, error.message);
    }
}

function buildPartyMessage(eventTime) {
    const unix = Math.floor(eventTime.getTime() / 1000);
    const embeds = [];

    // Header embed
    const headerEmbed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('Prelude to Annihilation — Party Signup')
        .setDescription(`<t:${unix}:f> — <t:${unix}:R>`)
        .setTimestamp();
    embeds.push(headerEmbed);

    // Party embeds
    for (let i = 0; i < parties.length; i++) {
        embeds.push(buildPartyEmbed(i));
    }

    // If last party is full and under max, show empty next party
    if (parties.length < MAX_PARTIES && parties[parties.length - 1].length >= PARTY_SIZE) {
        parties.push([]);
        embeds.push(buildPartyEmbed(parties.length - 1));
    }

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('anni_join')
                .setLabel('Join Party')
                .setEmoji('⚔️')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('anni_leave')
                .setLabel('Leave Party')
                .setEmoji('🚪')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('anni_leader')
                .setLabel('Set Leader')
                .setEmoji('👑')
                .setStyle(ButtonStyle.Primary),
        )
    ];

    return { embeds, components };
}

function buildPartyEmbed(partyIndex) {
    const party = parties[partyIndex] || [];
    const filledSlots = party.length;
    const leader = party.find(p => p.isLeader);

    const lines = [];
    for (let j = 0; j < PARTY_SIZE; j++) {
        const slot = j + 1;
        if (j < party.length) {
            const p = party[j];
            const roleIcon = getRoleIcon(p.role);
            const leaderIcon = p.isLeader ? '👑 ' : '';
            let line = `**${slot})** ${leaderIcon}${roleIcon ? roleIcon + ' ' : ''}**${p.username}** using *${p.build}* (<@${p.discordId}>)`;
            if (p.note) line += `\n  📝 ${p.note}`;
            lines.push(line);
        } else {
            lines.push(`**${slot})** <Available>`);
        }
    }

    const embed = new EmbedBuilder()
        .setColor(filledSlots >= PARTY_SIZE ? 0x2ECC71 : 0xFF6B6B)
        .setTitle(`Party ${partyIndex + 1}`)
        .addFields(
            { name: 'Slots', value: `${filledSlots} / ${PARTY_SIZE}`, inline: true },
            { name: 'Leader', value: leader ? `👑 ${leader.username}` : 'None', inline: true },
        )
        .setDescription(lines.join('\n'));

    return embed;
}

function startPartyCollector(channel, eventTime) {
    if (partyCollector) {
        try { partyCollector.stop(); } catch (e) {}
    }

    partyCollector = channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.customId === 'anni_join' || i.customId === 'anni_leave' || i.customId === 'anni_leader',
        time: 48 * 60 * 60000 // 48 hours
    });

    partyCollector.on('collect', async (btn) => {
        try {
            if (btn.customId === 'anni_join') {
                await handleJoin(btn, eventTime);
            } else if (btn.customId === 'anni_leave') {
                await handleLeave(btn, eventTime);
            } else if (btn.customId === 'anni_leader') {
                await handleSetLeader(btn, eventTime);
            }
        } catch (error) {
            console.error('Error handling party button:', error);
            try {
                if (!btn.replied && !btn.deferred) {
                    await btn.reply({ content: '❌ Something went wrong.', ephemeral: true });
                }
            } catch (e) {}
        }
    });

    partyCollector.on('end', async () => {
        // Disable buttons when collector ends
        if (partyMessage) {
            try {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('anni_join').setLabel('Join Party').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(true),
                    new ButtonBuilder().setCustomId('anni_leave').setLabel('Leave Party').setEmoji('🚪').setStyle(ButtonStyle.Danger).setDisabled(true),
                    new ButtonBuilder().setCustomId('anni_leader').setLabel('Set Leader').setEmoji('👑').setStyle(ButtonStyle.Primary).setDisabled(true),
                );
                await partyMessage.edit({ components: [disabledRow] });
            } catch (e) {}
        }
    });
}

async function handleSetLeader(btn, eventTime) {
    // Find which party this user is in
    let userPartyIdx = -1;
    for (let i = 0; i < parties.length; i++) {
        if (parties[i].find(p => p.discordId === btn.user.id)) {
            userPartyIdx = i;
            break;
        }
    }

    if (userPartyIdx === -1) {
        return btn.reply({ content: '❌ You must be in a party to set a leader.', ephemeral: true });
    }

    // Remove old leader in this party
    for (const p of parties[userPartyIdx]) {
        p.isLeader = false;
    }

    // Set this user as leader
    const user = parties[userPartyIdx].find(p => p.discordId === btn.user.id);
    user.isLeader = true;

    await btn.reply({ content: `✅ **${user.username}** is now the leader of Party ${userPartyIdx + 1}!`, ephemeral: true });
    await updatePartyMessage(eventTime);
}

async function handleJoin(btn, eventTime) {
    // Check if already in a party
    for (const party of parties) {
        if (party.find(p => p.discordId === btn.user.id)) {
            return btn.reply({ content: '❌ You are already in a party. Leave first to rejoin.', ephemeral: true });
        }
    }

    // Check if there's space
    let targetParty = parties.findIndex(p => p.length < PARTY_SIZE);
    if (targetParty === -1) {
        if (parties.length < MAX_PARTIES) {
            parties.push([]);
            targetParty = parties.length - 1;
        } else {
            return btn.reply({ content: '❌ All parties are full!', ephemeral: true });
        }
    }

    // Show modal for username, build, note
    const modal = new ModalBuilder()
        .setCustomId('anni_join_modal_' + btn.user.id + '_' + Date.now())
        .setTitle('Join Annihilation Party');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('username')
                .setLabel('Minecraft Username')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(16)
                .setPlaceholder('e.g. Flizyy')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('build')
                .setLabel('Build')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50)
                .setPlaceholder('e.g. Hana, Guardian, Lightbender')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('note')
                .setLabel('Note (optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(50)
                .setPlaceholder('e.g. might be late')
        ),
    );

    await btn.showModal(modal);

    const modalSubmit = await btn.awaitModalSubmit({
        filter: i => i.customId === modal.data.custom_id && i.user.id === btn.user.id,
        time: 300000
    }).catch(() => null);

    if (!modalSubmit) return;

    const username = modalSubmit.fields.getTextInputValue('username').replace(/[^a-zA-Z0-9_]/g, '');
    const build = modalSubmit.fields.getTextInputValue('build');
    const note = modalSubmit.fields.getTextInputValue('note') || null;

    if (!username || !build) {
        return modalSubmit.reply({ content: '❌ Username and build are required.', ephemeral: true });
    }

    // Check if username already taken by someone else
    for (const party of parties) {
        const existing = party.find(p => p.username.toLowerCase() === username.toLowerCase());
        if (existing && existing.discordId !== btn.user.id) {
            return modalSubmit.reply({ content: `❌ **${username}** is already in a party.`, ephemeral: true });
        }
    }

    const role = detectRole(build);

    // Re-check target party (could have filled during modal)
    targetParty = parties.findIndex(p => p.length < PARTY_SIZE);
    if (targetParty === -1) {
        if (parties.length < MAX_PARTIES) {
            parties.push([]);
            targetParty = parties.length - 1;
        } else {
            return modalSubmit.reply({ content: '❌ All parties filled while you were entering info.', ephemeral: true });
        }
    }

    parties[targetParty].push({
        discordId: btn.user.id,
        username,
        build,
        note,
        role
    });

    await modalSubmit.reply({ content: `✅ **${username}** joined Party ${targetParty + 1} as **${build}**. Good luck! 🔥`, ephemeral: true });

    // Update the party message
    await updatePartyMessage(eventTime);
}

async function handleLeave(btn, eventTime) {
    let found = false;
    for (const party of parties) {
        const idx = party.findIndex(p => p.discordId === btn.user.id);
        if (idx !== -1) {
            const removed = party.splice(idx, 1)[0];
            found = true;
            await btn.reply({ content: `✅ **${removed.username}** has left the party.`, ephemeral: true });
            break;
        }
    }

    if (!found) {
        return btn.reply({ content: '❌ You are not in any party.', ephemeral: true });
    }

    // Clean up empty trailing parties (keep at least 1)
    while (parties.length > 1 && parties[parties.length - 1].length === 0) {
        parties.pop();
    }

    await updatePartyMessage(eventTime);
}

async function updatePartyMessage(eventTime) {
    if (!partyMessage) return;
    try {
        const { embeds, components } = buildPartyMessage(eventTime);
        await partyMessage.edit({ embeds, components });
    } catch (error) {
        console.error('Failed to update party message:', error.message);
    }
}

function getEventStatus(eventTime) {
    const now = Date.now();
    const eventMs = eventTime.getTime();
    const diffMs = eventMs - now;
    
    // Event status: 'ended' (past), 'active' (within event duration ~2h), 'imminent' (<1h), 'upcoming'
    if (diffMs < 0 && Math.abs(diffMs) < 120 * 60000) {
        return 'active';
    } else if (diffMs < 0) {
        return 'ended';
    } else if (diffMs < 60 * 60000) {
        return 'imminent';
    }
    return 'upcoming';
}

async function getAnniEvent() {
    return await getWorldEvent(EVENT_NAME);
}

async function getAnniStatus() {
    try {
        const event = await getAnniEvent();
        if (!event) {
            console.warn('No Annihilation event found in DB');
            return null;
        }

        const status = getEventStatus(new Date(event.scheduled_time));
        return {
            name: EVENT_NAME,
            time: new Date(event.scheduled_time),
            status: status,
            isPredicted: event.is_predicted,
            apiStatus: event.api_status,
            lastCheck: event.last_api_check,
            retryCount: event.api_retry_count
        };
    } catch (err) {
        console.error('Error getting anni status:', err);
        return null;
    }
}

async function closePartySignup() {
    if (partyCollector) {
        try { partyCollector.stop(); } catch (e) {}
        partyCollector = null;
    }
    if (partyMessage) {
        try {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('anni_join').setLabel('Join Party').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('anni_leave').setLabel('Leave Party').setEmoji('🚪').setStyle(ButtonStyle.Danger).setDisabled(true),
                new ButtonBuilder().setCustomId('anni_leader').setLabel('Set Leader').setEmoji('👑').setStyle(ButtonStyle.Primary).setDisabled(true),
            );
            await partyMessage.edit({ components: [disabledRow] });
        } catch (e) {}
        partyMessage = null;
    }
    parties = [];
}

async function manualStartParty(channel) {
    if (!discordClient) return;
    const event = await getWorldEvent(EVENT_NAME);
    const eventTime = event ? new Date(event.scheduled_time) : new Date(Date.now() + 3600000);
    
    // Reset parties
    parties = [[]];
    
    const { embeds, components } = buildPartyMessage(eventTime);
    partyMessage = await channel.send({ embeds, components });
    startPartyCollector(channel, eventTime);
}

function stopAnni() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        console.log('Annihilation event tracker stopped.');
    }
}

module.exports = { initAnni, getAnniEvent, getAnniStatus, stopAnni, getEventStatus, announceEvent, closePartySignup, manualStartParty };
