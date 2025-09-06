// server.js (Full, Final, and Corrected)

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// --- Game Constants ---
// Original play field was 3000x3000.  We extend the world horizontally to
// include a second "light" zone of the same size to the east.  The first half
// keeps the regular grass while the new half has lighter grass and sparse
// resources.
const OLD_WORLD_WIDTH = 3000;
const WORLD_WIDTH = OLD_WORLD_WIDTH * 2;
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
    'Furnace': { cost: { Stone: 20 }, result: 'Furnace' },
    'Bed': { cost: { Wood: 20, Leaf: 40 }, result: 'Bed' },
    'Torch': { cost: { Wood: 3 }, result: 'Torch' },
    'Bow': { cost: { Wood: 3, Stone: 2 }, result: 'Bow' },
    'Arrow': { cost: { Wood: 1, Stone: 1 }, result: 'Arrow', amount: 2, noWorkbench: true }
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
let ogres = [];
let nextOgreId = 0;
let groundItems = [];
let nextItemId = 0;
let projectiles = [];
let nextProjectileId = 0;
let grid = Array(WORLD_WIDTH / GRID_CELL_SIZE)
    .fill(null)
    .map(() => Array(WORLD_HEIGHT / GRID_CELL_SIZE).fill(false));
let blockGrid = Array(WORLD_WIDTH / BLOCK_SIZE)
    .fill(null)
    .map(() => Array(WORLD_HEIGHT / BLOCK_SIZE).fill(false));
let dayNight = { isDay: true, cycleTime: 0, DAY_DURATION: 5 * 60 * 1000, NIGHT_DURATION: 3.5 * 60 * 1000 };

// --- World Generation ---
function isAreaFree(gridX, gridY, size) { for (let x = gridX; x < gridX + size; x++) { for (let y = gridY; y < gridY + size; y++) { if (x < 0 || x >= grid.length || y < 0 || y >= grid[0].length || grid[x][y]) return false; } } return true; }
function markArea(gridX, gridY, size, isOccupied) { for (let x = gridX; x < gridX + size; x++) { for (let y = gridY; y < gridY + size; y++) { if (x >= 0 && x < grid.length && y >= 0 && y < grid[0].length) grid[x][y] = isOccupied; } } }

function generateWorld() {
    console.log("Generating world with safe spawn zone...");
    const gridWidth = WORLD_WIDTH / GRID_CELL_SIZE;
    const gridHeight = WORLD_HEIGHT / GRID_CELL_SIZE;
    // Keep the safe spawn zone centred in the original area.
    const worldCenter = { x: OLD_WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };

    const placeResource = (type, count, sizes, xMin = 0, xMax = WORLD_WIDTH) => {
        let placed = 0;
        while (placed < count) {
            const size = sizes[Math.floor(Math.random() * sizes.length)];
            const gridX = Math.floor(Math.random() * (gridWidth - size));
            const gridY = Math.floor(Math.random() * (gridHeight - size));
            const worldX = (gridX + size / 2) * GRID_CELL_SIZE;
            const worldY = (gridY + size / 2) * GRID_CELL_SIZE;
            if (worldX < xMin || worldX > xMax) continue;
            if (getDistance({ x: worldX, y: worldY }, worldCenter) < SAFE_SPAWN_RADIUS)
                continue;
            if (isAreaFree(gridX, gridY, size)) {
                markArea(gridX, gridY, size, true);
                const hpBase = type === 'tree' ? 5 : 6;
                const maxHp = hpBase * size;
                resources.push({
                    id: nextResourceId++,
                    type,
                    x: worldX,
                    y: worldY,
                    hp: maxHp,
                    maxHp,
                    harvested: false,
                    size: size * GRID_CELL_SIZE * 0.8,
                    phase: 1,
                    apples:
                        type === 'tree' && Math.random() < 1 / 40
                            ? 1 + Math.floor(Math.random() * 4)
                            : 0,
                });
                placed++;
            }
        }
    };

    // Dense resources in original area
    placeResource('tree', 150, [2, 3], 0, OLD_WORLD_WIDTH);
    placeResource('rock', 90, [1, 2, 3], 0, OLD_WORLD_WIDTH);
    // Sparse resources in the new lighter area
    placeResource('tree', 30, [2, 3], OLD_WORLD_WIDTH, WORLD_WIDTH);
    placeResource('rock', 15, [1, 2, 3], OLD_WORLD_WIDTH, WORLD_WIDTH);
    // Transform rocks in the plains into passive rock monsters
    resources = resources.filter(r => {
        if (r.type === 'rock' && r.x >= OLD_WORLD_WIDTH) {
            ogres.push(createOgre(r.x, r.y));
            return false;
        }
        return true;
    });

    // Wall separating woods and plains with a small entrance
    const wallX = OLD_WORLD_WIDTH - GRID_CELL_SIZE;
    const gapStart = WORLD_HEIGHT / 2 - GRID_CELL_SIZE;
    const gapEnd = WORLD_HEIGHT / 2 + GRID_CELL_SIZE;
    for (let y = 0; y < WORLD_HEIGHT; y += GRID_CELL_SIZE) {
        if (y >= gapStart && y <= gapEnd) continue;
        const gridX = Math.floor(wallX / GRID_CELL_SIZE);
        const gridY = Math.floor(y / GRID_CELL_SIZE);
        const key = `w${gridX},${gridY}`;
        structures[key] = { type: 'stone_wall', x: gridX * GRID_CELL_SIZE, y, size: GRID_CELL_SIZE };
        markArea(gridX, gridY, 1, true);
    }

    console.log(`Generated ${resources.length} resources.`);
    spawnBoars(10);
    spawnZombies(5);
    spawnOgres(1);
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
        baseSpeed: 1.2,
        speed: 1.2,
        damage: 3,
        aggressive: false,
        target: null,
        cooldown: 0,
        giveUpTimer: 0,
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        behavior: behavior.type,
        color: behavior.color,
        burn: 0,
        slow: 0,
        bind: 0
    };
}

function getFreePosition() {
    let x, y;
    do {
        x = Math.random() * WORLD_WIDTH;
        y = Math.random() * WORLD_HEIGHT;
    } while (isBlocked(x, y, 20));
    return { x, y };
}

function getSpawnPositionAround(x, y, radius) {
    let nx, ny;
    do {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        nx = x + Math.cos(angle) * dist;
        ny = y + Math.sin(angle) * dist;
    } while (isBlocked(nx, ny, 20));
    return { x: nx, y: ny };
}

function spawnBoars(count) {
    for (let i = 0; i < count; i++) {
        const { x, y } = getFreePosition();
        boars.push(createBoar(x, y));
    }
}

function createZombie(x, y, ownerId = null, minionType = 'attack') {
    const size = 20;
    const hp = ownerId ? 5 : 20;
    // Basic stats differ slightly for different minion roles.
    const stats = {
        attack: { speed: 1.2, damage: 2 },
        healer: { speed: 1, damage: 0 },
        ranged: { speed: 1, damage: 2 }
    }[minionType] || { speed: 1.2, damage: 2 };

    // Different minion roles manifest as different creature types when
    // summoned by a player. Wild zombies remain the default.
    const kind = ownerId
        ? ({ attack: 'zombie', healer: 'spirit', ranged: 'skeleton' }[minionType] || 'zombie')
        : 'zombie';

    return {
        id: nextZombieId++,
        x,
        y,
        homeX: x,
        homeY: y,
        hp,
        maxHp: hp,
        size,
        baseSpeed: stats.speed,
        speed: stats.speed,
        damage: stats.damage,
        aggressive: false,
        target: null,
        cooldown: 0,
        giveUpTimer: 0,
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        angle: 0,
        burn: 0,
        slow: 0,
        bind: 0,
        ownerId,
        minionType,
        kind,
        commanded: false
    };
}

function spawnZombies(count) {
    for (let i = 0; i < count; i++) {
        const { x, y } = getFreePosition();
        zombies.push(createZombie(x, y));
    }
}

function createOgre(x, y) {
    // Rock golem boss
    const size = 40;
    const hp = 150;
    return {
        id: nextOgreId++,
        x,
        y,
        hp,
        maxHp: hp,
        size,
        baseSpeed: 0.6,
        speed: 0.6,
        cooldown: 0,
        smashCooldown: 0,
        smashPhase: null,
        smashTimer: 0,
        vx: 0,
        vy: 0,
        target: null,
        aggressive: false,
        burn: 0,
        slow: 0,
        bind: 0,
        wanderTimer: 0,
        angle: 0,
        facing: 0,
    };
}

