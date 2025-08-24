// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

// Game State
let players = {};
let resources = [];
let nextResourceId = 0;

// Day/Night Cycle
const DAY_DURATION = 10 * 60 * 1000; // 10 minutes
const NIGHT_DURATION = 7 * 60 * 1000; // 7 minutes
const CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;
let cycleTime = 0;
let isDay = true;

function generateWorld() {
    console.log("Generating world...");
    // Generate Trees
    for (let i = 0; i < 125; i++) {
        resources.push({
            id: nextResourceId++,
            type: 'tree',
            x: Math.random() * WORLD_WIDTH,
            y: Math.random() * WORLD_HEIGHT,
            hp: 5,
            maxHp: 5,
            harvested: false,
            size: 30 + Math.random() * 20
        });
    }
    // Generate Rocks
    for (let i = 0; i < 75; i++) {
        resources.push({
            id: nextResourceId++,
            type: 'rock',
            x: Math.random() * WORLD_WIDTH,
            y: Math.random() * WORLD_HEIGHT,
            hp: 6,
            maxHp: 6,
            harvested: false,
            size: 25 + Math.random() * 15
        });
    }
    console.log(`Generated ${resources.length} resources.`);
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function getDistance(obj1, obj2) {
    return Math.sqrt(Math.pow(obj1.x - obj2.x, 2) + Math.pow(obj1.y - obj2.y, 2));
}

function addItemToPlayer(playerId, item, quantity) {
    const player = players[playerId];
    if (!player) return;

    // Simplified inventory logic: stack or find new slot
    const existingStack = player.inventory.find(slot => slot && slot.item === item);
    if (existingStack) {
        existingStack.quantity += quantity;
    } else {
        const emptySlotIndex = player.inventory.findIndex(slot => slot === null);
        if (emptySlotIndex !== -1) {
            player.inventory[emptySlotIndex] = { item, quantity };
        } else {
            console.log("Inventory full for player " + playerId);
            // In a real game, you'd drop the item on the ground.
        }
    }

    // Send inventory update to the specific player
    const client = Array.from(wss.clients).find(c => c.id === playerId);
    if (client) {
        client.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
        client.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity }));
    }
}

wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;

    players[playerId] = {
        id: playerId,
        x: WORLD_WIDTH / 2,
        y: WORLD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        speed: 3,
        size: 20,
        inventory: Array(4).fill(null), // 2x2 grid
        hotbar: Array(4).fill(null)
    };

    console.log(`Player ${playerId} connected.`);

    // Send initial state to the new player
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        players: players,
        resources: resources,
        dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION }
    }));

    // Announce new player to others
    broadcast({ type: 'player-join', player: players[playerId] });

    ws.on('message', message => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'move':
                const player = players[playerId];
                if (player) {
                    player.x = data.x;
                    player.y = data.y;
                }
                break;
            case 'hit-resource':
                const hitter = players[playerId];
                const resource = resources.find(r => r.id === data.resourceId);
                if (hitter && resource && !resource.harvested) {
                    if (getDistance(hitter, resource) < hitter.size + resource.size + 10) {
                        resource.hp--;
                        if (resource.hp <= 0) {
                            resource.harvested = true;
                            let item, quantity, respawnTime;
                            if (resource.type === 'tree') {
                                item = 'Wood';
                                quantity = 2 + Math.floor(Math.random() * 3); // 2-4
                                respawnTime = 5 * 60 * 1000; // 5 minutes
                            } else {
                                item = 'Stone';
                                quantity = 2 + Math.floor(Math.random() * 3); // 2-4
                                respawnTime = 6 * 60 * 1000; // 6 minutes
                            }
                            addItemToPlayer(playerId, item, quantity);
                            
                            setTimeout(() => {
                                resource.hp = resource.maxHp;
                                resource.harvested = false;
                                broadcast({ type: 'resource-update', resource });
                            }, respawnTime);
                        }
                        broadcast({ type: 'resource-update', resource });
                    }
                }
                break;
            case 'chat':
                 broadcast({ type: 'chat-message', sender: playerId, message: data.message });
                 break;
            // Handle inventory/hotbar moves
            case 'move-item':
                const p = players[playerId];
                // Extremely simplified - a real implementation needs lots of validation
                // This example just swaps items.
                if (data.from.type === 'inventory' && data.to.type === 'hotbar') {
                    [p.inventory[data.from.index], p.hotbar[data.to.index]] = 
                    [p.hotbar[data.to.index], p.inventory[data.from.index]];
                }
                // ... add other cases (hotbar -> inv, inv -> inv, etc.)
                ws.send(JSON.stringify({ type: 'inventory-update', inventory: p.inventory, hotbar: p.hotbar }));
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected.`);
        delete players[playerId];
        broadcast({ type: 'player-leave', playerId: playerId });
    });
});

// Main Game Loop
function gameLoop() {
    // Day/Night Cycle Logic
    cycleTime = (cycleTime + (1000 / 60)) % CYCLE_DURATION;
    const previouslyDay = isDay;
    isDay = cycleTime < DAY_DURATION;

    if (isDay !== previouslyDay) {
        if (isDay) {
            broadcast({ type: 'notification', message: 'A New Day Has Begun' });
        } else {
            broadcast({ type: 'notification', message: 'Night Falls...' });
        }
    }
    
    // Broadcast updates
    broadcast({
        type: 'game-state',
        players: players,
        dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION }
    });
}

generateWorld();
setInterval(gameLoop, 1000 / 60); // 60 FPS

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});