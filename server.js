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
const BLOCK_SUBDIVISIONS = 2;
const BLOCK_SIZE = GRID_CELL_SIZE / BLOCK_SUBDIVISIONS;
const SAFE_SPAWN_RADIUS = 10 * GRID_CELL_SIZE;
const INVENTORY_SLOTS = 4;
const RECIPES = {
    Workbench: { cost: { Wood: 5, Stone: 2 }, result: 'Workbench' },
    'Wooden Axe': { cost: { Wood: 3 }, result: 'Wooden Axe' },
    'Wooden Pickaxe': { cost: { Wood: 3 }, result: 'Wooden Pickaxe' },
    'Wooden Sword': { cost: { Wood: 2 }, result: 'Wooden Sword' },
    'Stone Axe': { cost: { Wood: 2, Stone: 3 }, result: 'Stone Axe' },
    'Stone Pickaxe': { cost: { Wood: 2, Stone: 3 }, result: 'Stone Pickaxe' },
    'Stone Sword': { cost: { Wood: 1, Stone: 4 }, result: 'Stone Sword' }
};

// --- Game State ---
let players = {};
let resources = [];
let structures = {};
let nextResourceId = 0;
let boars = [];
let nextBoarId = 0;
let grid = Array(WORLD_WIDTH / GRID_CELL_SIZE).fill(null).map(() => Array(WORLD_HEIGHT / GRID_CELL_SIZE).fill(false));
let blockGrid = Array(WORLD_WIDTH / BLOCK_SIZE).fill(null).map(() => Array(WORLD_HEIGHT / BLOCK_SIZE).fill(false));
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
                const hpBase = type === 'tree' ? 5 : 6;
                const maxHp = hpBase * size;
                resources.push({ id: nextResourceId++, type, x: worldX, y: worldY, hp: maxHp, maxHp, harvested: false, size: size * GRID_CELL_SIZE * 0.8, phase: 1, apples: type === 'tree' && Math.random() < 1/40 ? 1 + Math.floor(Math.random()*4) : 0 });
                placed++;
            }
        }
    };
    placeResource('tree', 150, [2, 3]);
    placeResource('rock', 90, [1, 2, 3]);
    console.log(`Generated ${resources.length} resources.`);
    spawnBoars(10);
}

function createBoar(x, y, packId) {
    const sizeFactor = 0.8 + Math.random() * 0.7; // 0.8 - 1.5
    const size = 20 * sizeFactor;
    const hp = 15 * sizeFactor;
    return {
        id: nextBoarId++,
        x,
        y,
        hp,
        maxHp: hp,
        size,
        speed: 1 + Math.random() * 0.5,
        damage: Math.ceil(2 * sizeFactor),
        aggressive: false,
        fleeing: false,
        cooldown: 0,
        packId,
        vx: 0,
        vy: 0,
        wanderTimer: 0
    };
}

function spawnBoars(count) {
    const packSize = 3;
    for (let i = 0; i < count;) {
        const currentPackSize = Math.min(packSize, count - i);
        const packId = nextBoarId;
        const centerX = Math.random() * WORLD_WIDTH;
        const centerY = Math.random() * WORLD_HEIGHT;
        for (let j = 0; j < currentPackSize; j++) {
            const offsetX = Math.random() * 40 - 20;
            const offsetY = Math.random() * 40 - 20;
            boars.push(createBoar(centerX + offsetX, centerY + offsetY, packId));
        }
        i += currentPackSize;
    }
}

// --- Helpers & Game Logic ---
function broadcast(data) { wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); }); }
function getDistance(obj1, obj2) { return Math.hypot(obj1.x - obj2.x, obj1.y - obj2.y); }
function countItems(player, itemName) { let t = 0; [...player.inventory, ...player.hotbar].forEach(s => { if (s && s.item === itemName) t += s.quantity; }); return t; }
function consumeItems(player, itemName, amount) { let r = amount; const c = (s) => { if (s && s.item === itemName && r > 0) { const t = Math.min(r, s.quantity); s.quantity -= t; r -= t; if (s.quantity <= 0) return null; } return s; }; player.inventory = player.inventory.map(c); player.hotbar = player.hotbar.map(c); }
function addItemToPlayer(playerId, item, quantity) { const p = players[playerId]; if (!p) return; let s = [...p.inventory, ...p.hotbar].find(i => i && i.item === item); if (s) s.quantity += quantity; else { let i = p.hotbar.findIndex(x => x === null); if (i !== -1) p.hotbar[i] = { item, quantity }; else { i = p.inventory.findIndex(x => x === null); if (i !== -1) p.inventory[i] = { item, quantity }; else console.log(`Inv full for ${playerId}`); } } const c = [...wss.clients].find(c => c.id === playerId); if (c) { c.send(JSON.stringify({ type: 'inventory-update', inventory: p.inventory, hotbar: p.hotbar })); c.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity })); } }

function getDamage(item, target) {
    if (!item) return 1;
    const name = item.toLowerCase();
    if (target === 'tree') {
        if (name === 'wooden axe') return 3;
        if (name === 'stone axe') return 5;
    } else if (target === 'rock') {
        if (name === 'wooden pickaxe') return 3;
        if (name === 'stone pickaxe') return 5;
    } else if (target === 'boar') {
        if (name === 'wooden sword') return 4;
        if (name === 'stone sword') return 6;
        if (name === 'tusk') return 7;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    }
    return 1;
}

// --- WebSocket Connection Handling ---
wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;
    const newPlayer = { id: playerId, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, speed: 3, size: 20, inventory: Array(INVENTORY_SLOTS).fill(null), hotbar: Array(4).fill(null), hp: 10, maxHp: 10 };
    
    // This init message is CRITICAL. It MUST contain 'myPlayerData'.
    ws.send(JSON.stringify({
        type: 'init', playerId, players, myPlayerData: newPlayer, resources, structures, boars, dayNight
    }));

    players[playerId] = newPlayer;
    console.log(`Player ${playerId} connected.`);
    broadcast({ type: 'player-join', player: newPlayer });

    ws.on('message', message => {
        const data = JSON.parse(message); const player = players[playerId]; if (!player) return;
        switch (data.type) {
            case 'move': player.x = data.x; player.y = data.y; break;
            case 'hit-resource': {
                const resource = resources.find(r => r.id === data.resourceId);
                if (resource && !resource.harvested && getDistance(player, resource) < player.size + resource.size) {
                    const dmg = getDamage(data.item, resource.type);
                    resource.hp -= dmg;
                    if (resource.type === 'tree' && resource.phase === 1 && resource.hp <= resource.maxHp / 2) {
                        resource.phase = 2;
                        if (resource.apples > 0) addItemToPlayer(playerId, 'Apple', resource.apples);
                        addItemToPlayer(playerId, 'Leaf', 1 + Math.floor(Math.random() * 10));
                        addItemToPlayer(playerId, 'Wood', 1 + Math.floor(Math.random() * 2));
                    }
                    if (resource.hp <= 0) {
                        resource.harvested = true;
                        let item, quantity, respawnTime;
                        const sizeFactor = resource.size / (GRID_CELL_SIZE * 0.8);
                        const base = Math.max(1, Math.round(sizeFactor));
                        if (resource.type === 'tree') {
                            item = 'Wood';
                            quantity = base + Math.floor(Math.random() * base);
                            respawnTime = 5 * 60 * 1000;
                        } else {
                            item = 'Stone';
                            quantity = base + Math.floor(Math.random() * base);
                            respawnTime = 6 * 60 * 1000;
                        }
                        addItemToPlayer(playerId, item, quantity);
                        setTimeout(() => {
                            resource.hp = resource.maxHp;
                            resource.harvested = false;
                            if (resource.type === 'tree') {
                                resource.phase = 1;
                                resource.apples = Math.random() < 1/40 ? 1 + Math.floor(Math.random()*4) : 0;
                            }
                            broadcast({ type: 'resource-update', resource });
                        }, respawnTime);
                    }
                    broadcast({ type: 'resource-update', resource });
                }
                break;
            }
            case 'hit-boar': {
                const boar = boars.find(b => b.id === data.boarId);
                if (boar && getDistance(player, boar) < player.size + boar.size + 20) {
                    const dmg = getDamage(data.item, 'boar');
                    boar.hp -= dmg;
                    if (boar.hp <= 0) {
                        addItemToPlayer(playerId, 'Boar Meat', 1 + Math.floor(Math.random() * 3));
                        if (Math.random() < 0.1) addItemToPlayer(playerId, 'Tusk', 1);
                        const gid = boar.groupId;
                        boars = boars.filter(b => b.id !== boar.id);
                        if (gid !== null) {
                            boars.filter(b => b.groupId === gid).forEach(b => { b.aggressive = false; b.target = null; });
                        }
                    } else {
                        const gid = boar.groupId;
                        if (gid !== null) {
                            boars.filter(b => b.groupId === gid).forEach(b => { b.aggressive = true; b.target = playerId; });
                        } else {
                            boar.fleeing = true;
                            boar.target = playerId;
                        }
                        if (boar.hp <= boar.maxHp / 2) {
                            boar.fleeing = false;
                            boar.aggressive = true;
                            boar.target = playerId;
                        }
                    }
                    broadcast({ type: 'boar-update', boar });
                }
                break;
            }
            case 'place-item': {
                const { item, x, y } = data;
                const hotbarSlot = player.hotbar[data.hotbarIndex];
                if (!hotbarSlot || hotbarSlot.item !== item || getDistance(player, { x, y }) >= 150) break;
                let structureType;
                if (item === 'Wood') structureType = 'wood_wall';
                else if (item === 'Stone') structureType = 'stone_wall';
                else if (item === 'Workbench') structureType = 'workbench';
                else break;
                if (structureType === 'workbench') {
                    const gridX = Math.floor(x / GRID_CELL_SIZE);
                    const gridY = Math.floor(y / GRID_CELL_SIZE);
                    const coordKey = `w${gridX},${gridY}`;
                    if (isAreaFree(gridX, gridY, 1) && !structures[coordKey]) {
                        hotbarSlot.quantity--;
                        if (hotbarSlot.quantity <= 0) player.hotbar[data.hotbarIndex] = null;
                        const baseX = gridX * GRID_CELL_SIZE;
                        const baseY = gridY * GRID_CELL_SIZE;
                        structures[coordKey] = { type: structureType, x: baseX, y: baseY, size: GRID_CELL_SIZE };
                        markArea(gridX, gridY, 1, true);
                        broadcast({ type: 'structure-update', structures });
                        ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                    }
                } else {
                    const blockX = Math.floor(x / BLOCK_SIZE);
                    const blockY = Math.floor(y / BLOCK_SIZE);
                    const coordKey = `b${blockX},${blockY}`;
                    if (!blockGrid[blockX][blockY] && !structures[coordKey]) {
                        hotbarSlot.quantity--;
                        if (hotbarSlot.quantity <= 0) player.hotbar[data.hotbarIndex] = null;
                        structures[coordKey] = { type: structureType, x: blockX * BLOCK_SIZE, y: blockY * BLOCK_SIZE, size: BLOCK_SIZE };
                        blockGrid[blockX][blockY] = true;
                        broadcast({ type: 'structure-update', structures });
                        ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                    }
                }
                break;
            }
            case 'hit-structure': {
                const { key } = data;
                const structure = structures[key];
                if (!structure) break;
                const center = { x: structure.x + structure.size / 2, y: structure.y + structure.size / 2 };
                if (getDistance(player, center) < player.size + structure.size) {
                    if (structure.type === 'wood_wall' || structure.type === 'stone_wall') {
                        const item = structure.type === 'wood_wall' ? 'Wood' : 'Stone';
                        addItemToPlayer(playerId, item, 1);
                    }
                    delete structures[key];
                    if (key.startsWith('b')) {
                        const [bx, by] = key.slice(1).split(',').map(Number);
                        blockGrid[bx][by] = false;
                    } else if (key.startsWith('w')) {
                        const [gx, gy] = key.slice(1).split(',').map(Number);
                        markArea(gx, gy, 1, false);
                    }
                    broadcast({ type: 'structure-update', structures });
                }
                break;
            }
            case 'swap-inventory': {
                const { from, to } = data;
                if (
                    Number.isInteger(from) && Number.isInteger(to) &&
                    from >= 0 && from < player.inventory.length &&
                    to >= 0 && to < player.inventory.length
                ) {
                    const temp = player.inventory[from];
                    player.inventory[from] = player.inventory[to];
                    player.inventory[to] = temp;
                    ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                }
                break;
            }
            case 'craft-item': const recipe = RECIPES[data.itemName]; if (!recipe) return; let canCraft = true; for (const i in recipe.cost) { if (countItems(player, i) < recipe.cost[i]) { canCraft = false; break; } } if (canCraft) { for (const i in recipe.cost) { consumeItems(player, i, recipe.cost[i]); } addItemToPlayer(playerId, recipe.result, 1); } break;
            case 'chat': broadcast({ type: 'chat-message', sender: playerId, message: data.message }); break;
        }
    });
    ws.on('close', () => { console.log(`Player ${playerId} disconnected.`); delete players[playerId]; broadcast({ type: 'player-leave', playerId: playerId }); });
});

// --- Game Loop & Server Start ---
function gameLoop() {
    const cycleDuration = dayNight.DAY_DURATION + dayNight.NIGHT_DURATION;
    dayNight.cycleTime = (dayNight.cycleTime + (1000 / 60)) % cycleDuration;
    const previouslyDay = dayNight.isDay;
    dayNight.isDay = dayNight.cycleTime < dayNight.DAY_DURATION;
    if (dayNight.isDay !== previouslyDay) {
        broadcast({ type: 'notification', message: dayNight.isDay ? 'A New Day Has Begun' : 'Night Falls...' });
        if (dayNight.isDay) {
            const packs = {};
            for (const b of boars) {
                if (!packs[b.packId]) packs[b.packId] = [];
                packs[b.packId].push(b);
            }
            for (const id in packs) {
                const members = packs[id];
                let cx = 0, cy = 0;
                members.forEach(b => { cx += b.x; cy += b.y; });
                cx /= members.length; cy /= members.length;
                const babies = Math.floor(members.length / 3);
                for (let i = 0; i < babies; i++) {
                    const ox = Math.random() * 40 - 20;
                    const oy = Math.random() * 40 - 20;
                    boars.push(createBoar(cx + ox, cy + oy, parseInt(id)));
                }
                members.forEach(b => {
                    if (b.hp < b.maxHp) {
                        b.hp = b.maxHp;
                    } else {
                        b.size *= 1.1;
                        b.maxHp *= 1.1;
                        b.hp = b.maxHp;
                    }
                });
            }
        }
    }

    const packMap = {};
    for (const b of boars) {
        if (!packMap[b.packId]) packMap[b.packId] = { members: [], cx: 0, cy: 0 };
        const p = packMap[b.packId];
        p.members.push(b);
        p.cx += b.x;
        p.cy += b.y;
    }
    const packIds = Object.keys(packMap);
    packIds.forEach(id => {
        const p = packMap[id];
        p.cx /= p.members.length;
        p.cy /= p.members.length;
    });

    for (let i = 0; i < packIds.length; i++) {
        for (let j = i + 1; j < packIds.length; j++) {
            const p1 = packMap[packIds[i]];
            const p2 = packMap[packIds[j]];
            const dx = p1.cx - p2.cx;
            const dy = p1.cy - p2.cy;
            const dist = Math.hypot(dx, dy);
            if (dist < 100) {
                p1.members.forEach(b => { b.hp -= 1; b.vx = dx / dist * b.speed; b.vy = dy / dist * b.speed; });
                p2.members.forEach(b => { b.hp -= 1; b.vx = -dx / dist * b.speed; b.vy = -dy / dist * b.speed; });
            }
        }
    }

    for (const boar of boars) {
        if (boar.wanderTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            boar.vx = Math.cos(angle) * boar.speed;
            boar.vy = Math.sin(angle) * boar.speed;
            boar.wanderTimer = 60 + Math.floor(Math.random() * 120);
        }
        const pack = packMap[boar.packId];
        if (pack) {
            const dx = pack.cx - boar.x;
            const dy = pack.cy - boar.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 30) {
                boar.vx += (dx / dist) * 0.05;
                boar.vy += (dy / dist) * 0.05;
            }
        }
        boar.x += boar.vx;
        boar.y += boar.vy;
        boar.wanderTimer--;
        boar.x = Math.max(0, Math.min(WORLD_WIDTH, boar.x));
        boar.y = Math.max(0, Math.min(WORLD_HEIGHT, boar.y));
    }
    broadcast({ type: 'game-state', players, boars, dayNight });
}
generateWorld();
setInterval(gameLoop, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });