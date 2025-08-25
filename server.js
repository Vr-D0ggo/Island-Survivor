// server.js (Complete Rewrite for Grid System & Building)

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// --- Game Constants ---
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const GRID_CELL_SIZE = 50; // The world is a grid of 50x50 cells
const INVENTORY_SLOTS = 8;

// --- Game State ---
let players = {};
let resources = [];
let structures = {}; // Use an object for fast lookups by coordinate key
let nextResourceId = 0;
let grid = Array(WORLD_WIDTH / GRID_CELL_SIZE).fill(null).map(() => Array(WORLD_HEIGHT / GRID_CELL_SIZE).fill(false));

// Day/Night Cycle
const DAY_DURATION = 10 * 60 * 1000;
const NIGHT_DURATION = 7 * 60 * 1000;
const CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;
let cycleTime = 0;
let isDay = true;


// --- Server Functions ---

/**
 * Checks if a rectangular area on the grid is available for placement.
 */
function isAreaFree(gridX, gridY, size) {
    for (let x = gridX; x < gridX + size; x++) {
        for (let y = gridY; y < gridY + size; y++) {
            if (x < 0 || x >= grid.length || y < 0 || y >= grid[0].length || grid[x][y]) {
                return false; // Area is occupied or out of bounds
            }
        }
    }
    return true;
}

/**
 * Marks a rectangular area on the grid as occupied or free.
 */
function markArea(gridX, gridY, size, isOccupied) {
    for (let x = gridX; x < gridX + size; x++) {
        for (let y = gridY; y < gridY + size; y++) {
            if (x >= 0 && x < grid.length && y >= 0 && y < grid[0].length) {
                grid[x][y] = isOccupied;
            }
        }
    }
}


/**
 * Populates the world with grid-aligned resources.
 */
function generateWorld() {
    console.log("Generating world on a grid...");
    const gridWidth = WORLD_WIDTH / GRID_CELL_SIZE;
    const gridHeight = WORLD_HEIGHT / GRID_CELL_SIZE;

    // Generate Trees (4 or 9 cells)
    for (let i = 0; i < 150; i++) {
        const size = Math.random() < 0.7 ? 2 : 3; // 2x2 or 3x3
        const gridX = Math.floor(Math.random() * (gridWidth - size));
        const gridY = Math.floor(Math.random() * (gridHeight - size));

        if (isAreaFree(gridX, gridY, size)) {
            markArea(gridX, gridY, size, true);
            resources.push({
                id: nextResourceId++,
                type: 'tree',
                x: (gridX + size / 2) * GRID_CELL_SIZE,
                y: (gridY + size / 2) * GRID_CELL_SIZE,
                hp: 5, maxHp: 5, harvested: false,
                size: size * GRID_CELL_SIZE * 0.8 // Visual size
            });
        }
    }

    // Generate Rocks (1, 4 or 9 cells)
    for (let i = 0; i < 90; i++) {
        const sizeRoll = Math.random();
        const size = sizeRoll < 0.6 ? 1 : (sizeRoll < 0.9 ? 2 : 3); // 1x1, 2x2 or 3x3
        const gridX = Math.floor(Math.random() * (gridWidth - size));
        const gridY = Math.floor(Math.random() * (gridHeight - size));

        if (isAreaFree(gridX, gridY, size)) {
            markArea(gridX, gridY, size, true);
            resources.push({
                id: nextResourceId++,
                type: 'rock',
                x: (gridX + size / 2) * GRID_CELL_SIZE,
                y: (gridY + size / 2) * GRID_CELL_SIZE,
                hp: 6, maxHp: 6, harvested: false,
                size: size * GRID_CELL_SIZE * 0.8 // Visual size
            });
        }
    }
    console.log(`Generated ${resources.length} resources.`);
}

function broadcast(data) { wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); }); }
function getDistance(obj1, obj2) { return Math.hypot(obj1.x - obj2.x, obj1.y - obj2.y); }
function addItemToPlayer(playerId, item, quantity) { const p = players[playerId]; if (!p) return; let s = [...p.inventory, ...p.hotbar].find(i => i && i.item === item); if (s) s.quantity += quantity; else { let i = p.hotbar.findIndex(x => x === null); if (i !== -1) p.hotbar[i] = { item, quantity }; else { i = p.inventory.findIndex(x => x === null); if (i !== -1) p.inventory[i] = { item, quantity }; else console.log(`Inv full for ${playerId}`); } } const c = [...wss.clients].find(c => c.id === playerId); if (c) { c.send(JSON.stringify({ type: 'inventory-update', inventory: p.inventory, hotbar: p.hotbar })); c.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity })); } }

// --- WebSocket Connection Handling ---
wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;

    ws.send(JSON.stringify({
        type: 'init', playerId, players, resources, structures,
        dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION }
    }));

    const newPlayer = { id: playerId, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, speed: 3, size: 20, inventory: Array(INVENTORY_SLOTS).fill(null), hotbar: Array(4).fill(null) };
    players[playerId] = newPlayer;
    console.log(`Player ${playerId} connected.`);
    broadcast({ type: 'player-join', player: newPlayer });

    ws.on('message', message => {
        const data = JSON.parse(message);
        const player = players[playerId];
        if (!player) return;

        switch (data.type) {
            case 'move':
                player.x = data.x; player.y = data.y; break;
            case 'hit-resource':
                const resource = resources.find(r => r.id === data.resourceId);
                if (resource && !resource.harvested && getDistance(player, resource) < player.size + resource.size) {
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
            case 'place-item':
                const { item, x, y } = data;
                const gridX = Math.floor(x / GRID_CELL_SIZE);
                const gridY = Math.floor(y / GRID_CELL_SIZE);
                const coordKey = `${gridX},${gridY}`;

                const hotbarSlot = player.hotbar[data.hotbarIndex];
                if (hotbarSlot && hotbarSlot.item === item && getDistance(player, {x, y}) < 150 && isAreaFree(gridX, gridY, 1) && !structures[coordKey]) {
                    hotbarSlot.quantity--;
                    if (hotbarSlot.quantity <= 0) {
                        player.hotbar[data.hotbarIndex] = null;
                    }

                    structures[coordKey] = {
                        type: item === 'Wood' ? 'wood_wall' : 'stone_wall',
                        x: gridX * GRID_CELL_SIZE,
                        y: gridY * GRID_CELL_SIZE,
                    };
                    markArea(gridX, gridY, 1, true);

                    broadcast({ type: 'structure-update', structures });
                    ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                }
                break;
            case 'chat':
                broadcast({ type: 'chat-message', sender: playerId, message: data.message }); break;
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected.`);
        delete players[playerId];
        broadcast({ type: 'player-leave', playerId: playerId });
    });
});

// --- Main Game Loop & Server Start ---
function gameLoop() {
    cycleTime = (cycleTime + (1000 / 60)) % CYCLE_DURATION;
    const previouslyDay = isDay; isDay = cycleTime < DAY_DURATION;
    if (isDay !== previouslyDay) { broadcast({ type: 'notification', message: isDay ? 'A New Day Has Begun' : 'Night Falls...' }); }
    broadcast({ type: 'game-state', players, dayNight: { isDay, cycleTime, DAY_DURATION, NIGHT_DURATION } });
}

generateWorld();
setInterval(gameLoop, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });