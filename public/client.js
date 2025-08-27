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
let camera = { x: 0, y: 0 };
const WORLD_WIDTH = 3000; const WORLD_HEIGHT = 3000; const GRID_CELL_SIZE = 50;
let dayNight = { isDay: true, cycleTime: 0, DAY_DURATION: 10 * 60 * 1000, NIGHT_DURATION: 7 * 60 * 1000 };
const BLOCK_SIZE = GRID_CELL_SIZE / 2;
const treeTopImg = new Image(); treeTopImg.src = '/icons/Treetop.png';
const treeTrunkImg = new Image(); treeTrunkImg.src = '/icons/Treetrunk.png';
const RECIPES = { Workbench: { cost: { Wood: 5, Stone: 2 }, icon: 'workbench.png' } };

// --- Input & UI State ---
const keys = {}; window.addEventListener('keydown', e => keys[e.code] = true); window.addEventListener('keyup', e => keys[e.code] = false);
const hotbarSlots = [document.getElementById('hotbar-0'), document.getElementById('hotbar-1'), document.getElementById('hotbar-2'), document.getElementById('hotbar-3')];
const inventoryScreen = document.getElementById('inventory-screen'); const inventoryGrid = document.getElementById('inventory-grid'); const recipeList = document.getElementById('recipe-list');
const chatMessages = document.getElementById('chat-messages'); const chatInput = document.getElementById('chat-input');
let selectedHotbarSlot = 0;
let mousePos = { x: 0, y: 0 };
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

// --- Helper Functions ---
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }
function initializePlayerForRender(player) { if (player) { player.renderX = player.x; player.renderY = player.y; } }

// --- WebSocket Message Handling ---
socket.onmessage = event => {
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'init':
            myPlayerId = data.playerId;
            players = data.players || {};
            // CRITICAL FIX: Ensure myPlayerData exists before assigning
            if (data.myPlayerData) {
                players[myPlayerId] = data.myPlayerData;
            }
            resources = data.resources || [];
            structures = data.structures || {};
            dayNight = data.dayNight || dayNight;
            Object.values(players).forEach(initializePlayerForRender);
            if (!gameLoopStarted) { gameLoopStarted = true; requestAnimationFrame(gameLoop); }
            break;
        case 'game-state':
            const lastIsDay = dayNight.isDay; dayNight = data.dayNight; if (lastIsDay !== dayNight.isDay) playMusicForPhase(dayNight.isDay);
            for (const id in data.players) { if (id === myPlayerId) { const serverPlayer = data.players[id]; const clientPlayer = players[id]; if (clientPlayer) { const dist = Math.hypot(serverPlayer.x - clientPlayer.x, serverPlayer.y - clientPlayer.y); if (dist > 20) { clientPlayer.x = serverPlayer.x; clientPlayer.y = serverPlayer.y; } } } else { if (players[id]) { players[id].targetX = data.players[id].x; players[id].targetY = data.players[id].y; } else { players[id] = data.players[id]; initializePlayerForRender(players[id]); } } }
            break;
        case 'player-join': if (data.player.id !== myPlayerId) { players[data.player.id] = data.player; initializePlayerForRender(players[data.player.id]); } break;
        case 'player-leave': delete players[data.playerId]; break;
        case 'resource-update': const resIndex = resources.findIndex(r => r.id === data.resource.id); if (resIndex !== -1) resources[resIndex] = data.resource; break;
        case 'structure-update': structures = data.structures; break;
        case 'inventory-update': const me = players[myPlayerId]; if (me) { me.inventory = data.inventory; me.hotbar = data.hotbar; if (!inventoryScreen.classList.contains('hidden')) { updateInventoryUI(); updateCraftingUI(); } updateHotbarUI(); } break;
        case 'item-pickup-notif': createFloatingText(`+${data.amount} ${data.item}`, players[myPlayerId].x, players[myPlayerId].y); break;
        case 'notification': showNotification(data.message); break;
        case 'chat-message': addChatMessage(data.sender, data.message); break;
    }
};

// --- UI Functions ---
function updateCraftingUI() { const me = players[myPlayerId]; if (!me) return; recipeList.innerHTML = ''; const countItems = (itemName) => { let total = 0; [...me.inventory, ...me.hotbar].forEach(slot => { if (slot && slot.item === itemName) total += slot.quantity; }); return total; }; for (const recipeName in RECIPES) { const recipe = RECIPES[recipeName]; let canCraft = true; let costString = ''; for (const ingredient in recipe.cost) { const owned = countItems(ingredient); const needed = recipe.cost[ingredient]; if (owned < needed) canCraft = false; costString += `${ingredient}: ${owned}/${needed} `; } const recipeEl = document.createElement('div'); recipeEl.className = 'recipe'; if (!canCraft) recipeEl.classList.add('disabled'); recipeEl.innerHTML = `<div class="recipe-icon" style="background-image: url('/icons/${recipe.icon}')"></div><div class="recipe-details"><div class="recipe-name">${recipeName}</div><div class="recipe-cost">${costString.trim()}</div></div><button>Craft</button>`; if (canCraft) { recipeEl.querySelector('button').onclick = () => { socket.send(JSON.stringify({ type: 'craft-item', itemName: recipeName })); }; } recipeList.appendChild(recipeEl); } }
function updateInventoryUI(){ const me = players[myPlayerId]; if(!me || !me.inventory) return; inventoryGrid.innerHTML = ''; me.inventory.forEach((item) => { const slot = document.createElement('div'); slot.className = 'slot'; if(item){ const iconName = item.item.toLowerCase().replace(' ', '_'); slot.innerHTML = `<div class="item-icon" style="background-image: url('/icons/${iconName}.png')"></div><div class="item-quantity">${item.quantity}</div>`; } inventoryGrid.appendChild(slot); });}
function updateHotbarUI() { const me = players[myPlayerId]; if (!me || !me.hotbar) return; hotbarSlots.forEach((slot, i) => { slot.classList.toggle('selected', i === selectedHotbarSlot); const item = me.hotbar[i]; if (item) { const iconName = item.item.toLowerCase().replace(' ', '_'); slot.innerHTML = `<div class="item-icon" style="background-image: url('/icons/${iconName}.png')"></div><div class="item-quantity">${item.quantity}</div>`; } else { slot.innerHTML = `${i+1}`; } }); }

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
    let closestResource = null; let closestDist = Infinity;
    for (const resource of resources) {
        if (!resource.harvested) {
            const dist = Math.hypot(mouseX - resource.x, mouseY - resource.y);
            if (dist < resource.size && dist < closestDist) { closestDist = dist; closestResource = resource; }
        }
    }
    if (closestResource) {
        socket.send(JSON.stringify({ type: 'hit-resource', resourceId: closestResource.id }));
    } else {
        const blockX = Math.floor(mouseX / BLOCK_SIZE);
        const blockY = Math.floor(mouseY / BLOCK_SIZE);
        const key = `b${blockX},${blockY}`;
        if (structures[key]) socket.send(JSON.stringify({ type: 'hit-structure', key }));
    }
});
canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const me = players[myPlayerId];
    if (!me || !me.hotbar) return;
    const selectedItem = me.hotbar[selectedHotbarSlot];
    if (!selectedItem) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + camera.x;
    const mouseY = e.clientY - rect.top + camera.y;
    const snap = selectedItem.item === 'Workbench' ? GRID_CELL_SIZE : BLOCK_SIZE;
    const targetX = Math.floor(mouseX / snap) * snap;
    const targetY = Math.floor(mouseY / snap) * snap;
    socket.send(JSON.stringify({ type: 'place-item', item: selectedItem.item, x: targetX, y: targetY, hotbarIndex: selectedHotbarSlot }));
});

// --- Drawing & Game Loop ---
function drawPlayer(player, isMe) {
    if (!player || player.x === undefined) return;
    const x = isMe ? player.x : player.renderX;
    const y = isMe ? player.y : player.renderY;
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
    }
    const eyeOffset = player.size * 0.8;
    const ex = Math.cos(angle) * eyeOffset;
    const ey = Math.sin(angle) * eyeOffset;
    ctx.beginPath();
    ctx.arc(x + ex, y + ey, player.size * 0.4, 0, Math.PI * 2);
    ctx.arc(x - ex, y - ey, player.size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ccc';
    ctx.fill();
}
function drawResource(resource) {
    if (resource.harvested) {
        if (resource.type === 'tree') {
            ctx.fillStyle = '#654321';
            ctx.beginPath();
            ctx.arc(resource.x, resource.y, resource.size / 4, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }
    if (resource.type === 'tree') {
        const trunkSize = resource.size / 4;
        ctx.drawImage(treeTrunkImg, resource.x - trunkSize / 2, resource.y - trunkSize / 2, trunkSize, trunkSize);
        if (resource.phase === 1) {
            ctx.drawImage(treeTopImg, resource.x - resource.size / 2, resource.y - resource.size / 2, resource.size, resource.size);
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
function drawStructure(structure) {
    if (structure.type === 'wood_wall') ctx.fillStyle = '#8B4513';
    else if (structure.type === 'stone_wall') ctx.fillStyle = '#808080';
    else if (structure.type === 'workbench') ctx.fillStyle = '#deb887';
    else return;
    const size = structure.size || (structure.type === 'workbench' ? GRID_CELL_SIZE : BLOCK_SIZE);
    ctx.fillRect(structure.x, structure.y, size, size);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(structure.x, structure.y, size, size);
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
    Object.values(structures).forEach(drawStructure);
    Object.values(players).forEach(p => drawPlayer(p, p.id === myPlayerId));
    ctx.restore();
    ctx.fillStyle = `rgba(0, 0, 50, ${darkness})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
function addChatMessage(sender, message){ const li = document.createElement('li'); li.textContent = `${sender.substring(0,6)}: ${message}`; chatMessages.appendChild(li); chatMessages.scrollTop = chatMessages.scrollHeight; }
window.addEventListener('keydown', e => { if (e.key === 'Enter' && document.activeElement !== chatInput) { e.preventDefault(); chatInput.focus(); } });
window.addEventListener('keydown', e => { if (e.code === 'KeyE' && document.activeElement !== chatInput) { inventoryScreen.classList.toggle('hidden'); if (!inventoryScreen.classList.contains('hidden')) { updateInventoryUI(); updateCraftingUI(); } } });
window.addEventListener('keydown', e => { if (document.activeElement !== chatInput && e.code.startsWith('Digit')) { const digit = parseInt(e.code.replace('Digit', '')) - 1; if (digit >= 0 && digit < 4) { selectedHotbarSlot = digit; updateHotbarUI(); } }});
updateHotbarUI();