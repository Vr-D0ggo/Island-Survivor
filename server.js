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
    'Furnace': { cost: { Stone: 20 }, result: 'Furnace' },
    'Bed': { cost: { Wood: 20, Leaf: 40 }, result: 'Bed' },
    'Torch': { cost: { Wood: 3 }, result: 'Torch' }
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
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        behavior: behavior.type,
        color: behavior.color,
        burn: 0,
        slow: 0
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
    const hp = 20;
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
        vx: 0,
        vy: 0,
        wanderTimer: 0,
        angle: 0,
        burn: 0,
        slow: 0,
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
    const size = 25;
    const hp = 50; // 5x player health
    return { id: nextOgreId++, x, y, hp, maxHp: hp, size, baseSpeed: 1, speed: 1, cooldown: 0, vx: 0, vy: 0, target: null, fireCooldown: 0, burn: 0, slow: 0, wanderTimer: 0, angle: 0, facing: 0 };
}

function spawnOgres(count) {
    const corners = [
        { x: 50, y: 50 },
        { x: 50, y: WORLD_HEIGHT - 50 },
        { x: WORLD_WIDTH - 50, y: 50 },
        { x: WORLD_WIDTH - 50, y: WORLD_HEIGHT - 50 }
    ];
    for (let i = 0; i < count; i++) {
        const corner = corners[Math.floor(Math.random() * corners.length)];
        ogres.push(createOgre(corner.x, corner.y));
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
function countItems(player, itemName) { let t = 0; [...player.inventory, ...player.hotbar].forEach(s => { if (s && s.item === itemName) t += s.quantity; }); return t; }
function consumeItems(player, itemName, amount) { let r = amount; const c = (s) => { if (s && s.item === itemName && r > 0) { const t = Math.min(r, s.quantity); s.quantity -= t; r -= t; if (s.quantity <= 0) return null; } return s; }; player.inventory = player.inventory.map(c); player.hotbar = player.hotbar.map(c); }
function addItemToPlayer(playerId, item, quantity) { const p = players[playerId]; if (!p) return; let s = [...p.inventory, ...p.hotbar].find(i => i && i.item === item); if (s) s.quantity += quantity; else { let i = p.hotbar.findIndex(x => x === null); if (i !== -1) p.hotbar[i] = { item, quantity }; else { i = p.inventory.findIndex(x => x === null); if (i !== -1) p.inventory[i] = { item, quantity }; else console.log(`Inv full for ${playerId}`); } } const c = [...wss.clients].find(c => c.id === playerId); if (c) { c.send(JSON.stringify({ type: 'inventory-update', inventory: p.inventory, hotbar: p.hotbar })); c.send(JSON.stringify({ type: 'item-pickup-notif', item: item, amount: quantity })); } }
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
        player.canSlow = true;
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
    for (let i = 0; i < 8; i++) {
        const vx = Math.cos(angle) * entity.speed;
        const vy = Math.sin(angle) * entity.speed;
        const nx = entity.x + vx;
        const ny = entity.y + vy;
        if (!isBlocked(nx, ny, entity.size) && !collidesWithEntities(nx, ny, entity.size, entity)) {
            entity.vx = vx;
            entity.vy = vy;
            return;
        }
        angle += Math.PI / 4;
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
    const { x: spawnX, y: spawnY } = getFreePosition();
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
        canSlow: false,
        swordDamage: 0,
        attackRange: 0,
        class: null,
        poison: 0
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
                if (!player.active) {
                    player.active = true;
                    player.x = player.spawnX;
                    player.y = player.spawnY;
                    player.invulnerable = 120;
                    broadcast({ type: 'player-join', player });
                }
                break;
            case 'set-class':
                if (['knight', 'mage', 'summoner'].includes(data.class)) {
                    player.class = data.class;
                    if (!player.skills) player.skills = {};
                    player.skills.range = true;
                    player.skills[data.class] = true;
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
                if (target && target.active && target.invulnerable <= 0 && getDistance(player, target) < player.size + target.size + 20 + (player.attackRange || 0)) {
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
                    } else if (['mage', 'knight', 'summoner'].includes(skill) && player.skills.range && !player.class) {
                        player.skillPoints--;
                        player.skills[skill] = true;
                        player.class = skill;
                    } else if (player.class === 'knight' && ['knight-damage', 'knight-speed', 'knight-health'].includes(skill)) {
                        if (!player.knightSkills) player.knightSkills = {};
                        if (!player.knightSkills[skill] && Object.keys(player.knightSkills).length < 2) {
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
                    } else if (player.class === 'mage' && ['mage-mana', 'mage-regen', 'mage-slow'].includes(skill)) {
                        if (!player.mageSkills) player.mageSkills = {};
                        if (!player.mageSkills[skill]) {
                            player.skillPoints--;
                            player.mageSkills[skill] = true;
                            if (skill === 'mage-mana') { player.maxMana += 20; player.mana += 20; }
                            else if (skill === 'mage-regen') { player.manaRegen += 0.5 / 60; }
                            else if (skill === 'mage-slow') { player.canSlow = true; }
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
                    projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: playerId, type: 'slow' });
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
        proj.x += proj.vx;
        proj.y += proj.vy;
        let hit = false;
        for (const id in players) {
            const p = players[id];
            if (!p.active) continue;
            if (proj.owner && proj.owner === id) continue;
            if (getDistance(p, proj) < p.size) {
                if (proj.type === 'slow') {
                    p.slow = 60;
                } else if (!p.invulnerable || p.invulnerable <= 0) {
                    p.hp = Math.max(0, p.hp - 2);
                    p.burn = 120;
                    p.lastHitBy = proj.owner || 'ogre';
                    const c = [...wss.clients].find(cl => cl.id === id);
                    if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
                    if (p.hp <= 0 && proj.owner && players[proj.owner]) {
                        const killer = players[proj.owner];
                        const kc = [...wss.clients].find(cl => cl.id === proj.owner);
                        levelUp(killer, kc);
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
                        boar.slow = 60;
                    } else {
                        boar.hp = Math.max(0, boar.hp - 2);
                        boar.burn = 120;
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
                        zombie.slow = 60;
                    } else {
                        zombie.hp = Math.max(0, zombie.hp - 2);
                        zombie.burn = 120;
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
                        ogre.slow = 60;
                    } else {
                        ogre.hp = Math.max(0, ogre.hp - 2);
                        ogre.burn = 120;
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
                    if (proj.type !== 'slow') {
                        r.hp -= 2;
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
        if (proj.x < 0 || proj.x > WORLD_WIDTH || proj.y < 0 || proj.y > WORLD_HEIGHT) hit = true;
        proj.remove = hit;
    }
    projectiles = projectiles.filter(p => !p.remove);

    for (const boar of boars) {
        boar.speed = boar.baseSpeed;
        if (boar.slow > 0) { boar.slow--; boar.speed = boar.baseSpeed * 0.5; }
        if (boar.cooldown > 0) boar.cooldown--;
        if (boar.burn > 0) {
            boar.burn--;
            if (boar.burn % 30 === 0) boar.hp = Math.max(0, boar.hp - 1);
        }
        const potentialTargets = [];
        for (const id in players) {
            if (players[id].active) potentialTargets.push({ type: 'player', id, entity: players[id] });
        }
        for (const o of ogres) potentialTargets.push({ type: 'ogre', id: o.id, entity: o });
        if (!boar.aggressive) {
            if (boar.behavior === 'sight') {
                for (const t of potentialTargets) {
                    if (getDistance(t.entity, boar) < 150) { boar.aggressive = true; boar.target = { type: t.type, id: t.id }; break; }
                }
            } else if (boar.behavior === 'stand') {
                boar.vx = 0;
                boar.vy = 0;
                for (const t of potentialTargets) {
                    if (getDistance(t.entity, boar) < 80) { boar.aggressive = true; boar.target = { type: t.type, id: t.id }; break; }
                }
            }
        } else {
            let target = null;
            if (boar.target.type === 'player') target = players[boar.target.id];
            else if (boar.target.type === 'ogre') target = ogres.find(o => o.id === boar.target.id);
            if (!target) { boar.aggressive = false; boar.target = null; }
            else {
                const dist = getDistance(boar, target);
                if (dist > 200) { boar.aggressive = false; boar.target = null; }
                else {
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
                                    ogres = ogres.filter(o => o.id !== target.id);
                                    groundItems.push({ id: nextItemId++, item: 'Fire Staff', quantity: 1, x: target.x, y: target.y });
                                }
                                broadcast({ type: 'ogre-update', ogre: target });
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
        if (zombie.slow > 0) { zombie.slow--; zombie.speed = zombie.baseSpeed * 0.5; }
        if (zombie.cooldown > 0) zombie.cooldown--;
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
            for (const t of potential) {
                const dx = t.entity.x - zombie.x;
                const dy = t.entity.y - zombie.y;
                const dist = Math.hypot(dx, dy);
                const angleTo = Math.atan2(dy, dx);
                const diff = Math.abs(Math.atan2(Math.sin(angleTo - zombie.angle), Math.cos(angleTo - zombie.angle)));
                if (dist < 200 && diff < Math.PI / 4) {
                    zombie.aggressive = true;
                    zombie.target = { type: t.type, id: t.id };
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
            if (!target) { zombie.aggressive = false; zombie.target = null; zombie.commanded = false; }
            else {
                const dist = getDistance(zombie, target);
                if (!zombie.commanded && dist > 250) { zombie.aggressive = false; zombie.target = null; }
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
                            projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, owner: zombie.ownerId });
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
                                    if (target.hp <= 0) {
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
        if (ogre.slow > 0) { ogre.slow--; ogre.speed = ogre.baseSpeed * 0.5; }
        if (ogre.cooldown > 0) ogre.cooldown--;
        if (ogre.fireCooldown > 0) ogre.fireCooldown--;
        let targetData = null;
        if (ogre.target) {
            if (ogre.target.type === 'player') {
                const tp = players[ogre.target.id];
                if (tp) targetData = { entity: tp, type: 'player', id: ogre.target.id };
                else ogre.target = null;
            } else if (ogre.target.type === 'boar') {
                const tb = boars.find(b => b.id === ogre.target.id);
                if (tb) targetData = { entity: tb, type: 'boar', id: tb.id };
                else ogre.target = null;
            } else if (ogre.target.type === 'zombie') {
                const tz = zombies.find(z => z.id === ogre.target.id);
                if (tz) targetData = { entity: tz, type: 'zombie', id: tz.id };
                else ogre.target = null;
            }
        }
        if (!targetData) {
            let minDist = 250;
            const potentials = [];
            for (const id in players) {
                if (players[id].active) potentials.push({ entity: players[id], type: 'player', id });
            }
            for (const b of boars) potentials.push({ entity: b, type: 'boar', id: b.id });
            for (const z of zombies) potentials.push({ entity: z, type: 'zombie', id: z.id });
            for (const g of groundItems) {
                if (g.item === 'Raw Meat') potentials.push({ entity: g, type: 'meat', id: g.id });
            }
            for (const t of potentials) {
                const d = getDistance(t.entity, ogre);
                if (d < minDist) { minDist = d; targetData = { entity: t.entity, type: t.type, id: t.id }; }
            }
            if (targetData) ogre.target = { type: targetData.type, id: targetData.id };
        }
        if (targetData) {
            ogre.wanderTimer = 0;
            const dist = getDistance(ogre, targetData.entity);
            if (targetData.type === 'meat') {
                if (dist < 20) {
                    ogre.hp = Math.min(ogre.maxHp, ogre.hp + 5);
                    groundItems = groundItems.filter(g => g.id !== targetData.id);
                    ogre.target = null;
                } else {
                    moveToward(ogre, targetData.entity);
                    ogre.facing = Math.atan2(targetData.entity.y - ogre.y, targetData.entity.x - ogre.x);
                }
            } else {
                if (targetData.type === 'player' && dist < 300) {
                    ogre.vx = 0;
                    ogre.vy = 0;
                    ogre.facing = Math.atan2(targetData.entity.y - ogre.y, targetData.entity.x - ogre.x);
                } else {
                    moveToward(ogre, targetData.entity);
                    ogre.facing = Math.atan2(ogre.vy, ogre.vx);
                }
                if (dist < 300 && ogre.fireCooldown <= 0) {
                    const angle = Math.atan2(targetData.entity.y - ogre.y, targetData.entity.x - ogre.x);
                    ogre.facing = angle;
                    const speed = 4;
                    const spawnDist = ogre.size + 5;
                    const sx = ogre.x + Math.cos(angle) * spawnDist;
                    const sy = ogre.y + Math.sin(angle) * spawnDist;
                    projectiles.push({ id: nextProjectileId++, x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
                    ogre.fireCooldown = 90;
                }
                if (dist < ogre.size + (targetData.entity.size || 10) + 10 && ogre.cooldown <= 0) {
                    if (targetData.type !== 'player' || targetData.entity.invulnerable <= 0) {
                        const dmg = Math.floor((targetData.entity.maxHp || 10) / 2);
                        targetData.entity.hp = Math.max(0, targetData.entity.hp - dmg);
                        if (targetData.type === 'player') {
                            targetData.entity.lastHitBy = 'ogre';
                            const c = [...wss.clients].find(cl => cl.id === targetData.id);
                            if (c) c.send(JSON.stringify({ type: 'player-hit', hp: targetData.entity.hp }));
                        } else if (targetData.type === 'boar') {
                            targetData.entity.aggressive = true;
                            targetData.entity.target = { type: 'ogre', id: ogre.id };
                            if (targetData.entity.hp <= 0) boars = boars.filter(b => b.id !== targetData.id);
                            broadcast({ type: 'boar-update', boar: targetData.entity });
                        } else if (targetData.type === 'zombie') {
                            targetData.entity.aggressive = true;
                            targetData.entity.target = { type: 'ogre', id: ogre.id };
                            if (targetData.entity.hp <= 0) zombies = zombies.filter(z => z.id !== targetData.id);
                            broadcast({ type: 'zombie-update', zombie: targetData.entity });
                        }
                    }
                    ogre.cooldown = 90;
                }
            }
        } else {
            if (ogre.wanderTimer <= 0) {
                ogre.angle = Math.random() * Math.PI * 2;
                ogre.vx = Math.cos(ogre.angle) * ogre.speed;
                ogre.vy = Math.sin(ogre.angle) * ogre.speed;
                ogre.wanderTimer = 60 + Math.floor(Math.random() * 120);
            } else {
                ogre.wanderTimer--;
            }
            ogre.facing = Math.atan2(ogre.vy, ogre.vx);
        }
        const nx = ogre.x + ogre.vx;
        const ny = ogre.y + ogre.vy;
        if (!isBlocked(nx, ny, ogre.size) && !collidesWithEntities(nx, ny, ogre.size, ogre)) {
            ogre.x = nx;
            ogre.y = ny;
        }
        ogre.x = Math.max(0, Math.min(WORLD_WIDTH, ogre.x));
        ogre.y = Math.max(0, Math.min(WORLD_HEIGHT, ogre.y));
    }
    for (const id in players) {
        const p = players[id];
        if (!p.active) continue;
        p.speed = p.baseSpeed;
        if (p.slow > 0) { p.slow--; p.speed = p.baseSpeed * 0.5; }
        if (p.burn && p.burn > 0) {
            p.burn--;
            if (p.burn % 30 === 0 && (!p.invulnerable || p.invulnerable <= 0)) {
                p.hp = Math.max(0, p.hp - 1);
                const c = [...wss.clients].find(cl => cl.id === id);
                if (c) c.send(JSON.stringify({ type: 'player-hit', hp: p.hp }));
            }
        }
        if (p.invulnerable && p.invulnerable > 0) p.invulnerable--;
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