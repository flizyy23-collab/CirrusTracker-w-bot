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
    const itemHashStart = "󰀀󰄀";
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
                    let description = "";
                    for (const [statName, statValue] of Object.entries(result.stats)) {
                        const rateValue = result.rate[statName] || 0;
                        description += `${statValue} ${statName} - ${rateValue}%\n`;
                    }
                    description = description.trim();

                    embeds.push({
                        "title": result.itemName,
                        "description": description,
                        "color": tierColors[result.tier],
                        "footer": {
                            "text": `reroll count: ${result.reroll}`
                        }
                    });
                });
                
                resolve({
                    "content": `${updatedText}\n`,
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