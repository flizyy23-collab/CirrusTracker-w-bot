const { getPlayersWithVerifiedLinks } = require("../../core/database");
const { rankService } = require("./rank-service");

class RankEndpoint {
    async call(req, res) {
        try {
            // Get only players with verified Discord account links
            const rows = await getPlayersWithVerifiedLinks();
            const playersWithRanks = [];

            for (const row of rows) {
                try {
                    const memberRank = await rankService.getMemberRank(row.discord_id);
                    if (!memberRank) {
                        console.warn(`No rank found for player ${row.username} (${row.discord_id})`);
                        continue;
                    }

                    let rankInfo = memberRank.identifier;

                    playersWithRanks.push({
                        uuid: row.uuid,
                        username: row.username,
                        guild: row.guild,
                        needs_aspects: row.needs_aspects,
                        rank: rankInfo,
                        discord_id: row.discord_id
                    });
                } catch (error) {
                    console.error(`Error processing rank for player ${row.username}:`, error);
                }
            }

            res.status(200).json(playersWithRanks);
        } catch (error) {
            console.error("Error in rank endpoint:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}

module.exports = { RankEndpoint };