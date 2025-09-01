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
    'Stone Sword': { cost: { Wood: 1, Stone: 4 }, result: 'Stone Sword' },
    'Furnace': { cost: { Stone: 20 }, result: 'Furnace' }
};

// --- Game State ---
let players = {};
let resources = [];
let structures = {};
let nextResourceId = 0;
let boars = [];
let nextBoarId = 0;
let zombies = [];
let nextZombieId = 0;
let grid = Array(WORLD_WIDTH / GRID_CELL_SIZE).fill(null).map(() => Array(WORLD_HEIGHT / GRID_CELL_SIZE).fill(false));
let blockGrid = Array(WORLD_WIDTH / BLOCK_SIZE).fill(null).map(() => Array(WORLD_HEIGHT / BLOCK_SIZE).fill(false));
let dayNight = { isDay: true, cycleTime: 0, DAY_DURATION: 5 * 60 * 1000, NIGHT_DURATION: 3.5 * 60 * 1000 };

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
    spawnZombies(5);
}

function createBoar(x, y) {
    const size = 20;
    const hp = 15;
    const behaviors = [
        { type: 'sight', color: '#000000' },          // attacks on sight
        { type: 'stand', color: '#555555' },          // waits until player is very close
        { type: 'retaliate', color: '#8B4513' },      // attacks only if hit
        { type: 'half', color: '#A0522D' },           // attacks after dropping to half HP
        { type: 'passive', color: null }              // never attacks
    ];
    const behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
    return {
        id: nextBoarId++,
        x,
        y,
        hp,
        maxHp: hp,
        size,
        speed: 1.2,
        damage: 3,
        aggressive: false,
        target: null,
        cooldown: 0,
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        behavior: behavior.type,
        color: behavior.color
    };
}

function spawnBoars(count) {
    for (let i = 0; i < count; i++) {
        const x = Math.random() * WORLD_WIDTH;
        const y = Math.random() * WORLD_HEIGHT;
        boars.push(createBoar(x, y));
    }
}

function createZombie(x, y) {
    const size = 20;
    const hp = 20;
    return {
        id: nextZombieId++,
        x,
        y,
        homeX: x,
        homeY: y,
        hp,
        maxHp: hp,
        size,
        speed: 1.2,
        damage: 2,
        aggressive: false,
        target: null,
        cooldown: 0,
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        angle: 0
    };
}

function spawnZombies(count) {
    const trees = resources.filter(r => r.type === 'tree');
    for (let i = 0; i < count && trees.length > 0; i++) {
        const t = trees[Math.floor(Math.random() * trees.length)];
        zombies.push(createZombie(t.x, t.y));
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
    } else if (target === 'zombie') {
        if (name === 'wooden sword') return 4;
        if (name === 'stone sword') return 6;
        if (name === 'tusk') return 7;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    }
    return 1;
}

function isBlocked(x, y, size) {
    const bx = Math.floor(x / BLOCK_SIZE);
    const by = Math.floor(y / BLOCK_SIZE);
    if (blockGrid[bx] && blockGrid[bx][by]) return true;
    for (const key in structures) {
        const s = structures[key];
        const sSize = s.size;
        const cx = s.x + sSize / 2;
        const cy = s.y + sSize / 2;
        if (getDistance({ x, y }, { x: cx, y: cy }) < size / 2 + sSize / 2) return true;
    }
    for (const r of resources) {
        if (r.harvested) continue;
        let rSize = r.size / 2;
        if (r.type === 'tree') {
            rSize = GRID_CELL_SIZE * 0.4; // only block on trunk, not leaves
        }
        if (getDistance({ x, y }, r) < size / 2 + rSize) return true;
    }
    return false;
}