function spawnOgres(count) {
    // Spawn the rock golem in the centre of the new eastern area.
    for (let i = 0; i < count; i++) {
        const x = OLD_WORLD_WIDTH + OLD_WORLD_WIDTH / 2;
        const y = WORLD_HEIGHT / 2;
        ogres.push(createOgre(x, y));
    }
}

// --- Helpers & Game Logic ---
function broadcast(data) { wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); }); }
function getActivePlayers() {
    const active = {};
    for (const id in players) {
        if (players[id].active) active[id] = players[id];
    }
    return active;
}
function getDistance(obj1, obj2) { return Math.hypot(obj1.x - obj2.x, obj1.y - obj2.y); }
function findNearestTarget(player) {
    let nearest = null;
    let dist = Infinity;
    for (const [id, p] of Object.entries(players)) {
        if (id !== player.id && p.active) {
            const d = getDistance(player, p);
            if (d < dist) { dist = d; nearest = { type: 'player', id }; }
        }
    }
    for (const boar of boars) {
        const d = getDistance(player, boar);
        if (d < dist) { dist = d; nearest = { type: 'boar', id: boar.id }; }
    }
    for (const zombie of zombies) {
        const d = getDistance(player, zombie);
        if (d < dist) { dist = d; nearest = { type: 'zombie', id: zombie.id }; }
    }
    for (const ogre of ogres) {
        const d = getDistance(player, ogre);
        if (d < dist) { dist = d; nearest = { type: 'ogre', id: ogre.id }; }
    }
    return nearest;
}
// Count a player's items using an exact name match so crafted items
// like bows cannot be mistaken for their ingredients (e.g. stone).
function countItems(player, itemName) {
    let total = 0;
    [...player.inventory, ...player.hotbar].forEach(slot => {
        if (slot && slot.item === itemName) total += slot.quantity;
    });
    return total;
}

// Remove a specific amount of an item from a player, ensuring only the
// exact item name is consumed.
function consumeItems(player, itemName, amount) {
    let remaining = amount;
    const consumeFrom = (slot) => {
        if (slot && slot.item === itemName && remaining > 0) {
            const take = Math.min(remaining, slot.quantity);
            slot.quantity -= take;
            remaining -= take;
            if (slot.quantity <= 0) return null;
        }
        return slot;
    };
    player.inventory = player.inventory.map(consumeFrom);
    player.hotbar = player.hotbar.map(consumeFrom);
}
function addItemToPlayer(playerId, item, quantity) { const p = players[playerId]; if (!p) return; let s = [...p.inventory, ...p.hotbar].find(i => i && i.item === item); if (s) s.quantity += quantity; else { let i = p.hotbar.findIndex(x => x === null); if (i !== -1) p.hotbar[i] = { item, quantity }; else { i = p.inventory.findIndex(x => x === null); if (i !== -1) p.inventory[i] = { item, quantity }; else console.log(`Inv full for ${playerId}`); } } const c = [...wss.clients].find(c => c.id === playerId); if (c) { c.send(JSON.stringify({ type: 'inventory-update', inventory: p.inventory, hotbar: p.hotbar })); c.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity })); } }
function handleDashDamage(player, angle, playerId) {
    const dmg = 3 + (player.swordDamage || 0);
    const knock = 40;
    for (const id in players) {
        if (id === playerId) continue;
        const target = players[id];
        if (!target.active) continue;
        if (getDistance(player, target) < player.size + target.size) {
            target.hp = Math.max(0, target.hp - dmg);
            target.x += Math.cos(angle) * knock;
            target.y += Math.sin(angle) * knock;
            target.lastHitBy = playerId;
            const c = [...wss.clients].find(cl => cl.id === id);
            if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
        }
    }
    for (const boar of boars) {
        if (getDistance(player, boar) < player.size + boar.size) {
            boar.hp = Math.max(0, boar.hp - dmg);
            boar.x += Math.cos(angle) * knock;
            boar.y += Math.sin(angle) * knock;
            boar.aggressive = true;
            boar.target = { type: 'player', id: playerId };
            broadcast({ type: 'boar-update', boar });
        }
    }
    for (const zombie of zombies) {
        if (getDistance(player, zombie) < player.size + zombie.size) {
            zombie.hp = Math.max(0, zombie.hp - dmg);
            zombie.x += Math.cos(angle) * knock;
            zombie.y += Math.sin(angle) * knock;
            zombie.aggressive = true;
            zombie.target = { type: 'player', id: playerId };
            broadcast({ type: 'zombie-update', zombie });
        }
    }
    for (const ogre of ogres) {
        if (getDistance(player, ogre) < player.size + ogre.size) {
            ogre.hp = Math.max(0, ogre.hp - dmg);
            ogre.x += Math.cos(angle) * knock;
            ogre.y += Math.sin(angle) * knock;
            if (ogre.hp <= 0) {
                groundItems.push({ id: nextItemId++, item: 'Fire Staff', quantity: 1, x: ogre.x, y: ogre.y });
                ogres = ogres.filter(o => o.id !== ogre.id);
                const c = [...wss.clients].find(cl => cl.id === playerId);
                if (c) levelUp(player, c);
                broadcast({ type: 'ogre-update', ogre });
                break;
            } else {
                ogre.aggressive = true;
                ogre.target = { type: 'player', id: playerId };
                broadcast({ type: 'ogre-update', ogre });
            }
        }
    }
}

function handleWhirlwindDamage(player, playerId) {
    const dmg = 3 + (player.swordDamage || 0);
    const knock = 15;
    const radius = player.size + 100;
    for (const id in players) {
        if (id === playerId) continue;
        const target = players[id];
        if (!target.active) continue;
        if (getDistance(player, target) < radius) {
            target.hp = Math.max(0, target.hp - dmg);
            const angle = Math.atan2(target.y - player.y, target.x - player.x);
            target.x += Math.cos(angle) * knock;
            target.y += Math.sin(angle) * knock;
            target.lastHitBy = playerId;
            const c = [...wss.clients].find(cl => cl.id === id);
            if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
        }
    }
    const process = (arr, type) => {
        for (let i = arr.length - 1; i >= 0; i--) {
            const obj = arr[i];
            if (getDistance(player, obj) < radius) {
                obj.hp = Math.max(0, obj.hp - dmg);
                const angle = Math.atan2(obj.y - player.y, obj.x - player.x);
                obj.x += Math.cos(angle) * knock;
                obj.y += Math.sin(angle) * knock;
                if (type === 'ogre' && obj.hp <= 0) {
                    groundItems.push({ id: nextItemId++, item: 'Fire Staff', quantity: 1, x: obj.x, y: obj.y });
                    arr.splice(i, 1);
                    const c = [...wss.clients].find(cl => cl.id === playerId);
                    if (c) levelUp(player, c);
                } else {
                    obj.aggressive = true;
                    obj.target = { type: 'player', id: playerId };
                }
                const updateType = type === 'boar' ? 'boar-update' : type === 'zombie' ? 'zombie-update' : 'ogre-update';
                broadcast({ type: updateType, [type === 'boar' ? 'boar' : type === 'zombie' ? 'zombie' : 'ogre']: obj });
            }
        }
    };
    process(boars, 'boar');
    process(zombies, 'zombie');
    process(ogres, 'ogre');
}
function sendLevelUpdate(ws, player) {
    if (ws) ws.send(JSON.stringify({ type: 'level-update', level: player.level, skillPoints: player.skillPoints }));
}

function levelUp(player, ws) {
    player.level = (player.level || 1) + 1;
    player.skillPoints = (player.skillPoints || 0) + 1;
    if (player.class === 'mage') {
        player.maxMana += 20;
        player.mana += 20;
        player.manaRegen = (player.manaRegen || 0) + (0.5 / 60);
    }
    sendLevelUpdate(ws, player);
}

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
    } else if (target === 'player') {
        if (name === 'wooden sword') return 4;
        if (name === 'stone sword') return 6;
        if (name === 'tusk') return 7;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    } else if (target === 'ogre') {
        if (name === 'wooden sword') return 3;
        if (name === 'stone sword') return 5;
        if (name === 'tusk') return 6;
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

// Simple line-of-sight check used by mobs when acquiring targets.
// Steps along the line between two points and returns false if a
// blocking tile or structure is encountered.
function hasLineOfSight(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / BLOCK_SIZE);
    for (let i = 1; i < steps; i++) {
        const x = a.x + (dx * i) / steps;
        const y = a.y + (dy * i) / steps;
        if (isBlocked(x, y, BLOCK_SIZE / 2)) return false;
    }
    return true;
}

function collidesWithEntities(x, y, size, self) {
    for (const id in players) {
        const p = players[id];
        if (!p.active || p === self) continue;
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

function moveToward(entity, target) {
    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    let angle = Math.atan2(dy, dx);
    for (let i = 0; i < 16; i++) {
        const vx = Math.cos(angle) * entity.speed;
        const vy = Math.sin(angle) * entity.speed;
        const nx = entity.x + vx;
        const ny = entity.y + vy;
        if (!isBlocked(nx, ny, entity.size) && !collidesWithEntities(nx, ny, entity.size, entity)) {
            entity.vx = vx;
            entity.vy = vy;
            return;
        }
        angle += Math.PI / 8;
    }
    entity.vx = 0;
    entity.vy = 0;
}

function isInShadow(entity) {
    for (const r of resources) {
        if (!r.harvested && getDistance(entity, r) < r.size) return true;
    }
    for (const key in structures) {
        const s = structures[key];
        const size = s.size || (s.type === 'workbench' ? GRID_CELL_SIZE : BLOCK_SIZE);
        const cx = s.x + size / 2;
        const cy = s.y + size / 2;
        if (Math.abs(entity.x - cx) < size / 2 && Math.abs(entity.y - cy) < size / 2) return true;
    }
    for (const id in players) {
        const p = players[id];
        if (!p.active || p === entity) continue;
        if (getDistance(entity, p) < p.size * 1.2) return true;
    }
    for (const b of boars) {
        if (b !== entity && getDistance(entity, b) < b.size * 1.2) return true;
    }
    for (const o of ogres) {
        if (o !== entity && getDistance(entity, o) < o.size * 1.2) return true;
    }
    for (const z of zombies) {
        if (z !== entity && getDistance(entity, z) < z.size * 1.2) return true;
    }
    return false;
}

// --- WebSocket Connection Handling ---
wss.on('connection', ws => {
    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    ws.id = playerId;
    const { x: spawnX, y: spawnY } = getSpawnPositionAround(OLD_WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 50);
    const newPlayer = {
        id: playerId,
        name: 'Survivor',
        x: spawnX,
        y: spawnY,
        speed: 3,
        baseSpeed: 3,
        size: 20,
        inventory: Array(INVENTORY_SLOTS).fill(null),
        hotbar: Array(4).fill(null),
        hp: 10,
        maxHp: 10,
        heldIndex: 0,
        lastHitBy: null,
        burn: 0,
        slow: 0,
        eyeColor: '#ccc',
        mouth: 'line',
        mouthColor: '#000',
        mana: 100,
        maxMana: 100,
        manaRegen: 0,
        moving: false,
        spawnX,
        spawnY,
        invulnerable: 0,
        active: false,
        level: 1,
        skillPoints: 0,
        skills: {},
        knightSkills: {},
        summonerSkills: { attack: 0, healer: 0, ranged: 0 },
        mageSkills: {},
        rogueSkills: {},
        canSlow: false,
        canBind: false,
        canMissile: false,
        canBomb: false,
        canSmoke: false,
        canTeleport: false,
        slowDuration: 60,
        swordDamage: 0,
        attackRange: 0,
        dashCooldown: 0,
        whirlwindCooldown: 0,
        whirlwindTime: 0,
        dashVX: 0,
        dashVY: 0,
        dashTime: 0,
        class: null,
        poison: 0,
        bind: 0,
        color: '#ff0000'
    };
    
    // This init message is CRITICAL. It MUST contain 'myPlayerData'.
    ws.send(JSON.stringify({
        type: 'init', playerId, players: getActivePlayers(), myPlayerData: newPlayer, resources, structures, boars, zombies, ogres, groundItems, projectiles, dayNight
    }));

    players[playerId] = newPlayer;
    console.log(`Player ${playerId} connected.`);

    ws.on('message', message => {
        const data = JSON.parse(message); const player = players[playerId]; if (!player) return;
        if (!player.active && data.type !== 'set-name' && data.type !== 'respawn') return;
        switch (data.type) {
            case 'move': {
                if (player.dashTime && player.dashTime > 0) break;
                const nx = data.x;
                const ny = data.y;
                if (!isBlocked(nx, ny, player.size)) {
                    player.x = nx;
                    player.y = ny;
                }
                player.moving = true;
                break;
            }
            case 'held-item':
                if (Number.isInteger(data.index)) player.heldIndex = data.index;
                break;
            case 'respawn':
                player.active = true;
                player.hp = player.maxHp;
                const { x: rx, y: ry } = getSpawnPositionAround(player.spawnX, player.spawnY, 50);
                player.x = rx;
                player.y = ry;
                player.invulnerable = 120;
                broadcast({ type: 'player-join', player });
                ws.send(JSON.stringify({ type: 'player-hit', hp: player.hp }));
                ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                break;
            case 'set-name':
                if (typeof data.name === 'string') player.name = data.name.slice(0, 20);
                if (typeof data.color === 'string') player.color = data.color;
                if (typeof data.eyeColor === 'string') player.eyeColor = data.eyeColor;
                if (typeof data.mouth === 'string') player.mouth = data.mouth;
                if (typeof data.mouthColor === 'string') player.mouthColor = data.mouthColor;
                if (!player.active) {
                    player.active = true;
                    player.x = player.spawnX;
                    player.y = player.spawnY;
                    player.invulnerable = 120;
                    broadcast({ type: 'player-join', player });
                }
                break;
            case 'set-class':
                if (['knight', 'mage', 'summoner', 'rogue'].includes(data.class)) {
                    player.class = data.class;
                    if (!player.skills) player.skills = {};
                    player.skills.range = true;
                    player.skills[data.class] = true;
                    if (data.class === 'rogue') {
                        addItemToPlayer(playerId, 'Bow', 1);
                        addItemToPlayer(playerId, 'Arrow', 2);
                        player.mana = 0; player.maxMana = 0; player.manaRegen = 0;
                    } else if (data.class === 'knight') {
                        addItemToPlayer(playerId, 'Stone Sword', 1);
                        player.mana = 0; player.maxMana = 0; player.manaRegen = 0;
                    }
                }
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
                        levelUp(player, ws);
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
            case 'hit-player': {
                const target = players[data.targetId];
                if (target && target.active && (!target.invulnerable || target.invulnerable <= 0) && getDistance(player, target) < player.size + target.size + 20 + (player.attackRange || 0)) {
                    let dmg = getDamage(data.item, 'player');
                    if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                        dmg += player.swordDamage || 0;
                    }
                    target.hp = Math.max(0, target.hp - dmg);
                    target.lastHitBy = playerId;
                    const c = [...wss.clients].find(cl => cl.id === data.targetId);
                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                }
                break;
            }
            case 'hit-boar': {
                const boar = boars.find(b => b.id === data.boarId);
                if (boar && getDistance(player, boar) < player.size + boar.size + 20 + (player.attackRange || 0)) {
                    let dmg = getDamage(data.item, 'boar');
                    if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                        dmg += player.swordDamage || 0;
                    }
                    boar.hp -= dmg;
                    if (boar.hp <= 0) {
                        addItemToPlayer(playerId, 'Raw Meat', 1 + Math.floor(Math.random() * 3));
                        if (Math.random() < 0.1) addItemToPlayer(playerId, 'Tusk', 1);
                        boars = boars.filter(b => b.id !== boar.id);
                        levelUp(player, ws);
                    } else {
                        if (boar.behavior !== 'passive') {
                            if (boar.behavior !== 'half' || boar.hp <= boar.maxHp / 2) {
                                boar.aggressive = true;
                                boar.target = { type: 'player', id: playerId };
                            }
                        }
                    }
                    broadcast({ type: 'boar-update', boar });
                }
                break;
            }
            case 'hit-zombie': {
                const zombie = zombies.find(z => z.id === data.zombieId);
                if (zombie && getDistance(player, zombie) < player.size + zombie.size + 20 + (player.attackRange || 0)) {
                    let dmg = getDamage(data.item, 'zombie');
                    if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                        dmg += player.swordDamage || 0;
                    }
                    zombie.hp -= dmg;
                    if (zombie.hp <= 0) {
                        zombies = zombies.filter(z => z.id !== zombie.id);
                        levelUp(player, ws);
                    } else {
                        zombie.aggressive = true;
                        zombie.target = { type: 'player', id: playerId };
                    }
                    broadcast({ type: 'zombie-update', zombie });
                }
                break;
            }
            case 'hit-ogre': {
                const ogre = ogres.find(o => o.id === data.ogreId);
                if (ogre && getDistance(player, ogre) < player.size + ogre.size + 20 + (player.attackRange || 0)) {
                    let dmg = getDamage(data.item, 'ogre');
                    if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                        dmg += player.swordDamage || 0;
                    }
                    ogre.hp -= dmg;
                    ogre.aggressive = true;
                    ogre.target = { type: 'player', id: playerId };
                    if (ogre.hp <= 0) {
                        ogres = ogres.filter(o => o.id !== ogre.id);
                        groundItems.push({ id: nextItemId++, item: 'Fire Staff', quantity: 1, x: ogre.x, y: ogre.y });
                        levelUp(player, ws);
                    }
                    broadcast({ type: 'ogre-update', ogre });
                }
                break;
            }
            case 'cast-staff': {
                const { targetX, targetY } = data;
                if (player.mana >= 50) {
                    player.mana -= 50;
                    const angle = Math.atan2(targetY - player.y, targetX - player.x);
                    const speed = 4;
                    const spawnDist = player.size + 20;
                    const sx = player.x + Math.cos(angle) * spawnDist;
                    const sy = player.y + Math.sin(angle) * spawnDist;
                    projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: playerId });
                }
                break;
            }
            case 'unlock-skill': {
                const skill = data.skill;
                if (player.skillPoints > 0) {
                    if (skill === 'range' && !player.skills.range) {
                        player.skillPoints--;
                        player.skills.range = true;
                        player.attackRange += 20;
                    } else if (['mage', 'knight', 'summoner', 'rogue'].includes(skill) && player.skills.range && !player.class) {
                        player.skillPoints--;
                        player.skills[skill] = true;
                        player.class = skill;
                    } else if (player.class === 'knight' && ['knight-damage', 'knight-speed', 'knight-health', 'knight-shield', 'knight-whirlwind'].includes(skill)) {
                        if (!player.knightSkills) player.knightSkills = {};
                        if (!player.knightSkills[skill]) {
                            // prerequisite checks
                            if (skill === 'knight-shield' && !player.knightSkills['knight-speed']) break;
                            if (skill === 'knight-whirlwind' && !player.knightSkills['knight-damage']) break;
                            player.skillPoints--;
                            player.knightSkills[skill] = true;
                            if (skill === 'knight-damage') player.swordDamage += 2;
                            else if (skill === 'knight-speed') { player.baseSpeed += 0.5; player.speed += 0.5; }
                            else if (skill === 'knight-health') { player.maxHp += 5; player.hp += 5; }
                        }
                    } else if (player.class === 'summoner' && ['summoner-attack', 'summoner-healer', 'summoner-ranged'].includes(skill)) {
                        if (!player.summonerSkills) player.summonerSkills = { attack: 0, healer: 0, ranged: 0 };
                        player.skillPoints--;
                        if (skill === 'summoner-attack') player.summonerSkills.attack++;
                        else if (skill === 'summoner-healer') player.summonerSkills.healer++;
                        else if (skill === 'summoner-ranged') player.summonerSkills.ranged++;
                    } else if (player.class === 'mage' && ['mage-mana', 'mage-regen', 'mage-slow', 'mage-slow-extend', 'mage-bind', 'mage-missile'].includes(skill)) {
                        if (!player.mageSkills) player.mageSkills = {};
                        if (!player.mageSkills[skill]) {
                            if (skill === 'mage-slow-extend' && !player.mageSkills['mage-slow']) break;
                            if (skill === 'mage-bind' && !player.mageSkills['mage-slow-extend']) break;
                            if (skill === 'mage-missile' && !player.mageSkills['mage-mana']) break;
                            player.skillPoints--;
                            player.mageSkills[skill] = true;
                            if (skill === 'mage-mana') {
                                player.maxMana += 20; player.mana += 20;
                            } else if (skill === 'mage-regen') {
                                player.manaRegen += 0.5 / 60;
                            } else if (skill === 'mage-slow') {
                                player.canSlow = true;
                            } else if (skill === 'mage-slow-extend') {
                                player.slowDuration = 600;
                            } else if (skill === 'mage-bind') {
                                player.canBind = true;
                            } else if (skill === 'mage-missile') {
                                player.canMissile = true;
                            }
                        }
                    } else if (player.class === 'rogue' && ['rogue-bomb', 'rogue-smoke', 'rogue-teleport', 'rogue-bow'].includes(skill)) {
                        if (!player.rogueSkills) player.rogueSkills = {};
                        if (!player.rogueSkills[skill]) {
                            if (skill === 'rogue-smoke' && !player.rogueSkills['rogue-bomb']) break;
                            player.skillPoints--;
                            player.rogueSkills[skill] = true;
                            if (skill === 'rogue-bomb') player.canBomb = true;
                            else if (skill === 'rogue-smoke') player.canSmoke = true;
                            else if (skill === 'rogue-teleport') player.canTeleport = true;
                        }
                    }
                }
                break;
            }
            case 'spawn-minion': {
                if (player.class === 'summoner' && player.summonerSkills && player.mana >= 100) {
                    const type = data.minionType || 'attack';
                    const ownedType = zombies.filter(z => z.ownerId === playerId && z.minionType === type).length;
                    const maxType = player.summonerSkills[type] || 0;
                    if (ownedType < maxType) {
                        player.mana -= 100;
                        const pos = getSpawnPositionAround(player.x, player.y, 40);
                        const minion = createZombie(pos.x, pos.y, playerId, type);
                        zombies.push(minion);
                        broadcast({ type: 'zombie-update', zombie: minion });
                    }
                }
                break;
            }
            case 'cast-slow': {
                if (player.class === 'mage' && player.canSlow && player.mana >= 30) {
                    player.mana -= 30;
                    const { targetX, targetY } = data;
                    const angle = Math.atan2(targetY - player.y, targetX - player.x);
                    const speed = 4;
                    const spawnDist = player.size + 20;
                    const sx = player.x + Math.cos(angle) * spawnDist;
                    const sy = player.y + Math.sin(angle) * spawnDist;
                    projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: playerId, type: 'slow', duration: player.slowDuration || 60 });
                }
                break;
            }
            case 'cast-bind': {
                if (player.class === 'mage' && player.canBind && player.mana >= 30) {
                    player.mana -= 30;
                    const { targetX, targetY } = data;
                    const angle = Math.atan2(targetY - player.y, targetX - player.x);
                    const speed = 4;
                    const spawnDist = player.size + 20;
                    const sx = player.x + Math.cos(angle) * spawnDist;
                    const sy = player.y + Math.sin(angle) * spawnDist;
                    projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: playerId, type: 'bind' });
                }
                break;
            }
            case 'cast-missile': {
                if (player.class === 'mage' && player.canMissile && player.mana >= 75) {
                    player.mana -= 75;
                    const target = findNearestTarget(player);
                    if (target) {
                        projectiles.push({ id: nextProjectileId++, x: player.x, y: player.y, vx: 0, vy: 0, owner: playerId, type: 'missile', targetType: target.type, targetId: target.id });
                    }
                }
                break;
            }
            case 'shoot-arrow': {
                if (player.hotbar[player.heldIndex] && player.hotbar[player.heldIndex].item === 'Bow' && countItems(player, 'Arrow') > 0) {
                    consumeItems(player, 'Arrow', 1);
                    ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                    const { targetX, targetY } = data;
                    const angle = Math.atan2(targetY - player.y, targetX - player.x);
                    const speed = 6;
                    const spawnDist = player.size + 20;
                    const sx = player.x + Math.cos(angle) * spawnDist;
                    const sy = player.y + Math.sin(angle) * spawnDist;
                    projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: playerId, type: 'arrow' });
                }
                break;
            }
            case 'shield-dash': {
                if (player.class === 'knight' && player.knightSkills && player.knightSkills['knight-shield'] && player.dashCooldown <= 0) {
                    player.dashCooldown = 120;
                    const { targetX, targetY } = data;
                    const angle = Math.atan2(targetY - player.y, targetX - player.x);
                    player.dashVX = Math.cos(angle) * 6;
                    player.dashVY = Math.sin(angle) * 6;
                    player.dashTime = 20;
                    player.invulnerable = 20;
                }
                break;
            }
            case 'knight-whirlwind': {
                if (player.class === 'knight' && player.knightSkills && player.knightSkills['knight-whirlwind'] && player.whirlwindCooldown <= 0) {
                    player.whirlwindCooldown = 180;
                    player.whirlwindTime = 20;
                    handleWhirlwindDamage(player, playerId);
                }
                break;
            }
            case 'rogue-bomb': {
                if (player.class === 'rogue' && player.canBomb) {
                    const { targetX, targetY } = data;
                    if (typeof targetX === 'number' && typeof targetY === 'number') {
                        const angle = Math.atan2(targetY - player.y, targetX - player.x);
                        const speed = 5;
                        projectiles.push({
                            id: nextProjectileId++,
                            x: player.x,
                            y: player.y,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            owner: playerId,
                            type: 'bomb',
                            timer: 60,
                        });
                    }
                }
                break;
            }
            case 'rogue-smoke': {
                if (player.class === 'rogue' && player.canSmoke) {
                    const { targetX, targetY } = data;
                    if (typeof targetX === 'number' && typeof targetY === 'number') {
                        const angle = Math.atan2(targetY - player.y, targetX - player.x);
                        const speed = 4;
                        projectiles.push({
                            id: nextProjectileId++,
                            x: player.x,
                            y: player.y,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            owner: playerId,
                            type: 'smoke',
                            timer: 300,
                            radius: 80,
                        });
                    }
                }
                break;
            }
            case 'rogue-teleport': {
                if (player.class === 'rogue' && player.canTeleport) {
                    const { targetX, targetY } = data;
                    player.x = targetX;
                    player.y = targetY;
                }
                break;
            }
            case 'command-minions': {
                const { targetType, targetId } = data;
                if (player.class === 'summoner' && !(targetType === 'player' && targetId === playerId)) {
                    for (const z of zombies) {
                        if (z.ownerId === playerId) {
                            z.aggressive = true;
                            z.target = { type: targetType, id: targetId };
                            z.commanded = true;
                        }
                    }
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
                else if (item === 'Bed') structureType = 'bed';
                else if (item === 'Torch') structureType = 'torch';
                else break;
                if (['workbench', 'furnace', 'bed', 'torch'].includes(structureType)) {
                    const gridX = Math.floor(x / GRID_CELL_SIZE);
                    const gridY = Math.floor(y / GRID_CELL_SIZE);
                    const coordKey = `w${gridX},${gridY}`;
                    if (isAreaFree(gridX, gridY, 1) && !structures[coordKey]) {
                        hotbarSlot.quantity--;
                        if (hotbarSlot.quantity <= 0) player.hotbar[data.hotbarIndex] = null;
                        const baseX = gridX * GRID_CELL_SIZE;
                        const baseY = gridY * GRID_CELL_SIZE;
                        structures[coordKey] = { type: structureType, x: baseX, y: baseY, size: GRID_CELL_SIZE };
                        if (structureType !== 'torch') {
                            markArea(gridX, gridY, 1, true);
                        }
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
                    } else if (key.startsWith('w') && structure.type !== 'torch') {
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
            case 'move-item': {
                const { fromType, fromIndex, toType, toIndex } = data;
                const fromArr = fromType === 'hotbar' ? player.hotbar : player.inventory;
                const toArr = toType === 'hotbar' ? player.hotbar : player.inventory;
                if (
                    ['hotbar', 'inventory'].includes(fromType) &&
                    ['hotbar', 'inventory'].includes(toType) &&
                    Number.isInteger(fromIndex) && Number.isInteger(toIndex) &&
                    fromIndex >= 0 && fromIndex < fromArr.length &&
                    toIndex >= 0 && toIndex < toArr.length
                ) {
                    const temp = fromArr[fromIndex];
                    fromArr[fromIndex] = toArr[toIndex];
                    toArr[toIndex] = temp;
                    ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                }
                break;
            }
            case 'drop-item': {
                const { fromType, index } = data;
                const arr = fromType === 'hotbar' ? player.hotbar : player.inventory;
                if (['hotbar', 'inventory'].includes(fromType) && Number.isInteger(index) && index >= 0 && index < arr.length) {
                    const slot = arr[index];
                    if (slot) {
                        groundItems.push({ id: nextItemId++, item: slot.item, quantity: slot.quantity, x: player.x, y: player.y, pickupTimer: 300 });
                        arr[index] = null;
                        ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                    }
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
                        player.poison = steps;
                        const interval = setInterval(() => {
                            const p = players[playerId];
                            if (!p) { clearInterval(interval); return; }
                            const dmg = total / steps;
                            p.hp = Math.max(0, p.hp - dmg);
                            p.poison = Math.max(0, (p.poison || 0) - 1);
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
                } else if (slot.item === 'Apple') {
                    slot.quantity--;
                    if (slot.quantity <= 0) player.hotbar[index] = null;
                    player.hp = Math.min(player.maxHp, player.hp + 2);
                    ws.send(JSON.stringify({ type: 'inventory-update', inventory: player.inventory, hotbar: player.hotbar }));
                    ws.send(JSON.stringify({ type: 'player-hit', hp: player.hp }));
                }
                levelUp(player, ws);
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
            case 'sleep-bed': {
                const bed = structures[data.key];
                if (!bed || bed.type !== 'bed') break;
                const center = { x: bed.x + bed.size / 2, y: bed.y + bed.size / 2 };
                if (getDistance(player, center) < player.size + bed.size) {
                    player.spawnX = center.x;
                    player.spawnY = center.y;
                }
                break;
            }
            case 'craft-item': {
                const recipe = RECIPES[data.itemName];
                if (!recipe) return;
                if (data.itemName !== 'Workbench' && !recipe.noWorkbench) {
                    const near = Object.values(structures).some(s => s.type === 'workbench' && getDistance(player, { x: s.x + s.size / 2, y: s.y + s.size / 2 }) < 150);
                    if (!near) break;
                }
                let canCraft = true;
                for (const i in recipe.cost) {
                    if (countItems(player, i) < recipe.cost[i]) { canCraft = false; break; }
                }
                if (canCraft) {
                    for (const i in recipe.cost) { consumeItems(player, i, recipe.cost[i]); }
                    addItemToPlayer(playerId, recipe.result, recipe.amount || 1);
                }
                break;
            }
            case 'chat':
                broadcast({ type: 'chat-message', sender: player.name, message: data.message });
                break;
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
                if (z.ownerId) return;
                z.x = z.homeX;
                z.y = z.homeY;
                z.aggressive = false;
                z.target = null;
                z.burn = 0;
            });
            if (boars.length < 20) spawnBoars(3);
        } else if (zombies.length < 10) {
            spawnZombies(5);
        }
    }

    for (const proj of projectiles) {
        if (proj.type === 'bomb' || proj.type === 'smoke') {
            proj.timer--;
            proj.x += proj.vx;
            proj.y += proj.vy;

            // Bounce off world bounds
            if (proj.x < 0 || proj.x > WORLD_WIDTH) {
                proj.vx *= -1;
                proj.x = Math.max(0, Math.min(WORLD_WIDTH, proj.x));
            }
            if (proj.y < 0 || proj.y > WORLD_HEIGHT) {
                proj.vy *= -1;
                proj.y = Math.max(0, Math.min(WORLD_HEIGHT, proj.y));
            }

            // Bounce off players and mobs
            const entities = [];
            for (const id in players) {
                const p = players[id];
                if (p.active) entities.push({ x: p.x, y: p.y, size: p.size });
            }
            entities.push(...boars, ...zombies, ...ogres);
            for (const e of entities) {
                if (getDistance(e, proj) < e.size) {
                    const speed = Math.hypot(proj.vx, proj.vy);
                    const ang = Math.atan2(proj.y - e.y, proj.x - e.x);
                    proj.vx = Math.cos(ang) * speed;
                    proj.vy = Math.sin(ang) * speed;
                    proj.x = e.x + Math.cos(ang) * (e.size + 1);
                    proj.y = e.y + Math.sin(ang) * (e.size + 1);
                }
            }
            for (const key in structures) {
                const s = structures[key];
                if (s.type === 'wood_wall' || s.type === 'stone_wall') {
                    if (
                        proj.x >= s.x &&
                        proj.x <= s.x + s.size &&
                        proj.y >= s.y &&
                        proj.y <= s.y + s.size
                    ) {
                        proj.vx *= -1;
                        proj.vy *= -1;
                        if (proj.x < s.x) proj.x = s.x - 1;
                        if (proj.x > s.x + s.size) proj.x = s.x + s.size + 1;
                        if (proj.y < s.y) proj.y = s.y - 1;
                        if (proj.y > s.y + s.size) proj.y = s.y + s.size + 1;
                    }
                }
            }

            if (proj.timer <= 0) {
                if (proj.type === 'bomb') {
                    const radius = 40;
                    const damage = 4;
                    broadcast({ type: 'bomb-explode', x: proj.x, y: proj.y, radius });
                    for (const id in players) {
                        const p = players[id];
                        if (!p.active) continue;
                        if (getDistance(p, proj) < radius) {
                            p.hp = Math.max(0, p.hp - damage);
                            p.lastHitBy = proj.owner || 'ogre';
                            const c = [...wss.clients].find(cl => cl.id === id);
                            if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                        }
                    }
                    for (const boar of boars) {
                        if (getDistance(boar, proj) < radius) {
                            boar.hp = Math.max(0, boar.hp - damage);
                            boar.aggressive = true;
                            broadcast({ type: 'boar-update', boar });
                        }
                    }
                    for (const zombie of zombies) {
                        if (getDistance(zombie, proj) < radius) {
                            zombie.hp = Math.max(0, zombie.hp - damage);
                            zombie.aggressive = true;
                            broadcast({ type: 'zombie-update', zombie });
                        }
                    }
                    for (const ogre of ogres) {
                        if (getDistance(ogre, proj) < radius) {
                            ogre.hp = Math.max(0, ogre.hp - damage);
                            broadcast({ type: 'ogre-update', ogre });
                        }
                    }
                }
                proj.remove = true;
            }
            continue;
        }
        if (proj.type === 'missile' && proj.targetType) {
            let target;
            if (proj.targetType === 'player') target = players[proj.targetId];
            else if (proj.targetType === 'boar') target = boars.find(b => b.id === proj.targetId);
            else if (proj.targetType === 'zombie') target = zombies.find(z => z.id === proj.targetId);
            else if (proj.targetType === 'ogre') target = ogres.find(o => o.id === proj.targetId);
            if (target) {
                const angle = Math.atan2(target.y - proj.y, target.x - proj.x);
                const speed = 1;
                proj.vx = Math.cos(angle) * speed;
                proj.vy = Math.sin(angle) * speed;
            } else {
                proj.remove = true;
                continue;
            }
        }
        proj.x += proj.vx;
        proj.y += proj.vy;
        let hit = false;
        for (const id in players) {
            const p = players[id];
            if (!p.active) continue;
            if (proj.owner && proj.owner === id) continue;
            if (getDistance(p, proj) < p.size) {
                if (proj.type === 'slow') {
                    p.slow = proj.duration || 60;
                } else if (proj.type === 'bind') {
                    p.bind = 120;
                } else if (proj.type === 'missile') {
                    if (!p.invulnerable || p.invulnerable <= 0) {
                        let dmg = 4;
                        p.hp = Math.max(0, p.hp - dmg);
                        p.lastHitBy = proj.owner || 'ogre';
                        const c = [...wss.clients].find(cl => cl.id === id);
                        if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                        if (p.hp <= 0 && proj.owner && players[proj.owner]) {
                            const killer = players[proj.owner];
                            const kc = [...wss.clients].find(cl => cl.id === proj.owner);
                            levelUp(killer, kc);
                        }
                    }
                } else {
                    if (!p.invulnerable || p.invulnerable <= 0) {
                        let dmg = 2;
                        if (proj.type !== 'arrow' && proj.type !== 'minion') p.burn = 120;
                        p.hp = Math.max(0, p.hp - dmg);
                        p.lastHitBy = proj.owner || 'ogre';
                        const c = [...wss.clients].find(cl => cl.id === id);
                        if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                        if (p.hp <= 0 && proj.owner && players[proj.owner]) {
                            const killer = players[proj.owner];
                            const kc = [...wss.clients].find(cl => cl.id === proj.owner);
                            levelUp(killer, kc);
                        }
                    }
                }
                hit = true;
                break;
            }
        }
        if (!hit) {
            for (const boar of boars) {
                if (getDistance(boar, proj) < boar.size) {
                    if (proj.type === 'slow') {
                        boar.slow = proj.duration || 60;
                    } else if (proj.type === 'bind') {
                        boar.bind = 120;
                    } else if (proj.type === 'missile') {
                        let dmg = 4;
                        boar.hp = Math.max(0, boar.hp - dmg);
                        boar.aggressive = true;
                        const nearestOgre = ogres.length ? ogres.reduce((a,b)=>getDistance(b,boar)<getDistance(a,boar)?b:a) : null;
                        if (nearestOgre) boar.target = { type: 'ogre', id: nearestOgre.id };
                        broadcast({ type: 'boar-update', boar });
                    } else {
                        let dmg = 2;
                        if (proj.type !== 'arrow' && proj.type !== 'minion') boar.burn = 120;
                        boar.hp = Math.max(0, boar.hp - dmg);
                        boar.aggressive = true;
                        const nearestOgre = ogres.length ? ogres.reduce((a,b)=>getDistance(b,boar)<getDistance(a,boar)?b:a) : null;
                        if (nearestOgre) boar.target = { type: 'ogre', id: nearestOgre.id };
                        broadcast({ type: 'boar-update', boar });
                    }
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) {
            for (const zombie of zombies) {
                if (getDistance(zombie, proj) < zombie.size) {
                    if (proj.type === 'slow') {
                        zombie.slow = proj.duration || 60;
                    } else if (proj.type === 'bind') {
                        zombie.bind = 120;
                    } else if (proj.type === 'missile') {
                        let dmg = 4;
                        zombie.hp = Math.max(0, zombie.hp - dmg);
                        zombie.aggressive = true;
                        const nearestOgre = ogres.length ? ogres.reduce((a,b)=>getDistance(b,zombie)<getDistance(a,zombie)?b:a) : null;
                        if (nearestOgre) zombie.target = { type: 'ogre', id: nearestOgre.id };
                        broadcast({ type: 'zombie-update', zombie });
                    } else {
                        let dmg = 2;
                        if (proj.type !== 'arrow' && proj.type !== 'minion') zombie.burn = 120;
                        zombie.hp = Math.max(0, zombie.hp - dmg);
                        zombie.aggressive = true;
                        const nearestOgre = ogres.length ? ogres.reduce((a,b)=>getDistance(b,zombie)<getDistance(a,zombie)?b:a) : null;
                        if (nearestOgre) zombie.target = { type: 'ogre', id: nearestOgre.id };
                        broadcast({ type: 'zombie-update', zombie });
                    }
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) {
            for (const ogre of ogres) {
                if (getDistance(ogre, proj) < ogre.size) {
                    if (proj.type === 'slow') {
                        ogre.slow = proj.duration || 60;
                    } else if (proj.type === 'bind') {
                        ogre.bind = 120;
                    } else if (proj.type === 'missile') {
                        let dmg = 4;
                        ogre.hp = Math.max(0, ogre.hp - dmg);
                        if (proj.owner) ogre.target = { type: 'player', id: proj.owner };
                        broadcast({ type: 'ogre-update', ogre });
                    } else {
                        let dmg = 2;
                        if (proj.type !== 'arrow' && proj.type !== 'minion') ogre.burn = 120;
                        ogre.hp = Math.max(0, ogre.hp - dmg);
                        if (proj.owner) ogre.target = { type: 'player', id: proj.owner };
                        broadcast({ type: 'ogre-update', ogre });
                    }
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) {
            for (const r of resources) {
                if (r.harvested) continue;
                if (getDistance(r, proj) < r.size / 2) {
                    if (!['slow', 'bind'].includes(proj.type)) {
                        let dmg = 2;
                        r.hp -= dmg;
                        if (r.hp <= 0) {
                            r.harvested = true;
                        }
                        broadcast({ type: 'resource-update', resource: r });
                    }
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) {
            for (const key in structures) {
                const s = structures[key];
                if (s.type === 'wood_wall' || s.type === 'stone_wall') {
                    if (proj.x >= s.x && proj.x <= s.x + s.size && proj.y >= s.y && proj.y <= s.y + s.size) {
                        delete structures[key];
                        if (key.startsWith('b')) {
                            const [bx, by] = key.slice(1).split(',').map(Number);
                            blockGrid[bx][by] = false;
                        } else if (key.startsWith('w') && s.type !== 'torch') {
                            const [gx, gy] = key.slice(1).split(',').map(Number);
                            markArea(gx, gy, 1, false);
                        }
                        broadcast({ type: 'structure-update', structures });
                        hit = true;
                        break;
                    }
                }
            }
        }
        if (proj.x < 0 || proj.x > WORLD_WIDTH || proj.y < 0 || proj.y > WORLD_HEIGHT) hit = true;
        proj.remove = hit;
    }
    projectiles = projectiles.filter(p => !p.remove);

    for (const boar of boars) {
        boar.speed = boar.baseSpeed;
        if (boar.bind > 0) { boar.bind--; boar.speed = 0; }
        else if (boar.slow > 0) { boar.slow--; boar.speed = boar.baseSpeed * 0.5; }
        if (boar.cooldown > 0) boar.cooldown--;
        if (boar.giveUpTimer > 0) boar.giveUpTimer--;
        if (boar.burn > 0) {
            boar.burn--;
            if (boar.burn % 30 === 0) boar.hp = Math.max(0, boar.hp - 1);
        }
        const potentialTargets = [];
        for (const id in players) {
            if (players[id].active) potentialTargets.push({ type: 'player', id, entity: players[id] });
        }
        for (const o of ogres) potentialTargets.push({ type: 'ogre', id: o.id, entity: o });
        for (const z of zombies) {
            if (z.ownerId) potentialTargets.push({ type: 'zombie', id: z.id, entity: z });
        }
        if (!boar.aggressive) {
            if (boar.behavior === 'sight') {
                for (const t of potentialTargets) {
                    if (getDistance(t.entity, boar) < 150 && hasLineOfSight(boar, t.entity)) {
                        boar.aggressive = true; boar.target = { type: t.type, id: t.id }; boar.giveUpTimer = 600; break;
                    }
                }
            } else if (boar.behavior === 'stand') {
                boar.vx = 0;
                boar.vy = 0;
                for (const t of potentialTargets) {
                    if (getDistance(t.entity, boar) < 80 && hasLineOfSight(boar, t.entity)) {
                        boar.aggressive = true; boar.target = { type: t.type, id: t.id }; boar.giveUpTimer = 600; break;
                    }
                }
            }
        } else {
            let target = null;
            if (boar.target.type === 'player') target = players[boar.target.id];
            else if (boar.target.type === 'ogre') target = ogres.find(o => o.id === boar.target.id);
            else if (boar.target.type === 'zombie') target = zombies.find(z => z.id === boar.target.id);
            if (!target) { boar.aggressive = false; boar.target = null; boar.giveUpTimer = 0; }
            else {
                const dist = getDistance(boar, target);
                if (dist > 200) { boar.aggressive = false; boar.target = null; boar.giveUpTimer = 0; }
                else {
                    if (hasLineOfSight(boar, target)) boar.giveUpTimer = 600;
                    else if (boar.giveUpTimer <= 0) { boar.aggressive = false; boar.target = null; boar.giveUpTimer = 0; continue; }
                    moveToward(boar, target);
                    if (dist < boar.size + target.size && boar.cooldown <= 0) {
                        if (boar.target.type !== 'player' || target.invulnerable <= 0) {
                            target.hp = Math.max(0, target.hp - boar.damage);
                            if (boar.target.type === 'player') {
                                target.lastHitBy = 'boar';
                                const c = [...wss.clients].find(cl => cl.id === boar.target.id);
                                if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                            } else {
                                if (target.hp <= 0) {
                                    if (boar.target.type === 'ogre') {
                                        ogres = ogres.filter(o => o.id !== target.id);
                                        groundItems.push({ id: nextItemId++, item: 'Fire Staff', quantity: 1, x: target.x, y: target.y });
                                    }
                                }
                                if (boar.target.type === 'ogre') broadcast({ type: 'ogre-update', ogre: target });
                                else if (boar.target.type === 'zombie') broadcast({ type: 'zombie-update', zombie: target });
                            }
                        }
                    boar.cooldown = 60;
                    }
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
    for (const boar of boars) {
        if (boar.hp <= 0 && !boar.dropProcessed) {
            groundItems.push({ id: nextItemId++, item: 'Raw Meat', quantity: 1 + Math.floor(Math.random() * 3), x: boar.x, y: boar.y });
            if (Math.random() < 0.1) groundItems.push({ id: nextItemId++, item: 'Tusk', quantity: 1, x: boar.x, y: boar.y });
            boar.dropProcessed = true;
        }
    }
    boars = boars.filter(b => b.hp > 0);

    for (const zombie of zombies) {
        zombie.speed = zombie.baseSpeed;
        if (zombie.bind > 0) { zombie.bind--; zombie.speed = 0; }
        else if (zombie.slow > 0) { zombie.slow--; zombie.speed = zombie.baseSpeed * 0.5; }
        if (zombie.cooldown > 0) zombie.cooldown--;
        if (zombie.giveUpTimer > 0) zombie.giveUpTimer--;
        if (dayNight.isDay && !isInShadow(zombie) && !zombie.ownerId) {
            zombie.burn = Math.min(120, (zombie.burn || 0) + 1);
            if (zombie.burn % 30 === 0) zombie.hp = Math.max(0, zombie.hp - 1);
        } else if (zombie.burn > 0) {
            zombie.burn--;
        }
        // Healer minions simply follow their owner and heal them periodically.
        if (zombie.ownerId && zombie.minionType === 'healer') {
            const owner = players[zombie.ownerId];
            if (owner) {
                const dist = getDistance(zombie, owner);
                if (dist > 40) moveToward(zombie, owner);
                else { zombie.vx = 0; zombie.vy = 0; }
                if (dist < 50 && owner.hp < owner.maxHp && zombie.cooldown <= 0) {
                    owner.hp = Math.min(owner.maxHp, owner.hp + 1);
                    const c = [...wss.clients].find(cl => cl.id === zombie.ownerId);
                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: owner.hp }));
                    zombie.cooldown = 60;
                }
            }
            zombie.wanderTimer--;
            zombie.x = Math.max(0, Math.min(WORLD_WIDTH, zombie.x + zombie.vx));
            zombie.y = Math.max(0, Math.min(WORLD_HEIGHT, zombie.y + zombie.vy));
            continue;
        }
        if (!zombie.aggressive) {
            let detected = false;
            const potential = [];
            for (const id in players) {
                if (players[id].active && id !== zombie.ownerId) potential.push({ type: 'player', id, entity: players[id] });
            }
            for (const o of ogres) potential.push({ type: 'ogre', id: o.id, entity: o });
            if (!zombie.ownerId) {
                for (const z of zombies) {
                    if (z.ownerId) potential.push({ type: 'zombie', id: z.id, entity: z });
                }
            }
            for (const t of potential) {
                const dx = t.entity.x - zombie.x;
                const dy = t.entity.y - zombie.y;
                const dist = Math.hypot(dx, dy);
                const angleTo = Math.atan2(dy, dx);
                const diff = Math.abs(Math.atan2(Math.sin(angleTo - zombie.angle), Math.cos(angleTo - zombie.angle)));
                if (dist < 200 && diff < Math.PI / 4 && hasLineOfSight(zombie, t.entity)) {
                    zombie.aggressive = true;
                    zombie.target = { type: t.type, id: t.id };
                    zombie.giveUpTimer = 1800;
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
            let target = null;
            if (zombie.target.type === 'player') target = players[zombie.target.id];
            else if (zombie.target.type === 'ogre') target = ogres.find(o => o.id === zombie.target.id);
            else if (zombie.target.type === 'boar') target = boars.find(b => b.id === zombie.target.id);
            else if (zombie.target.type === 'zombie') target = zombies.find(z => z.id === zombie.target.id);
            if (!target) { zombie.aggressive = false; zombie.target = null; zombie.commanded = false; zombie.giveUpTimer = 0; }
            else {
                const dist = getDistance(zombie, target);
                if (!zombie.commanded) {
                    if (hasLineOfSight(zombie, target)) zombie.giveUpTimer = 1800;
                    else if (zombie.giveUpTimer <= 0) { zombie.aggressive = false; zombie.target = null; zombie.commanded = false; zombie.giveUpTimer = 0; continue; }
                }
                if (!zombie.commanded && dist > 250 && zombie.giveUpTimer <= 0) { zombie.aggressive = false; zombie.target = null; zombie.commanded = false; }
                else {
                    moveToward(zombie, target);
                    zombie.angle = Math.atan2(zombie.vy, zombie.vx);
                    if (zombie.minionType === 'ranged') {
                        if (dist < 200 && zombie.cooldown <= 0) {
                            const angle = Math.atan2(target.y - zombie.y, target.x - zombie.x);
                            const speed = 4;
                            const spawnDist = zombie.size + 5;
                            const sx = zombie.x + Math.cos(angle) * spawnDist;
                            const sy = zombie.y + Math.sin(angle) * spawnDist;
                            projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: zombie.ownerId, type: 'minion' });
                            zombie.cooldown = 60;
                        }
                    } else {
                        if (dist < zombie.size + target.size && zombie.cooldown <= 0) {
                            if (zombie.target.type !== 'player' || target.invulnerable <= 0) {
                                target.hp = Math.max(0, target.hp - zombie.damage);
                                if (zombie.target.type === 'player') {
                                    target.lastHitBy = 'zombie';
                                    const c = [...wss.clients].find(cl => cl.id === zombie.target.id);
                                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                                } else {
                                    if (target.hp <= 0 && zombie.target.type === 'ogre') {
                                        ogres = ogres.filter(o => o.id !== target.id);
                                        groundItems.push({ id: nextItemId++, item: 'Fire Staff', quantity: 1, x: target.x, y: target.y });
                                    }
                                    if (zombie.target.type === 'ogre') broadcast({ type: 'ogre-update', ogre: target });
                                    else if (zombie.target.type === 'boar') broadcast({ type: 'boar-update', boar: target });
                                    else if (zombie.target.type === 'zombie') broadcast({ type: 'zombie-update', zombie: target });
                                }
                            }
                            zombie.cooldown = 60;
                        }
                    }
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
    zombies = zombies.filter(z => z.hp > 0);

    for (const ogre of ogres) {
        ogre.speed = ogre.baseSpeed;
        if (ogre.bind > 0) { ogre.bind--; ogre.speed = 0; }
        else if (ogre.slow > 0) { ogre.slow--; ogre.speed = ogre.baseSpeed * 0.5; }
        if (!ogre.aggressive) {
            ogre.vx = 0;
            ogre.vy = 0;
            continue;
        }
        if (ogre.cooldown > 0) ogre.cooldown--;
        if (ogre.smashCooldown > 0) ogre.smashCooldown--;

        // Handle ongoing smash animation phases
        if (ogre.smashPhase) {
            ogre.smashTimer--;
            if (ogre.smashTimer <= 0) {
                const radius = 100;
                const side = ogre.smashPhase;
                for (const id in players) {
                    const p = players[id];
                    if (!p.active) continue;
                    if (side === 'right' && p.x < ogre.x) continue;
                    if (side === 'left' && p.x > ogre.x) continue;
                    if (getDistance(p, ogre) < radius) {
                        const angle = Math.atan2(p.y - ogre.y, p.x - ogre.x);
                        const knock = 50;
                        p.x += Math.cos(angle) * knock;
                        p.y += Math.sin(angle) * knock;
                        p.hp = Math.max(0, p.hp - 10);
                        p.lastHitBy = 'ogre';
                        const c = [...wss.clients].find(cl => cl.id === id);
                        if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                    }
                }
                if (ogre.smashPhase === 'right') {
                    ogre.smashPhase = 'left';
                    ogre.smashTimer = 15;
                } else {
                    ogre.smashPhase = null;
                    ogre.smashCooldown = 180;
                }
            }
            continue; // no movement while smashing
        }

        let targetData = null;
        let minDist = Infinity;
        for (const id in players) {
            const p = players[id];
            if (!p.active) continue;
            const d = getDistance(p, ogre);
            if (d < minDist) {
                minDist = d;
                targetData = { entity: p, type: 'player', id };
            }
        }
        if (targetData) {
            ogre.target = { type: 'player', id: targetData.id };
            ogre.wanderTimer = 0;
            const dist = minDist;
            moveToward(ogre, targetData.entity);
            ogre.facing = Math.atan2(ogre.vy, ogre.vx);
            if (dist < 120 && ogre.smashCooldown <= 0) {
                ogre.smashPhase = 'right';
                ogre.smashTimer = 15;
            }
        } else {
            ogre.target = null;
        }
        const nx = ogre.x + ogre.vx;
        const ny = ogre.y + ogre.vy;
        if (!isBlocked(nx, ny, ogre.size) && !collidesWithEntities(nx, ny, ogre.size, ogre)) {
            ogre.x = nx;
            ogre.y = ny;
        }
        // Destroy resources the golem moves through
        for (const r of resources) {
            if (!r.harvested && getDistance(r, ogre) < ogre.size + (r.size / 2)) {
                r.harvested = true;
                r.hp = 0;
                broadcast({ type: 'resource-update', resource: r });
            }
        }
        ogre.x = Math.max(0, Math.min(WORLD_WIDTH, ogre.x));
        ogre.y = Math.max(0, Math.min(WORLD_HEIGHT, ogre.y));
    }
    for (const id in players) {
        const p = players[id];
        if (!p.active) continue;
        p.speed = p.baseSpeed;
        if (p.bind > 0) { p.bind--; p.speed = 0; }
        else if (p.slow > 0) { p.slow--; p.speed = p.baseSpeed * 0.5; }
        if (p.burn && p.burn > 0) {
            p.burn--;
            if (p.burn % 30 === 0 && (!p.invulnerable || p.invulnerable <= 0)) {
                p.hp = Math.max(0, p.hp - 1);
                const c = [...wss.clients].find(cl => cl.id === id);
                if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
            }
        }
        if (p.invulnerable && p.invulnerable > 0) p.invulnerable--;
        if (p.dashCooldown && p.dashCooldown > 0) p.dashCooldown--;
        if (p.whirlwindCooldown && p.whirlwindCooldown > 0) p.whirlwindCooldown--;
        if (p.whirlwindTime && p.whirlwindTime > 0) p.whirlwindTime--;
        if (p.dashTime && p.dashTime > 0) {
            p.x = Math.max(0, Math.min(WORLD_WIDTH, p.x + p.dashVX));
            p.y = Math.max(0, Math.min(WORLD_HEIGHT, p.y + p.dashVY));
            handleDashDamage(p, Math.atan2(p.dashVY, p.dashVX), id);
            p.dashTime--;
            p.moving = true;
        }
        if (p.hp <= 0) {
            if (p.lastHitBy === 'zombie') {
                const owned = zombies.filter(z => z.ownerId === id).length;
                if (owned < 3) zombies.push(createZombie(p.x, p.y, id));
            }
            for (const slot of [...p.inventory, ...p.hotbar]) {
                if (slot) groundItems.push({ id: nextItemId++, item: slot.item, quantity: slot.quantity, x: p.x, y: p.y });
            }
            p.inventory = Array(INVENTORY_SLOTS).fill(null);
            p.hotbar = Array(4).fill(null);
            p.hp = p.maxHp;
            const safe = getSpawnPositionAround(p.spawnX !== undefined ? p.spawnX : WORLD_WIDTH / 2,
                                               p.spawnY !== undefined ? p.spawnY : WORLD_HEIGHT / 2,
                                               50);
            p.x = safe.x;
            p.y = safe.y;
            p.invulnerable = 120;
            p.active = false;
            broadcast({ type: 'player-leave', playerId: id });
            const c = [...wss.clients].find(cl => cl.id === id);
            if (c) c.send(JSON.stringify({ type: 'player-dead', cause: p.lastHitBy }));
            broadcast({ type: 'chat-message', sender: 'Server', message: `${p.name} died`, color: 'red' });
        }
        if (p.mana < p.maxMana) {
            const base = p.moving ? (2 / 60) : (4 / 60);
            const regen = base + (p.manaRegen || 0);
            p.mana = Math.min(p.maxMana, p.mana + regen);
        }
        p.moving = false;
    }

    groundItems = groundItems.filter(g => {
        if (g.pickupTimer && g.pickupTimer > 0) { g.pickupTimer--; return true; }
        for (const id in players) {
            const p = players[id];
            if (!p.active) continue;
            if (getDistance(p, g) < 30) {
                addItemToPlayer(id, g.item, g.quantity);
                return false;
            }
        }
        return true;
    });
    broadcast({ type: 'game-state', players: getActivePlayers(), boars, zombies, ogres, groundItems, projectiles, dayNight });
}
generateWorld();
setInterval(gameLoop, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });