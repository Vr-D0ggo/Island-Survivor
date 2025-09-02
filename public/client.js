// client.js (Full, Final, and Defensive Code)

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

console.log("Client script started.");

// --- WebSocket Connection ---
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${protocol}://${window.location.host}`);
socket.onopen = () => console.log("✅ WebSocket connection established successfully!");
socket.onerror = (error) => console.error("❌ WebSocket Error:", error);

// --- Audio Handling ---
const morningMusic = new Audio('/morning.mp3'); morningMusic.loop = true;
const nightMusic = new Audio('/night.mp3'); nightMusic.loop = true;
let audioStarted = false;
function playMusicForPhase(isDay) { if (!audioStarted) return; const musicToPlay = isDay ? morningMusic : nightMusic; const musicToStop = isDay ? nightMusic : morningMusic; musicToStop.volume = 0; musicToStop.pause(); musicToPlay.play().catch(e => console.error("Audio play failed:", e)); musicToPlay.volume = 0.5; }
window.addEventListener('click', () => { if (!audioStarted) { console.log("Audio context started by user interaction."); audioStarted = true; playMusicForPhase(dayNight.isDay); } }, { once: true });

// --- Game State (Initialized to be safe) ---
let myPlayerId = null;
let players = {};
let resources = [];
let structures = {}; // Start as empty object to prevent crashes
let boars = [];
let zombies = [];
let ogres = [];
let groundItems = [];
let projectiles = [];
let camera = { x: 0, y: 0 };
const WORLD_WIDTH = 3000; const WORLD_HEIGHT = 3000; const GRID_CELL_SIZE = 50;
let dayNight = { isDay: true, cycleTime: 0, DAY_DURATION: 5 * 60 * 1000, NIGHT_DURATION: 3.5 * 60 * 1000 };
const BLOCK_SIZE = GRID_CELL_SIZE / 2;
const treeTopImg = new Image(); treeTopImg.src = '/icons/Treetop.png';
const treeTrunkImg = new Image(); treeTrunkImg.src = '/icons/Treetrunk.png';
const appleImg = new Image(); appleImg.src = '/icons/apple.png';
const boarImg = new Image(); boarImg.src = '/icons/Boar.png';
const workbenchImg = new Image(); workbenchImg.src = '/icons/workbench.png';
const ovenImg = new Image(); ovenImg.src = '/icons/Oven.png';
const bedImg = new Image(); bedImg.src = '/icons/Bed.png';
const fireStaffImg = new Image(); fireStaffImg.src = '/icons/FireStaff.png';
const fireBallImg = new Image(); fireBallImg.src = '/icons/FireBall.png';
const ITEM_ICONS = {
    'Wood': 'wood.png',
    'Stone': 'stone.png',
    'Leaf': 'Leaf.png',
    'Raw Meat': 'Meat.png',
    'Cooked Meat': 'Meat.png',
    'Tusk': 'Tusk.png',
    'Apple': 'apple.png',
    'Wooden Axe': 'Axe.png',
    'Wooden Pickaxe': 'Pickaxe.png',
    'Wooden Sword': 'Sword.png',
    'Stone Axe': 'Axe.png',
    'Stone Pickaxe': 'Pickaxe.png',
    'Stone Sword': 'Sword.png',
    'Workbench': 'workbench.png',
    'Furnace': 'Oven.png',
    'Bed': 'Bed.png'
};
const itemImages = {};
const RECIPES = {
    Workbench: { cost: { Wood: 5, Stone: 2 }, icon: 'workbench.png' },
    'Wooden Axe': { cost: { Wood: 3 }, icon: ITEM_ICONS['Wooden Axe'] },
    'Wooden Pickaxe': { cost: { Wood: 3 }, icon: ITEM_ICONS['Wooden Pickaxe'] },
    'Wooden Sword': { cost: { Wood: 2 }, icon: ITEM_ICONS['Wooden Sword'] },
    'Stone Axe': { cost: { Wood: 2, Stone: 3 }, icon: ITEM_ICONS['Stone Axe'] },
    'Stone Pickaxe': { cost: { Wood: 2, Stone: 3 }, icon: ITEM_ICONS['Stone Pickaxe'] },
    'Stone Sword': { cost: { Wood: 1, Stone: 4 }, icon: ITEM_ICONS['Stone Sword'] },
    'Furnace': { cost: { Stone: 20 }, icon: ITEM_ICONS['Furnace'] },
    'Bed': { cost: { Wood: 20, Leaf: 40 }, icon: ITEM_ICONS['Bed'] }
};

// --- Input & UI State ---
const keys = {}; window.addEventListener('keydown', e => keys[e.code] = true); window.addEventListener('keyup', e => keys[e.code] = false);
const hotbarSlots = [document.getElementById('hotbar-0'), document.getElementById('hotbar-1'), document.getElementById('hotbar-2'), document.getElementById('hotbar-3')];
const inventoryScreen = document.getElementById('inventory-screen'); const inventoryGrid = document.getElementById('inventory-grid'); const recipeList = document.getElementById('recipe-list');
const furnaceScreen = document.getElementById('furnace-screen');
const furnaceInput = document.getElementById('furnace-input');
const furnaceFuel = document.getElementById('furnace-fuel');
const furnaceCookBtn = document.getElementById('furnace-cook-btn');
const chatMessages = document.getElementById('chat-messages'); const chatInput = document.getElementById('chat-input');
const healthFill = document.getElementById('player-health-fill');
let selectedHotbarSlot = 0;
let mousePos = { x: 0, y: 0 };
let dragSrcIndex = null;
let deathFade = 0;
let deathFadeDir = 0;
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

// --- Helper Functions ---
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }
function initializePlayerForRender(player) { if (player) { player.renderX = player.x; player.renderY = player.y; } }
function createItemIconCanvas(name) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ictx = c.getContext('2d');
    if (name === 'Raw Meat' || name === 'Cooked Meat') {
        ictx.fillStyle = '#a33';
        ictx.fillRect(4, 4, 24, 24);
        ictx.strokeStyle = '#711';
        ictx.strokeRect(4, 4, 24, 24);
    } else if (name === 'Tusk') {
        ictx.fillStyle = '#fff';
        ictx.beginPath();
        ictx.moveTo(8, 24);
        ictx.lineTo(16, 4);
        ictx.lineTo(24, 24);
        ictx.closePath();
        ictx.fill();
        ictx.strokeStyle = '#ccc';
        ictx.stroke();
    } else {
        ictx.fillStyle = '#777';
        ictx.fillRect(4, 4, 24, 24);
    }
    c.className = 'item-icon';
    return c;
}
function updatePlayerHealthBar() {
    const me = players[myPlayerId];
    if (me && healthFill) {
        healthFill.style.width = `${(me.hp / me.maxHp) * 100}%`;
    }
}

function drawShadow(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + h / 2, w / 2, h / 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// --- WebSocket Message Handling ---
socket.onmessage = event => {
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'init':
            myPlayerId = data.playerId;
            players = data.players || {};
            if (data.myPlayerData) {
                players[myPlayerId] = data.myPlayerData;
            }
            resources = data.resources || [];
            structures = data.structures || {};
            boars = data.boars || [];
            zombies = data.zombies || [];
            ogres = data.ogres || [];
            groundItems = data.groundItems || [];
            projectiles = data.projectiles || [];
            dayNight = data.dayNight || dayNight;
            Object.values(players).forEach(initializePlayerForRender);
            if (!gameLoopStarted) { gameLoopStarted = true; requestAnimationFrame(gameLoop); }
            updatePlayerHealthBar();
            socket.send(JSON.stringify({ type: 'held-item', index: selectedHotbarSlot }));
            break;
        case 'game-state':
            const lastIsDay = dayNight.isDay;
            dayNight = data.dayNight;
            if (lastIsDay !== dayNight.isDay) playMusicForPhase(dayNight.isDay);
            boars = data.boars || boars;
            zombies = data.zombies || zombies;
            ogres = data.ogres || ogres;
            groundItems = data.groundItems || groundItems;
            projectiles = data.projectiles || projectiles;
            for (const id in data.players) {
                if (players[id]) {
                    const serverPlayer = data.players[id];
                    const clientPlayer = players[id];
                    clientPlayer.heldIndex = serverPlayer.heldIndex;
                    clientPlayer.hp = serverPlayer.hp;
                    clientPlayer.burn = serverPlayer.burn;
                    if (id === myPlayerId) {
                        const dist = Math.hypot(serverPlayer.x - clientPlayer.x, serverPlayer.y - clientPlayer.y);
                        if (dist > 20) { clientPlayer.x = serverPlayer.x; clientPlayer.y = serverPlayer.y; }
                    } else {
                        clientPlayer.targetX = serverPlayer.x;
                        clientPlayer.targetY = serverPlayer.y;
                    }
                } else {
                    players[id] = data.players[id];
                    initializePlayerForRender(players[id]);
                }
            }
            updatePlayerHealthBar();
            break;
        case 'player-join': if (data.player.id !== myPlayerId) { players[data.player.id] = data.player; initializePlayerForRender(players[data.player.id]); } break;
        case 'player-leave': delete players[data.playerId]; break;
        case 'resource-update': const resIndex = resources.findIndex(r => r.id === data.resource.id); if (resIndex !== -1) resources[resIndex] = data.resource; break;
        case 'structure-update': structures = data.structures; break;
        case 'inventory-update': const me = players[myPlayerId]; if (me) { me.inventory = data.inventory; me.hotbar = data.hotbar; if (!inventoryScreen.classList.contains('hidden')) { updateInventoryUI(); updateCraftingUI(); } if (!furnaceScreen.classList.contains('hidden')) { updateFurnaceUI(); } updateHotbarUI(); } break;
        case 'item-pickup-notif': createFloatingText(`+${data.amount} ${data.item}`, players[myPlayerId].x, players[myPlayerId].y); break;
        case 'notification': showNotification(data.message); break;
        case 'boar-update': {
            const idx = boars.findIndex(b => b.id === data.boar.id);
            if (idx !== -1) boars[idx] = data.boar; else boars.push(data.boar);
            break;
        }
        case 'zombie-update': {
            const idx = zombies.findIndex(z => z.id === data.zombie.id);
            if (idx !== -1) zombies[idx] = data.zombie; else zombies.push(data.zombie);
            break;
        }
        case 'ogre-update': {
            const idx = ogres.findIndex(o => o.id === data.ogre.id);
            if (idx !== -1) ogres[idx] = data.ogre; else ogres.push(data.ogre);
            break;
        }
        case 'player-hit': if (players[myPlayerId]) { players[myPlayerId].hp = data.hp; updatePlayerHealthBar(); } break;
        case 'player-dead': deathFade = 0; deathFadeDir = 1; break;
        case 'chat-message': addChatMessage(data.sender, data.message); break;
    }
};

// --- UI Functions ---
function updateCraftingUI() {
    const me = players[myPlayerId];
    if (!me) return;
    recipeList.innerHTML = '';
    const countItems = (itemName) => {
        let total = 0;
        [...me.inventory, ...me.hotbar].forEach(slot => { if (slot && slot.item === itemName) total += slot.quantity; });
        return total;
    };
    const nearWorkbench = Object.values(structures).some(s => s.type === 'workbench' && Math.hypot((s.x + s.size / 2) - me.x, (s.y + s.size / 2) - me.y) < 150);
    for (const recipeName in RECIPES) {
        if (recipeName !== 'Workbench' && !nearWorkbench) continue;
        const recipe = RECIPES[recipeName];
        let canCraft = true;
        let costString = '';
        for (const ingredient in recipe.cost) {
            const owned = countItems(ingredient);
            const needed = recipe.cost[ingredient];
            if (owned < needed) canCraft = false;
            costString += `${ingredient}: ${owned}/${needed} `;
        }
        const recipeEl = document.createElement('div');
        recipeEl.className = 'recipe';
        if (!canCraft) recipeEl.classList.add('disabled');
        recipeEl.innerHTML = `<div class="recipe-icon" style="background-image: url('/icons/${recipe.icon}')"></div><div class="recipe-details"><div class="recipe-name">${recipeName}</div><div class="recipe-cost">${costString.trim()}</div></div><button>Craft</button>`;
        if (canCraft) {
            recipeEl.querySelector('button').onclick = () => { socket.send(JSON.stringify({ type: 'craft-item', itemName: recipeName })); };
        }
        recipeList.appendChild(recipeEl);
    }
}
function updateInventoryUI(){
    const me = players[myPlayerId];
    if(!me || !me.inventory) return;
    inventoryGrid.innerHTML = '';
    me.inventory.forEach((item, i) => {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.index = i;
        slot.draggable = !!item;
        slot.addEventListener('dragstart', () => { dragSrcIndex = i; });
        slot.addEventListener('dragover', e => e.preventDefault());
        slot.addEventListener('drop', e => {
            e.preventDefault();
            const dest = parseInt(e.currentTarget.dataset.index, 10);
            if (dragSrcIndex !== null && dest !== dragSrcIndex) {
                socket.send(JSON.stringify({ type: 'swap-inventory', from: dragSrcIndex, to: dest }));
            }
            dragSrcIndex = null;
        });
        slot.addEventListener('dragend', () => { dragSrcIndex = null; });
        if(item){
            const iconName = ITEM_ICONS[item.item];
            if(iconName){
                const url = iconName.startsWith('data:') ? iconName : `/icons/${iconName}`;
                slot.innerHTML = `<div class="item-icon" style="background-image: url('${url}')"></div><div class="item-quantity">${item.quantity}</div>`;
            } else {
                const canvasIcon = createItemIconCanvas(item.item);
                slot.appendChild(canvasIcon);
                const qty = document.createElement('div');
                qty.className = 'item-quantity';
                qty.textContent = item.quantity;
                slot.appendChild(qty);
            }
        }
        inventoryGrid.appendChild(slot);
    });
}

function updateFurnaceUI() {
    const me = players[myPlayerId];
    if (!me) return;
    const allItems = [...me.hotbar, ...me.inventory].filter(s => s);
    const inputOptions = allItems.filter(s => s.item === 'Raw Meat' || s.item === 'Apple');
    const fuelOptions = allItems.filter(s => ['Wood', 'Leaf', 'Raw Meat', 'Apple'].includes(s.item));
    furnaceInput.innerHTML = '';
    inputOptions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.item;
        opt.textContent = `${s.item} (${s.quantity})`;
        furnaceInput.appendChild(opt);
    });
    furnaceFuel.innerHTML = '';
    fuelOptions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.item;
        opt.textContent = `${s.item} (${s.quantity})`;
        furnaceFuel.appendChild(opt);
    });
}
function updateHotbarUI() {
    const me = players[myPlayerId];
    if (!me || !me.hotbar) return;
    hotbarSlots.forEach((slot, i) => {
        slot.classList.toggle('selected', i === selectedHotbarSlot);
        const item = me.hotbar[i];
        if (item) {
            const iconName = ITEM_ICONS[item.item];
            if (iconName) {
                const url = iconName.startsWith('data:') ? iconName : `/icons/${iconName}`;
                slot.innerHTML = `<div class="item-icon" style="background-image: url('${url}')"></div><div class="item-quantity">${item.quantity}</div>`;
            } else {
                slot.innerHTML = '';
                const canvasIcon = createItemIconCanvas(item.item);
                slot.appendChild(canvasIcon);
                const qty = document.createElement('div');
                qty.className = 'item-quantity';
                qty.textContent = item.quantity;
                slot.appendChild(qty);
            }
        } else {
            slot.innerHTML = `${i+1}`;
        }
    });
}

// --- Player Interaction ---
function playerMovement() {
    const player = players[myPlayerId]; if (!player) return;
    let dx = 0; let dy = 0;
    if (keys['KeyW']) dy -= 1;
    if (keys['KeyS']) dy += 1;
    if (keys['KeyA']) dx -= 1;
    if (keys['KeyD']) dx += 1;
    if (dx === 0 && dy === 0) return;
    const magnitude = Math.hypot(dx, dy);
    dx = (dx / magnitude) * player.speed;
    dy = (dy / magnitude) * player.speed;
    let predictedX = player.x + dx;
    let predictedY = player.y + dy;
    predictedX = Math.max(player.size, Math.min(WORLD_WIDTH - player.size, predictedX));
    predictedY = Math.max(player.size, Math.min(WORLD_HEIGHT - player.size, predictedY));
    let collision = false;
    for (const res of resources) {
        if (res.harvested) continue;
        const radius = res.type === 'tree' ? res.size / 8 : res.size / 2;
        if (Math.hypot(predictedX - res.x, predictedY - res.y) < player.size + radius) { collision = true; break; }
    }
    if (!collision) {
        for (const key in structures) {
            const s = structures[key];
            const size = s.size || (s.type === 'workbench' ? GRID_CELL_SIZE : BLOCK_SIZE);
            if (predictedX > s.x - player.size && predictedX < s.x + size + player.size && predictedY > s.y - player.size && predictedY < s.y + size + player.size) { collision = true; break; }
        }
    }
    if (!collision) {
        player.x = predictedX;
        player.y = predictedY;
        socket.send(JSON.stringify({ type: 'move', x: player.x, y: player.y }));
    }
}
canvas.addEventListener('mousedown', e => {
    if (!myPlayerId || !players[myPlayerId] || e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + camera.x;
    const mouseY = e.clientY - rect.top + camera.y;
    const me = players[myPlayerId];
    const selectedItem = me.hotbar[selectedHotbarSlot];
    let closestBoar = null; let boarDist = Infinity;
    for (const boar of boars) {
        const dist = Math.hypot(mouseX - boar.x, mouseY - boar.y);
        if (dist < boar.size && dist < boarDist) { boarDist = dist; closestBoar = boar; }
    }
    let closestZombie = null; let zombieDist = Infinity;
    for (const zombie of zombies) {
        const dist = Math.hypot(mouseX - zombie.x, mouseY - zombie.y);
        if (dist < zombie.size && dist < zombieDist) { zombieDist = dist; closestZombie = zombie; }
    }
    let closestResource = null; let closestDist = Infinity;
    for (const resource of resources) {
        if (!resource.harvested) {
            const dist = Math.hypot(mouseX - resource.x, mouseY - resource.y);
            if (dist < resource.size && dist < closestDist) { closestDist = dist; closestResource = resource; }
        }
    }
    if (closestBoar) {
        socket.send(JSON.stringify({ type: 'hit-boar', boarId: closestBoar.id, item: selectedItem ? selectedItem.item : null }));
    } else if (closestZombie) {
        socket.send(JSON.stringify({ type: 'hit-zombie', zombieId: closestZombie.id, item: selectedItem ? selectedItem.item : null }));
    } else if (closestResource) {
        socket.send(JSON.stringify({ type: 'hit-resource', resourceId: closestResource.id, item: selectedItem ? selectedItem.item : null }));
    } else {
        let key = null;
        const blockX = Math.floor(mouseX / BLOCK_SIZE);
        const blockY = Math.floor(mouseY / BLOCK_SIZE);
        if (structures[`b${blockX},${blockY}`]) {
            key = `b${blockX},${blockY}`;
        } else {
            const gridX = Math.floor(mouseX / GRID_CELL_SIZE);
            const gridY = Math.floor(mouseY / GRID_CELL_SIZE);
            if (structures[`w${gridX},${gridY}`]) key = `w${gridX},${gridY}`;
        }
        if (key) socket.send(JSON.stringify({ type: 'hit-structure', key, item: selectedItem ? selectedItem.item : null, hotbarIndex: selectedHotbarSlot }));
    }
});
canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + camera.x;
    const mouseY = e.clientY - rect.top + camera.y;
    let key = null;
    const blockX = Math.floor(mouseX / BLOCK_SIZE);
    const blockY = Math.floor(mouseY / BLOCK_SIZE);
    if (structures[`b${blockX},${blockY}`]) {
        key = `b${blockX},${blockY}`;
    } else {
        const gridX = Math.floor(mouseX / GRID_CELL_SIZE);
        const gridY = Math.floor(mouseY / GRID_CELL_SIZE);
        if (structures[`w${gridX},${gridY}`]) key = `w${gridX},${gridY}`;
    }
    if (key && structures[key]) {
        const s = structures[key];
        const me = players[myPlayerId];
        if (me) {
            const cx = s.x + s.size / 2;
            const cy = s.y + s.size / 2;
            if (Math.hypot(me.x - cx, me.y - cy) < me.size + s.size) {
                if (s.type === 'furnace') {
                    furnaceScreen.classList.remove('hidden');
                    updateFurnaceUI();
                    return;
                } else if (s.type === 'bed') {
                    socket.send(JSON.stringify({ type: 'sleep-bed', key }));
                    showNotification('Respawn point set!');
                    return;
                }
            }
        }
    }
    const me = players[myPlayerId];
    if (!me || !me.hotbar) return;
    const selectedItem = me.hotbar[selectedHotbarSlot];
    if (!selectedItem) return;
    const snap = ['Workbench','Furnace','Bed'].includes(selectedItem.item) ? GRID_CELL_SIZE : BLOCK_SIZE;
    const targetX = Math.floor(mouseX / snap) * snap;
    const targetY = Math.floor(mouseY / snap) * snap;
    socket.send(JSON.stringify({ type: 'place-item', item: selectedItem.item, x: targetX, y: targetY, hotbarIndex: selectedHotbarSlot }));
});