function collidesWithEntities(x, y, size, self) {
    for (const id in players) {
        const p = players[id];
        if (p === self) continue;
        if (getDistance({ x, y }, p) < size / 2 + p.size / 2) return true;
    }
    for (const b of boars) {
        if (b === self) continue;
        if (getDistance({ x, y }, b) < size / 2 + b.size / 2) return true;
    }
    for (const z of zombies) {
        if (z === self) continue;
        if (getDistance({ x, y }, z) < size / 2 + z.size / 2) return true;
    }
    return false;
}

// --- WebSocket Connection Handling ---
wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;
    const newPlayer = { id: playerId, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, speed: 3, size: 20, inventory: Array(INVENTORY_SLOTS).fill(null), hotbar: Array(4).fill(null), hp: 10, maxHp: 10, heldIndex: 0, lastHitBy: null };
    
    // This init message is CRITICAL. It MUST contain 'myPlayerData'.
    ws.send(JSON.stringify({
        type: 'init', playerId, players, myPlayerData: newPlayer, resources, structures, boars, zombies: dayNight.isDay ? [] : zombies, dayNight
    }));

    players[playerId] = newPlayer;
    console.log(`Player ${playerId} connected.`);
    broadcast({ type: 'player-join', player: newPlayer });

    ws.on('message', message => {
        const data = JSON.parse(message); const player = players[playerId]; if (!player) return;
        switch (data.type) {
            case 'move': {
                const nx = data.x;
                const ny = data.y;
                if (!isBlocked(nx, ny, player.size) && !collidesWithEntities(nx, ny, player.size, player)) {
                    player.x = nx;
                    player.y = ny;
                }
                break;
            }
            case 'held-item':
                if (Number.isInteger(data.index)) player.heldIndex = data.index;
                break;
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
                        addItemToPlayer(playerId, 'Raw Meat', 1 + Math.floor(Math.random() * 3));
                        if (Math.random() < 0.1) addItemToPlayer(playerId, 'Tusk', 1);
                        boars = boars.filter(b => b.id !== boar.id);
                    } else {
                        if (boar.behavior !== 'passive') {
                            if (boar.behavior !== 'half' || boar.hp <= boar.maxHp / 2) {
                                boar.aggressive = true;
                                boar.target = playerId;
                            }
                        }
                    }
                    broadcast({ type: 'boar-update', boar });
                }
                break;
            }
            case 'hit-zombie': {
                const zombie = zombies.find(z => z.id === data.zombieId);
                if (zombie && getDistance(player, zombie) < player.size + zombie.size + 20) {
                    const dmg = getDamage(data.item, 'zombie');
                    zombie.hp -= dmg;
                    if (zombie.hp <= 0) {
                        zombies = zombies.filter(z => z.id !== zombie.id);
                    } else {
                        zombie.aggressive = true;
                        zombie.target = playerId;
                    }
                    broadcast({ type: 'zombie-update', zombie });
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
                else if (item === 'Furnace') structureType = 'furnace';
                else break;
                if (structureType === 'workbench' || structureType === 'furnace') {
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
                    if (structure.type === 'wood_wall' || structure.type === 'stone_wall' || structure.type === 'furnace') {
                        const itemDrop = structure.type === 'wood_wall' ? 'Wood' : 'Stone';
                        addItemToPlayer(playerId, itemDrop, 1);
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
            case 'consume-item': {
                const index = data.hotbarIndex;
                const slot = player.hotbar[index];
                if (!slot) break;
                if (slot.item === 'Raw Meat') {
                    slot.quantity--;
                    if (slot.quantity <= 0) player.hotbar[index] = null;
                    ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                    if (Math.random() < 0.5) {
                        const total = player.maxHp * 0.25;
                        let dealt = 0;
                        const steps = 5;
                        const interval = setInterval(() => {
                            const p = players[playerId];
                            if (!p) { clearInterval(interval); return; }
                            const dmg = total / steps;
                            p.hp = Math.max(0, p.hp - dmg);
                            ws.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                            dealt += dmg;
                            if (dealt >= total || p.hp <= 0) clearInterval(interval);
                        }, 1000);
                    } else {
                        player.hp = Math.min(player.maxHp, player.hp + 2);
                        ws.send(JSON.stringify({ type: 'player-hit', hp: player.hp }));
                    }
                } else if (slot.item === 'Cooked Meat') {
                    slot.quantity--;
                    if (slot.quantity <= 0) player.hotbar[index] = null;
                    player.hp = Math.min(player.maxHp, player.hp + 5);
                    ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                    ws.send(JSON.stringify({ type: 'player-hit', hp: player.hp }));
                }
                break;
            }
            case 'furnace-cook': {
                const { input, fuel } = data;
                const outputMap = { 'Raw Meat': 'Cooked Meat', 'Apple': null };
                const fuels = ['Wood', 'Leaf', 'Raw Meat', 'Apple'];
                if (!outputMap.hasOwnProperty(input) || !fuels.includes(fuel)) break;
                const near = Object.values(structures).some(s => s.type === 'furnace' && getDistance(player, { x: s.x + s.size / 2, y: s.y + s.size / 2 }) < 150);
                if (!near) break;
                if (countItems(player, input) <= 0 || countItems(player, fuel) <= 0) break;
                consumeItems(player, input, 1);
                consumeItems(player, fuel, 1);
                const result = outputMap[input];
                if (result) addItemToPlayer(playerId, result, 1);
                ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                break;
            }
            case 'craft-item': {
                const recipe = RECIPES[data.itemName];
                if (!recipe) return;
                if (data.itemName !== 'Workbench') {
                    const near = Object.values(structures).some(s => s.type === 'workbench' && getDistance(player, { x: s.x + s.size / 2, y: s.y + s.size / 2 }) < 150);
                    if (!near) break;
                }
                let canCraft = true;
                for (const i in recipe.cost) {
                    if (countItems(player, i) < recipe.cost[i]) { canCraft = false; break; }
                }
                if (canCraft) {
                    for (const i in recipe.cost) { consumeItems(player, i, recipe.cost[i]); }
                    addItemToPlayer(playerId, recipe.result, 1);
                }
                break;
            }
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
            boars.forEach(b => (b.hp = b.maxHp));
            zombies.forEach(z => {
                z.x = z.homeX;
                z.y = z.homeY;
                z.aggressive = false;
                z.target = null;
            });
        }
    }

    for (const boar of boars) {
        if (boar.cooldown > 0) boar.cooldown--;
        if (!boar.aggressive) {
            if (boar.behavior === 'sight') {
                for (const id in players) {
                    const p = players[id];
                    if (getDistance(p, boar) < 150) {
                        boar.aggressive = true;
                        boar.target = id;
                        break;
                    }
                }
            } else if (boar.behavior === 'stand') {
                boar.vx = 0;
                boar.vy = 0;
                for (const id in players) {
                    const p = players[id];
                    if (getDistance(p, boar) < 80) {
                        boar.aggressive = true;
                        boar.target = id;
                        break;
                    }
                }
            }
        } else {
            const target = players[boar.target];
            if (!target) {
                boar.aggressive = false;
                boar.target = null;
            } else {
                const dx = target.x - boar.x;
                const dy = target.y - boar.y;
                const dist = Math.hypot(dx, dy) || 1;
                boar.vx = (dx / dist) * boar.speed;
                boar.vy = (dy / dist) * boar.speed;
                if (dist < boar.size + target.size && boar.cooldown <= 0) {
                    target.hp = Math.max(0, target.hp - boar.damage);
                    target.lastHitBy = 'boar';
                    boar.cooldown = 60;
                    const c = [...wss.clients].find(cl => cl.id === boar.target);
                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                }
            }
        }
        if (!boar.aggressive && boar.behavior !== 'stand' && boar.wanderTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            boar.vx = Math.cos(angle) * boar.speed;
            boar.vy = Math.sin(angle) * boar.speed;
            boar.wanderTimer = 60 + Math.floor(Math.random() * 120);
        }
        if (boar.behavior === 'stand') {
            boar.wanderTimer = 0;
        } else {
            boar.wanderTimer--;
        }
        const nx = boar.x + boar.vx;
        const ny = boar.y + boar.vy;
        if (!isBlocked(nx, ny, boar.size) && !collidesWithEntities(nx, ny, boar.size, boar)) {
            boar.x = nx;
            boar.y = ny;
        } else {
            boar.vx = -boar.vx;
            boar.vy = -boar.vy;
        }
        boar.x = Math.max(0, Math.min(WORLD_WIDTH, boar.x));
        boar.y = Math.max(0, Math.min(WORLD_HEIGHT, boar.y));
    }

    for (const zombie of zombies) {
        if (zombie.cooldown > 0) zombie.cooldown--;
        if (dayNight.isDay) continue;
        if (!zombie.aggressive) {
            let detected = false;
            for (const id in players) {
                const p = players[id];
                const dx = p.x - zombie.x;
                const dy = p.y - zombie.y;
                const dist = Math.hypot(dx, dy);
                const angleToPlayer = Math.atan2(dy, dx);
                const diff = Math.abs(Math.atan2(Math.sin(angleToPlayer - zombie.angle), Math.cos(angleToPlayer - zombie.angle)));
                if (dist < 200 && diff < Math.PI / 4) {
                    zombie.aggressive = true;
                    zombie.target = id;
                    detected = true;
                    break;
                }
            }
            if (!detected && zombie.wanderTimer <= 0) {
                zombie.angle = Math.random() * Math.PI * 2;
                zombie.vx = Math.cos(zombie.angle) * zombie.speed;
                zombie.vy = Math.sin(zombie.angle) * zombie.speed;
                zombie.wanderTimer = 60 + Math.floor(Math.random() * 120);
            }
        } else {
            const target = players[zombie.target];
            if (!target) {
                zombie.aggressive = false;
                zombie.target = null;
            } else {
                const dx = target.x - zombie.x;
                const dy = target.y - zombie.y;
                const dist = Math.hypot(dx, dy) || 1;
                zombie.angle = Math.atan2(dy, dx);
                zombie.vx = (dx / dist) * zombie.speed;
                zombie.vy = (dy / dist) * zombie.speed;
                if (dist < zombie.size + target.size && zombie.cooldown <= 0) {
                    target.hp = Math.max(0, target.hp - zombie.damage);
                    target.lastHitBy = 'zombie';
                    zombie.cooldown = 60;
                    const c = [...wss.clients].find(cl => cl.id === zombie.target);
                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                }
            }
        }
        zombie.wanderTimer--;
        const nx = zombie.x + zombie.vx;
        const ny = zombie.y + zombie.vy;
        if (!isBlocked(nx, ny, zombie.size) && !collidesWithEntities(nx, ny, zombie.size, zombie)) {
            zombie.x = nx;
            zombie.y = ny;
        } else {
            zombie.vx = -zombie.vx;
            zombie.vy = -zombie.vy;
        }
        zombie.x = Math.max(0, Math.min(WORLD_WIDTH, zombie.x));
        zombie.y = Math.max(0, Math.min(WORLD_HEIGHT, zombie.y));
    }
    const deadPlayers = [];
    for (const id in players) {
        if (players[id].hp <= 0) deadPlayers.push(id);
    }
    for (const id of deadPlayers) {
        const p = players[id];
        if (p.lastHitBy === 'zombie') {
            zombies.push(createZombie(p.x, p.y));
        }
        const c = [...wss.clients].find(cl => cl.id === id);
        if (c) c.send(JSON.stringify({ type: 'player-dead' }));
        delete players[id];
        broadcast({ type: 'player-death', playerId: id });
    }
    broadcast({ type: 'game-state', players, boars, zombies: dayNight.isDay ? [] : zombies, dayNight });
}
generateWorld();
setInterval(gameLoop, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });