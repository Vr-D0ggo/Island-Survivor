// server.js (Corrected for player visibility)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app); 
const wss = new WebSocket.Server({ server }); 

app.use(express.static('public'));

// ... (All the variables and functions like generateWorld, broadcast, etc. are the same)
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const INVENTORY_SLOTS = 8; 
let players = {};
let resources = [];
let nextResourceId = 0;
const DAY_DURATION = 10 * 60 * 1000;
const NIGHT_DURATION = 7 * 60 * 1000;
const CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;
let cycleTime = 0;
let isDay = true;
// ... (All helper functions remain the same)
function generateWorld() { console.log("Generating world..."); for (let i = 0; i < 125; i++) { resources.push({ id: nextResourceId++, type: 'tree', x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT, hp: 5, maxHp: 5, harvested: false, size: 30 + Math.random() * 20 }); } for (let i = 0; i < 75; i++) { resources.push({ id: nextResourceId++, type: 'rock', x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT, hp: 6, maxHp: 6, harvested: false, size: 25 + Math.random() * 15 }); } console.log(`Generated ${resources.length} resources.`); }
function broadcast(data) { wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(data)); } }); }
function getDistance(obj1, obj2) { return Math.sqrt(Math.pow(obj1.x - obj2.x, 2) + Math.pow(obj1.y - obj2.y, 2)); }
function addItemToPlayer(playerId, item, quantity) { const player = players[playerId]; if (!player) return; const allSlots = [...player.inventory, ...player.hotbar]; let existingStack = allSlots.find(slot => slot && slot.item === item); if (existingStack) { existingStack.quantity += quantity; } else { let emptySlotIndex = player.hotbar.findIndex(slot => slot === null); if (emptySlotIndex !== -1) { player.hotbar[emptySlotIndex] = { item, quantity }; } else { emptySlotIndex = player.inventory.findIndex(slot => slot === null); if (emptySlotIndex !== -1) { player.inventory[emptySlotIndex] = { item, quantity }; } else { console.log("Inventory full for player " + playerId); } } } const client = Array.from(wss.clients).find(c => c.id === playerId); if (client) { client.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar })); client.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity })); } }

// === FIX #1: Corrected connection logic ===
wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;
    
    // 1. Send the new player the list of who is ALREADY here.
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        players: players, // Send the current players object
        resources: resources,
        dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION }
    }));

    // 2. NOW, create the new player object and add them to the server's list.
    const newPlayer = {
        id: playerId,
        x: WORLD_WIDTH / 2,
        y: WORLD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        speed: 3,
        size: 20,
        inventory: Array(INVENTORY_SLOTS).fill(null),
        hotbar: Array(4).fill(null)
    };
    players[playerId] = newPlayer;

    console.log(`Player ${playerId} connected.`);

    // 3. Finally, announce the new player's arrival to EVERYONE.
    broadcast({ type: 'player-join', player: newPlayer });

    ws.on('message', message => {
        // ... message handling logic remains the same
        const data = JSON.parse(message);
        switch (data.type) {
            case 'move': const player = players[playerId]; if (player) { player.x = data.x; player.y = data.y; } break;
            case 'hit-resource': const hitter = players[playerId]; const resource = resources.find(r => r.id === data.resourceId); if (hitter && resource && !resource.harvested && getDistance(hitter, resource) < hitter.size + resource.size + 10) { resource.hp--; if (resource.hp <= 0) { resource.harvested = true; let item, quantity, respawnTime; if (resource.type === 'tree') { item = 'Wood'; quantity = 2 + Math.floor(Math.random() * 3); respawnTime = 5 * 60 * 1000; } else { item = 'Stone'; quantity = 2 + Math.floor(Math.random() * 3); respawnTime = 6 * 60 * 1000; } addItemToPlayer(playerId, item, quantity); setTimeout(() => { resource.hp = resource.maxHp; resource.harvested = false; broadcast({ type: 'resource-update', resource }); }, respawnTime); } broadcast({ type: 'resource-update', resource }); } break;
            case 'chat': broadcast({ type: 'chat-message', sender: playerId, message: data.message }); break;
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected.`);
        delete players[playerId];
        broadcast({ type: 'player-leave', playerId: playerId });
    });
});

// ... (gameLoop and server.listen remain the same)
function gameLoop() { cycleTime = (cycleTime + (1000 / 60)) % CYCLE_DURATION; const previouslyDay = isDay; isDay = cycleTime < DAY_DURATION; if (isDay !== previouslyDay) { broadcast({ type: 'notification', message: isDay ? 'A New Day Has Begun' : 'Night Falls...' }); } broadcast({ type: 'game-state', players: players, dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION } }); }
generateWorld();
setInterval(gameLoop, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });