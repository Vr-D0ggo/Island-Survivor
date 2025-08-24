// client.js
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const socket = new WebSocket(`ws://${window.location.host}`);

let myPlayerId = null;
let players = {};
let resources = [];
let camera = { x: 0, y: 0 };
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

let dayNight = {
    isDay: true,
    cycleTime: 0,
    DAY_DURATION: 10 * 60 * 1000,
    NIGHT_DURATION: 7 * 60 * 1000
};

const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// --- UI Elements ---
const hotbarSlots = [document.getElementById('hotbar-0'), document.getElementById('hotbar-1'), document.getElementById('hotbar-2'), document.getElementById('hotbar-3')];
const inventoryScreen = document.getElementById('inventory-screen');
const inventoryGrid = document.getElementById('inventory-grid');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
let selectedHotbarSlot = 0;


// --- Game Logic ---
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

socket.onmessage = event => {
    const data = JSON.parse(event.data);

    switch (data.type) {
        case 'init':
            myPlayerId = data.playerId;
            players = data.players;
            resources = data.resources;
            dayNight = data.dayNight;
            break;
        case 'game-state':
            // Interpolate other players, but reconcile our own player
            for (const id in data.players) {
                if (id === myPlayerId) {
                    // Server reconciliation
                    const serverPlayer = data.players[id];
                    const clientPlayer = players[id];
                    if (clientPlayer) {
                        // Correct position if server diverges significantly
                        const dx = serverPlayer.x - clientPlayer.x;
                        const dy = serverPlayer.y - clientPlayer.y;
                        if (Math.sqrt(dx * dx + dy * dy) > 20) {
                             clientPlayer.x = serverPlayer.x;
                             clientPlayer.y = serverPlayer.y;
                        }
                    } else {
                        players[id] = serverPlayer;
                    }
                } else {
                    // Interpolation for other players
                    if (players[id]) {
                        players[id].targetX = data.players[id].x;
                        players[id].targetY = data.players[id].y;
                    } else {
                        players[id] = data.players[id];
                        players[id].renderX = players[id].x;
                        players[id].renderY = players[id].y;
                    }
                }
            }
            dayNight = data.dayNight;
            break;
        case 'player-join':
            if (data.player.id !== myPlayerId) {
                players[data.player.id] = data.player;
                players[data.player.id].renderX = data.player.x;
                players[data.player.id].renderY = data.player.y;
            }
            break;
        case 'player-leave':
            delete players[data.playerId];
            break;
        case 'resource-update':
            const index = resources.findIndex(r => r.id === data.resource.id);
            if (index !== -1) {
                resources[index] = data.resource;
            }
            break;
        case 'inventory-update':
            const me = players[myPlayerId];
            if (me) {
                me.inventory = data.inventory;
                me.hotbar = data.hotbar;
                updateInventoryUI();
                updateHotbarUI();
            }
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

function playerMovement() {
    const player = players[myPlayerId];
    if (!player) return;

    let dx = 0;
    let dy = 0;
    if (keys['KeyW']) dy -= 1;
    if (keys['KeyS']) dy += 1;
    if (keys['KeyA']) dx -= 1;
    if (keys['KeyD']) dx += 1;

    if (dx !== 0 || dy !== 0) {
        const magnitude = Math.sqrt(dx * dx + dy * dy);
        dx = (dx / magnitude) * player.speed;
        dy = (dy / magnitude) * player.speed;

        // Client-side prediction
        let predictedX = player.x + dx;
        let predictedY = player.y + dy;

        // Simple boundary check
        predictedX = Math.max(player.size, Math.min(WORLD_WIDTH - player.size, predictedX));
        predictedY = Math.max(player.size, Math.min(WORLD_HEIGHT - player.size, predictedY));

        // Simple collision prediction (can be improved)
        for(const resource of resources){
            if(!resource.harvested) {
                const dist = Math.hypot(predictedX - resource.x, predictedY - resource.y);
                if (dist < player.size + resource.size / 2) {
                    predictedX = player.x; // Block movement
                    predictedY = player.y;
                    break;
                }
            }
        }

        player.x = predictedX;
        player.y = predictedY;
        
        socket.send(JSON.stringify({ type: 'move', x: player.x, y: player.y }));
    }
}

// --- Drawing ---
function drawPlayer(player, isMe) {
    const x = isMe ? player.x : player.renderX;
    const y = isMe ? player.y : player.renderY;

    // Body
    ctx.beginPath();
    ctx.arc(x, y, player.size, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? 'hsl(120, 100%, 70%)' : 'hsl(0, 100%, 70%)';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Arms
    ctx.beginPath();
    ctx.arc(x - player.size * 0.8, y, player.size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + player.size * 0.8, y, player.size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ccc';
    ctx.fill();
}

function drawResource(resource) {
    if (resource.harvested) { // Draw a stump
        if (resource.type === 'tree') {
            ctx.fillStyle = '#654321';
            ctx.beginPath();
            ctx.arc(resource.x, resource.y, resource.size / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        // Rocks just disappear, no stump
        return;
    }

    if (resource.type === 'tree') {
        // Trunk
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(resource.x - resource.size/4, resource.y, resource.size/2, resource.size/2);
        // Leaves
        ctx.fillStyle = '#228B22';
        ctx.beginPath();
        ctx.arc(resource.x, resource.y, resource.size, 0, Math.PI * 2);
        ctx.fill();
    } else if (resource.type === 'rock') {
        ctx.fillStyle = '#808080';
        ctx.beginPath();
        ctx.arc(resource.x, resource.y, resource.size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Health bar
    if (resource.hp < resource.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(resource.x - resource.size, resource.y - resource.size - 15, resource.size * 2, 10);
        ctx.fillStyle = 'green';
        const hpWidth = (resource.hp / resource.maxHp) * resource.size * 2;
        ctx.fillRect(resource.x - resource.size, resource.y - resource.size - 15, hpWidth, 10);
    }
}

function update() {
    if (!myPlayerId || !players[myPlayerId]) return;

    if (document.activeElement !== chatInput) {
        playerMovement();
    }

    // Interpolate other players
    for (const id in players) {
        if (id !== myPlayerId) {
            const p = players[id];
            if (p.targetX) {
                p.renderX = lerp(p.renderX, p.targetX, 0.2);
                p.renderY = lerp(p.renderY, p.targetY, 0.2);
            }
        }
    }

    // Update camera to follow player
    const me = players[myPlayerId];
    camera.x = lerp(camera.x, me.x - canvas.width / 2, 0.1);
    camera.y = lerp(camera.y, me.y - canvas.height / 2, 0.1);

    updateClockUI();
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Day/Night overlay first
    const cycleProgress = dayNight.cycleTime / (dayNight.isDay ? dayNight.DAY_DURATION : dayNight.NIGHT_DURATION);
    let darkness = 0;
    if (!dayNight.isDay) {
        darkness = 0.8;
    } else {
        // Smooth transition at dawn/dusk
        if (dayNight.cycleTime > dayNight.DAY_DURATION - 1000*60) { // Last minute of day
            darkness = ((dayNight.cycleTime - (dayNight.DAY_DURATION - 1000*60)) / (1000*60)) * 0.8;
        } else if (dayNight.cycleTime < 1000*60) { // First minute of day
            darkness = (1 - (dayNight.cycleTime / (1000*60))) * 0.8;
        }
    }
    ctx.fillStyle = `rgba(0, 0, 50, ${darkness})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);


    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Draw world background/grid
    ctx.strokeStyle = '#3a5c3a';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_HEIGHT);
        ctx.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_WIDTH, y);
        ctx.stroke();
    }
    ctx.fillStyle = '#5c8b5c';
    ctx.fillRect(0,0, WORLD_WIDTH, WORLD_HEIGHT);


    resources.forEach(drawResource);
    Object.values(players).forEach(p => {
        drawPlayer(p, p.id === myPlayerId);
    });

    ctx.restore();
}

function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// --- UI Interaction and Updates ---

// Inventory
window.addEventListener('keydown', e => {
    if (e.code === 'KeyE' && document.activeElement !== chatInput) {
        inventoryScreen.classList.toggle('hidden');
        if(!inventoryScreen.classList.contains('hidden')){
            updateInventoryUI();
        }
    }
});
function updateInventoryUI(){
    const me = players[myPlayerId];
    if(!me) return;

    inventoryGrid.innerHTML = '';
    me.inventory.forEach((item, index) => {
        const slot = document.createElement('div');
        slot.className = 'slot';
        if(item){
            slot.innerHTML = `
                <div class="item-icon" style="background-image: url('/icons/${item.item.toLowerCase()}.png')"></div>
                <div class="item-quantity">${item.quantity}</div>
            `;
        }
        inventoryGrid.appendChild(slot);
    });
}

// Hotbar
window.addEventListener('keydown', e => {
    if (document.activeElement !== chatInput && e.code.startsWith('Digit')) {
        const digit = parseInt(e.code.replace('Digit', '')) - 1;
        if (digit >= 0 && digit < 4) {
            selectedHotbarSlot = digit;
            updateHotbarUI();
        }
    }
});
function updateHotbarUI() {
    const me = players[myPlayerId];
    hotbarSlots.forEach((slot, i) => {
        slot.classList.toggle('selected', i === selectedHotbarSlot);
        const item = me?.hotbar[i];
        if (item) {
            slot.innerHTML = `
                <div class="item-icon" style="background-image: url('/icons/${item.item.toLowerCase()}.png')"></div>
                <div class="item-quantity">${item.quantity}</div>
            `;
        } else {
            slot.innerHTML = `${i+1}`;
        }
    });
}

// Clock
function updateClockUI(){
    const phaseEl = document.getElementById('clock-phase');
    const timeEl = document.getElementById('clock-time');
    
    phaseEl.textContent = dayNight.isDay ? 'Day' : 'Night';
    const total = dayNight.isDay ? dayNight.DAY_DURATION : dayNight.NIGHT_DURATION;
    const current = dayNight.isDay ? dayNight.cycleTime : dayNight.cycleTime - dayNight.DAY_DURATION;
    const timeLeft = total - current;

    const minutes = Math.floor(timeLeft / 1000 / 60);
    const seconds = Math.floor((timeLeft / 1000) % 60);
    timeEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Hitting resources
canvas.addEventListener('mousedown', e => {
    if (!myPlayerId) return;
    const me = players[myPlayerId];

    // Convert screen coords to world coords
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + camera.x;
    const mouseY = e.clientY - rect.top + camera.y;

    let closestResource = null;
    let closestDist = Infinity;

    for (const resource of resources) {
        if (!resource.harvested) {
            const dist = Math.hypot(mouseX - resource.x, mouseY - resource.y);
            if (dist < resource.size && dist < closestDist) {
                closestDist = dist;
                closestResource = resource;
            }
        }
    }

    if (closestResource) {
        socket.send(JSON.stringify({ type: 'hit-resource', resourceId: closestResource.id }));
    }
});

// Floating Text
function createFloatingText(text, x, y) {
    const textEl = document.createElement('div');
    textEl.className = 'floating-text';
    textEl.textContent = text;
    document.body.appendChild(textEl);
    
    // Position based on world coordinates
    function updatePosition(){
        const screenX = x - camera.x;
        const screenY = y - camera.y;
        textEl.style.left = `${screenX}px`;
        textEl.style.top = `${screenY}px`;
        if (parseFloat(textEl.style.opacity) > 0) {
            requestAnimationFrame(updatePosition);
        }
    }
    updatePosition();

    setTimeout(() => textEl.remove(), 1500);
}

// Notifications
function showNotification(message){
    const notifContainer = document.getElementById('notifications');
    const notif = document.createElement('div');
    notif.className = 'notification-message';
    notif.textContent = message;
    notifContainer.appendChild(notif);
    setTimeout(() => notif.remove(), 5000);
}

// Chat
chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        if(chatInput.value.trim().length > 0) {
            socket.send(JSON.stringify({ type: 'chat', message: chatInput.value }));
            chatInput.value = '';
        }
        chatInput.blur();
    }
});
function addChatMessage(sender, message){
    const li = document.createElement('li');
    li.textContent = `${sender.substring(0, 6)}: ${message}`;
    chatMessages.appendChild(li);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}


// To get this working, you'll need some simple icons.
// Create a folder `public/icons` and add `wood.png` and `stone.png`.
// You can find free icons online or create simple ones.

updateHotbarUI();