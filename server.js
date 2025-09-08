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
const WORLD_WIDTH = OLD_WORLD_WIDTH * 3;
const GLACIAL_RIFT_START_X = OLD_WORLD_WIDTH * 2;
const GLACIAL_RIFT_END_X = WORLD_WIDTH;
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
let frostWraiths = [];
let nextFrostWraithId = 0;
let iceMaulers = [];
let nextIceMaulerId = 0;
let cryoShamans = [];
let nextCryoShamanId = 0;
let glacierTitan = null;
let nextTitanId = 0;
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
let dayNight = {
    isDay: true,
    cycleTime: 0,
    DAY_DURATION: 5 * 60 * 1000,
    NIGHT_DURATION: 3.5 * 60 * 1000,
    dayCount: 1,
    isBloodNight: false
};
const BLIZZARD_INTERVAL = 60 * 1000;
const BLIZZARD_DURATION = 15 * 1000;
let riftBlizzard = { active: false, timer: BLIZZARD_INTERVAL };

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
    placeResource('tree', 30, [2, 3], OLD_WORLD_WIDTH, GLACIAL_RIFT_START_X);
    placeResource('rock', 15, [1, 2, 3], OLD_WORLD_WIDTH, GLACIAL_RIFT_START_X);
    // Minimal rocks in the Glacial Rift
    placeResource('rock', 10, [1, 2], GLACIAL_RIFT_START_X, WORLD_WIDTH);
    generateGlacialRift();
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
    spawnFrostWraiths(5);
    spawnIceMaulers(3);
    spawnCryoShamans(2);

    // Spawn the forest boss: the Big Zombie.
    let bossPos;
    do {
        bossPos = getFreePosition();
    } while (bossPos.x > OLD_WORLD_WIDTH);
    zombies.push(createZombie(bossPos.x, bossPos.y, null, 'attack', 'big'));

    // Spawn the Glacier Titan in the centre of the Glacial Rift.
    const titanX = GLACIAL_RIFT_START_X + (GLACIAL_RIFT_END_X - GLACIAL_RIFT_START_X) / 2;
    const titanY = WORLD_HEIGHT / 2;
    glacierTitan = createGlacierTitan(titanX, titanY);
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

function getSpawnPositionAround(x, y, radius, minDist = 0) {
    let nx, ny, dist;
    do {
        const angle = Math.random() * Math.PI * 2;
        dist = minDist + Math.random() * (radius - minDist);
        nx = x + Math.cos(angle) * dist;
        ny = y + Math.sin(angle) * dist;
    } while (isBlocked(nx, ny, 20) || collidesWithEntities(nx, ny, 20));
    return { x: nx, y: ny };
}

function spawnBoars(count) {
    for (let i = 0; i < count; i++) {
        const { x, y } = getFreePosition();
        boars.push(createBoar(x, y));
    }
}

function getFreeRiftPosition() {
    let pos;
    do {
        const x = GLACIAL_RIFT_START_X + Math.random() * (GLACIAL_RIFT_END_X - GLACIAL_RIFT_START_X);
        const y = Math.random() * WORLD_HEIGHT;
        pos = { x, y };
    } while (isBlocked(pos.x, pos.y, 20));
    return pos;
}

function createFrostWraith(x, y) {
    return {
        id: nextFrostWraithId++,
        x,
        y,
        hp: 15,
        maxHp: 15,
        size: 15,
        baseSpeed: 1.5,
        speed: 1.5,
        vx: 0,
        vy: 0,
        slow: 0,
        bind: 0
    };
}

function spawnFrostWraiths(count) {
    for (let i = 0; i < count; i++) {
        const { x, y } = getFreeRiftPosition();
        frostWraiths.push(createFrostWraith(x, y));
    }
}

function createIceMauler(x, y) {
    return {
        id: nextIceMaulerId++,
        x,
        y,
        hp: 80,
        maxHp: 80,
        size: 30,
        baseSpeed: 1,
        speed: 1,
        vx: 0,
        vy: 0,
        cooldown: 0,
        slow: 0,
        bind: 0
    };
}

function spawnIceMaulers(count) {
    for (let i = 0; i < count; i++) {
        const { x, y } = getFreeRiftPosition();
        iceMaulers.push(createIceMauler(x, y));
    }
}

function createCryoShaman(x, y) {
    return {
        id: nextCryoShamanId++,
        x,
        y,
        hp: 60,
        maxHp: 60,
        size: 25,
        baseSpeed: 0.4,
        speed: 0.4,
        vx: 0,
        vy: 0,
        slow: 0,
        bind: 0,
        healCooldown: 0,
        pillarCooldown: 0
    };
}

function spawnCryoShamans(count) {
    for (let i = 0; i < count; i++) {
        const { x, y } = getFreeRiftPosition();
        cryoShamans.push(createCryoShaman(x, y));
    }
}

function createGlacierTitan(x, y) {
    return {
        id: nextTitanId++,
        x,
        y,
        hp: 2000,
        maxHp: 2000,
        size: 100,
        baseSpeed: 0.5,
        speed: 0.5,
        phase: 1,
        shardCooldown: 0,
        stompCooldown: 0,
        wraithCooldown: 0,
        shield: false,
        shieldHp: 0,
        vx: 0,
        vy: 0
    };
}

function generateGlacialRift() {
    for (let x = GLACIAL_RIFT_START_X; x < GLACIAL_RIFT_END_X; x += GRID_CELL_SIZE) {
        for (let y = 0; y < WORLD_HEIGHT; y += GRID_CELL_SIZE) {
            if (Math.random() < 0.15) {
                const gridX = Math.floor(x / GRID_CELL_SIZE);
                const gridY = Math.floor(y / GRID_CELL_SIZE);
                const key = `i${gridX},${gridY}`;
                structures[key] = { type: 'ice_wall', x: gridX * GRID_CELL_SIZE, y: gridY * GRID_CELL_SIZE, size: GRID_CELL_SIZE };
                markArea(gridX, gridY, 1, true);
            }
        }
    }
}

function createZombie(x, y, ownerId = null, minionType = 'attack', kindOverride = null, bossId = null) {
    const stats = {
        attack: { speed: 1.2, damage: 2 },
        healer: { speed: 1, damage: 0 },
        ranged: { speed: 1, damage: 2 }
    }[minionType] || { speed: 1.2, damage: 2 };

    const isBig = kindOverride === 'big';
    const size = isBig ? 35 : 20;
    const hp = isBig ? 120 : (ownerId ? 5 : 20);
    const baseSpeed = isBig ? 0.8 : stats.speed;
    const damage = isBig ? 4 : stats.damage;

    // Different minion roles manifest as different creature types when
    // summoned by a player. Wild zombies remain the default unless overridden.
    const kind = kindOverride || (ownerId
        ? ({ attack: 'zombie', healer: 'spirit', ranged: 'skeleton' }[minionType] || 'zombie')
        : 'zombie');

    return {
        id: nextZombieId++,
        x,
        y,
        homeX: x,
        homeY: y,
        hp,
        maxHp: hp,
        size,
        baseSpeed,
        speed: baseSpeed,
        damage,
        aggressive: false,
        target: null,
        cooldown: 0,
        giveUpTimer: 0,
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        angle: bossId ? Math.random() * Math.PI * 2 : 0,
        burn: 0,
        sunTimer: 0,
        slow: 0,
        bind: 0,
        ownerId,
        minionType,
        kind,
        commanded: false,
        bossId,
        isBigZombie: isBig,
        spawnCooldown: 0
    };
}

function spawnZombies(count) {
    for (let i = 0; i < count; i++) {
        const { x, y } = getFreePosition();
        zombies.push(createZombie(x, y));
    }
}

function createOgre(x, y, isBoss = false) {
    const size = isBoss ? 80 : 40;
    const hp = isBoss ? 1000 : 150;
    return {
        id: nextOgreId++,
        x,
        y,
        hp,
        maxHp: hp,
        size,
        baseSpeed: isBoss ? 0.4 : 0.6,
        speed: isBoss ? 0.4 : 0.6,
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
        isBoss
    };
}

function spawnOgres(count) {
    // Spawn the rock golem boss in the centre of the new eastern area.
    for (let i = 0; i < count; i++) {
        const x = OLD_WORLD_WIDTH + OLD_WORLD_WIDTH / 2;
        const y = WORLD_HEIGHT / 2;
        ogres.push(createOgre(x, y, true));
    }
}

function updateGlacierTitan() {
    if (!glacierTitan) return;
    const t = glacierTitan;
    if (t.hp <= 0) {
        glacierTitan = null;
        return;
    }
    if (t.phase === 1 && t.hp <= t.maxHp * 0.66) {
        t.phase = 2;
        t.shield = true;
        t.shieldHp = 200;
    }
    if (t.phase === 2 && t.hp <= t.maxHp * 0.33) {
        t.phase = 3;
        t.shield = false;
    }
    const nearest = getNearestPlayer(t);
    if (nearest) {
        const target = nearest.player;
        if (t.phase === 1) {
            if (t.shardCooldown <= 0) {
                const angle = Math.atan2(target.y - t.y, target.x - t.x);
                const speed = 4;
                projectiles.push({ id: nextProjectileId++, x: t.x, y: t.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: null, type: 'arrow' });
                t.shardCooldown = 90;
            } else t.shardCooldown--;
            if (t.stompCooldown <= 0) {
                for (const id in players) {
                    const p = players[id];
                    if (!p.active) continue;
                    const dist = getDistance(p, t);
                    if (dist < 300) {
                        const ang = Math.atan2(p.y - t.y, p.x - t.x);
                        p.x += Math.cos(ang) * 100;
                        p.y += Math.sin(ang) * 100;
                    }
                }
                t.stompCooldown = 180;
            } else t.stompCooldown--;
        } else if (t.phase === 2) {
            if (t.wraithCooldown <= 0) {
                spawnFrostWraiths(2);
                t.wraithCooldown = 300;
            } else t.wraithCooldown--;
        } else if (t.phase === 3) {
            moveToward(t, target);
        }
    }
    t.x = Math.max(GLACIAL_RIFT_START_X, Math.min(GLACIAL_RIFT_END_X, t.x + t.vx));
    t.y = Math.max(0, Math.min(WORLD_HEIGHT, t.y + t.vy));
    t.vx = 0;
    t.vy = 0;
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
function getNearestPlayer(entity) {
    let nearest = null;
    let dist = Infinity;
    for (const [id, p] of Object.entries(players)) {
        if (!p.active) continue;
        const d = getDistance(entity, p);
        if (d < dist) { dist = d; nearest = { id, player: p }; }
    }
    return nearest;
}
function findNearestTarget(src) {
    let nearest = null;
    let dist = Infinity;
    const dir = src.dir;
    function consider(obj, type, id) {
        if (dir) {
            const toX = obj.x - src.x;
            const toY = obj.y - src.y;
            if (toX * dir.x + toY * dir.y <= 0) return;
        }
        const d = getDistance(src, obj);
        if (d < dist) { dist = d; nearest = { type, id }; }
    }
    for (const [id, p] of Object.entries(players)) {
        if (id !== src.id && p.active) consider(p, 'player', id);
    }
    for (const boar of boars) consider(boar, 'boar', boar.id);
    for (const zombie of zombies) consider(zombie, 'zombie', zombie.id);
    for (const ogre of ogres) consider(ogre, 'ogre', ogre.id);
    for (const wraith of frostWraiths) consider(wraith, 'wraith', wraith.id);
    for (const mauler of iceMaulers) consider(mauler, 'mauler', mauler.id);
    for (const shaman of cryoShamans) consider(shaman, 'shaman', shaman.id);
    if (glacierTitan) consider(glacierTitan, 'titan', glacierTitan.id);
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
            let tdmg = dmg;
            let tknock = knock;
            if (target.class === 'guardian') { tdmg = Math.max(0, tdmg - 1); tknock *= 0.5; }
            if (target.fortify && target.fortify > 0) { tdmg = Math.max(0, tdmg - 2); tknock *= 0.5; }
            target.hp = Math.max(0, target.hp - tdmg);
            target.x += Math.cos(angle) * tknock;
            target.y += Math.sin(angle) * tknock;
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
                if (ogre.isBoss) groundItems.push({ id: nextItemId++, item: 'Mace', quantity: 1, x: ogre.x, y: ogre.y });
                else groundItems.push({ id: nextItemId++, item: 'Stone', quantity: 10, x: ogre.x, y: ogre.y });
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
    for (const wraith of frostWraiths) {
        if (getDistance(player, wraith) < player.size + wraith.size) {
            wraith.hp = Math.max(0, wraith.hp - dmg);
            wraith.x += Math.cos(angle) * knock;
            wraith.y += Math.sin(angle) * knock;
            broadcast({ type: 'wraith-update', wraith });
        }
    }
    for (const mauler of iceMaulers) {
        if (getDistance(player, mauler) < player.size + mauler.size) {
            mauler.hp = Math.max(0, mauler.hp - dmg);
            mauler.x += Math.cos(angle) * knock;
            mauler.y += Math.sin(angle) * knock;
            broadcast({ type: 'mauler-update', mauler });
        }
    }
    for (const shaman of cryoShamans) {
        if (getDistance(player, shaman) < player.size + shaman.size) {
            shaman.hp = Math.max(0, shaman.hp - dmg);
            shaman.x += Math.cos(angle) * knock;
            shaman.y += Math.sin(angle) * knock;
            broadcast({ type: 'shaman-update', shaman });
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
            let tdmg = dmg;
            let tknock = knock;
            if (target.class === 'guardian') { tdmg = Math.max(0, tdmg - 1); tknock *= 0.5; }
            if (target.fortify && target.fortify > 0) { tdmg = Math.max(0, tdmg - 2); tknock *= 0.5; }
            target.hp = Math.max(0, target.hp - tdmg);
            const angle = Math.atan2(target.y - player.y, target.x - player.x);
            target.x += Math.cos(angle) * tknock;
            target.y += Math.sin(angle) * tknock;
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
                    if (obj.isBoss) groundItems.push({ id: nextItemId++, item: 'Mace', quantity: 1, x: obj.x, y: obj.y });
                    else groundItems.push({ id: nextItemId++, item: 'Stone', quantity: 10, x: obj.x, y: obj.y });
                    arr.splice(i, 1);
                    const c = [...wss.clients].find(cl => cl.id === playerId);
                    if (c) levelUp(player, c);
                } else {
                    obj.aggressive = true;
                    obj.target = { type: 'player', id: playerId };
                }
                const updateType =
                    type === 'boar'
                        ? 'boar-update'
                        : type === 'zombie'
                        ? 'zombie-update'
                        : type === 'ogre'
                        ? 'ogre-update'
                        : type === 'wraith'
                        ? 'wraith-update'
                        : type === 'mauler'
                        ? 'mauler-update'
                        : 'shaman-update';
                const payloadKey =
                    type === 'boar'
                        ? 'boar'
                        : type === 'zombie'
                        ? 'zombie'
                        : type === 'ogre'
                        ? 'ogre'
                        : type === 'wraith'
                        ? 'wraith'
                        : type === 'mauler'
                        ? 'mauler'
                        : 'shaman';
                broadcast({ type: updateType, [payloadKey]: obj });
            }
        }
    };
    process(boars, 'boar');
    process(zombies, 'zombie');
    process(ogres, 'ogre');
    process(frostWraiths, 'wraith');
    process(iceMaulers, 'mauler');
    process(cryoShamans, 'shaman');
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
        if (name === 'mace') return 6;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    } else if (target === 'zombie') {
        if (name === 'wooden sword') return 4;
        if (name === 'stone sword') return 6;
        if (name === 'tusk') return 7;
        if (name === 'mace') return 6;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    } else if (target === 'player') {
        if (name === 'wooden sword') return 4;
        if (name === 'stone sword') return 6;
        if (name === 'tusk') return 7;
        if (name === 'mace') return 6;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    } else if (target === 'ogre') {
        if (name === 'wooden sword') return 3;
        if (name === 'stone sword') return 5;
        if (name === 'tusk') return 6;
        if (name === 'mace') return 7;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    } else if (target === 'titan') {
        if (name === 'wooden sword') return 2;
        if (name === 'stone sword') return 4;
        if (name === 'tusk') return 5;
        if (name === 'mace') return 6;
        if (name.includes('axe') || name.includes('pickaxe')) return 1;
    } else if (target === 'wraith') {
        if (name === 'wooden sword') return 3;
        if (name === 'stone sword') return 5;
        if (name === 'tusk') return 6;
        if (name === 'mace') return 6;
        if (name.includes('axe') || name.includes('pickaxe')) return 1;
    } else if (target === 'mauler') {
        if (name === 'wooden sword') return 3;
        if (name === 'stone sword') return 5;
        if (name === 'tusk') return 6;
        if (name === 'mace') return 7;
        if (name.includes('axe') || name.includes('pickaxe')) return 2;
    } else if (target === 'shaman') {
        if (name === 'wooden sword') return 2;
        if (name === 'stone sword') return 4;
        if (name === 'tusk') return 5;
        if (name === 'mace') return 6;
        if (name.includes('axe') || name.includes('pickaxe')) return 1;
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
    for (const o of ogres) {
        if (o === self) continue;
        if (getDistance({ x, y }, o) < size / 2 + o.size / 2) return true;
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

function moveTowardNoClip(entity, target) {
    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) {
        entity.vx = 0;
        entity.vy = 0;
        return;
    }
    entity.vx = (dx / dist) * entity.speed;
    entity.vy = (dy / dist) * entity.speed;
}

function moveAway(entity, target) {
    const dx = entity.x - target.x;
    const dy = entity.y - target.y;
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

function commandPlayerMinions(ownerId, targetType, targetId) {
    for (const z of zombies) {
        if (z.ownerId === ownerId) {
            z.aggressive = true;
            z.target = { type: targetType, id: targetId };
            z.commanded = true;
        }
    }
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
        outlineColor: '#333',
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
        summonerSkills: {
            attack: 0,
            healer: 0,
            ranged: 0,
            'summoner-ranged-stop': false,
            'summoner-ranged-flee': false,
            'summoner-lockon': false
        },
        shieldWall: 0,
        tauntCooldown: 0,
        fortify: 0,
        mageSkills: {},
        rogueSkills: {},
        canSlow: false,
        canBind: false,
        canMissile: false,
        canFlame: false,
        canBomb: false,
        canSmoke: false,
        canTeleport: false,
        stickyBomb: false,
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
        type: 'init',
        playerId,
        players: getActivePlayers(),
        myPlayerData: newPlayer,
        resources,
        structures,
        boars,
        zombies,
        ogres,
        frostWraiths,
        iceMaulers,
        cryoShamans,
        titan: glacierTitan,
        groundItems,
        projectiles,
        dayNight,
        riftBlizzard
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
                if (!isBlocked(nx, ny, player.size) && !collidesWithEntities(nx, ny, player.size, player)) {
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
                if (typeof data.outlineColor === 'string') player.outlineColor = data.outlineColor;
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
                if (['knight', 'mage', 'summoner', 'rogue', 'guardian'].includes(data.class)) {
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
                    } else if (data.class === 'guardian') {
                        player.maxHp = 20;
                        player.hp = 20;
                        player.baseSpeed = 2.5;
                        player.speed = 2.5;
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
                    if (player.summonerSkills && player.summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(playerId, 'player', data.targetId);
                    }
                    const c = [...wss.clients].find(cl => cl.id === data.targetId);
                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                    if (data.item && data.item.toLowerCase() === 'mace') {
                        const angle = Math.atan2(target.y - player.y, target.x - player.x);
                        const knock = 200;
                        target.x += Math.cos(angle) * knock;
                        target.y += Math.sin(angle) * knock;
                    }
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
                    if (player.summonerSkills && player.summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(playerId, 'boar', boar.id);
                    }
                    if (data.item && data.item.toLowerCase() === 'mace') {
                        const angle = Math.atan2(boar.y - player.y, boar.x - player.x);
                        const knock = 200;
                        boar.x += Math.cos(angle) * knock;
                        boar.y += Math.sin(angle) * knock;
                    }
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
                    if (player.summonerSkills && player.summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(playerId, 'zombie', zombie.id);
                    }
                    if (data.item && data.item.toLowerCase() === 'mace') {
                        const angle = Math.atan2(zombie.y - player.y, zombie.x - player.x);
                        const knock = 200;
                        zombie.x += Math.cos(angle) * knock;
                        zombie.y += Math.sin(angle) * knock;
                    }
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
                    if (player.summonerSkills && player.summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(playerId, 'ogre', ogre.id);
                    }
                    if (data.item && data.item.toLowerCase() === 'mace') {
                        const angle = Math.atan2(ogre.y - player.y, ogre.x - player.x);
                        const knock = 200;
                        ogre.x += Math.cos(angle) * knock;
                        ogre.y += Math.sin(angle) * knock;
                    }
                    ogre.aggressive = true;
                    ogre.target = { type: 'player', id: playerId };
                    if (ogre.hp <= 0) {
                        ogres = ogres.filter(o => o.id !== ogre.id);
                        if (ogre.isBoss) groundItems.push({ id: nextItemId++, item: 'Mace', quantity: 1, x: ogre.x, y: ogre.y });
                        else groundItems.push({ id: nextItemId++, item: 'Stone', quantity: 10, x: ogre.x, y: ogre.y });
                        levelUp(player, ws);
                    }
                    broadcast({ type: 'ogre-update', ogre });
                }
                break;
            }
            case 'hit-titan': {
                if (glacierTitan && getDistance(player, glacierTitan) < player.size + glacierTitan.size + 20 + (player.attackRange || 0)) {
                    if (glacierTitan.shield) {
                        glacierTitan.shieldHp -= getDamage(data.item, 'titan');
                        if (glacierTitan.shieldHp <= 0) glacierTitan.shield = false;
                    } else {
                        let dmg = getDamage(data.item, 'titan');
                        if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                            dmg += player.swordDamage || 0;
                        }
                        glacierTitan.hp -= dmg;
                        if (glacierTitan.hp <= 0) {
                            groundItems.push({ id: nextItemId++, item: 'Stone', quantity: 100, x: glacierTitan.x, y: glacierTitan.y });
                            glacierTitan = null;
                            levelUp(player, ws);
                        }
                    }
                    broadcast({ type: 'titan-update', titan: glacierTitan });
                }
                break;
            }
            case 'hit-wraith': {
                const wraith = frostWraiths.find(w => w.id === data.wraithId);
                if (wraith && getDistance(player, wraith) < player.size + wraith.size + 20 + (player.attackRange || 0)) {
                    let dmg = getDamage(data.item, 'wraith');
                    if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                        dmg += player.swordDamage || 0;
                    }
                    wraith.hp -= dmg;
                    if (wraith.hp <= 0) {
                        frostWraiths = frostWraiths.filter(w => w.id !== wraith.id);
                        levelUp(player, ws);
                    }
                    broadcast({ type: 'wraith-update', wraith });
                }
                break;
            }
            case 'hit-mauler': {
                const mauler = iceMaulers.find(m => m.id === data.maulerId);
                if (mauler && getDistance(player, mauler) < player.size + mauler.size + 20 + (player.attackRange || 0)) {
                    let dmg = getDamage(data.item, 'mauler');
                    if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                        dmg += player.swordDamage || 0;
                    }
                    mauler.hp -= dmg;
                    if (mauler.hp <= 0) {
                        iceMaulers = iceMaulers.filter(m => m.id !== mauler.id);
                        levelUp(player, ws);
                    }
                    broadcast({ type: 'mauler-update', mauler });
                }
                break;
            }
            case 'hit-shaman': {
                const shaman = cryoShamans.find(s => s.id === data.shamanId);
                if (shaman && getDistance(player, shaman) < player.size + shaman.size + 20 + (player.attackRange || 0)) {
                    let dmg = getDamage(data.item, 'shaman');
                    if (player.class === 'knight' && data.item && data.item.toLowerCase().includes('sword')) {
                        dmg += player.swordDamage || 0;
                    }
                    shaman.hp -= dmg;
                    if (shaman.hp <= 0) {
                        cryoShamans = cryoShamans.filter(s => s.id !== shaman.id);
                        levelUp(player, ws);
                    }
                    broadcast({ type: 'shaman-update', shaman });
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
                    } else if (['mage', 'knight', 'summoner', 'rogue', 'guardian'].includes(skill) && player.skills.range && !player.class) {
                        player.skillPoints--;
                        player.skills[skill] = true;
                        player.class = skill;
                    } else if (player.class === 'knight' && ['knight-damage', 'knight-speed', 'knight-health', 'knight-shield', 'knight-whirlwind', 'knight-attack-range'].includes(skill)) {
                        if (!player.knightSkills) player.knightSkills = {};
                        if (!player.knightSkills[skill]) {
                            // prerequisite checks
                            if (skill === 'knight-shield' && !player.knightSkills['knight-speed']) break;
                            if (skill === 'knight-whirlwind' && !player.knightSkills['knight-damage']) break;
                            if (skill === 'knight-attack-range' && !player.knightSkills['knight-whirlwind']) break;
                            player.skillPoints--;
                            player.knightSkills[skill] = true;
                            if (skill === 'knight-damage') player.swordDamage += 2;
                            else if (skill === 'knight-speed') { player.baseSpeed += 0.5; player.speed += 0.5; }
                            else if (skill === 'knight-health') { player.maxHp += 5; player.hp += 5; }
                            else if (skill === 'knight-attack-range') { player.attackRange = (player.attackRange || 20) * 2; }
                        }
                    } else if (player.class === 'summoner' && ['summoner-attack', 'summoner-healer', 'summoner-ranged', 'summoner-ranged-stop', 'summoner-ranged-flee', 'summoner-lockon'].includes(skill)) {
                        if (!player.summonerSkills) {
                            player.summonerSkills = {
                                attack: 0,
                                healer: 0,
                                ranged: 0,
                                'summoner-ranged-stop': false,
                                'summoner-ranged-flee': false,
                                'summoner-lockon': false
                            };
                        }
                        if (skill === 'summoner-attack') {
                            player.skillPoints--;
                            player.summonerSkills.attack++;
                        } else if (skill === 'summoner-healer') {
                            player.skillPoints--;
                            player.summonerSkills.healer++;
                        } else if (skill === 'summoner-ranged') {
                            player.skillPoints--;
                            player.summonerSkills.ranged++;
                        } else if (skill === 'summoner-ranged-stop') {
                            if (!player.summonerSkills['summoner-ranged-stop'] && player.summonerSkills.ranged > 0) {
                                player.skillPoints--;
                                player.summonerSkills['summoner-ranged-stop'] = true;
                            }
                        } else if (skill === 'summoner-ranged-flee') {
                            if (!player.summonerSkills['summoner-ranged-flee'] && player.summonerSkills['summoner-ranged-stop']) {
                                player.skillPoints--;
                                player.summonerSkills['summoner-ranged-flee'] = true;
                            }
                        } else if (skill === 'summoner-lockon') {
                            if (!player.summonerSkills['summoner-lockon']) {
                                player.skillPoints--;
                                player.summonerSkills['summoner-lockon'] = true;
                            }
                        }
                    } else if (player.class === 'mage' && ['mage-mana', 'mage-regen', 'mage-flame', 'mage-slow', 'mage-slow-extend', 'mage-bind', 'mage-missile', 'mage-missile-upgrade'].includes(skill)) {
                        if (!player.mageSkills) player.mageSkills = {};
                        if (!player.mageSkills[skill]) {
                            if (skill === 'mage-slow-extend' && !player.mageSkills['mage-slow']) break;
                            if (skill === 'mage-bind' && !player.mageSkills['mage-slow-extend']) break;
                            if (skill === 'mage-missile' && !player.mageSkills['mage-mana']) break;
                            if (skill === 'mage-missile-upgrade' && !player.mageSkills['mage-missile']) break;
                            if (skill === 'mage-flame' && !player.mageSkills['mage-regen']) break;
                            player.skillPoints--;
                            player.mageSkills[skill] = true;
                            if (skill === 'mage-mana') {
                                player.maxMana += 20; player.mana += 20;
                            } else if (skill === 'mage-regen') {
                                player.manaRegen += 0.5 / 60;
                            } else if (skill === 'mage-flame') {
                                player.canFlame = true;
                            } else if (skill === 'mage-slow') {
                                player.canSlow = true;
                            } else if (skill === 'mage-slow-extend') {
                                player.slowDuration = 600;
                            } else if (skill === 'mage-bind') {
                                player.canBind = true;
                            } else if (skill === 'mage-missile') {
                                player.canMissile = true;
                            } else if (skill === 'mage-missile-upgrade') {
                                player.missileUpgrade = true;
                            }
                        }
                    } else if (player.class === 'rogue' && ['rogue-bomb', 'rogue-sticky', 'rogue-smoke', 'rogue-teleport', 'rogue-bow'].includes(skill)) {
                        if (!player.rogueSkills) player.rogueSkills = {};
                        if (!player.rogueSkills[skill]) {
                            if ((skill === 'rogue-smoke' || skill === 'rogue-sticky') && !player.rogueSkills['rogue-bomb']) break;
                            player.skillPoints--;
                            player.rogueSkills[skill] = true;
                            if (skill === 'rogue-bomb') player.canBomb = true;
                            else if (skill === 'rogue-smoke') player.canSmoke = true;
                            else if (skill === 'rogue-teleport') player.canTeleport = true;
                            else if (skill === 'rogue-sticky') player.stickyBomb = true;
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
                    const { targetX, targetY } = data;
                    if (typeof targetX === 'number' && typeof targetY === 'number') {
                        const angle = Math.atan2(targetY - player.y, targetX - player.x);
                        const speed = 2;
                        const spawnDist = player.size + 20;
                        const angles = player.missileUpgrade ? [angle - 0.1, angle + 0.1] : [angle];
                        for (const a of angles) {
                            const sx = player.x + Math.cos(a) * spawnDist;
                            const sy = player.y + Math.sin(a) * spawnDist;
                            projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, owner: playerId, type: 'missile', lockTimer: 15 });
                        }
                    }
                }
                break;
            }
            case 'cast-flame': {
                if (player.class === 'mage' && player.canFlame && player.mana >= 10) {
                    player.mana -= 10;
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
                            type: 'flame',
                            timer: 120,
                            radius: 60,
                        });
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
            case 'guardian-shield-wall': {
                if (player.class === 'guardian' && (!player.shieldWall || player.shieldWall <= 0)) {
                    player.shieldWall = 180;
                }
                break;
            }
            case 'guardian-taunt': {
                if (player.class === 'guardian' && (!player.tauntCooldown || player.tauntCooldown <= 0)) {
                    const radius = 200;
                    for (const b of boars) {
                        if (getDistance(player, b) < radius) {
                            b.aggressive = true;
                            b.target = { type: 'player', id: playerId };
                            b.giveUpTimer = 600;
                        }
                    }
                    for (const z of zombies) {
                        if (getDistance(player, z) < radius) {
                            z.aggressive = true;
                            z.target = { type: 'player', id: playerId };
                            z.giveUpTimer = 600;
                        }
                    }
                    for (const o of ogres) {
                        if (getDistance(player, o) < radius) {
                            o.aggressive = true;
                            o.target = { type: 'player', id: playerId };
                        }
                    }
                    player.tauntCooldown = 300;
                }
                break;
            }
            case 'guardian-fortify': {
                if (player.class === 'guardian') {
                    player.fortify = 180;
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
                            sticky: player.stickyBomb,
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
                            radius: 120,
                            age: 0,
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
                        const baseX = gridX * GRID_CELL_SIZE;
                        const baseY = gridY * GRID_CELL_SIZE;
                        const center = { x: baseX + GRID_CELL_SIZE / 2, y: baseY + GRID_CELL_SIZE / 2 };
                        if (getDistance(player, center) < player.size + GRID_CELL_SIZE / 2) break;
                        hotbarSlot.quantity--;
                        if (hotbarSlot.quantity <= 0) player.hotbar[data.hotbarIndex] = null;
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
                        const center = { x: blockX * BLOCK_SIZE + BLOCK_SIZE / 2, y: blockY * BLOCK_SIZE + BLOCK_SIZE / 2 };
                        if (getDistance(player, center) < player.size + BLOCK_SIZE / 2) break;
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
                    if (structure.type === 'wood_wall' || structure.type === 'stone_wall' || structure.type === 'ice_wall' || structure.type === 'furnace') {
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
            dayNight.dayCount++;
            dayNight.isBloodNight = false;
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
        } else {
            dayNight.isBloodNight = true;
            if (dayNight.isBloodNight) {
                const boss = ogres.find(o => o.isBoss);
                if (boss) groundItems.push({ id: nextItemId++, item: 'Stone', quantity: 50, x: boss.x, y: boss.y });
                for (const b of boars) {
                    const n = getNearestPlayer(b);
                    if (n) { b.aggressive = true; b.target = { type: 'player', id: n.id }; }
                }
                for (const z of zombies) {
                    if (z.isBigZombie) continue;
                    const n = getNearestPlayer(z);
                    if (n) { z.aggressive = true; z.target = { type: 'player', id: n.id }; }
                }
                for (const o of ogres) {
                    if (o.isBoss) continue;
                    const n = getNearestPlayer(o);
                    if (n) { o.aggressive = true; o.target = { type: 'player', id: n.id }; }
                }
            }
            if (zombies.length < 10) {
                spawnZombies(5);
            }
        }
    }

    if (frostWraiths.length < 6) {
        spawnFrostWraiths(2);
    }
    if (iceMaulers.length < 4) {
        spawnIceMaulers(1);
    }
    if (cryoShamans.length < 3) {
        spawnCryoShamans(1);
    }
    riftBlizzard.timer -= 1000 / 60;
    if (riftBlizzard.timer <= 0) {
        riftBlizzard.active = !riftBlizzard.active;
        riftBlizzard.timer = riftBlizzard.active ? BLIZZARD_DURATION : BLIZZARD_INTERVAL;
    }

    for (const proj of projectiles) {
        if (proj.type === 'bomb' || proj.type === 'smoke' || proj.type === 'flame') {
            proj.timer--;
            if (proj.stuckTo) {
                if (proj.stuckTo.hp <= 0) {
                    proj.stuckTo = null;
                } else {
                    proj.x = proj.stuckTo.x;
                    proj.y = proj.stuckTo.y;
                }
            } else {
                proj.x += proj.vx;
                proj.y += proj.vy;
            }
            proj.age = (proj.age || 0) + 1;
            if (proj.type === 'smoke' && proj.age > 120) {
                proj.vx *= 0.9;
                proj.vy *= 0.9;
                if (Math.hypot(proj.vx, proj.vy) < 0.1) { proj.vx = 0; proj.vy = 0; }
            }

            if (!proj.stuckTo) {
                // Bounce off world bounds
                if (proj.x < 0 || proj.x > WORLD_WIDTH) {
                    proj.vx *= -1;
                    proj.x = Math.max(0, Math.min(WORLD_WIDTH, proj.x));
                }
                if (proj.y < 0 || proj.y > WORLD_HEIGHT) {
                    proj.vy *= -1;
                    proj.y = Math.max(0, Math.min(WORLD_HEIGHT, proj.y));
                }

                // Bounce off players and mobs or stick if upgraded
                const entities = [];
                for (const id in players) {
                    const p = players[id];
                    if (p.active) entities.push(p);
                }
                entities.push(...boars, ...zombies, ...ogres, ...frostWraiths, ...iceMaulers, ...cryoShamans);
                for (const e of entities) {
                    if (getDistance(e, proj) < e.size) {
                        if (proj.sticky) {
                            proj.stuckTo = e;
                            proj.vx = 0;
                            proj.vy = 0;
                            proj.x = e.x;
                            proj.y = e.y;
                            break;
                        } else {
                            const speed = Math.hypot(proj.vx, proj.vy);
                            const ang = Math.atan2(proj.y - e.y, proj.x - e.x);
                            proj.vx = Math.cos(ang) * speed;
                            proj.vy = Math.sin(ang) * speed;
                            proj.x = e.x + Math.cos(ang) * (e.size + 1);
                            proj.y = e.y + Math.sin(ang) * (e.size + 1);
                        }
                    }
                }
                if (proj.type === 'bomb') {
                    for (const r of resources) {
                        if (r.harvested) continue;
                        if (getDistance(r, proj) < r.size / 2) {
                            const speed = Math.hypot(proj.vx, proj.vy);
                            const ang = Math.atan2(proj.y - r.y, proj.x - r.x);
                            proj.vx = Math.cos(ang) * speed;
                            proj.vy = Math.sin(ang) * speed;
                            const dist = r.size / 2 + 1;
                            proj.x = r.x + Math.cos(ang) * dist;
                            proj.y = r.y + Math.sin(ang) * dist;
                        }
                    }
                }
                for (const key in structures) {
                    const s = structures[key];
                    if (s.type === 'wood_wall' || s.type === 'stone_wall' || s.type === 'ice_wall') {
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
            }

            if (proj.type === 'flame') {
                const radius = proj.radius || 60;
                for (const id in players) {
                    const p = players[id];
                    if (!p.active) continue;
                    if (getDistance(p, proj) < radius) p.burn = 120;
                }
                for (const boar of boars) {
                    if (getDistance(boar, proj) < radius) boar.burn = 120;
                }
                for (const zombie of zombies) {
                    if (getDistance(zombie, proj) < radius) zombie.burn = 120;
                }
                for (const ogre of ogres) {
                    if (getDistance(ogre, proj) < radius) ogre.burn = 120;
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
                            let dmg = damage;
                            if (p.class === 'guardian') dmg = Math.max(0, dmg - 1);
                            if (p.fortify && p.fortify > 0) dmg = Math.max(0, dmg - 2);
                            p.hp = Math.max(0, p.hp - dmg);
                            p.lastHitBy = proj.owner || 'ogre';
                            const c = [...wss.clients].find(cl => cl.id === id);
                            if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                        }
                    }
                    for (const boar of boars) {
                        if (getDistance(boar, proj) < radius) {
                            boar.hp = Math.max(0, boar.hp - damage);
                            boar.aggressive = true;
                            if (boar.hp > 0) {
                                broadcast({ type: 'boar-update', boar });
                            }
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
        if (proj.type === 'missile') {
            if (proj.lockTimer > 0) proj.lockTimer--;
            if (!proj.targetType && proj.lockTimer <= 0) {
                const target = findNearestTarget({ x: proj.x, y: proj.y, id: proj.owner, dir: { x: proj.vx, y: proj.vy } });
                if (target) {
                    proj.targetType = target.type;
                    proj.targetId = target.id;
                }
            }
            if (proj.targetType) {
                let target;
                if (proj.targetType === 'player') target = players[proj.targetId];
                else if (proj.targetType === 'boar') target = boars.find(b => b.id === proj.targetId);
                else if (proj.targetType === 'zombie') target = zombies.find(z => z.id === proj.targetId);
                else if (proj.targetType === 'ogre') target = ogres.find(o => o.id === proj.targetId);
                else if (proj.targetType === 'wraith') target = frostWraiths.find(w => w.id === proj.targetId);
                else if (proj.targetType === 'mauler') target = iceMaulers.find(m => m.id === proj.targetId);
                else if (proj.targetType === 'shaman') target = cryoShamans.find(s => s.id === proj.targetId);
                if (target) {
                    const angle = Math.atan2(target.y - proj.y, target.x - proj.x);
                    const speed = 0.5;
                    proj.vx = Math.cos(angle) * speed;
                    proj.vy = Math.sin(angle) * speed;
                } else {
                    proj.remove = true;
                    continue;
                }
            }
            // Steer around obstacles like trees and rocks
            let avoidX = 0;
            let avoidY = 0;
            const nextX = proj.x + proj.vx;
            const nextY = proj.y + proj.vy;
            for (const r of resources) {
                if (r.harvested) continue;
                const dist = getDistance({ x: nextX, y: nextY }, r);
                if (dist < r.size / 2 + 5) {
                    avoidX += nextX - r.x;
                    avoidY += nextY - r.y;
                }
            }
            if (avoidX !== 0 || avoidY !== 0) {
                const speed = Math.hypot(proj.vx, proj.vy) || 0.0001;
                proj.vx += avoidX * 0.05;
                proj.vy += avoidY * 0.05;
                const mag = Math.hypot(proj.vx, proj.vy) || 1;
                proj.vx = (proj.vx / mag) * speed;
                proj.vy = (proj.vy / mag) * speed;
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
                if (p.shieldWall && p.shieldWall > 0) {
                    hit = true;
                } else if (proj.type === 'slow') {
                    p.slow = proj.duration || 60;
                } else if (proj.type === 'bind') {
                    p.bind = 120;
                } else if (proj.type === 'missile') {
                    if (!p.invulnerable || p.invulnerable <= 0) {
                        let dmg = 4;
                        if (p.class === 'guardian') dmg = Math.max(0, dmg - 1);
                        if (p.fortify && p.fortify > 0) dmg = Math.max(0, dmg - 2);
                        p.hp = Math.max(0, p.hp - dmg);
                        p.lastHitBy = proj.owner || 'ogre';
                        const c = [...wss.clients].find(cl => cl.id === id);
                        if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                        if (p.hp <= 0 && proj.owner && players[proj.owner]) {
                            const killer = players[proj.owner];
                            const kc = [...wss.clients].find(cl => cl.id === proj.owner);
                            levelUp(killer, kc);
                        }
                        if (proj.owner && players[proj.owner] && players[proj.owner].summonerSkills && players[proj.owner].summonerSkills['summoner-lockon']) {
                            commandPlayerMinions(proj.owner, 'player', id);
                        }
                    }
                } else {
                    if (!p.invulnerable || p.invulnerable <= 0) {
                        let dmg = 2;
                        if (p.class === 'guardian') dmg = Math.max(0, dmg - 1);
                        if (p.fortify && p.fortify > 0) dmg = Math.max(0, dmg - 2);
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
                        if (proj.owner && players[proj.owner] && players[proj.owner].summonerSkills && players[proj.owner].summonerSkills['summoner-lockon']) {
                            commandPlayerMinions(proj.owner, 'player', id);
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
                    if (proj.owner && players[proj.owner] && players[proj.owner].summonerSkills && players[proj.owner].summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(proj.owner, 'boar', boar.id);
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
                        broadcast({ type: 'zombie-update', zombie });
                    } else {
                        let dmg = 2;
                        if (proj.type !== 'arrow' && proj.type !== 'minion') zombie.burn = 120;
                        zombie.hp = Math.max(0, zombie.hp - dmg);
                        zombie.aggressive = true;
                        broadcast({ type: 'zombie-update', zombie });
                    }
                    if (proj.owner && players[proj.owner] && players[proj.owner].summonerSkills && players[proj.owner].summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(proj.owner, 'zombie', zombie.id);
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
                    if (proj.owner && players[proj.owner] && players[proj.owner].summonerSkills && players[proj.owner].summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(proj.owner, 'ogre', ogre.id);
                    }
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) {
            for (const wraith of frostWraiths) {
                if (getDistance(wraith, proj) < wraith.size) {
                    if (proj.type === 'slow') {
                        wraith.slow = proj.duration || 60;
                    } else if (proj.type === 'bind') {
                        wraith.bind = 120;
                    } else if (proj.type === 'missile') {
                        let dmg = 4;
                        wraith.hp = Math.max(0, wraith.hp - dmg);
                        broadcast({ type: 'wraith-update', wraith });
                    } else {
                        let dmg = 2;
                        wraith.hp = Math.max(0, wraith.hp - dmg);
                        broadcast({ type: 'wraith-update', wraith });
                    }
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) {
            for (const mauler of iceMaulers) {
                if (getDistance(mauler, proj) < mauler.size) {
                    if (proj.type === 'slow') {
                        mauler.slow = proj.duration || 60;
                    } else if (proj.type === 'bind') {
                        mauler.bind = 120;
                    } else if (proj.type === 'missile') {
                        let dmg = 4;
                        mauler.hp = Math.max(0, mauler.hp - dmg);
                        broadcast({ type: 'mauler-update', mauler });
                    } else {
                        let dmg = 2;
                        mauler.hp = Math.max(0, mauler.hp - dmg);
                        broadcast({ type: 'mauler-update', mauler });
                    }
                    if (proj.owner && players[proj.owner] && players[proj.owner].summonerSkills && players[proj.owner].summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(proj.owner, 'mauler', mauler.id);
                    }
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) {
            for (const shaman of cryoShamans) {
                if (getDistance(shaman, proj) < shaman.size) {
                    if (proj.type === 'slow') {
                        shaman.slow = proj.duration || 60;
                    } else if (proj.type === 'bind') {
                        shaman.bind = 120;
                    } else if (proj.type === 'missile') {
                        let dmg = 4;
                        shaman.hp = Math.max(0, shaman.hp - dmg);
                        broadcast({ type: 'shaman-update', shaman });
                    } else {
                        let dmg = 2;
                        shaman.hp = Math.max(0, shaman.hp - dmg);
                        broadcast({ type: 'shaman-update', shaman });
                    }
                    if (proj.owner && players[proj.owner] && players[proj.owner].summonerSkills && players[proj.owner].summonerSkills['summoner-lockon']) {
                        commandPlayerMinions(proj.owner, 'shaman', shaman.id);
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
                if (s.type === 'wood_wall' || s.type === 'stone_wall' || s.type === 'ice_wall') {
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
        if (boar.hp <= 0) {
            boar.vx = 0;
            boar.vy = 0;
            continue;
        }
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
                            let dmg = boar.damage;
                            if (dayNight.isBloodNight) dmg *= 1.5;
                            if (boar.target.type === 'player') {
                                if (target.class === 'guardian') dmg = Math.max(0, dmg - 1);
                                if (target.fortify && target.fortify > 0) dmg = Math.max(0, dmg - 2);
                            }
                            target.hp = Math.max(0, target.hp - dmg);
                            if (boar.target.type === 'player') {
                                target.lastHitBy = 'boar';
                                const c = [...wss.clients].find(cl => cl.id === boar.target.id);
                                if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                            } else {
                                if (target.hp <= 0) {
                                    if (boar.target.type === 'ogre') {
                                        ogres = ogres.filter(o => o.id !== target.id);
                                        if (target.isBoss) groundItems.push({ id: nextItemId++, item: 'Mace', quantity: 1, x: target.x, y: target.y });
                                        else groundItems.push({ id: nextItemId++, item: 'Stone', quantity: 10, x: target.x, y: target.y });
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
        if (dayNight.isDay && !zombie.isBigZombie) {
            zombie.sunTimer = (zombie.sunTimer || 0) + 1;
            if (zombie.sunTimer % 60 === 0) {
                zombie.hp = Math.max(0, zombie.hp - 1);
                broadcast({ type: 'zombie-update', zombie });
            }
        } else {
            zombie.sunTimer = 0;
        }
        if (zombie.burn > 0) {
            if (zombie.burn % 30 === 0) zombie.hp = Math.max(0, zombie.hp - 1);
            zombie.burn--;
        }

        // Tree zombies that guard the Big Zombie.
        if (zombie.bossId) {
            const boss = zombies.find(z => z.id === zombie.bossId && z.isBigZombie);
            if (boss) {
                const distBoss = getDistance(zombie, boss);
                if (distBoss > 80) {
                    moveToward(zombie, boss);
                } else {
                    if (boss.vx === 0 && boss.vy === 0) {
                        zombie.angle += 0.02;
                        const radius = 60;
                        const tx = boss.x + Math.cos(zombie.angle) * radius;
                        const ty = boss.y + Math.sin(zombie.angle) * radius;
                        zombie.speed = zombie.baseSpeed * 0.5;
                        moveToward(zombie, { x: tx, y: ty });
                    } else {
                        zombie.vx = 0; zombie.vy = 0;
                    }
                }
                let targetPlayer = null; let playerDist = Infinity;
                for (const id in players) {
                    const p = players[id];
                    if (!p.active) continue;
                    const d = getDistance(zombie, p);
                    if (d < 300 && d < playerDist) { playerDist = d; targetPlayer = p; }
                }
                if (targetPlayer) {
                    moveToward(zombie, targetPlayer);
                    if (playerDist < (zombie.size + targetPlayer.size) * 3 && zombie.cooldown <= 0) {
                        if (targetPlayer.invulnerable <= 0) {
                            let dmg = zombie.damage;
                            if (dayNight.isBloodNight) dmg *= 1.5;
                            if (targetPlayer.class === 'guardian') dmg = Math.max(0, dmg - 1);
                            if (targetPlayer.fortify && targetPlayer.fortify > 0) dmg = Math.max(0, dmg - 2);
                            targetPlayer.hp = Math.max(0, targetPlayer.hp - dmg);
                            targetPlayer.lastHitBy = 'zombie';
                            const c = [...wss.clients].find(cl => cl.id === targetPlayer.id);
                            if (c) c.send(JSON.stringify({ type: 'player-hit', hp: targetPlayer.hp }));
                        }
                        zombie.cooldown = 60;
                    }
                }
            }
            zombie.wanderTimer--;
            zombie.x = Math.max(0, Math.min(WORLD_WIDTH, zombie.x + zombie.vx));
            zombie.y = Math.max(0, Math.min(WORLD_HEIGHT, zombie.y + zombie.vy));
            continue;
        }

        // Big Zombie boss behaviour.
        if (zombie.isBigZombie) {
            let nearest = null; let min = Infinity;
            for (const id in players) {
                const p = players[id];
                if (!p.active) continue;
                const d = getDistance(zombie, p);
                if (d < min) { min = d; nearest = p; }
            }
            if (nearest && min < 300) {
                const angle = Math.atan2(zombie.y - nearest.y, zombie.x - nearest.x);
                zombie.vx = Math.cos(angle) * zombie.speed;
                zombie.vy = Math.sin(angle) * zombie.speed;
            } else {
                zombie.vx = 0; zombie.vy = 0;
            }
            const minions = zombies.filter(z => z.bossId === zombie.id);
            if (minions.length === 0 && zombie.spawnCooldown <= 0) {
                for (let i = 0; i < 3; i++) {
                    const { x: nx, y: ny } = getSpawnPositionAround(zombie.x, zombie.y, 80, zombie.size + 20);
                    zombies.push(createZombie(nx, ny, null, 'attack', 'tree', zombie.id));
                }
                zombie.spawnCooldown = 600;
            } else if (zombie.spawnCooldown > 0) zombie.spawnCooldown--;
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
            continue;
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
                    const owner = players[zombie.ownerId];
                    const skills = owner ? owner.summonerSkills || {} : {};
                    const range = 200;
                    let moved = false;
                    if (zombie.minionType === 'ranged') {
                        if (skills['summoner-ranged-flee']) {
                            if (dist > range) {
                                moveToward(zombie, target);
                            } else if (dist < range - 40) {
                                moveAway(zombie, target);
                            } else {
                                zombie.vx = 0;
                                zombie.vy = 0;
                            }
                            moved = true;
                        } else if (skills['summoner-ranged-stop']) {
                            if (dist > range) moveToward(zombie, target);
                            else { zombie.vx = 0; zombie.vy = 0; }
                            moved = true;
                        }
                        if (!moved) moveToward(zombie, target);
                        zombie.angle = Math.atan2(zombie.vy, zombie.vx);
                        if (dist < range && zombie.cooldown <= 0) {
                            const angle = Math.atan2(target.y - zombie.y, target.x - zombie.x);
                            const speed = 4;
                            const spawnDist = zombie.size + 5;
                            const sx = zombie.x + Math.cos(angle) * spawnDist;
                            const sy = zombie.y + Math.sin(angle) * spawnDist;
                            projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: zombie.ownerId, type: 'minion' });
                            zombie.cooldown = 60;
                        }
                    } else {
                        moveToward(zombie, target);
                        zombie.angle = Math.atan2(zombie.vy, zombie.vx);
                        if (dist < zombie.size + target.size && zombie.cooldown <= 0) {
                            if (zombie.target.type !== 'player' || target.invulnerable <= 0) {
                                let dmg = zombie.damage;
                                if (dayNight.isBloodNight && zombie.target.type === 'player') dmg *= 1.5;
                                if (zombie.target.type === 'player') {
                                    if (target.class === 'guardian') dmg = Math.max(0, dmg - 1);
                                    if (target.fortify && target.fortify > 0) dmg = Math.max(0, dmg - 2);
                                }
                                target.hp = Math.max(0, target.hp - dmg);
                                if (zombie.target.type === 'player') {
                                    target.lastHitBy = 'zombie';
                                    const c = [...wss.clients].find(cl => cl.id === zombie.target.id);
                                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                                } else {
                                    if (target.hp <= 0 && zombie.target.type === 'ogre') {
                                        ogres = ogres.filter(o => o.id !== target.id);
                                        if (target.isBoss) groundItems.push({ id: nextItemId++, item: 'Mace', quantity: 1, x: target.x, y: target.y });
                                        else groundItems.push({ id: nextItemId++, item: 'Stone', quantity: 10, x: target.x, y: target.y });
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
                const smashTargets = [];
                for (const id in players) {
                    const p = players[id];
                    if (!p.active) continue;
                    smashTargets.push({ entity: p, type: 'player', id });
                }
                for (const z of zombies) {
                    if (z.ownerId) smashTargets.push({ entity: z, type: 'zombie', id: z.id });
                }
                for (const t of smashTargets) {
                    const p = t.entity;
                    if (side === 'right' && p.x < ogre.x) continue;
                    if (side === 'left' && p.x > ogre.x) continue;
                    if (getDistance(p, ogre) < radius) {
                        const angle = Math.atan2(p.y - ogre.y, p.x - ogre.x);
                        const knock = 50;
                        let tknock = knock;
                        let dmg = 10;
                        if (dayNight.isBloodNight && !ogre.isBoss) dmg *= 1.5;
                        if (t.type === 'player') {
                            if (p.class === 'guardian') { dmg = Math.max(0, dmg - 1); tknock *= 0.5; }
                            if (p.fortify && p.fortify > 0) { dmg = Math.max(0, dmg - 2); tknock *= 0.5; }
                        }
                        p.x += Math.cos(angle) * tknock;
                        p.y += Math.sin(angle) * tknock;
                        p.hp = Math.max(0, p.hp - dmg);
                        if (t.type === 'player') {
                            p.lastHitBy = 'ogre';
                            const c = [...wss.clients].find(cl => cl.id === t.id);
                            if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                        } else {
                            p.aggressive = true;
                            p.target = { type: 'ogre', id: ogre.id };
                            broadcast({ type: 'zombie-update', zombie: p });
                        }
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
        for (const z of zombies) {
            if (!z.ownerId) continue;
            const d = getDistance(z, ogre);
            if (d < minDist) {
                minDist = d;
                targetData = { entity: z, type: 'zombie', id: z.id };
            }
        }
        if (targetData) {
            ogre.target = { type: targetData.type, id: targetData.id };
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
    for (const wraith of frostWraiths) {
        if (wraith.bind > 0) { wraith.bind--; wraith.speed = 0; }
        else if (wraith.slow > 0) { wraith.slow--; wraith.speed = wraith.baseSpeed * 0.5; }
        else wraith.speed = wraith.baseSpeed;
        const target = getNearestPlayer(wraith);
        if (target) {
            moveTowardNoClip(wraith, target);
            const dist = getDistance(wraith, target);
            if (dist < wraith.size + target.size) {
                if (target.slow > 0) target.bind = 120;
                else target.slow = 60;
                target.lastHitBy = 'wraith';
            }
        } else {
            wraith.vx = 0;
            wraith.vy = 0;
        }
        wraith.x = Math.max(GLACIAL_RIFT_START_X, Math.min(GLACIAL_RIFT_END_X, wraith.x + wraith.vx));
        wraith.y = Math.max(0, Math.min(WORLD_HEIGHT, wraith.y + wraith.vy));
    }
    frostWraiths = frostWraiths.filter(w => w.hp > 0);
    for (const mauler of iceMaulers) {
        if (mauler.bind > 0) { mauler.bind--; mauler.speed = 0; }
        else if (mauler.slow > 0) { mauler.slow--; mauler.speed = mauler.baseSpeed * 0.5; }
        else mauler.speed = mauler.baseSpeed;
        if (mauler.cooldown > 0) mauler.cooldown--;
        const target = getNearestPlayer(mauler);
        if (target) {
            moveToward(mauler, target);
            const dist = getDistance(mauler, target);
            if (dist < mauler.size + target.size && mauler.cooldown <= 0) {
                let dmg = 4;
                target.hp = Math.max(0, target.hp - dmg);
                target.bind = 60;
                target.fortify = 0;
                target.lastHitBy = 'mauler';
                const c = [...wss.clients].find(cl => cl.id === target.id);
                if (c) c.send(JSON.stringify({ type: 'player-hit', hp: target.hp }));
                mauler.cooldown = 90;
            }
        } else {
            mauler.vx = 0;
            mauler.vy = 0;
        }
        mauler.x = Math.max(GLACIAL_RIFT_START_X, Math.min(GLACIAL_RIFT_END_X, mauler.x + mauler.vx));
        mauler.y = Math.max(0, Math.min(WORLD_HEIGHT, mauler.y + mauler.vy));
    }
    iceMaulers = iceMaulers.filter(m => m.hp > 0);
    for (const shaman of cryoShamans) {
        if (shaman.bind > 0) { shaman.bind--; shaman.speed = 0; }
        else if (shaman.slow > 0) { shaman.slow--; shaman.speed = shaman.baseSpeed * 0.5; }
        else shaman.speed = shaman.baseSpeed;
        if (shaman.healCooldown > 0) shaman.healCooldown--;
        if (shaman.pillarCooldown > 0) shaman.pillarCooldown--;
        if (shaman.healCooldown <= 0) {
            const allies = [...boars, ...zombies, ...ogres, ...frostWraiths, ...iceMaulers, ...cryoShamans];
            for (const ally of allies) {
                if (getDistance(ally, shaman) < 150) ally.hp = Math.min(ally.maxHp, ally.hp + 1);
            }
            shaman.healCooldown = 300;
        }
        if (shaman.pillarCooldown <= 0) {
            const gridX = Math.floor(shaman.x / GRID_CELL_SIZE);
            const gridY = Math.floor(shaman.y / GRID_CELL_SIZE);
            const key = `i${gridX},${gridY}`;
            if (!structures[key]) {
                structures[key] = { type: 'ice_pillar', x: gridX * GRID_CELL_SIZE, y: gridY * GRID_CELL_SIZE, size: GRID_CELL_SIZE };
                markArea(gridX, gridY, 1, true);
                broadcast({ type: 'structure-update', structure: structures[key] });
            }
            shaman.pillarCooldown = 600;
        }
        if (shaman.vx === 0 && shaman.vy === 0) {
            const ang = Math.random() * Math.PI * 2;
            shaman.vx = Math.cos(ang) * shaman.speed;
            shaman.vy = Math.sin(ang) * shaman.speed;
        }
        const nx = shaman.x + shaman.vx;
        const ny = shaman.y + shaman.vy;
        if (!isBlocked(nx, ny, shaman.size)) {
            shaman.x = Math.max(GLACIAL_RIFT_START_X, Math.min(GLACIAL_RIFT_END_X, nx));
            shaman.y = Math.max(0, Math.min(WORLD_HEIGHT, ny));
        } else {
            shaman.vx = -shaman.vx;
            shaman.vy = -shaman.vy;
        }
    }
    cryoShamans = cryoShamans.filter(s => s.hp > 0);
    updateGlacierTitan();
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
        if (p.shieldWall && p.shieldWall > 0) p.shieldWall--;
        if (p.tauntCooldown && p.tauntCooldown > 0) p.tauntCooldown--;
        if (p.fortify && p.fortify > 0) p.fortify--;
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
    broadcast({
        type: 'game-state',
        players: getActivePlayers(),
        boars,
        zombies,
        ogres,
        frostWraiths,
        iceMaulers,
        cryoShamans,
        titan: glacierTitan,
        groundItems,
        projectiles: projectiles.map(p => ({ ...p, stuckTo: undefined })),
        dayNight,
        riftBlizzard
    });
}
generateWorld();
setInterval(gameLoop, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });