const request = require('request');
const { config } = require("../../core/config");

function getWynnUser(uuid) {
    return new Promise((resolve, reject) => {
        const url = `https://api.wynncraft.com/v3/player/${uuid}`;

        request(url, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                resolve(JSON.parse(body));
            } else {
                reject(new Error('WynnAPI request failed' + response.error));
            }
        });
    });
}

function getGuildRank(uuid) {
    return new Promise((resolve, reject) => {
        getWynnUser(uuid).then((wynnUser) => {
            if (!wynnUser.guild || wynnUser.guild === "NULL") {
                resolve(0);
                return;
            }
            resolve(wynnUser.guild.rankStars.length);
        }).catch(reject);
    });
}

async function getPlayerGuild(uuid) {

    try {
        let player = await getWynnUser(uuid);
        if (!player.guild || player.guild === "NULL") return null;
        return player.guild.prefix;
    } catch (error) {
        console.error('Error fetching player guild:', error);
        return null;
    }
}

async function getPlayerGuildInfo(uuid) {
    try {
        let player = await getWynnUser(uuid);
        if (!player.guild || player.guild === "NULL") return { guild: null, guildRank: null };
        
        const guildPrefix = player.guild.prefix;
        let guildRank = null;
        
        // Only get guild rank if player is in the configured guild
        if (guildPrefix === config.get("guild-tag")) {
            guildRank = player.guild.rankStars ? player.guild.rankStars.length : 0;
        }
        
        return { guild: guildPrefix, guildRank };
    } catch (error) {
        console.error('Error fetching player guild info:', error);
        return { guild: null, guildRank: null };
    }
}

async function isPlayerInGuild(uuid) {
    try {
        let player = await getWynnUser(uuid);
        let guild = player.guild;

        if (!guild || guild === "NULL") return false;

        return guild.prefix === config.get("guild-tag");
    } catch (error) {
        console.error('Error checking if player is in guild:', error);
        return false;
    }
}

module.exports = {getGuildRank, isPlayerInGuild, getPlayerGuild, getPlayerGuildInfo};
