const {getToken} = require("../auth/authentication");
const {getPlayerUUID, insertAspect, resolveAlias} = require("../../core/database");
const {requestUUID, requestWynnPlayerUUID} = require("../../core/utilities");

class ReportAspectEndpoint {
    constructor() {
        // Tracks pending aspect reports: key → { count, timer, giverUUID, receiverUUID, reporter, resolved }
        this.pendingAspects = new Map();
    }

    async call(req, res) {
        let token = req.query.token;
        let {giver, receiver, reporter, count} = req.query;
        const aspectCount = Math.min(parseInt(count) || 1, 10); // cap at 10 for safety

        if (!token || !giver || !receiver) return res.status(400).send("Missing parameters");

        let tokenObject = await getToken(reporter);
        if (!tokenObject || tokenObject.serverId !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");

        const reportKey = `${giver}-${receiver}`;
        const pending = this.pendingAspects.get(reportKey);

        if (pending) {
            // Another mod already reported this — update count if higher
            if (aspectCount > pending.count) {
                pending.count = aspectCount;
                console.log(`Aspect report updated: ${giver} → ${receiver} x${aspectCount} (reporter: ${reporter})`);
            } else {
                console.log(`Aspect report deduped: ${giver} → ${receiver} x${aspectCount} (keeping x${pending.count})`);
            }
            return res.status(200).send("Aspect reported");
        }

        // First report — resolve UUIDs and start a 5-second window
        let giverUUID = await getPlayerUUID(giver);
        let receiverUUID = await getPlayerUUID(receiver);

        if (!giverUUID) {
            const aliasName = await resolveAlias(giver);
            if (aliasName) giverUUID = await getPlayerUUID(aliasName);
        }
        if (!receiverUUID) {
            const aliasName = await resolveAlias(receiver);
            if (aliasName) receiverUUID = await getPlayerUUID(aliasName);
        }

        if (!giverUUID) giverUUID = (await requestUUID(giver))?.uuid;
        if (!receiverUUID) receiverUUID = (await requestUUID(receiver))?.uuid;

        if (!giverUUID) giverUUID = await requestWynnPlayerUUID(giver);
        if (!receiverUUID) receiverUUID = await requestWynnPlayerUUID(receiver);

        if (!giverUUID || !receiverUUID) return res.status(400).send("Invalid player");

        const entry = { count: aspectCount, giverUUID, receiverUUID, reporter };
        this.pendingAspects.set(reportKey, entry);

        console.log(`Aspect report queued: ${giver} → ${receiver} x${aspectCount} (reporter: ${reporter}), waiting 5s for other reports...`);
        res.status(200).send("Aspect reported");

        // Wait 5 seconds to collect reports from all mods, then insert with highest count
        setTimeout(async () => {
            const final = this.pendingAspects.get(reportKey);
            this.pendingAspects.delete(reportKey);
            if (!final) return;

            console.log(`Aspect report finalized: ${giver} → ${receiver} x${final.count}`);
            for (let i = 0; i < final.count; i++) {
                await insertAspect(final.giverUUID, final.receiverUUID, final.reporter);
            }
        }, 5000);
    }
}

module.exports = { ReportAspectEndpoint }