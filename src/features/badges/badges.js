const { badgeCacheService } = require("./badge-cache");

function createRaidLeaderCondition(raid, position) {
    return async (uuid) => {
        // Use cached leaderboard instead of database query
        const topPlayers = badgeCacheService.getCachedLeaderboard(raid);
        return topPlayers.length > position && topPlayers[position] === uuid;
    };
}

const badges = [
    {
        id: 'ALL_TOP_1',
        priority: 100,
        condition: createRaidLeaderCondition(-1, 0)
    },
    {
        id: 'ALL_TOP_2',
        priority: 100,
        condition: createRaidLeaderCondition(-1, 1)
    },
    {
        id: 'ALL_TOP_3',
        priority: 100,
        condition: createRaidLeaderCondition(-1, 2)
    },
    {
        id: 'NOTG_TOP_1',
        priority: 100,
        condition: createRaidLeaderCondition(0, 0)
    },
    {
        id: 'NOTG_TOP_2',
        priority: 100,
        condition: createRaidLeaderCondition(0, 1)
    },
    {
        id: 'NOTG_TOP_3',
        priority: 100,
        condition: createRaidLeaderCondition(0, 2)
    },
    {
        id: 'NOL_TOP_1',
        priority: 100,
        condition: createRaidLeaderCondition(1, 0)
    },
    {
        id: 'NOL_TOP_2',
        priority: 100,
        condition: createRaidLeaderCondition(1, 1)
    },
    {
        id: 'NOL_TOP_3',
        priority: 100,
        condition: createRaidLeaderCondition(1, 2)
    },
    {
        id: 'TCC_TOP_1',
        priority: 100,
        condition: createRaidLeaderCondition(2, 0)
    },
    {
        id: 'TCC_TOP_2',
        priority: 100,
        condition: createRaidLeaderCondition(2, 1)
    },
    {
        id: 'TCC_TOP_3',
        priority: 100,
        condition: createRaidLeaderCondition(2, 2)
    },
    {
        id: 'TNA_TOP_1',
        priority: 100,
        condition: createRaidLeaderCondition(3, 0)
    },
    {
        id: 'TNA_TOP_2',
        priority: 100,
        condition: createRaidLeaderCondition(3, 1)
    },
    {
        id: 'TNA_TOP_3',
        priority: 100,
        condition: createRaidLeaderCondition(3, 2)
    },

];

module.exports = { badgeDefinitions: badges };