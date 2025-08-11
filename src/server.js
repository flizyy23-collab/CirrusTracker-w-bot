const express = require('express');
const http = require('http');
const {databaseInit, insertRaid} = require("./database");
const {AuthenticateEndpoint} = require("./endpoints/authenticate-endpoint");
const {ReportRaidEndpoint} = require("./endpoints/report-raid-endpoint");
const {IsAuthenticatedEndpoint} = require("./endpoints/is-authenticated-endpoint");
require("./discord/discord-bot");
const {ReportAspectEndpoint} = require("./endpoints/report-aspect-endpoint");
const {initQueue} = require("./player-queue");
const {ToggleAspectsEndpoint} = require("./endpoints/toggle-aspects-endpoint");
const { config } = require("./config");
const {websocketInit, wsManager} = require("./websocket");

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
    'toggle-aspects': new ToggleAspectsEndpoint()
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



