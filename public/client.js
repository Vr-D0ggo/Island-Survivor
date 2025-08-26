// client.js (Full, Complete Code)

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

console.log("Client script started.");

// --- WebSocket Connection ---
// Dynamically determines ws or wss for compatibility with local and deployed environments.
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${protocol}://${window.location.host}`);

socket.onopen = () => console.log("✅ WebSocket connection established successfully!");
socket.onerror = (error) => console.error("❌ WebSocket Error:", error);

// --- Audio Handling ---
const morningMusic = new Audio('/morning.mp3');
morningMusic.loop = true;
const nightMusic = new Audio('/night.mp3');
nightMusic.loop = true;
let audioStarted = false;

function playMusicForPhase(isDay) {
    if (!audioStarted) return; // Don't play until user has interacted
    
    const musicToPlay = isDay ? morningMusic : nightMusic;
    const musicToStop = isDay ? nightMusic : morningMusic;

    // Stop and fade out the old track
    musicToStop.volume = 0;
    musicToStop.pause();
    
    // Play and fade in the new track
    musicToPlay.play().catch(e => console.error("Audio play failed:", e));
    musicToPlay.volume = 0.5; // Set your desired volume
}

// Browsers require a user interaction (like a click) to start playing audio.
window.addEventListener('click', () => {
    if (!audioStarted) {
        console.log("Audio context started by user interaction.");
        audioStarted = true;
        playMusicForPhase(dayNight.isDay); // Start playing the correct music immediately
    }
}, { once: true });


// --- Game State ---
let myPlayerId = null;
let players = {};
let resources = [];
let structures = {}; // Stores player-built structures
let camera = { x: 0, y: 0 };
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const GRID_CELL_SIZE = 50;
let dayNight = { isDay: true, cycleTime: 0, DAY_DURATION: 10 * 60 * 1000, NIGHT_DURATION: 7 * 60 * 1000 };

// --- Input & UI State ---
const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

const hotbarSlots = [document.getElementById('hotbar-0'), document.getElementById('hotbar-1'), document.getElementById('hotbar-2'), document.getElementById('hotbar-3')];
const inventoryScreen = document.getElementById('inventory-screen');
const inventoryGrid = document.getElementById('inventory-grid');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
let selectedHotbarSlot = 0;


// --- Helper Functions ---
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }

/**
 * Prepares a player object for rendering by setting initial render coordinates.
 * This is crucial for making existing players appear instantly and smoothly.
 */
function initializePlayerForRender(player) {
    if (player) {
        player.renderX = player.x;
        player.renderY = player.y;
    }
}

// --- WebSocket Message Handling ---
socket.onmessage = event => {
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'init':
            myPlayerId = data.playerId;
            players = data.players;
            resources = data.resources;
            structures = data.structures;
            dayNight = data.dayNight;
            // === FIX FOR PLAYER VISIBILITY BUG ===
            // Initialize all existing players for smooth rendering from the start.
            Object.values(players).forEach(initializePlayerForRender);
            if (!gameLoopStarted) { requestAnimationFrame(gameLoop); gameLoopStarted = true; }
            break;
        case 'game-state':
            const lastIsDay = dayNight.isDay;
            dayNight = data.dayNight;
            // Check if the day/night phase has changed to switch music
            if (lastIsDay !== dayNight.isDay) {
                playMusicForPhase(dayNight.isDay);
            }
            // Update player data
            for (const id in data.players) {
                if (id === myPlayerId) { // Server reconciliation for our own player
                    const serverPlayer = data.players[id];
                    const clientPlayer = players[id];
                    if (clientPlayer) {
                        const dist = Math.hypot(serverPlayer.x - clientPlayer.x, serverPlayer.y - clientPlayer.y);
                        if (dist > 20) { clientPlayer.x = serverPlayer.x; clientPlayer.y = serverPlayer.y; } // Snap if too far
                    }
                } else { // Interpolation for other players
                    if (players[id]) {
                        players[id].targetX = data.players[id].x;
                        players[id].targetY = data.players[id].y;
                    } else { // A player joined that we somehow missed, add them
                        players[id] = data.players[id];
                        initializePlayerForRender(players[id]);
                    }
                }
            }
            break;
        case 'player-join':
            if (data.player.id !== myPlayerId) {
                players[data.player.id] = data.player;
                initializePlayerForRender(players[data.player.id]); // Initialize new player
            }
            break;
        case 'player-leave':
            delete players[data.playerId];
            break;
        case 'resource-update':
            const resIndex = resources.findIndex(r => r.id === data.resource.id);
            if (resIndex !== -1) resources[resIndex] = data.resource;
            break;
        case 'structure-update':
            structures = data.structures;
            break;
        case 'inventory-update':
            const me = players[myPlayerId];
            if (me) { me.inventory = data.inventory; me.hotbar = data.hotbar; updateInventoryUI(); updateHotbarUI(); }
            break;
        case 'item-pickup-notif':
            createFloatingText(`+${data.amount} ${data.item}`, players[myPlayerId].x, players[myPlayerId].y);
            break;
        case 'notification':
            showNotification(data.message);
            break;
        case 'chat-message':
            addChatMessage(data.sender, data.message);
            break;
    }
};

// --- Player Interaction ---
function playerMovement() {
    const player = players[myPlayerId]; if (!player) return;
    let dx = 0; let dy = 0;
    if (keys['KeyW']) dy -= 1; if (keys['KeyS']) dy += 1;
    if (keys['KeyA']) dx -= 1; if (keys['KeyD']) dx += 1;
    if (dx === 0 && dy === 0) return;

    const magnitude = Math.hypot(dx, dy);
    dx = (dx / magnitude) * player.speed; dy = (dy / magnitude) * player.speed;
    let predictedX = player.x + dx; let predictedY = player.y + dy;
    
    predictedX = Math.max(player.size, Math.min(WORLD_WIDTH - player.size, predictedX));
    predictedY = Math.max(player.size, Math.min(WORLD_HEIGHT - player.size, predictedY));

    // Simple collision with resources and structures
    let collision = false;
    for (const res of resources) {
        if (!res.harvested && Math.hypot(predictedX - res.x, predictedY - res.y) < player.size + res.size / 2) {
            collision = true; break;
        }
    }
    if (!collision) {
        for (const key in structures) {
            const s = structures[key];
            if (predictedX > s.x - player.size && predictedX < s.x + GRID_CELL_SIZE + player.size &&
                predictedY > s.y - player.size && predictedY < s.y + GRID_CELL_SIZE + player.size) {
                collision = true; break;
            }
        }
    }

    if (!collision) {
        player.x = predictedX; player.y = predictedY;
        socket.send(JSON.stringify({ type: 'move', x: player.x, y: player.y }));
    }
}

canvas.addEventListener('mousedown', e => {
    if (!myPlayerId || e.button !== 0) return; // Only process left clicks
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
    if (closestResource) socket.send(JSON.stringify({ type: 'hit-resource', resourceId: closestResource.id }));
});

canvas.addEventListener('contextmenu', e => {
    e.preventDefault(); // Prevent right-click menu
    const me = players[myPlayerId]; if (!me) return;
    const selectedItem = me.hotbar[selectedHotbarSlot];
    if (!selectedItem || (selectedItem.item !== 'Wood' && selectedItem.item !== 'Stone')) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + camera.x;
    const mouseY = e.clientY - rect.top + camera.y;
    
    // Snap mouse coordinates to the world grid
    const targetX = Math.floor(mouseX / GRID_CELL_SIZE) * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
    const targetY = Math.floor(mouseY / GRID_CELL_SIZE) * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;

    socket.send(JSON.stringify({
        type: 'place-item', item: selectedItem.item,
        x: targetX, y: targetY, hotbarIndex: selectedHotbarSlot
    }));
});

// --- Drawing Functions ---
function drawPlayer(player, isMe) {
    const x = isMe ? player.x : player.renderX;
    const y = isMe ? player.y : player.renderY;
    ctx.beginPath(); ctx.arc(x, y, player.size, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? 'hsl(120, 100%, 70%)' : 'hsl(0, 100%, 70%)'; ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - player.size * 0.8, y, player.size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + player.size * 0.8, y, player.size * 0.4, 0, Math.PI * 2); ctx.fillStyle = '#ccc'; ctx.fill();
}

function drawResource(resource) {
    if (resource.harvested) { if (resource.type === 'tree') { ctx.fillStyle = '#654321'; ctx.beginPath(); ctx.arc(resource.x, resource.y, resource.size / 4, 0, Math.PI * 2); ctx.fill(); } return; }
    if (resource.type === 'tree') { ctx.fillStyle = '#8B4513'; ctx.fillRect(resource.x - resource.size/8, resource.y, resource.size/4, resource.size/4); ctx.fillStyle = '#228B22'; ctx.beginPath(); ctx.arc(resource.x, resource.y - resource.size/4, resource.size/2, 0, Math.PI * 2); ctx.fill(); }
    else if (resource.type === 'rock') { ctx.fillStyle = '#808080'; ctx.beginPath(); ctx.arc(resource.x, resource.y, resource.size/2, 0, Math.PI * 2); ctx.fill(); }
    if (resource.hp < resource.maxHp) { ctx.fillStyle = 'red'; ctx.fillRect(resource.x - resource.size/2, resource.y - resource.size/2 - 15, resource.size, 10); ctx.fillStyle = 'green'; const hpWidth = (resource.hp / resource.maxHp) * resource.size; ctx.fillRect(resource.x - resource.size/2, resource.y - resource.size/2 - 15, hpWidth, 10); }
}

function drawStructure(structure) {
    if (structure.type === 'wood_wall') ctx.fillStyle = '#8B4513';
    else if (structure.type === 'stone_wall') ctx.fillStyle = '#808080';
    else return;
    ctx.fillRect(structure.x, structure.y, GRID_CELL_SIZE, GRID_CELL_SIZE);
    ctx.strokeStyle = '#333'; ctx.strokeRect(structure.x, structure.y, GRID_CELL_SIZE, GRID_CELL_SIZE);
}

// --- Main Render Loop ---
function render() {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let darkness = 0; if (!dayNight.isDay) darkness = 0.8;
    ctx.translate(-camera.x, -camera.y);

    ctx.fillStyle = '#5c8b5c'; ctx.fillRect(0,0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += GRID_CELL_SIZE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke(); }
    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_CELL_SIZE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke(); }

    resources.forEach(drawResource);
    Object.values(structures).forEach(drawStructure);
    Object.values(players).forEach(p => drawPlayer(p, p.id === myPlayerId));
    
    ctx.restore();
    ctx.fillStyle = `rgba(0, 0, 50, ${darkness})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// --- Main Game Loop ---
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
                if (p.targetX !== undefined) {
                    p.renderX = lerp(p.renderX, p.targetX, 0.2);
                    p.renderY = lerp(p.renderY, p.targetY, 0.2);
                }
            }
        }
    }
    updateClockUI();
    render();
    requestAnimationFrame(gameLoop);
}

// --- UI Functions and Event Listeners ---
function createFloatingText(text, x, y) { const el = document.createElement('div'); el.className = 'floating-text'; el.textContent = text; document.body.appendChild(el); function updatePos(){ const screenX = x - camera.x; const screenY = y - camera.y; el.style.left = `${screenX}px`; el.style.top = `${screenY}px`; if (getComputedStyle(el).opacity > 0) requestAnimationFrame(updatePos); } updatePos(); setTimeout(() => el.remove(), 1500); }
function showNotification(message){ const cont = document.getElementById('notifications'); const n = document.createElement('div'); n.className='notification-message'; n.textContent = message; cont.appendChild(n); setTimeout(()=>n.remove(), 5000); }
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { if(chatInput.value.trim().length > 0) { socket.send(JSON.stringify({ type: 'chat', message: chatInput.value })); chatInput.value = ''; } chatInput.blur(); } });
function addChatMessage(sender, message){ const li = document.createElement('li'); li.textContent = `${sender.substring(0,6)}: ${message}`; chatMessages.appendChild(li); chatMessages.scrollTop = chatMessages.scrollHeight; }
window.addEventListener('keydown', e => { if (e.key === 'Enter' && document.activeElement !== chatInput) { e.preventDefault(); chatInput.focus(); } });
window.addEventListener('keydown', e => { if (e.code === 'KeyE' && document.activeElement !== chatInput) { inventoryScreen.classList.toggle('hidden'); if(!inventoryScreen.classList.contains('hidden')) updateInventoryUI(); }});
function updateInventoryUI(){
    const me = players[myPlayerId];
    if(!me) return;
    inventoryGrid.innerHTML = '';
    me.inventory.forEach((item, idx) => {
        const slot = document.createElement('div');
        slot.className = 'slot';
        if(item){
            slot.innerHTML = `<div class="item-icon" style="background-image: url('/icons/${item.item.toLowerCase()}.png')"></div><div class="item-quantity">${item.quantity}</div>`;
        }
        slot.addEventListener('click', () => {
            socket.send(JSON.stringify({ type: 'swap-item', inventoryIndex: idx, hotbarIndex: selectedHotbarSlot }));
        });
        inventoryGrid.appendChild(slot);
    });
}
window.addEventListener('keydown', e => { if (document.activeElement !== chatInput && e.code.startsWith('Digit')) { const digit = parseInt(e.code.replace('Digit', '')) - 1; if (digit >= 0 && digit < 4) { selectedHotbarSlot = digit; updateHotbarUI(); } }});
function updateHotbarUI() { const me = players[myPlayerId]; hotbarSlots.forEach((slot, i) => { slot.classList.toggle('selected', i === selectedHotbarSlot); const item = me?.hotbar[i]; if (item) { slot.innerHTML = `<div class="item-icon" style="background-image: url('/icons/${item.item.toLowerCase()}.png')"></div><div class="item-quantity">${item.quantity}</div>`; } else { slot.innerHTML = `${i+1}`; } }); }
function updateClockUI(){ const phaseEl = document.getElementById('clock-phase'); const timeEl = document.getElementById('clock-time'); phaseEl.textContent = dayNight.isDay ? 'Day' : 'Night'; const total = dayNight.isDay ? dayNight.DAY_DURATION : dayNight.NIGHT_DURATION; const current = dayNight.isDay ? dayNight.cycleTime : dayNight.cycleTime - dayNight.DAY_DURATION; const timeLeft = total - current; const minutes = Math.floor(timeLeft / 1000 / 60); const seconds = Math.floor((timeLeft / 1000) % 60); timeEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`; }

// Initial UI setup
updateHotbarUI();