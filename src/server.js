const express = require('express');
const http = require('http');
const {databaseInit, insertRaid} = require("./core/database");
const {AuthenticateEndpoint} = require("./features/auth/authenticate-endpoint");
const {ReportRaidEndpoint} = require("./features/raids/report-raid-endpoint");
const {IsAuthenticatedEndpoint} = require("./features/auth/is-authenticated-endpoint");
require("./discord/discord-bot");
const {ReportAspectEndpoint} = require("./features/aspects/report-aspect-endpoint");
const {initQueue} = require("./features/player/player-queue");
const {ToggleAspectsEndpoint} = require("./features/aspects/toggle-aspects-endpoint");
const {VerifyLinkEndpoint} = require("./features/account-linking/verify-link-endpoint");
const {UnlinkMinecraftEndpoint} = require("./features/account-linking/unlink-minecraft-endpoint");
const { config } = require("./core/config");
const {websocketInit, wsManager} = require("./features/websocket/websocket");

const app = express();
const server = http.createServer(app);
const PORT = config.get("host-port") || 3000;

server.listen(PORT, '0.0.0.0', async (error) => {
    if (!error) console.log("Server is Successfully Running, and App is listening on port " + PORT)
    else console.log("Error occurred, server can't start", error);

    await databaseInit();
    await registerEndpoints(app);
    await initQueue();
    websocketInit(server);
});

const endpoints = {
    'authenticate': new AuthenticateEndpoint(),
    'report-raid': new ReportRaidEndpoint(),
    'report-aspect': new ReportAspectEndpoint(),
    'is-authenticated': new IsAuthenticatedEndpoint(),
    'toggle-aspects': new ToggleAspectsEndpoint(),
    'verify-link': new VerifyLinkEndpoint(),
    'unlink-minecraft': new UnlinkMinecraftEndpoint()
};

function registerEndpoints(app) {
    app.use('/api/:endpoint', async (req, res) => {
        const endpointName = req.params.endpoint;
        const endpoint = endpoints[endpointName];

        if (endpoint && typeof endpoint.call === 'function') {
            await endpoint.call(req, res);
        } else {
            res.status(404).send('Endpoint not found');
        }
    });
}



