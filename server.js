// server.js (Full, Final, and Corrected)

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
const GRID_CELL_SIZE = 50;
const SAFE_SPAWN_RADIUS = 10 * GRID_CELL_SIZE;
const INVENTORY_SLOTS = 8;
const RECIPES = { Workbench: { cost: { Wood: 5, Stone: 2 }, result: 'Workbench' } };

// --- Game State ---
let players = {};
let resources = [];
let structures = {};
let nextResourceId = 0;
let grid = Array(WORLD_WIDTH / GRID_CELL_SIZE).fill(null).map(() => Array(WORLD_HEIGHT / GRID_CELL_SIZE).fill(false));
let dayNight = { isDay: true, cycleTime: 0, DAY_DURATION: 10 * 60 * 1000, NIGHT_DURATION: 7 * 60 * 1000 };

// --- World Generation ---
function isAreaFree(gridX, gridY, size) { for (let x = gridX; x < gridX + size; x++) { for (let y = gridY; y < gridY + size; y++) { if (x < 0 || x >= grid.length || y < 0 || y >= grid[0].length || grid[x][y]) return false; } } return true; }
function markArea(gridX, gridY, size, isOccupied) { for (let x = gridX; x < gridX + size; x++) { for (let y = gridY; y < gridY + size; y++) { if (x >= 0 && x < grid.length && y >= 0 && y < grid[0].length) grid[x][y] = isOccupied; } } }

function generateWorld() {
    console.log("Generating world with safe spawn zone...");
    const gridWidth = WORLD_WIDTH / GRID_CELL_SIZE, gridHeight = WORLD_HEIGHT / GRID_CELL_SIZE;
    const worldCenter = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    const placeResource = (type, count, sizes) => {
        let placed = 0;
        while (placed < count) {
            const size = sizes[Math.floor(Math.random() * sizes.length)];
            const gridX = Math.floor(Math.random() * (gridWidth - size));
            const gridY = Math.floor(Math.random() * (gridHeight - size));
            const worldX = (gridX + size / 2) * GRID_CELL_SIZE;
            const worldY = (gridY + size / 2) * GRID_CELL_SIZE;
            if (getDistance({x: worldX, y: worldY}, worldCenter) < SAFE_SPAWN_RADIUS) continue;
            if (isAreaFree(gridX, gridY, size)) {
                markArea(gridX, gridY, size, true);
                resources.push({ id: nextResourceId++, type, x: worldX, y: worldY, hp: type === 'tree' ? 5 : 6, maxHp: type === 'tree' ? 5 : 6, harvested: false, size: size * GRID_CELL_SIZE * 0.8 });
                placed++;
            }
        }
    };
    placeResource('tree', 150, [2, 3]);
    placeResource('rock', 90, [1, 2, 3]);
    console.log(`Generated ${resources.length} resources.`);
}

// --- Helpers & Game Logic ---
function broadcast(data) { wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); }); }
function getDistance(obj1, obj2) { return Math.hypot(obj1.x - obj2.x, obj1.y - obj2.y); }
function countItems(player, itemName) { let t = 0; [...player.inventory, ...player.hotbar].forEach(s => { if (s && s.item === itemName) t += s.quantity; }); return t; }
function consumeItems(player, itemName, amount) { let r = amount; const c = (s) => { if (s && s.item === itemName && r > 0) { const t = Math.min(r, s.quantity); s.quantity -= t; r -= t; if (s.quantity <= 0) return null; } return s; }; player.inventory = player.inventory.map(c); player.hotbar = player.hotbar.map(c); }
function addItemToPlayer(playerId, item, quantity) { const p = players[playerId]; if (!p) return; let s = [...p.inventory, ...p.hotbar].find(i => i && i.item === item); if (s) s.quantity += quantity; else { let i = p.hotbar.findIndex(x => x === null); if (i !== -1) p.hotbar[i] = { item, quantity }; else { i = p.inventory.findIndex(x => x === null); if (i !== -1) p.inventory[i] = { item, quantity }; else console.log(`Inv full for ${playerId}`); } } const c = [...wss.clients].find(c => c.id === playerId); if (c) { c.send(JSON.stringify({ type: 'inventory-update', inventory: p.inventory, hotbar: p.hotbar })); c.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity })); } }

