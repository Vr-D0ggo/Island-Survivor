// server.js (Verified and Correct)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
// 1. Create an HTTP server from the Express app
const server = http.createServer(app); 
// 2. Attach the WebSocket server to that specific HTTP server
const wss = new WebSocket.Server({ server }); 

app.use(express.static('public'));

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const INVENTORY_SLOTS = 8; 

// Game State
let players = {};
let resources = [];
let nextResourceId = 0;

// Day/Night Cycle
const DAY_DURATION = 10 * 60 * 1000;
const NIGHT_DURATION = 7 * 60 * 1000;
const CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;
let cycleTime = 0;
let isDay = true;

function generateWorld() {
    console.log("Generating world...");
    // Trees
    for (let i = 0; i < 125; i++) {
        resources.push({ id: nextResourceId++, type: 'tree', x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT, hp: 5, maxHp: 5, harvested: false, size: 30 + Math.random() * 20 });
    }
    // Rocks
    for (let i = 0; i < 75; i++) {
        resources.push({ id: nextResourceId++, type: 'rock', x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT, hp: 6, maxHp: 6, harvested: false, size: 25 + Math.random() * 15 });
    }
    console.log(`Generated ${resources.length} resources.`);
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(data)); }
    });
}

function getDistance(obj1, obj2) { return Math.sqrt(Math.pow(obj1.x - obj2.x, 2) + Math.pow(obj1.y - obj2.y, 2)); }

function addItemToPlayer(playerId, item, quantity) {
    const player = players[playerId]; if (!player) return;
    const allSlots = [...player.inventory, ...player.hotbar];
    let existingStack = allSlots.find(slot => slot && slot.item === item);
    if (existingStack) { existingStack.quantity += quantity; } else {
        let emptySlotIndex = player.hotbar.findIndex(slot => slot === null);
        if (emptySlotIndex !== -1) { player.hotbar[emptySlotIndex] = { item, quantity }; } else {
            emptySlotIndex = player.inventory.findIndex(slot => slot === null);
            if (emptySlotIndex !== -1) { player.inventory[emptySlotIndex] = { item, quantity }; } else { console.log("Inventory full for player " + playerId); }
        }
    }
    const client = Array.from(wss.clients).find(c => c.id === playerId);
    if (client) {
        client.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
        client.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity }));
    }
}

wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;
    players[playerId] = { id: playerId, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, vx: 0, vy: 0, speed: 3, size: 20, inventory: Array(INVENTORY_SLOTS).fill(null), hotbar: Array(4).fill(null) };
    console.log(`Player ${playerId} connected.`);
    ws.send(JSON.stringify({ type: 'init', playerId: playerId, players: players, resources: resources, dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION } }));
    broadcast({ type: 'player-join', player: players[playerId] });

    ws.on('message', message => {
        const data = JSON.parse(message);
        switch (data.type) {
            case 'move':
                const player = players[playerId]; if (player) { player.x = data.x; player.y = data.y; } break;
            case 'hit-resource':
                const hitter = players[playerId]; const resource = resources.find(r => r.id === data.resourceId);
                if (hitter && resource && !resource.harvested && getDistance(hitter, resource) < hitter.size + resource.size + 10) {
                    resource.hp--;
                    if (resource.hp <= 0) {
                        resource.harvested = true;
                        let item, quantity, respawnTime;
                        if (resource.type === 'tree') { item = 'Wood'; quantity = 2 + Math.floor(Math.random() * 3); respawnTime = 5 * 60 * 1000; } 
                        else { item = 'Stone'; quantity = 2 + Math.floor(Math.random() * 3); respawnTime = 6 * 60 * 1000; }
                        addItemToPlayer(playerId, item, quantity);
                        setTimeout(() => { resource.hp = resource.maxHp; resource.harvested = false; broadcast({ type: 'resource-update', resource }); }, respawnTime);
                    }
                    broadcast({ type: 'resource-update', resource });
                }
                break;
            case 'chat': broadcast({ type: 'chat-message', sender: playerId, message: data.message }); break;
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected.`);
        delete players[playerId];
        broadcast({ type: 'player-leave', playerId: playerId });
    });
});

function gameLoop() {
    cycleTime = (cycleTime + (1000 / 60)) % CYCLE_DURATION;
    const previouslyDay = isDay; isDay = cycleTime < DAY_DURATION;
    if (isDay !== previouslyDay) { broadcast({ type: 'notification', message: isDay ? 'A New Day Has Begun' : 'Night Falls...' }); }
    broadcast({ type: 'game-state', players: players, dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION } });
}

generateWorld();
setInterval(gameLoop, 1000 / 60);

const PORT = process.env.PORT || 3000;
// 3. IMPORTANT: Listen on the HTTP server, NOT the Express app.
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});