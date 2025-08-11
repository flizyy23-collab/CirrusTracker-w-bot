const tokenMap = new Map()  

function addUser(uuid, token) {
    tokenMap.set(uuid, new Token(token));
}

function getToken(uuid) {
    return tokenMap.get(uuid);
}

function generateToken(uuid) {
    const length = Math.floor(Math.random() * 6) + 15;
    const token = Array.from({ length }, () => Math.random().toString(36).charAt(2)).join('');
    addUser(uuid, token);

    return token;
}

function removeToken(uuid) {
    if (tokenMap.has(uuid)) tokenMap.delete(uuid);
}

function findUuidByToken(token) {
    for (let [uuid, tokenObj] of tokenMap) {
        if (tokenObj.token === token && tokenObj.isAuthenticated()) {
            return uuid;
        }
    }
    return null;
}

function getAllTokens() {
    return tokenMap;
}

class Token {
    constructor(token) {
        this.token = token;
        this.authenticated = false;
    }

    authenticate() {
        this.authenticated = true;
    }

    isAuthenticated() {
        return this.authenticated;
    }
}

module.exports = {generateToken, getToken, removeToken, findUuidByToken, getAllTokens, Token};

