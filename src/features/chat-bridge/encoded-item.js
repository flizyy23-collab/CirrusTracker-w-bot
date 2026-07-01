const {requestItemAnalysis} = require("../../core/utilities");

const tierColors = {
        "mythic": 11141290,
        "fabled": 16733525,
        "legendary": 5636095,
        "rare": 16733695,
        "unique": 12697887,
        "common": 16777215
    };

function extractAllItemHashes(text) {
    const itemHashStart = "\u{F0000}\u{F0100}";
    const words = text.split(/\s+/);
    const itemHashes = [];
    
    for (const word of words) {
        if (word.startsWith(itemHashStart)) {
            itemHashes.push(word);
        }
    }
    
    return itemHashes;
}

function analyzeAndFormatItems(text) {
    return new Promise((resolve, reject) => {
        const itemHashes = extractAllItemHashes(text);
        
        if (itemHashes.length === 0) {
            reject(new Error('No item hashes found in the provided text'));
            return;
        }
        
        const analysisPromises = itemHashes.map(hash => requestItemAnalysis(hash));
        Promise.all(analysisPromises)
            .then(results => {
                let updatedText = text;
                const embeds = [];
                
                results.forEach((result, index) => {
                    const hash = itemHashes[index];
                    updatedText = updatedText.replace(hash, result.itemName);

                    // Calculate overall average
                    let totalRate = 0, statCount = 0;
                    for (const statName of Object.keys(result.stats)) {
                        const rateValue = parseFloat(result.rate[statName]) || 0;
                        totalRate += rateValue;
                        statCount++;
                    }
                    const overallStr = statCount > 0 ? (totalRate / statCount).toFixed(2) : "0.00";

                    // Build stat lines
                    let statLines = [];
                    for (const [statName, statValue] of Object.entries(result.stats)) {
                        const rateValue = result.rate[statName];
                        const rateStr = (typeof rateValue === 'number') ? rateValue.toFixed(2) : rateValue;

                        let displayStat, displayValue;
                        const sign = statValue >= 0 ? "+" : "";
                        if (statName.endsWith(' %')) {
                            displayStat = statName.slice(0, -2);
                            displayValue = sign + statValue + "%";
                        } else {
                            displayStat = statName;
                            displayValue = sign + statValue;
                        }

                        statLines.push(displayValue + " " + displayStat + " **[" + rateStr + "%]**");
                    }

                    let description = statLines.join("\n");

                    let footerParts = [];
                    footerParts.push("Rerolls: " + result.reroll);
                    if (result.shiny && result.shiny !== '' && result.shiny !== 'null') {
                        footerParts.push("\u2728 " + result.shiny);
                    }

                    embeds.push({
                        "title": result.itemName + " [" + overallStr + "%]",
                        "description": description,
                        "color": tierColors[result.tier] || tierColors["common"],
                        "footer": {
                            "text": footerParts.join("  \u2022  ")
                        }
                    });
                });
                
                resolve({
                    "content": "",
                    "embeds": embeds,
                    "attachments": []
                });
            })
            .catch(error => {
                reject(error);
            });
    });
}

module.exports = {analyzeAndFormatItems};