// --- WebSocket Connection Handling ---
wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;
    const newPlayer = { id: playerId, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, speed: 3, size: 20, inventory: Array(INVENTORY_SLOTS).fill(null), hotbar: Array(4).fill(null) };
    
    // This init message is CRITICAL. It MUST contain 'myPlayerData'.
    ws.send(JSON.stringify({
        type: 'init', playerId, players, myPlayerData: newPlayer, resources, structures, dayNight
    }));

    players[playerId] = newPlayer;
    console.log(`Player ${playerId} connected.`);
    broadcast({ type: 'player-join', player: newPlayer });

    ws.on('message', message => {
        const data = JSON.parse(message); const player = players[playerId]; if (!player) return;
        switch (data.type) {
            case 'move': player.x = data.x; player.y = data.y; break;
            case 'hit-resource': { const resource = resources.find(r => r.id === data.resourceId); if (resource && !resource.harvested && getDistance(player, resource) < player.size + resource.size) { resource.hp--; if (resource.hp <= 0) { resource.harvested = true; let item, quantity, respawnTime; if (resource.type === 'tree') { item = 'Wood'; quantity = 2 + Math.floor(Math.random() * 3); respawnTime = 5 * 60 * 1000; } else { item = 'Stone'; quantity = 2 + Math.floor(Math.random() * 3); respawnTime = 6 * 60 * 1000; } addItemToPlayer(playerId, item, quantity); setTimeout(() => { resource.hp = resource.maxHp; resource.harvested = false; broadcast({ type: 'resource-update', resource }); }, respawnTime); } broadcast({ type: 'resource-update', resource }); } break; }
            case 'place-item': { const { item, x, y } = data; const gridX = Math.floor(x / GRID_CELL_SIZE); const gridY = Math.floor(y / GRID_CELL_SIZE); const coordKey = `${gridX},${gridY}`; const hotbarSlot = player.hotbar[data.hotbarIndex]; if (hotbarSlot && hotbarSlot.item === item && getDistance(player, {x, y}) < 150 && isAreaFree(gridX, gridY, 1) && !structures[coordKey]) { hotbarSlot.quantity--; if (hotbarSlot.quantity <= 0) player.hotbar[data.hotbarIndex] = null; structures[coordKey] = { type: item === 'Wood' ? 'wood_wall' : 'stone_wall', x: gridX * GRID_CELL_SIZE, y: gridY * GRID_CELL_SIZE, }; markArea(gridX, gridY, 1, true); broadcast({ type: 'structure-update', structures }); ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar })); } break; }
            case 'craft-item': const recipe = RECIPES[data.itemName]; if (!recipe) return; let canCraft = true; for (const i in recipe.cost) { if (countItems(player, i) < recipe.cost[i]) { canCraft = false; break; } } if (canCraft) { for (const i in recipe.cost) { consumeItems(player, i, recipe.cost[i]); } addItemToPlayer(playerId, recipe.result, 1); } break;
            case 'chat': broadcast({ type: 'chat-message', sender: playerId, message: data.message }); break;
        }
    });
    ws.on('close', () => { console.log(`Player ${playerId} disconnected.`); delete players[playerId]; broadcast({ type: 'player-leave', playerId: playerId }); });
});

// --- Game Loop & Server Start ---
function gameLoop() { const cycleDuration = dayNight.DAY_DURATION + dayNight.NIGHT_DURATION; dayNight.cycleTime = (dayNight.cycleTime + (1000 / 60)) % cycleDuration; const previouslyDay = dayNight.isDay; dayNight.isDay = dayNight.cycleTime < dayNight.DAY_DURATION; if (dayNight.isDay !== previouslyDay) { broadcast({ type: 'notification', message: dayNight.isDay ? 'A New Day Has Begun' : 'Night Falls...' }); } broadcast({ type: 'game-state', players, dayNight }); }
generateWorld();
setInterval(gameLoop, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });