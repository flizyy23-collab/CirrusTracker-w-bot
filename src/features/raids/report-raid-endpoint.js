const {getToken} = require("../auth/authentication");
const {insertRaid, getPlayerUUID, insertPlayer, checkRecentRaidExists} = require("../../core/database");
const {requestUUID} = require("../../core/utilities");
const {sendRaidEmbed} = require("./raid-message");

class ReportRaidEndpoint {
    constructor() {
        this.recentRaids = new Map();
    }

    async call(req, res) {
        let token = req.query.token;
        let {raid, player1, player2, player3, player4, reporter, seasonRating, guildXP} = req.query;

        if (!raid || !token || !player1 || !reporter || !seasonRating || !guildXP) return res.status(400).send("Missing parameters");

        // Build players array (only player1 required)
        const playerNames = [player1];
        if (player2) playerNames.push(player2);
        if (player3) playerNames.push(player3);
        if (player4) playerNames.push(player4);

        // In-memory dedup for rapid duplicate requests
        const reportKey = `${raid}-${playerNames.sort().join('-')}`;
        if (this.recentRaids.has(reportKey)) {
            return res.status(200).send("Raid already reported");
        }
        this.recentRaids.set(reportKey, true);
        setTimeout(() => this.recentRaids.delete(reportKey), 1000 * 60 * 5);

        try {
            let tokenObject = await getToken(reporter);

            if (!tokenObject || tokenObject.serverId !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");

            let playerUuids = [];

            for (let i = 0; i < playerNames.length; i++) {
                let player = playerNames[i];

                let uuid = await getPlayerUUID(player);

                if (!uuid) uuid = (await requestUUID(player))?.uuid;
                if (!uuid) return res.status(400).send("Invalid player: " + player);

                playerUuids.push(uuid);
            }

            // DB-based dedup
            const isDuplicate = await checkRecentRaidExists(raid, playerUuids);
            if (isDuplicate) {
                console.log("Raid already exists in DB, skipping: ", reportKey);
                return res.status(200).send("Raid already reported");
            }

            // Ensure all players exist in the players table
            for (let i = 0; i < playerUuids.length; i++) {
                await insertPlayer(playerUuids[i], playerNames[i]);
            }

            console.log("Reporting raid: ", raid, playerNames.join(', '), reporter, seasonRating, guildXP);

            await insertRaid(raid, playerUuids, reporter, seasonRating, guildXP);
            res.status(200).send("Raid reported");
            await sendRaidEmbed(raid, playerNames);
        } catch (err) {
            console.error("Error reporting raid: ", err);
            res.status(500).send("Error reporting raid");
        }
    }
}

module.exports = { ReportRaidEndpoint }