// --- Drawing & Game Loop ---
function drawPlayer(player, isMe) {
    if (!player || player.x === undefined) return;
    const x = isMe ? player.x : player.renderX;
    const y = isMe ? player.y : player.renderY;
    drawShadow(x, y, player.size * 2, player.size);
    ctx.beginPath();
    ctx.arc(x, y, player.size, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? 'hsl(120, 100%, 70%)' : 'hsl(0, 100%, 70%)';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.stroke();
    let angle = 0;
    if (isMe) {
        angle = Math.atan2(mousePos.y - (y - camera.y), mousePos.x - (x - camera.x));
    } else if (player.targetX !== undefined) {
        angle = Math.atan2(player.targetY - y, player.targetX - x);
    }
    const eyeAngle = angle + Math.PI / 2;
    const eyeOffset = player.size * 0.4;
    const ex = Math.cos(eyeAngle) * eyeOffset;
    const ey = Math.sin(eyeAngle) * eyeOffset;
    ctx.beginPath();
    ctx.arc(x + ex, y + ey, player.size * 0.2, 0, Math.PI * 2);
    ctx.arc(x - ex, y - ey, player.size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ccc';
    ctx.fill();
    const nx = Math.cos(angle) * player.size * 0.6;
    const ny = Math.sin(angle) * player.size * 0.6;
    const held = player.hotbar && player.hotbar[player.heldIndex];
    if (held) {
        const icon = ITEM_ICONS[held.item];
        if (icon) {
            if (!itemImages[icon]) { const img = new Image(); img.src = `/icons/${icon}`; itemImages[icon] = img; }
            const img = itemImages[icon];
            const hx = x + Math.cos(angle) * (player.size + 10);
            const hy = y + Math.sin(angle) * (player.size + 10);
            ctx.drawImage(img, hx - 12, hy - 12, 24, 24);
        }
    }
    ctx.beginPath();
    ctx.arc(x + nx, y + ny, player.size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    if (player.hp < player.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(x - player.size, y - player.size - 10, player.size * 2, 6);
        ctx.fillStyle = 'green';
        ctx.fillRect(x - player.size, y - player.size - 10, (player.hp / player.maxHp) * player.size * 2, 6);
    }
    if (player.burn && player.burn > 0) {
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(Date.now() / 100);
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(x, y, player.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
function drawResource(resource) {
    if (resource.harvested) {
        if (resource.type === 'tree') {
            drawShadow(resource.x, resource.y, resource.size / 2, resource.size / 4);
            ctx.fillStyle = '#654321';
            ctx.beginPath();
            ctx.arc(resource.x, resource.y, resource.size / 4, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }
    if (resource.type === 'tree') {
        const trunkSize = resource.size / 4;
        drawShadow(resource.x, resource.y, resource.size, resource.size / 2);
        ctx.drawImage(treeTrunkImg, resource.x - trunkSize / 2, resource.y - trunkSize / 2, trunkSize, trunkSize);
        if (resource.phase === 1) {
            ctx.drawImage(treeTopImg, resource.x - resource.size / 2, resource.y - resource.size / 2, resource.size, resource.size);
            if (resource.apples && resource.apples > 0) {
                ctx.drawImage(appleImg, resource.x - 8, resource.y - resource.size / 2 - 16, 16, 16);
            }
            ctx.save();
            ctx.globalCompositeOperation = 'source-atop';
            const grad = ctx.createRadialGradient(resource.x, resource.y, 0, resource.x, resource.y, resource.size / 2);
            grad.addColorStop(0, 'rgba(0,255,0,0.4)');
            grad.addColorStop(1, 'rgba(0,255,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(resource.x - resource.size / 2, resource.y - resource.size / 2, resource.size, resource.size);
            ctx.restore();
        }
    } else if (resource.type === 'rock') {
        drawShadow(resource.x, resource.y, resource.size, resource.size / 2);
        ctx.fillStyle = '#808080';
        ctx.beginPath();
        ctx.arc(resource.x, resource.y, resource.size / 2, 0, Math.PI * 2);
        ctx.fill();
    }
    if (resource.hp < resource.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(resource.x - resource.size / 2, resource.y - resource.size / 2 - 15, resource.size, 10);
        ctx.fillStyle = 'green';
        const hpWidth = (resource.hp / resource.maxHp) * resource.size;
        ctx.fillRect(resource.x - resource.size / 2, resource.y - resource.size / 2 - 15, hpWidth, 10);
    }
}
function drawBoar(boar) {
    const size = boar.size * 2;
    drawShadow(boar.x, boar.y, size, size / 2);
    if (boar.color) {
        ctx.save();
        ctx.drawImage(boarImg, boar.x - size / 2, boar.y - size / 2, size, size);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = boar.color;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(boar.x, boar.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
    } else {
        ctx.drawImage(boarImg, boar.x - size / 2, boar.y - size / 2, size, size);
    }
    if (boar.hp < boar.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(boar.x - boar.size, boar.y - boar.size - 10, boar.size * 2, 6);
        ctx.fillStyle = 'green';
        ctx.fillRect(boar.x - boar.size, boar.y - boar.size - 10, (boar.hp / boar.maxHp) * boar.size * 2, 6);
    }
}
function drawZombie(zombie) {
    const x = zombie.x;
    const y = zombie.y;
    const angle = zombie.angle || 0;
    drawShadow(x, y, zombie.size * 2, zombie.size);
    ctx.beginPath();
    ctx.arc(x, y, zombie.size, 0, Math.PI * 2);
    ctx.fillStyle = '#6b8e23';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.stroke();
    const eyeAngle = angle + Math.PI / 2;
    const eyeOffset = zombie.size * 0.4;
    const ex = Math.cos(eyeAngle) * eyeOffset;
    const ey = Math.sin(eyeAngle) * eyeOffset;
    ctx.beginPath();
    ctx.arc(x + ex, y + ey, zombie.size * 0.2, 0, Math.PI * 2);
    ctx.arc(x - ex, y - ey, zombie.size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ccc';
    ctx.fill();
    const nx = Math.cos(angle) * zombie.size * 0.6;
    const ny = Math.sin(angle) * zombie.size * 0.6;
    ctx.beginPath();
    ctx.arc(x + nx, y + ny, zombie.size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    if (zombie.burn && zombie.burn > 0) {
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(Date.now() / 100);
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(x, y, zombie.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    if (zombie.hp < zombie.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(x - zombie.size, y - zombie.size - 10, zombie.size * 2, 6);
        ctx.fillStyle = 'green';
        ctx.fillRect(x - zombie.size, y - zombie.size - 10, (zombie.hp / zombie.maxHp) * zombie.size * 2, 6);
    }
}

function drawOgre(ogre) {
    drawShadow(ogre.x, ogre.y, ogre.size * 2, ogre.size);
    ctx.beginPath();
    ctx.arc(ogre.x, ogre.y, ogre.size, 0, Math.PI * 2);
    ctx.fillStyle = '#800080';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.drawImage(fireStaffImg, ogre.x - 16, ogre.y - 16, 32, 32);
    if (ogre.burn && ogre.burn > 0) {
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(Date.now() / 100);
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(ogre.x, ogre.y, ogre.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    if (ogre.hp < ogre.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(ogre.x - ogre.size, ogre.y - ogre.size - 10, ogre.size * 2, 6);
        ctx.fillStyle = 'green';
        ctx.fillRect(ogre.x - ogre.size, ogre.y - ogre.size - 10, (ogre.hp / ogre.maxHp) * ogre.size * 2, 6);
    }
}

function drawProjectile(p) {
    drawShadow(p.x, p.y, 16, 8);
    ctx.drawImage(fireBallImg, p.x - 8, p.y - 8, 16, 16);
}

function drawGroundItem(item) {
    const icon = ITEM_ICONS[item.item];
    if (!icon) return;
    if (!itemImages[icon]) { const img = new Image(); img.src = `/icons/${icon}`; itemImages[icon] = img; }
    const img = itemImages[icon];
    drawShadow(item.x, item.y, 32, 16);
    ctx.drawImage(img, item.x - 16, item.y - 16, 32, 32);
}
function drawStructure(structure) {
    const size = structure.size || (structure.type === 'workbench' ? GRID_CELL_SIZE : BLOCK_SIZE);
    drawShadow(structure.x + size / 2, structure.y + size / 2, size, size / 2);
    if (structure.type === 'wood_wall') {
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(structure.x, structure.y, size, size);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(structure.x, structure.y, size, size);
    } else if (structure.type === 'stone_wall') {
        ctx.fillStyle = '#808080';
        ctx.fillRect(structure.x, structure.y, size, size);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(structure.x, structure.y, size, size);
    } else if (structure.type === 'workbench') {
        ctx.drawImage(workbenchImg, structure.x, structure.y, size, size);
    } else if (structure.type === 'furnace') {
        ctx.drawImage(ovenImg, structure.x, structure.y, size, size);
    } else if (structure.type === 'bed') {
        ctx.drawImage(bedImg, structure.x, structure.y, size, size);
    }
}
function render() {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const transition = 60 * 1000;
    const cycleDuration = dayNight.DAY_DURATION + dayNight.NIGHT_DURATION;
    const cycleTime = dayNight.cycleTime % cycleDuration;
    let darkness = 0;
    if (cycleTime < dayNight.DAY_DURATION) {
        if (cycleTime > dayNight.DAY_DURATION - transition) {
            darkness = 0.8 * (cycleTime - (dayNight.DAY_DURATION - transition)) / transition;
        }
    } else {
        const nightProgress = cycleTime - dayNight.DAY_DURATION;
        if (nightProgress < dayNight.NIGHT_DURATION - transition) {
            darkness = 0.8;
        } else {
            darkness = 0.8 * (1 - (nightProgress - (dayNight.NIGHT_DURATION - transition)) / transition);
        }
    }
    ctx.translate(-camera.x, -camera.y);
    ctx.fillStyle = '#5c8b5c';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += GRID_CELL_SIZE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke(); }
    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_CELL_SIZE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke(); }
    resources.forEach(drawResource);
    groundItems.forEach(drawGroundItem);
    boars.forEach(drawBoar);
    ogres.forEach(drawOgre);
    projectiles.forEach(drawProjectile);
    zombies.forEach(drawZombie);
    Object.values(structures).forEach(drawStructure);
    Object.values(players).forEach(p => drawPlayer(p, p.id === myPlayerId));
    ctx.restore();
    ctx.fillStyle = `rgba(0, 0, 50, ${darkness})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (deathFadeDir !== 0) {
        deathFade += 0.02 * deathFadeDir;
        if (deathFade >= 1) { deathFade = 1; deathFadeDir = -1; }
        if (deathFade <= 0) { deathFade = 0; deathFadeDir = 0; }
    }
    if (deathFade > 0) {
        ctx.fillStyle = `rgba(0,0,0,${deathFade})`;
        ctx.fillRect(0,0,canvas.width,canvas.height);
    }
}
let gameLoopStarted = false;
function gameLoop() {
    if (players[myPlayerId]) {
        if (document.activeElement !== chatInput) playerMovement();
        const me = players[myPlayerId];
        camera.x = lerp(camera.x, me.x - canvas.width / 2, 0.1);
        camera.y = lerp(camera.y, me.y - canvas.height / 2, 0.1);
        for (const id in players) {
            if (id !== myPlayerId) {
                const p = players[id];
                if (p && p.targetX !== undefined) {
                    p.renderX = lerp(p.renderX, p.targetX, 0.2);
                    p.renderY = lerp(p.renderY, p.targetY, 0.2);
                }
            }
        }
    }
    render();
    requestAnimationFrame(gameLoop);
}

// --- Other UI Listeners & Functions ---
function createFloatingText(text, x, y) { const el = document.createElement('div'); el.className = 'floating-text'; el.textContent = text; document.body.appendChild(el); function updatePos(){ const screenX = x - camera.x; const screenY = y - camera.y; el.style.left = `${screenX}px`; el.style.top = `${screenY}px`; if (getComputedStyle(el).opacity > 0) requestAnimationFrame(updatePos); } updatePos(); setTimeout(() => el.remove(), 1500); }
function showNotification(message){ const cont = document.getElementById('notifications'); const n = document.createElement('div'); n.className='notification-message'; n.textContent = message; cont.appendChild(n); setTimeout(()=>n.remove(), 5000); }
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { if(chatInput.value.trim().length > 0) { socket.send(JSON.stringify({ type: 'chat', message: chatInput.value })); chatInput.value = ''; } chatInput.blur(); } });
furnaceCookBtn.addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'furnace-cook', input: furnaceInput.value, fuel: furnaceFuel.value }));
    furnaceScreen.classList.add('hidden');
});
function addChatMessage(sender, message){ const li = document.createElement('li'); li.textContent = `${sender.substring(0,6)}: ${message}`; chatMessages.appendChild(li); chatMessages.scrollTop = chatMessages.scrollHeight; }
window.addEventListener('keydown', e => { if (e.key === 'Enter' && document.activeElement !== chatInput) { e.preventDefault(); chatInput.focus(); } });
window.addEventListener('keydown', e => { if (e.code === 'KeyE' && document.activeElement !== chatInput) { inventoryScreen.classList.toggle('hidden'); if (!inventoryScreen.classList.contains('hidden')) { updateInventoryUI(); updateCraftingUI(); } } });
window.addEventListener('keydown', e => {
    if (document.activeElement !== chatInput && e.code.startsWith('Digit')) {
        const digit = parseInt(e.code.replace('Digit', '')) - 1;
        if (digit >= 0 && digit < 4) {
            selectedHotbarSlot = digit;
            if (players[myPlayerId]) players[myPlayerId].heldIndex = selectedHotbarSlot;
            updateHotbarUI();
            socket.send(JSON.stringify({ type: 'held-item', index: selectedHotbarSlot }));
        }
    }
});
window.addEventListener('keydown', e => {
    if (document.activeElement !== chatInput && e.code === 'KeyF') {
        socket.send(JSON.stringify({ type: 'consume-item', hotbarIndex: selectedHotbarSlot }));
    }
});
window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && !furnaceScreen.classList.contains('hidden')) {
        furnaceScreen.classList.add('hidden');
    }
});
updateHotbarUI();