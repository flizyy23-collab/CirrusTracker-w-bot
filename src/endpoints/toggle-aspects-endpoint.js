const {getToken} = require("../authentication");
const {isPlayerInGuild} = require("../wynn-api");
const {toggleNeedsAspects} = require("../database");
class ToggleAspectsEndpoint {

    async call(req, res) {
        let token = req.query.token;
        let {reporter} = req.query;

        let tokenObject = await getToken(reporter);

        if (!tokenObject || tokenObject.token !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");
        if (!await isPlayerInGuild(reporter)) return res.status(400).send("Reporter is not in the guild");

        let result = await toggleNeedsAspects(reporter);
        if (result === null) return res.status(400).send("Reporter is not in the guild or has not completed a raid!");

        console.log("Toggling needed aspects: ", reporter, result);

        res.status(200).send(result);
    }
}

module.exports = { ToggleAspectsEndpoint }