const {getGuildRank, isPlayerInGuild} = require('../wynn-api')
const {generateToken, getToken} = require("../authentication");
const {sleep} = require("../misc");
const request = require('request');
const {getPlayerUsername, insertPlayer} = require("../database");
const { config } = require("../config");

class AuthenticateEndpoint {

    async call(req, res) {
        if (!req.query.uuid) return res.status(400).send("Missing parameters");
        let {uuid} = req.query;

        if (!await isPlayerInGuild(uuid)) return res.status(400).send("Player is not in the guild");

        let token = generateToken(uuid);
        res.status(200).send(token);

        await sleep(5000);
        await this.checkForAuthentication(uuid, token);
    }

    async checkForAuthentication(uuid, serverId, retry) {
        let username = retry ? await this.getUsername(uuid) : await getPlayerUsername(uuid);
        if (!retry && !username) {
            await this.checkForAuthentication(uuid, serverId, true);
            return;
        }

        console.log('Checking for authentication: ' + username + ' ' + serverId);

        const url = `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${username}&serverId=${serverId}`;
        request(url, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                let stars = getGuildRank(uuid);
                if (stars < getMinimumRank()) return;

                getToken(uuid).authenticate();
                console.log('Player authenticated: ' + username);
            } else {
                console.error('Mojang request failed', response.error);

                if (!retry) {
                    setTimeout(async () => {
                        await this.checkForAuthentication(uuid, serverId, true);

                    }, 5000);
                }
            }
        });
    }

    getUsername(uuid) {
        const url = `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`;
        return new Promise((resolve, reject) => {
            request(url, function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    let data = JSON.parse(body);

                    resolve(data.name);

                    if (data && data.name) insertPlayer(uuid, data.name);
                } else {
                    console.error('Mojang sessionserver request failed', response.error);
                    reject(null);
                }
            });
        });
    }
}

function getMinimumRank() {
    return config.get("minimum-rank");
}

module.exports = { AuthenticateEndpoint }
