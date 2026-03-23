const { getToken } = require("../auth/authentication");
const { chatBridge } = require("./chat-bridge-service");

class ReportChatEndpoint {
    async call(req, res) {
        const { token, reporter, username, message } = req.query;

        if (!token || !reporter || !username || !message) return res.status(400).send("Missing parameters");

        const tokenObject = await getToken(reporter);
        if (!tokenObject || tokenObject.serverId !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");

        const packet = { data: { username, message } };
        await chatBridge.handleMinecraftMessage(null, packet);

        res.status(200).send("Chat message reported");
    }
}

module.exports = { ReportChatEndpoint };
