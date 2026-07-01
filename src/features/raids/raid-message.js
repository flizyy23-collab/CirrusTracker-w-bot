const { EmbedBuilder } = require('discord.js');
const { config } = require("../../core/config");
const { getRaidCount } = require("../../core/database");
const { client } = require("../../discord/discord-bot")

const raids = ["Nest of the Grootslangs",
    "Orphion's Nexus of Light",
    "The Canyon Colossus",
    "The Nameless Anomaly",
    "The Wartorn Palace"
]

const raidsAbbr = [
    "NOTG",
    "NOL",
    "TCC",
    "TNA",
    "TWP",
]

function getWeeklyTimestamp() {
    const now = new Date();
    const estNow = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const currentDay = estNow.getDay();
    
    let daysToSubtract;
    if (currentDay === 5) {
        if (estNow.getHours() < 12) {
            daysToSubtract = 7;
        } else {
            daysToSubtract = 0;
        }
    } else if (currentDay === 6) {
        daysToSubtract = 1;
    } else if (currentDay === 0) {
        daysToSubtract = 2;
    } else {
        daysToSubtract = currentDay + 2;
    }
    
    const targetDate = new Date(estNow);
    targetDate.setDate(estNow.getDate() - daysToSubtract);
    targetDate.setHours(12, 0, 0, 0);
    return targetDate;
}

async function sendRaidEmbed(raidID, players) {
    this.config = config.get('chat-bridge');
    const channelId = this.config['channel-id'];
    try {
        const channel = await client.channels.fetch(channelId);
        const weeklyTimestamp = getWeeklyTimestamp();
        const mysqlTimestamp = weeklyTimestamp.toISOString().slice(0, 19).replace('T', ' ');
        const specificRaidCount = await getRaidCount(raidID);
        const totalRaidCount = await getRaidCount();
        const weeklyRaidCount = await getRaidCount(null, mysqlTimestamp);

        // Format player list: "A", "A & B", "A, B, & C", "A, B, C, & D"
        let playerText;
        if (players.length === 1) {
            playerText = players[0];
        } else if (players.length === 2) {
            playerText = `${players[0]} & ${players[1]}`;
        } else {
            playerText = players.slice(0, -1).join(', ') + ', & ' + players[players.length - 1];
        }

        const aspectsPerPlayer = (2 / players.length);
        const aspectsText = aspectsPerPlayer % 1 === 0 ? aspectsPerPlayer.toString() : aspectsPerPlayer.toFixed(2);

        const embed = new EmbedBuilder()
            .setTitle(`${playerText} Completed ${raids[raidID]}`)
            .setDescription(
                `Players: **${players.length}** · Aspects each: **${aspectsText}**\n` +
                `All time ${raidsAbbr[raidID]}'s: ${specificRaidCount}\n` +
                `All time guild raids: ${totalRaidCount}\n` +
                `Guild raids this week: ${weeklyRaidCount}`
            )
            .setColor(0x0099FF)

        const messageOptions = { embeds: [embed] };

        await channel.send(messageOptions);
        console.log(`Embed sent successfully to channel ${channelId}`);
        return true;

    } catch (error) {
        console.error(`Failed to send embed to channel ${channelId}:`, error.message);
        return false;
    }
}

module.exports = {sendRaidEmbed}