const request = require("request");

const raids = [
  { name: "All Raids", id: -1 },
  { name: "Nest of the Grootslangs", id: 0 },
  { name: "Orphion's Nexus of Light", id: 1 },
  { name: "The Canyon Colossus", id: 2 },
  { name: "The Nameless Anomaly", id: 3 }
]

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function daysToTimestamp(days) {
  if (days <= 0) return null;

  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getLastPoolReset(weeksAgo = 0) {
  const date = new Date();
  date.setUTCHours(17, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 2) % 7 - (weeksAgo * 7));

  return date.toISOString().slice(0, 19).replace('T', ' ');
}


function requestUUID(username) {
  return new Promise((resolve, reject) => {
    const url = `https://api.mojang.com/users/profiles/minecraft/${username}`;

    request(url, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        let data = JSON.parse(body);
        if (data && data.id) {
          let id = data.id.replace(
              /(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/,
              '$1-$2-$3-$4-$5'
          );
          resolve(id);

          // Dynamically import to avoid circular dependency
          setImmediate(async () => {
            try {
              const { insertPlayer } = require("./database");
              await insertPlayer(id, username);
            } catch (err) {
              console.error('Error inserting player:', err);
            }
          });
        } else {
          resolve(null);
        }
      } else {
        console.error('Mojang request failed', response.statusMessage);
        reject(error);
      }
    });
  }).catch(err => {
    console.error('Error in requestUUID:', err);
    return null;
  });
}

async function requestUsername(uuid) {
  const cleanUUID = uuid.replace(/-/g, '');
  const url = `https://sessionserver.mojang.com/session/minecraft/profile/${cleanUUID}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.name || null;
  } catch (err) {
    console.error('Error fetching username:', err);
    return null;
  }
}


module.exports = {sleep, requestUUID, requestUsername, raids, daysToTimestamp, getLastPoolReset};