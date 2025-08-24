// server.js (Full, Corrected Code)

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
// Create an HTTP server from the Express app, which is necessary for WebSockets
const server = http.createServer(app);
// Attach the WebSocket server to the HTTP server
const wss = new WebSocket.Server({ server });

// Serve all static files (HTML, CSS, client.js) from the 'public' directory
app.use(express.static('public'));

// --- Game Constants ---
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const INVENTORY_SLOTS = 8; // Number of inventory slots (excluding hotbar)

// --- Game State (Managed by the server) ---
let players = {};
let resources = [];
let nextResourceId = 0;

// Day/Night Cycle
const DAY_DURATION = 10 * 60 * 1000; // 10 minutes
const NIGHT_DURATION = 7 * 60 * 1000; // 7 minutes
const CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;
let cycleTime = 0;
let isDay = true;

// --- Server Functions ---

/**
 * Populates the 'resources' array with randomly placed trees and rocks.
 */
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

/**
 * Sends a JSON message to all connected clients.
 * @param {object} data - The data object to be sent.
 */
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

/**
 * Calculates the distance between two objects with x and y properties.
 * @returns {number} The distance.
 */
function getDistance(obj1, obj2) {
    return Math.sqrt(Math.pow(obj1.x - obj2.x, 2) + Math.pow(obj1.y - obj2.y, 2));
}

/**
 * Adds an item to a player's inventory or hotbar, stacking if possible.
 * @param {string} playerId - The ID of the player receiving the item.
 * @param {string} item - The name of the item (e.g., 'Wood').
 * @param {number} quantity - The amount of the item to add.
 */
function addItemToPlayer(playerId, item, quantity) {
    const player = players[playerId];
    if (!player) return;

    // Check all slots (inventory and hotbar) for an existing stack
    const allSlots = [...player.inventory, ...player.hotbar];
    let existingStack = allSlots.find(slot => slot && slot.item === item);

    if (existingStack) {
        existingStack.quantity += quantity;
    } else {
        // Find an empty slot, prioritizing the hotbar
        let emptySlotIndex = player.hotbar.findIndex(slot => slot === null);
        if (emptySlotIndex !== -1) {
            player.hotbar[emptySlotIndex] = { item, quantity };
        } else {
            // If hotbar is full, check inventory
            emptySlotIndex = player.inventory.findIndex(slot => slot === null);
            if (emptySlotIndex !== -1) {
                player.inventory[emptySlotIndex] = { item, quantity };
            } else {
                console.log(`Inventory full for player ${playerId}. Item dropped.`);
                // In a real game, you would drop the item on the ground here
            }
        }
    }

    // Send an update to the specific player about their new inventory state
    const client = Array.from(wss.clients).find(c => c.id === playerId);
    if (client) {
        client.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
        client.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity }));
    }
}


// --- WebSocket Connection Handling ---

wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;

    // === FIX FOR PLAYER VISIBILITY BUG ===
    // 1. Send the new player the list of who is ALREADY here.
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        players: players, // Send the current players object before adding the new one
        resources: resources,
        dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION }
    }));

    // 2. NOW, create the new player object and add them to the server's master list.
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

    // 3. Finally, announce the NEW player's arrival to EVERYONE (including themselves).
    broadcast({ type: 'player-join', player: newPlayer });

    // Handle messages from this specific client
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
                if (hitter && resource && !resource.harvested && getDistance(hitter, resource) < hitter.size + resource.size + 10) {
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
                break;
            case 'chat':
                broadcast({ type: 'chat-message', sender: playerId, message: data.message });
                break;
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected.`);
        delete players[playerId];
        broadcast({ type: 'player-leave', playerId: playerId });
    });
});

// --- Main Game Loop ---

function gameLoop() {
    // Update Day/Night cycle
    cycleTime = (cycleTime + (1000 / 60)) % CYCLE_DURATION;
    const previouslyDay = isDay;
    isDay = cycleTime < DAY_DURATION;

    // Announce a phase change
    if (isDay !== previouslyDay) {
        broadcast({ type: 'notification', message: isDay ? 'A New Day Has Begun' : 'Night Falls...' });
    }
    
    // Broadcast the updated state to all players
    broadcast({
        type: 'game-state',
        players: players,
        dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION }
    });
}

// --- Server Initialization ---

generateWorld();
setInterval(gameLoop, 1000 / 60); // Run the game loop at ~60 FPS

const PORT = process.env.PORT || 3000;
// IMPORTANT: Listen on the HTTP server, NOT the Express app directly.
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});