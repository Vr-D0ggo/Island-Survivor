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

function safeSend(data) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

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
let frostWraiths = [];
let titan = null;
let groundItems = [];
let projectiles = [];
let explosions = [];
let riftBlizzard = { active: false };
let selectedMageSpell = 'slow';
let selectedKnightAbility = 'non';
let selectedRogueAbility = 'bomb';
let selectedGuardianAbility = 'shield-wall';
let attackCooldown = 0; // no global left-click cooldown
let camera = { x: 0, y: 0 };
let rockBossDefeated = false;
let gateWarning = 0;
const OLD_WORLD_WIDTH = 3000;
const WORLD_WIDTH = OLD_WORLD_WIDTH * 3;
const GLACIAL_RIFT_START_X = OLD_WORLD_WIDTH * 2;
const GLACIAL_RIFT_END_X = WORLD_WIDTH;
const WORLD_HEIGHT = 3000;
const GRID_CELL_SIZE = 50;
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
const arrowImg = new Image(); arrowImg.src = '/icons/Arrow.png';
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
    'Wooden Sword': 'WoodSword.png',
    'Stone Axe': 'Axe.png',
    'Stone Pickaxe': 'Pickaxe.png',
    'Stone Sword': 'IronSword.png',
    'Workbench': 'workbench.png',
    'Furnace': 'Oven.png',
    'Bed': 'Bed.png',
    'Fire Staff': 'FireStaff.png',
    'Torch': 'FireBall.png',
    'Bow': 'Bow.png',
    'Arrow': 'Arrow.png',
    'Mace': 'Mace.png'
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
    'Bed': { cost: { Wood: 20, Leaf: 40 }, icon: ITEM_ICONS['Bed'] },
    'Torch': { cost: { Wood: 3 }, icon: ITEM_ICONS['Torch'] },
    'Bow': { cost: { Wood: 3, Stone: 2 }, icon: ITEM_ICONS['Bow'] },
    'Arrow': { cost: { Wood: 1, Stone: 1 }, icon: ITEM_ICONS['Arrow'], amount: 2, noWorkbench: true }
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
const manaFill = document.getElementById('player-mana-fill');
const manaBar = document.getElementById('player-mana-bar');
const attackFill = document.getElementById('player-attack-fill');
const attackBar = document.getElementById('player-attack-bar');
const deathScreen = document.getElementById('death-screen');
const deathMessage = document.getElementById('death-message');
const respawnBtn = document.getElementById('respawn-btn');
const menuBtn = document.getElementById('menu-btn');
const preSpawnScreen = document.getElementById('pre-spawn-screen');
const nameInput = document.getElementById('name-input');
const colorInput = document.getElementById('color-input');
const eyeColorInput = document.getElementById('eye-color-input');
const outlineColorInput = document.getElementById('outline-color-input');
const customizeBtn = document.getElementById('customize-btn');
const customizationPanel = document.getElementById('customization-panel');
const mouthSelect = document.getElementById('mouth-select');
const mouthColorInput = document.getElementById('mouth-color-input');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;
const startBtn = document.getElementById('start-btn');
const controlsScreen = document.getElementById('controls-screen');
const controlsBtn = document.getElementById('controls-btn');
const classScreen = document.getElementById('class-screen');
const classButtons = document.querySelectorAll('.class-option');
const levelIndicator = document.getElementById('level-indicator');
const summonerBar = document.getElementById('summoner-bar');
const abilityIndicator = document.getElementById('ability-indicator');
const skillTree = document.getElementById('skill-tree');
const skillPointsElem = document.getElementById('skill-points');
const rangeNode = document.getElementById('skill-range');
const mageNode = document.getElementById('skill-mage');
const knightNode = document.getElementById('skill-knight');
const summonerNode = document.getElementById('skill-summoner');
const rogueNode = document.getElementById('skill-rogue');
const knightSkillGroup = document.getElementById('knight-skills');
const summonerSkillGroup = document.getElementById('summoner-skills');
const mageSkillGroup = document.getElementById('mage-skills');
const rogueSkillGroup = document.getElementById('rogue-skills');
const knightSkillNodes = [
    document.getElementById('skill-knight-damage'),
    document.getElementById('skill-knight-speed'),
    document.getElementById('skill-knight-health'),
    document.getElementById('skill-knight-shield'),
    document.getElementById('skill-knight-whirlwind'),
    document.getElementById('skill-knight-attack-range')
];
const knightSkillPrereqs = {
    'knight-shield': 'knight-speed',
    'knight-whirlwind': 'knight-damage',
    'knight-attack-range': 'knight-whirlwind'
};
const summonerSkillNodes = [
    document.getElementById('skill-summoner-attack'),
    document.getElementById('skill-summoner-healer'),
    document.getElementById('skill-summoner-ranged'),
    document.getElementById('skill-summoner-ranged-stop'),
    document.getElementById('skill-summoner-ranged-flee'),
    document.getElementById('skill-summoner-lockon')
];
const mageSkillNodes = [
    document.getElementById('skill-mage-mana'),
    document.getElementById('skill-mage-regen'),
    document.getElementById('skill-mage-flame'),
    document.getElementById('skill-mage-slow'),
    document.getElementById('skill-mage-slow-extend'),
    document.getElementById('skill-mage-bind'),
    document.getElementById('skill-mage-missile'),
    document.getElementById('skill-mage-missile-upgrade')
];
const mageSkillPrereqs = {
    'mage-slow-extend': 'mage-slow',
    'mage-bind': 'mage-slow-extend',
    'mage-missile': 'mage-mana',
    'mage-missile-upgrade': 'mage-missile',
    'mage-flame': 'mage-regen'
};
const rogueSkillNodes = [
    document.getElementById('skill-rogue-bomb'),
    document.getElementById('skill-rogue-sticky'),
    document.getElementById('skill-rogue-smoke'),
    document.getElementById('skill-rogue-teleport'),
    document.getElementById('skill-rogue-bow')
];
const rogueSkillPrereqs = { 'rogue-smoke': 'rogue-bomb', 'rogue-sticky': 'rogue-bomb' };

function renderMouth(ctx, x, y, size, type, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    switch (type) {
        case 'line':
            ctx.beginPath();
            ctx.moveTo(x - size, y);
            ctx.lineTo(x + size, y);
            ctx.stroke();
            break;
        case 'square':
            ctx.fillRect(x - size, y - size, size * 2, size * 2);
            break;
        case 'circle':
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'oval':
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(1.5, 1);
            ctx.beginPath();
            ctx.arc(0, 0, size, 0, Math.PI * 2);
            ctx.restore();
            ctx.fill();
            break;
        case 'diamond':
            ctx.beginPath();
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size, y);
            ctx.lineTo(x, y + size);
            ctx.lineTo(x - size, y);
            ctx.closePath();
            ctx.fill();
            break;
        case 'triangle':
            ctx.beginPath();
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size, y + size);
            ctx.lineTo(x - size, y + size);
            ctx.closePath();
            ctx.fill();
            break;
    }
}

function orderSkillGroup(group, prereqs) {
    const nodes = Array.from(group.children);
    const depth = skill => {
        let d = 0; let s = skill;
        while (prereqs[s]) { d++; s = prereqs[s]; }
        return d;
    };
    nodes.sort((a, b) => depth(a.dataset.skill) - depth(b.dataset.skill));
    nodes.forEach(n => group.appendChild(n));
}
if (knightSkillGroup) orderSkillGroup(knightSkillGroup, knightSkillPrereqs);
if (mageSkillGroup) orderSkillGroup(mageSkillGroup, mageSkillPrereqs);
if (rogueSkillGroup) orderSkillGroup(rogueSkillGroup, rogueSkillPrereqs);
let selectedHotbarSlot = 0;
let mousePos = { x: 0, y: 0 };
let dragData = null; let dropHandled = false;
let deathFade = 0;
let deathFadeDir = 0;
let preSpawn = true;
let spectatorTarget = null;
// Current minion type to spawn for summoners.
let summonerSpawnType = 'attack';
if (respawnBtn) respawnBtn.onclick = () => { preSpawn = false; deathScreen.classList.add('hidden'); socket.send(JSON.stringify({ type: 'respawn' })); };
if (menuBtn) menuBtn.onclick = () => { deathScreen.classList.add('hidden'); preSpawnScreen.classList.remove('hidden'); preSpawn = true; };
if (controlsBtn) controlsBtn.onclick = () => { controlsScreen.classList.add('hidden'); preSpawnScreen.classList.remove('hidden'); };
if (startBtn) startBtn.onclick = () => { preSpawnScreen.classList.add('hidden'); classScreen.classList.remove('hidden'); };
if (customizeBtn) customizeBtn.onclick = () => {
    customizationPanel.classList.toggle('hidden');
    drawPreview();
};
// Update preview and send new appearance when customization changes
[colorInput, eyeColorInput, outlineColorInput, mouthSelect, mouthColorInput].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
        drawPreview();
        safeSend({
            type: 'set-name',
            name: nameInput.value || 'Survivor',
            color: colorInput.value,
            eyeColor: eyeColorInput.value,
            outlineColor: outlineColorInput.value,
            mouth: mouthSelect.value,
            mouthColor: mouthColorInput.value
        });
    });
});
function drawPreview() {
    if (!previewCtx) return;
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const x = previewCanvas.width / 2;
    const y = previewCanvas.height / 2;
    const size = 30;
    previewCtx.beginPath();
    previewCtx.arc(x, y, size, 0, Math.PI * 2);
    previewCtx.fillStyle = colorInput.value;
    previewCtx.fill();
    previewCtx.strokeStyle = outlineColorInput.value;
    previewCtx.lineWidth = 3;
    previewCtx.stroke();
    previewCtx.beginPath();
    previewCtx.arc(x - size * 0.4, y - size * 0.4, size * 0.2, 0, Math.PI * 2);
    previewCtx.arc(x + size * 0.4, y + size * 0.4, size * 0.2, 0, Math.PI * 2);
    previewCtx.fillStyle = eyeColorInput.value;
    previewCtx.fill();
    renderMouth(previewCtx, x, y + size * 0.4, size * 0.2, mouthSelect.value, mouthColorInput.value);
}
classButtons.forEach(btn => {
    btn.onclick = () => {
        const cls = btn.dataset.class;
        classScreen.classList.add('hidden');
        preSpawn = false;
        socket.send(JSON.stringify({ type: 'set-name', name: nameInput.value || 'Survivor', color: colorInput.value, eyeColor: eyeColorInput.value, outlineColor: outlineColorInput.value, mouth: mouthSelect.value, mouthColor: mouthColorInput.value }));
        socket.send(JSON.stringify({ type: 'set-class', class: cls }));
    };
});
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

// --- Helper Functions ---
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }
function initializePlayerForRender(player) { if (player) { player.renderX = player.x; player.renderY = player.y; player.spinAngle = player.spinAngle || 0; } }
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

function updatePlayerManaBar() {
    const me = players[myPlayerId];
    if (me && manaFill && manaBar) {
        if (me.maxMana > 0) {
            manaBar.classList.remove('hidden');
            manaFill.style.height = `${(me.mana / me.maxMana) * 100}%`;
        } else {
            manaBar.classList.add('hidden');
        }
    }
}

function updateAttackBar() {
    if (attackBar) attackBar.classList.add('hidden');
}

function updateLevelUI() {
    const me = players[myPlayerId];
    if (!me) return;
    if (levelIndicator) levelIndicator.textContent = `Level: ${me.level || 1}`;
    if (skillPointsElem) skillPointsElem.textContent = `Points: ${me.skillPoints || 0}`;
    if (rangeNode) {
        const unlocked = me.skills && me.skills.range;
        rangeNode.classList.toggle('unlocked', unlocked);
        rangeNode.classList.toggle('locked', !unlocked);
    }
    [mageNode, knightNode, summonerNode, rogueNode].forEach(node => {
        if (!node) return;
        const skill = node.dataset.skill;
        const unlocked = me.class === skill;
        const available = me.skills && me.skills.range && !me.class;
        node.classList.toggle('hidden', me.class && me.class !== skill);
        node.classList.toggle('unlocked', unlocked);
        node.classList.toggle('locked', !(unlocked || available));
    });
    if (knightSkillGroup) knightSkillGroup.classList.toggle('hidden', me.class !== 'knight');
    if (summonerSkillGroup) summonerSkillGroup.classList.toggle('hidden', me.class !== 'summoner');
    if (mageSkillGroup) mageSkillGroup.classList.toggle('hidden', me.class !== 'mage');
    if (rogueSkillGroup) rogueSkillGroup.classList.toggle('hidden', me.class !== 'rogue');
    knightSkillNodes.forEach(node => {
        const skill = node.dataset.skill;
        const unlocked = me.knightSkills && me.knightSkills[skill];
        node.classList.remove('hidden');
        node.classList.toggle('unlocked', unlocked);
        node.classList.toggle('locked', !unlocked);
    });
    summonerSkillNodes.forEach(node => {
        const available = me.class === 'summoner' && me.skillPoints > 0;
        node.classList.toggle('locked', !available);
        node.classList.toggle('unlocked', available);
    });
    mageSkillNodes.forEach(node => {
        const skill = node.dataset.skill;
        const unlocked = me.mageSkills && me.mageSkills[skill];
        node.classList.remove('hidden');
        node.classList.toggle('unlocked', unlocked);
        node.classList.toggle('locked', !unlocked);
    });
    rogueSkillNodes.forEach(node => {
        const skill = node.dataset.skill;
        const unlocked = me.rogueSkills && me.rogueSkills[skill];
        node.classList.remove('hidden');
        node.classList.toggle('unlocked', unlocked);
        node.classList.toggle('locked', !unlocked);
    });
}

function updateSummonerBar() {
    const me = players[myPlayerId];
    if (!summonerBar || !me || me.class !== 'summoner' || !me.summonerSkills) {
        if (summonerBar) summonerBar.classList.add('hidden');
        return;
    }
    const owned = zombies.filter(z => z.ownerId === myPlayerId && z.minionType === summonerSpawnType).length;
    const max = me.summonerSkills[summonerSpawnType] || 0;
    const remaining = Math.max(0, max - owned);
    const label = summonerSpawnType.charAt(0).toUpperCase() + summonerSpawnType.slice(1);
    summonerBar.textContent = `${label}: ${remaining} left`;
    summonerBar.classList.remove('hidden');
}

function updateAbilityIndicator() {
    const me = players[myPlayerId];
    if (!abilityIndicator || !me) {
        if (abilityIndicator) abilityIndicator.classList.add('hidden');
        return;
    }
    if (me.class === 'mage' && (me.canSlow || me.canBind || me.canMissile || me.canFlame)) {
        const spells = [];
        if (me.canSlow) spells.push('slow');
        if (me.canBind) spells.push('bind');
        if (me.canMissile) spells.push('missile');
        if (me.canFlame) spells.push('flame');
        if (!spells.includes(selectedMageSpell)) selectedMageSpell = spells[0];
        const labelMap = { slow: 'Slow', bind: 'Bind', missile: 'Missile', flame: 'Flame' };
        abilityIndicator.textContent = `Spell: ${labelMap[selectedMageSpell]}`;
        abilityIndicator.classList.remove('hidden');
    } else if (me.class === 'knight' && me.knightSkills && (me.knightSkills['knight-shield'] || me.knightSkills['knight-whirlwind'])) {
        const abilities = ['non'];
        if (me.knightSkills['knight-shield']) abilities.push('dash');
        if (me.knightSkills['knight-whirlwind']) abilities.push('whirlwind');
        if (!abilities.includes(selectedKnightAbility)) selectedKnightAbility = abilities[0];
        const labelMap = { non: 'Non', dash: 'Dash', whirlwind: 'Whirlwind' };
        abilityIndicator.textContent = `Ability: ${labelMap[selectedKnightAbility]}`;
        abilityIndicator.classList.remove('hidden');
    } else if (me.class === 'rogue') {
        const abilities = [];
        if (me.canBomb) abilities.push('bomb');
        if (me.canSmoke) abilities.push('smoke');
        if (me.canTeleport) abilities.push('teleport');
        if (me.rogueSkills && me.rogueSkills['rogue-bow']) abilities.push('bow');
        if (abilities.length > 0) {
            if (!abilities.includes(selectedRogueAbility)) selectedRogueAbility = abilities[0];
            const labelMap = { bomb: 'Bomb', smoke: 'Smoke', teleport: 'Teleport', bow: 'Bow' };
            abilityIndicator.textContent = `Ability: ${labelMap[selectedRogueAbility]}`;
            abilityIndicator.classList.remove('hidden');
        } else {
            abilityIndicator.classList.add('hidden');
        }
    } else if (me.class === 'guardian') {
        const abilities = ['shield-wall', 'taunt', 'fortify'];
        if (!abilities.includes(selectedGuardianAbility)) selectedGuardianAbility = abilities[0];
        const labelMap = { 'shield-wall': 'Shield Wall', taunt: 'Taunt', fortify: 'Fortify' };
        abilityIndicator.textContent = `Ability: ${labelMap[selectedGuardianAbility]}`;
        abilityIndicator.classList.remove('hidden');
    } else {
        abilityIndicator.classList.add('hidden');
    }
}

function getMouseTarget() {
    const mx = mousePos.x + camera.x;
    const my = mousePos.y + camera.y;
    let target = null; let dist = Infinity;
    const check = (entity, type, id) => {
        const size = entity.size || 10;
        const d = Math.hypot(mx - entity.x, my - entity.y);
        if (d < size && d < dist) { dist = d; target = { type, id }; }
    };
    for (const [id, p] of Object.entries(players)) {
        if (id !== myPlayerId && p.active) check(p, 'player', id);
    }
    for (const boar of boars) check(boar, 'boar', boar.id);
    for (const zombie of zombies) check(zombie, 'zombie', zombie.id);
    for (const ogre of ogres) check(ogre, 'ogre', ogre.id);
    for (const w of frostWraiths) check(w, 'wraith', w.id);
    if (titan) check(titan, 'titan', titan.id);
    return target;
}

function drawShadow(x, y, w, h) {
    for (const s of Object.values(structures)) {
        if (s.type === 'torch') {
            const tx = s.x + (s.size || GRID_CELL_SIZE) / 2;
            const ty = s.y + (s.size || GRID_CELL_SIZE) / 2;
            if (Math.hypot(tx - x, ty - y) < 120) return;
        }
    }
    const cycleDuration = dayNight.DAY_DURATION + dayNight.NIGHT_DURATION;
    const cycleTime = dayNight.cycleTime % cycleDuration;
    let alpha = 0.2;
    if (cycleTime >= dayNight.DAY_DURATION) {
        const nightProgress = (cycleTime - dayNight.DAY_DURATION) / dayNight.NIGHT_DURATION; // 0..1
        if (nightProgress >= 0.25 && nightProgress <= 0.75) alpha = 0;
        else if (nightProgress < 0.25) alpha *= 1 - (nightProgress / 0.25);
        else alpha *= (nightProgress - 0.75) / 0.25;
    }
    const centerX = x + w / 2;
    const centerY = y + h;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, w / 2, h / 2, 0, 0, Math.PI * 2);
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
            frostWraiths = data.frostWraiths || [];
            titan = data.titan || null;
            groundItems = data.groundItems || [];
            projectiles = data.projectiles || [];
            dayNight = data.dayNight || dayNight;
            riftBlizzard = data.riftBlizzard || riftBlizzard;
            rockBossDefeated = data.rockBossDefeated || false;
            Object.values(players).forEach(initializePlayerForRender);
            if (!gameLoopStarted) { gameLoopStarted = true; requestAnimationFrame(gameLoop); }
            updatePlayerHealthBar();
            updatePlayerManaBar();
            updateLevelUI();
            socket.send(JSON.stringify({ type: 'held-item', index: selectedHotbarSlot }));
            break;
        case 'game-state':
            const lastIsDay = dayNight.isDay;
            dayNight = data.dayNight;
            if (lastIsDay !== dayNight.isDay) playMusicForPhase(dayNight.isDay);
            boars = data.boars || boars;
            zombies = data.zombies || zombies;
            ogres = data.ogres || ogres;
            frostWraiths = data.frostWraiths || frostWraiths;
            titan = data.titan || titan;
            riftBlizzard = data.riftBlizzard || riftBlizzard;
            groundItems = data.groundItems || groundItems;
            projectiles = data.projectiles || projectiles;
            if (typeof data.rockBossDefeated !== 'undefined') rockBossDefeated = data.rockBossDefeated;
            for (const id in data.players) {
                if (players[id]) {
                    const serverPlayer = data.players[id];
                    const clientPlayer = players[id];
                    clientPlayer.heldIndex = serverPlayer.heldIndex;
                    clientPlayer.hp = serverPlayer.hp;
                    clientPlayer.burn = serverPlayer.burn;
                    clientPlayer.mana = serverPlayer.mana;
                    clientPlayer.maxMana = serverPlayer.maxMana;
                    clientPlayer.manaRegen = serverPlayer.manaRegen || 0;
                    clientPlayer.level = serverPlayer.level;
                    clientPlayer.skillPoints = serverPlayer.skillPoints;
                    clientPlayer.skills = serverPlayer.skills || {};
                    clientPlayer.attackRange = serverPlayer.attackRange || 0;
                    clientPlayer.class = serverPlayer.class || null;
                    clientPlayer.speed = serverPlayer.speed;
                    clientPlayer.baseSpeed = serverPlayer.baseSpeed;
                    clientPlayer.knightSkills = serverPlayer.knightSkills || {};
                    clientPlayer.summonerSkills = serverPlayer.summonerSkills || { attack: 0, healer: 0, ranged: 0, 'summoner-ranged-stop': false, 'summoner-ranged-flee': false, 'summoner-lockon': false };
                    clientPlayer.mageSkills = serverPlayer.mageSkills || {};
                    clientPlayer.swordDamage = serverPlayer.swordDamage || 0;
                    clientPlayer.canSlow = serverPlayer.canSlow;
                    clientPlayer.canBind = serverPlayer.canBind;
                    clientPlayer.canMissile = serverPlayer.canMissile;
                    clientPlayer.canFlame = serverPlayer.canFlame;
                    clientPlayer.canBomb = serverPlayer.canBomb;
                    clientPlayer.canSmoke = serverPlayer.canSmoke;
                    clientPlayer.canTeleport = serverPlayer.canTeleport;
                    clientPlayer.stickyBomb = serverPlayer.stickyBomb;
                    clientPlayer.rogueSkills = serverPlayer.rogueSkills || {};
                    clientPlayer.color = serverPlayer.color;
                    clientPlayer.eyeColor = serverPlayer.eyeColor || '#ccc';
                    clientPlayer.dashCooldown = serverPlayer.dashCooldown || 0;
                    clientPlayer.whirlwindCooldown = serverPlayer.whirlwindCooldown || 0;
                    clientPlayer.whirlwindTime = serverPlayer.whirlwindTime || 0;
                    if (id === myPlayerId) {
                        const dist = Math.hypot(serverPlayer.x - clientPlayer.x, serverPlayer.y - clientPlayer.y);
                        if (dist > 20) { clientPlayer.x = serverPlayer.x; clientPlayer.y = serverPlayer.y; }
                        updateAbilityIndicator();
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
            updatePlayerManaBar();
            updateLevelUI();
            break;
        case 'player-join': if (data.player.id !== myPlayerId) { players[data.player.id] = data.player; initializePlayerForRender(players[data.player.id]); } break;
        case 'player-leave': delete players[data.playerId]; break;
        case 'resource-update': const resIndex = resources.findIndex(r => r.id === data.resource.id); if (resIndex !== -1) resources[resIndex] = data.resource; break;
        case 'structure-update': structures = data.structures; break;
        case 'inventory-update': const me = players[myPlayerId]; if (me) { me.inventory = data.inventory; me.hotbar = data.hotbar; if (!inventoryScreen.classList.contains('hidden')) { updateInventoryUI(); updateCraftingUI(); } if (!furnaceScreen.classList.contains('hidden')) { updateFurnaceUI(); } updateHotbarUI(); } break;
        case 'item-pickup-notif': createFloatingText(`+${data.amount} ${data.item}`, players[myPlayerId].x, players[myPlayerId].y); break;
        case 'notification': showNotification(data.message); break;
        case 'level-update': {
            const mePlayer = players[myPlayerId];
            if (mePlayer) {
                mePlayer.level = data.level;
                mePlayer.skillPoints = data.skillPoints;
                updateLevelUI();
            }
            break;
        }
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
        case 'wraith-update': {
            const idx = frostWraiths.findIndex(w => w.id === data.wraith.id);
            if (idx !== -1) frostWraiths[idx] = data.wraith; else frostWraiths.push(data.wraith);
            break;
        }
        case 'titan-update': {
            titan = data.titan;
            break;
        }
        case 'bomb-explode':
            explosions.push({ x: data.x, y: data.y, radius: data.radius, timer: 30 });
            break;
        case 'player-hit': if (players[myPlayerId]) { players[myPlayerId].hp = data.hp; updatePlayerHealthBar(); } break;
        case 'player-dead':
            deathFade = 0;
            deathFadeDir = 1;
            preSpawn = true;
            if (deathMessage) {
                const cause = data.cause || 'unknown';
                if (cause === 'ogre') deathMessage.textContent = 'You were crushed by the Rock Monster';
                else deathMessage.textContent = `You died at the hands of ${cause}`;
            }
            if (deathScreen) deathScreen.classList.remove('hidden');
            break;
        case 'chat-message': addChatMessage(data.sender, data.message, data.color); break;
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
        const recipe = RECIPES[recipeName];
        if (recipeName !== 'Workbench' && !recipe.noWorkbench && !nearWorkbench) continue;
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
        const displayName = recipe.amount ? `${recipeName} x${recipe.amount}` : recipeName;
        recipeEl.innerHTML = `<div class="recipe-icon" style="background-image: url('/icons/${recipe.icon}')"></div><div class="recipe-details"><div class="recipe-name">${displayName}</div><div class="recipe-cost">${costString.trim()}</div></div><button>Craft</button>`;
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
        slot.addEventListener('dragstart', () => { dragData = { type: 'inventory', index: i }; dropHandled = false; });
        slot.addEventListener('dragover', e => e.preventDefault());
        slot.addEventListener('drop', e => {
            e.preventDefault(); dropHandled = true;
            const dest = parseInt(e.currentTarget.dataset.index, 10);
            if (!dragData) return;
            if (dragData.type === 'inventory' && dest !== dragData.index) {
                socket.send(JSON.stringify({ type: 'swap-inventory', from: dragData.index, to: dest }));
            } else if (dragData.type === 'hotbar') {
                socket.send(JSON.stringify({ type: 'move-item', fromType: 'hotbar', fromIndex: dragData.index, toType: 'inventory', toIndex: dest }));
            }
            dragData = null;
        });
        slot.addEventListener('dragend', () => {
            if (!dropHandled && dragData) {
                socket.send(JSON.stringify({ type: 'drop-item', fromType: dragData.type, index: dragData.index }));
            }
            dragData = null;
        });
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
        if (!slot.dataset.bound) {
            slot.addEventListener('dragover', e => e.preventDefault());
            slot.addEventListener('dragstart', () => { if (me.hotbar[i]) { dragData = { type: 'hotbar', index: i }; dropHandled = false; }});
            slot.addEventListener('drop', e => {
                e.preventDefault(); dropHandled = true;
                const dest = i;
                if (!dragData) return;
                if (dragData.type === 'inventory') {
                    socket.send(JSON.stringify({ type: 'move-item', fromType: 'inventory', fromIndex: dragData.index, toType: 'hotbar', toIndex: dest }));
                } else if (dragData.type === 'hotbar' && dest !== dragData.index) {
                    socket.send(JSON.stringify({ type: 'move-item', fromType: 'hotbar', fromIndex: dragData.index, toType: 'hotbar', toIndex: dest }));
                }
                dragData = null;
            });
            slot.addEventListener('dragend', () => {
                if (!dropHandled && dragData) {
                    socket.send(JSON.stringify({ type: 'drop-item', fromType: dragData.type, index: dragData.index }));
                }
                dragData = null;
            });
            slot.dataset.bound = '1';
        }
        slot.draggable = !!item;
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
    if (gateWarning > 0) gateWarning--;
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
    if (!collision && !rockBossDefeated && predictedX >= GLACIAL_RIFT_START_X - player.size) {
        collision = true;
        if (gateWarning <= 0) {
            showNotification('Defeat the Rock Golem to enter the Ice Biome!');
            gateWarning = 60;
        }
    }
    if (!collision) {
        player.x = predictedX;
        player.y = predictedY;
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'move', x: player.x, y: player.y }));
        }
    }
}
canvas.addEventListener('mousedown', e => {
    if (!myPlayerId || !players[myPlayerId] || e.button !== 0 || preSpawn) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + camera.x;
    const mouseY = e.clientY - rect.top + camera.y;
    const me = players[myPlayerId];
    const selectedItem = me.hotbar[selectedHotbarSlot];
    let closestPlayer = null; let playerDist = Infinity;
    for (const id in players) {
        if (id === myPlayerId) continue;
        const p = players[id];
        const dist = Math.hypot(mouseX - p.x, mouseY - p.y);
        if (dist < p.size && dist < playerDist) { playerDist = dist; closestPlayer = { id, data: p }; }
    }
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
    let closestOgre = null; let ogreDist = Infinity;
    for (const ogre of ogres) {
        const dist = Math.hypot(mouseX - ogre.x, mouseY - ogre.y);
        if (dist < ogre.size && dist < ogreDist) { ogreDist = dist; closestOgre = ogre; }
    }
    let closestWraith = null; let wraithDist = Infinity;
    for (const w of frostWraiths) {
        const dist = Math.hypot(mouseX - w.x, mouseY - w.y);
        if (dist < w.size && dist < wraithDist) { wraithDist = dist; closestWraith = w; }
    }
    let closestTitan = null; let titanDist = Infinity;
    if (titan) {
        const dist = Math.hypot(mouseX - titan.x, mouseY - titan.y);
        if (dist < titan.size && dist < titanDist) { titanDist = dist; closestTitan = titan; }
    }
    let closestResource = null; let closestDist = Infinity;
    for (const resource of resources) {
        if (!resource.harvested) {
            const dist = Math.hypot(mouseX - resource.x, mouseY - resource.y);
            if (dist < resource.size && dist < closestDist) { closestDist = dist; closestResource = resource; }
        }
    }
    let didAttack = false;
    if (closestPlayer) {
        socket.send(JSON.stringify({ type: 'hit-player', targetId: closestPlayer.id, item: selectedItem ? selectedItem.item : null }));
        didAttack = true;
    } else if (closestBoar) {
        socket.send(JSON.stringify({ type: 'hit-boar', boarId: closestBoar.id, item: selectedItem ? selectedItem.item : null }));
        didAttack = true;
    } else if (closestZombie) {
        socket.send(JSON.stringify({ type: 'hit-zombie', zombieId: closestZombie.id, item: selectedItem ? selectedItem.item : null }));
        didAttack = true;
    } else if (closestOgre) {
        socket.send(JSON.stringify({ type: 'hit-ogre', ogreId: closestOgre.id, item: selectedItem ? selectedItem.item : null }));
        didAttack = true;
    } else if (closestTitan) {
        socket.send(JSON.stringify({ type: 'hit-titan', item: selectedItem ? selectedItem.item : null }));
        didAttack = true;
    } else if (closestWraith) {
        socket.send(JSON.stringify({ type: 'hit-wraith', wraithId: closestWraith.id, item: selectedItem ? selectedItem.item : null }));
        didAttack = true;
    } else if (closestResource) {
        socket.send(JSON.stringify({ type: 'hit-resource', resourceId: closestResource.id, item: selectedItem ? selectedItem.item : null }));
        didAttack = true;
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
            else if (structures[`i${gridX},${gridY}`]) key = `i${gridX},${gridY}`;
        }
        if (key) socket.send(JSON.stringify({ type: 'hit-structure', key, item: selectedItem ? selectedItem.item : null, hotbarIndex: selectedHotbarSlot }));
    }
    if (didAttack) {
        updateAttackBar();
    }
});
canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + camera.x;
    const mouseY = e.clientY - rect.top + camera.y;
    const me = players[myPlayerId];
    if (!me || !me.hotbar) return;
    const selectedItem = me.hotbar[selectedHotbarSlot];
    if (selectedItem && ['Raw Meat','Cooked Meat','Apple'].includes(selectedItem.item)) {
        socket.send(JSON.stringify({ type: 'consume-item', hotbarIndex: selectedHotbarSlot }));
        return;
    }
    if (selectedItem && selectedItem.item === 'Fire Staff') {
        socket.send(JSON.stringify({ type: 'cast-staff', targetX: mouseX, targetY: mouseY }));
        return;
    }
    if (selectedItem && selectedItem.item === 'Bow') {
        socket.send(JSON.stringify({ type: 'shoot-arrow', targetX: mouseX, targetY: mouseY }));
        return;
    }
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
    ctx.fillStyle = player.color || (isMe ? 'hsl(120, 100%, 70%)' : 'hsl(0, 100%, 70%)');
    ctx.fill();
    ctx.strokeStyle = player.outlineColor || '#333';
    ctx.lineWidth = 3;
    ctx.stroke();
    let angle = 0;
    if (player.whirlwindTime && player.whirlwindTime > 0) {
        player.spinAngle = (player.spinAngle || 0) + 0.5;
        angle = player.spinAngle;
    } else {
        if (isMe) {
            angle = Math.atan2(mousePos.y - (y - camera.y), mousePos.x - (x - camera.x));
        } else if (player.targetX !== undefined) {
            angle = Math.atan2(player.targetY - y, player.targetX - x);
        }
        player.spinAngle = angle;
    }
    const eyeAngle = angle + Math.PI / 2;
    const eyeOffset = player.size * 0.4;
    const ex = Math.cos(eyeAngle) * eyeOffset;
    const ey = Math.sin(eyeAngle) * eyeOffset;
    ctx.beginPath();
    ctx.arc(x + ex, y + ey, player.size * 0.2, 0, Math.PI * 2);
    ctx.arc(x - ex, y - ey, player.size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = player.eyeColor || '#ccc';
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
    const mx = x + Math.cos(angle) * player.size * 0.6;
    const my = y + Math.sin(angle) * player.size * 0.6;
    renderMouth(ctx, mx, my, player.size * 0.3, player.mouth || 'line', player.mouthColor || '#000');
    if (player.hp < player.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(x - player.size, y - player.size - 10, player.size * 2, 6);
        ctx.fillStyle = 'green';
        ctx.fillRect(x - player.size, y - player.size - 10, (player.hp / player.maxHp) * player.size * 2, 6);
    }
    if (player.poison && player.poison > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.arc(x, y, player.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = 'green';
        ctx.beginPath();
        ctx.arc(x, y, player.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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
    const angle = Math.atan2(boar.vy || 0, boar.vx || 0);
    ctx.save();
    ctx.translate(boar.x, boar.y);
    if (boar.vx !== 0 || boar.vy !== 0) ctx.rotate(angle);
    ctx.drawImage(boarImg, -size / 2, -size / 2, size, size);
    if (boar.color) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = boar.color;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
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

    // Pick colors based on the creature type for visual distinction.
    let bodyColor = '#00ff00'; // default zombie now green
    let eyeColor = '#ccc';
    if (zombie.kind === 'skeleton') {
        bodyColor = '#ddd';
        eyeColor = '#000';
    } else if (zombie.kind === 'spirit') {
        bodyColor = 'rgba(150,255,255,0.8)';
        eyeColor = '#fff';
    } else if (zombie.kind === 'tree') {
        bodyColor = '#39ff14';
        eyeColor = '#003300';
    } else if (zombie.kind === 'big') {
        bodyColor = '#228B22';
        eyeColor = '#fff';
    }
    ctx.fillStyle = bodyColor;
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
    ctx.fillStyle = eyeColor;
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
    ctx.save();
    ctx.translate(ogre.x, ogre.y);
    const arm1 = ogre.size * 0.8;
    const arm2 = ogre.size * 0.6;
    const armWidth = ogre.size / 3;
    function drawArm(side) {
        const base = side === 'right' ? 0 : Math.PI;
        let swing = 0;
        if (ogre.smashPhase === side) {
            swing = (1 - ogre.smashTimer / 15) * (side === 'right' ? Math.PI / 2 : -Math.PI / 2);
        }
        const a1 = base + swing;
        const elbow = { x: Math.cos(a1) * arm1, y: Math.sin(a1) * arm1 };
        const hand = { x: elbow.x + Math.cos(a1) * arm2, y: elbow.y + Math.sin(a1) * arm2 };
        ctx.strokeStyle = '#555';
        ctx.lineWidth = armWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(elbow.x, elbow.y);
        ctx.lineTo(hand.x, hand.y);
        ctx.stroke();
    }
    drawArm('left');
    drawArm('right');
    ctx.fillStyle = '#777';
    ctx.beginPath();
    ctx.arc(0, 0, ogre.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

function drawTitan(t) {
    drawShadow(t.x, t.y, t.size * 2, t.size);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = '#99d';
    ctx.beginPath();
    ctx.arc(0, 0, t.size, 0, Math.PI * 2);
    ctx.fill();
    if (t.phase >= 2 && !t.shield) {
        ctx.fillStyle = '#0ff';
        ctx.beginPath();
        ctx.arc(0, 0, t.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }
    if (t.shield) {
        ctx.strokeStyle = 'cyan';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, t.size + 10, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
    if (t.hp < t.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(t.x - t.size, t.y - t.size - 10, t.size * 2, 6);
        ctx.fillStyle = 'cyan';
        ctx.fillRect(t.x - t.size, t.y - t.size - 10, (t.hp / t.maxHp) * t.size * 2, 6);
    }
}

function drawFrostWraith(wraith) {
    drawShadow(wraith.x, wraith.y, wraith.size * 2, wraith.size);
    ctx.fillStyle = 'rgba(180,220,255,0.8)';
    ctx.beginPath();
    ctx.arc(wraith.x, wraith.y, wraith.size, 0, Math.PI * 2);
    ctx.fill();
    if (wraith.hp < wraith.maxHp) {
        ctx.fillStyle = 'red';
        ctx.fillRect(wraith.x - wraith.size, wraith.y - wraith.size - 10, wraith.size * 2, 6);
        ctx.fillStyle = 'blue';
        ctx.fillRect(wraith.x - wraith.size, wraith.y - wraith.size - 10, (wraith.hp / wraith.maxHp) * wraith.size * 2, 6);
    }
}

function drawProjectile(p) {
    drawShadow(p.x, p.y, 16, 8);
    if (p.type === 'slow') {
        ctx.fillStyle = 'blue';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
    } else if (p.type === 'bind') {
        ctx.fillStyle = 'purple';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
    } else if (p.type === 'minion') {
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
    } else if (p.type === 'arrow') {
        ctx.drawImage(arrowImg, p.x - 8, p.y - 8, 16, 16);
    } else if (p.type === 'missile') {
        const ang = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.fillStyle = 'gray';
        ctx.fillRect(-6, -2, 12, 4);
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(6, -4);
        ctx.lineTo(10, 0);
        ctx.lineTo(6, 4);
        ctx.fill();
        ctx.restore();
    } else if (p.type === 'bomb') {
        ctx.fillStyle = 'orange';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
    } else if (p.type === 'smoke') {
        const radius = p.radius || 120;
        const me = players[myPlayerId];
        const inner = me && me.class === 'rogue' ? 'rgba(128,128,128,0.4)' : 'rgba(90,90,90,0.6)';
        const outer = me && me.class === 'rogue' ? 'rgba(128,128,128,0)' : 'rgba(90,90,90,0)';
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        grad.addColorStop(0, inner);
        grad.addColorStop(1, outer);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
    } else if (p.type === 'flame') {
        const radius = p.radius || 60;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        grad.addColorStop(0, 'rgba(255,0,0,0.5)');
        grad.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.drawImage(fireBallImg, p.x - 8, p.y - 8, 16, 16);
    }
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
    } else if (structure.type === 'ice_wall') {
        ctx.fillStyle = '#aeeaff';
        ctx.fillRect(structure.x, structure.y, size, size);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(structure.x, structure.y, size, size);
    } else if (structure.type === 'workbench') {
        ctx.drawImage(workbenchImg, structure.x, structure.y, size, size);
    } else if (structure.type === 'furnace') {
        ctx.drawImage(ovenImg, structure.x, structure.y, size, size);
    } else if (structure.type === 'bed') {
        ctx.drawImage(bedImg, structure.x, structure.y, size, size);
    } else if (structure.type === 'torch') {
        const cx = structure.x + size / 2;
        const cy = structure.y + size / 2;
        const radius = size / 4;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, '#ffff99');
        grad.addColorStop(1, '#ff9900');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
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
    ctx.fillRect(0, 0, OLD_WORLD_WIDTH, WORLD_HEIGHT);
    ctx.fillStyle = '#8cc68c';
    ctx.fillRect(OLD_WORLD_WIDTH, 0, OLD_WORLD_WIDTH, WORLD_HEIGHT);
    ctx.fillStyle = '#d0f0ff';
    ctx.fillRect(GLACIAL_RIFT_START_X, 0, OLD_WORLD_WIDTH, WORLD_HEIGHT);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += GRID_CELL_SIZE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke(); }
    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_CELL_SIZE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke(); }
    resources.forEach(drawResource);
    groundItems.forEach(drawGroundItem);
    boars.forEach(drawBoar);
    ogres.forEach(drawOgre);
    if (titan) drawTitan(titan);
    frostWraiths.forEach(drawFrostWraith);
    projectiles.forEach(drawProjectile);
    explosions.forEach(ex => {
        const alpha = ex.timer / 30;
        ctx.fillStyle = `rgba(255,0,0,${alpha})`;
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, ex.radius, 0, Math.PI * 2);
        ctx.fill();
        ex.timer--;
    });
    explosions = explosions.filter(ex => ex.timer > 0);
    zombies.forEach(drawZombie);
    Object.values(structures).forEach(drawStructure);
    Object.values(players).forEach(p => drawPlayer(p, p.id === myPlayerId));
    ctx.restore();
    const playerMe = players[myPlayerId];
    const inRift = playerMe && playerMe.x >= GLACIAL_RIFT_START_X;
    if (riftBlizzard.active && inRift) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = `rgba(0, 0, 50, ${darkness})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (darkness > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        Object.values(structures).forEach(s => {
            if (s.type === 'torch') {
                const tx = s.x - camera.x + (s.size || GRID_CELL_SIZE) / 2;
                const ty = s.y - camera.y + (s.size || GRID_CELL_SIZE) / 2;
                const radius = 150;
                const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, radius);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(tx, ty, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        });
        ctx.restore();

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        Object.values(structures).forEach(s => {
            if (s.type === 'torch') {
                const tx = s.x - camera.x + (s.size || GRID_CELL_SIZE) / 2;
                const ty = s.y - camera.y + (s.size || GRID_CELL_SIZE) / 2;
                const radius = 150;
                const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, radius);
                grad.addColorStop(0, 'rgba(255, 220, 100, 0.8)');
                grad.addColorStop(1, 'rgba(255, 220, 100, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(tx, ty, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        });
        ctx.restore();
    }
    const me = players[myPlayerId];
    if (me) {
        for (const p of projectiles) {
            if (p.type === 'smoke') {
                const radius = p.radius || 120;
                if (Math.hypot(me.x - p.x, me.y - p.y) < radius) {
                    ctx.fillStyle = 'gray';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    break;
                }
            }
        }
    }
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
        if (!preSpawn && document.activeElement !== chatInput) playerMovement();
        const me = players[myPlayerId];
        if (preSpawn) {
            if (!spectatorTarget || spectatorTarget.hp <= 0) {
                const options = [...boars, ...zombies, ...ogres];
                spectatorTarget = options.length ? options[Math.floor(Math.random() * options.length)] : me;
            }
            const target = spectatorTarget || me;
            camera.x = lerp(camera.x, target.x - canvas.width / 2, 0.1);
            camera.y = lerp(camera.y, target.y - canvas.height / 2, 0.1);
        } else {
            camera.x = lerp(camera.x, me.x - canvas.width / 2, 0.1);
            camera.y = lerp(camera.y, me.y - canvas.height / 2, 0.1);
        }
        for (const id in players) {
            if (id !== myPlayerId) {
                const p = players[id];
                if (p && p.targetX !== undefined) {
                    p.renderX = lerp(p.renderX, p.targetX, 0.2);
                    p.renderY = lerp(p.renderY, p.targetY, 0.2);
                }
            }
        }
        updateSummonerBar();
        updateAbilityIndicator();
        updateAttackBar();
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
function addChatMessage(sender, message, color){
    const li = document.createElement('li');
    li.textContent = `${sender}: ${message}`;
    if (color) li.style.color = color;
    chatMessages.appendChild(li);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
window.addEventListener('keydown', e => { if (e.key === 'Enter' && document.activeElement !== chatInput) { e.preventDefault(); chatInput.focus(); } });
window.addEventListener('keydown', e => { if (e.code === 'KeyE' && document.activeElement !== chatInput) { inventoryScreen.classList.toggle('hidden'); if (!inventoryScreen.classList.contains('hidden')) { updateInventoryUI(); updateCraftingUI(); } } });
window.addEventListener('keydown', e => { if (e.code === 'KeyQ' && document.activeElement !== chatInput) { skillTree.classList.toggle('hidden'); updateLevelUI(); } });
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
// Summoners can cycle the minion type they will spawn.
window.addEventListener('keydown', e => {
    if (document.activeElement !== chatInput && e.code === 'KeyV') {
        const types = ['attack', 'healer', 'ranged'];
        const idx = types.indexOf(summonerSpawnType);
        summonerSpawnType = types[(idx + 1) % types.length];
        updateSummonerBar();
        updateAbilityIndicator();
    }
});
window.addEventListener('wheel', e => {
    if (document.activeElement !== chatInput) {
        const me = players[myPlayerId];
        if (me?.class === 'summoner') {
            const types = ['attack', 'healer', 'ranged'];
            let idx = types.indexOf(summonerSpawnType);
            idx = (idx + (e.deltaY > 0 ? 1 : -1) + types.length) % types.length;
            summonerSpawnType = types[idx];
            updateSummonerBar();
            e.preventDefault();
        } else if (me?.class === 'mage' && (me.canSlow || me.canBind || me.canMissile || me.canFlame)) {
            const spells = [];
            if (me.canSlow) spells.push('slow');
            if (me.canBind) spells.push('bind');
            if (me.canMissile) spells.push('missile');
            if (me.canFlame) spells.push('flame');
            let idx = spells.indexOf(selectedMageSpell);
            idx = (idx + (e.deltaY > 0 ? 1 : -1) + spells.length) % spells.length;
            selectedMageSpell = spells[idx];
            updateAbilityIndicator();
            e.preventDefault();
        } else if (me?.class === 'knight' && me.knightSkills && (me.knightSkills['knight-shield'] || me.knightSkills['knight-whirlwind'])) {
            const abilities = ['non'];
            if (me.knightSkills['knight-shield']) abilities.push('dash');
            if (me.knightSkills['knight-whirlwind']) abilities.push('whirlwind');
            let idx = abilities.indexOf(selectedKnightAbility);
            idx = (idx + (e.deltaY > 0 ? 1 : -1) + abilities.length) % abilities.length;
            selectedKnightAbility = abilities[idx];
            updateAbilityIndicator();
            e.preventDefault();
        } else if (me?.class === 'rogue') {
            const abilities = [];
            if (me.canBomb) abilities.push('bomb');
            if (me.canSmoke) abilities.push('smoke');
            if (me.canTeleport) abilities.push('teleport');
            if (me.rogueSkills && me.rogueSkills['rogue-bow']) abilities.push('bow');
            if (abilities.length > 0) {
                let idx = abilities.indexOf(selectedRogueAbility);
                idx = (idx + (e.deltaY > 0 ? 1 : -1) + abilities.length) % abilities.length;
                selectedRogueAbility = abilities[idx];
                updateAbilityIndicator();
                e.preventDefault();
            }
        } else if (me?.class === 'guardian') {
            const abilities = ['shield-wall', 'taunt', 'fortify'];
            let idx = abilities.indexOf(selectedGuardianAbility);
            idx = (idx + (e.deltaY > 0 ? 1 : -1) + abilities.length) % abilities.length;
            selectedGuardianAbility = abilities[idx];
            updateAbilityIndicator();
            e.preventDefault();
        }
    }
}, { passive: false });
window.addEventListener('keydown', e => {
    if (document.activeElement !== chatInput && !e.repeat) {
        const me = players[myPlayerId];
        if (!me) return;
        if (e.code === 'Space') {
            if (me.class === 'summoner') {
                if (me.mana >= 100) {
                    safeSend({ type: 'spawn-minion', minionType: summonerSpawnType });
                }
            } else if (me.class === 'mage') {
                const targetX = mousePos.x + camera.x;
                const targetY = mousePos.y + camera.y;
                if (selectedMageSpell === 'bind' && me.canBind) {
                    safeSend({ type: 'cast-bind', targetX, targetY });
                } else if (selectedMageSpell === 'slow' && me.canSlow) {
                    safeSend({ type: 'cast-slow', targetX, targetY });
                } else if (selectedMageSpell === 'missile' && me.canMissile && me.mana >= 75) {
                    safeSend({ type: 'cast-missile', targetX, targetY });
                } else if (selectedMageSpell === 'flame' && me.canFlame && me.mana >= 10) {
                    safeSend({ type: 'cast-flame', targetX, targetY });
                }
            } else if (me.class === 'knight' && me.knightSkills) {
                if (selectedKnightAbility === 'dash' && me.knightSkills['knight-shield']) {
                    const targetX = mousePos.x + camera.x;
                    const targetY = mousePos.y + camera.y;
                    safeSend({ type: 'shield-dash', targetX, targetY });
                } else if (selectedKnightAbility === 'whirlwind' && me.knightSkills['knight-whirlwind'] && (!me.whirlwindCooldown || me.whirlwindCooldown <= 0)) {
                    players[myPlayerId].whirlwindTime = 20;
                    safeSend({ type: 'knight-whirlwind' });
                }
            } else if (me.class === 'rogue') {
                const targetX = mousePos.x + camera.x;
                const targetY = mousePos.y + camera.y;
                if (selectedRogueAbility === 'bomb' && me.canBomb) {
                    safeSend({ type: 'rogue-bomb', targetX, targetY });
                } else if (selectedRogueAbility === 'smoke' && me.canSmoke) {
                    safeSend({ type: 'rogue-smoke', targetX, targetY });
                } else if (selectedRogueAbility === 'teleport' && me.canTeleport) {
                    me.x = targetX;
                    me.y = targetY;
                    safeSend({ type: 'rogue-teleport', targetX, targetY });
                    safeSend({ type: 'move', x: me.x, y: me.y });
                } else if (selectedRogueAbility === 'bow') {
                    safeSend({ type: 'shoot-arrow', targetX, targetY });
                }
            } else if (me.class === 'guardian') {
                if (selectedGuardianAbility === 'shield-wall') {
                    safeSend({ type: 'guardian-shield-wall' });
                } else if (selectedGuardianAbility === 'taunt') {
                    safeSend({ type: 'guardian-taunt' });
                } else if (selectedGuardianAbility === 'fortify') {
                    safeSend({ type: 'guardian-fortify' });
                }
            }
            e.preventDefault();
        }
    }
});
window.addEventListener('keydown', e => {
    if (document.activeElement !== chatInput && e.code === 'KeyF') {
        socket.send(JSON.stringify({ type: 'consume-item', hotbarIndex: selectedHotbarSlot }));
    }
});
window.addEventListener('keydown', e => {
    if (document.activeElement !== chatInput && e.code === 'KeyX') {
        const me = players[myPlayerId];
        if (me && me.hotbar && me.hotbar[selectedHotbarSlot]) {
            socket.send(JSON.stringify({ type: 'drop-item', fromType: 'hotbar', index: selectedHotbarSlot }));
        }
    }
});
window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && !furnaceScreen.classList.contains('hidden')) {
        furnaceScreen.classList.add('hidden');
    }
});
updateHotbarUI();

if (rangeNode) rangeNode.addEventListener('click', () => {
    const me = players[myPlayerId];
    if (me && me.skillPoints > 0 && !(me.skills && me.skills.range)) {
        socket.send(JSON.stringify({ type: 'unlock-skill', skill: 'range' }));
    }
});
[mageNode, knightNode, summonerNode, rogueNode].forEach(node => {
    if (!node) return;
    node.addEventListener('click', () => {
        const me = players[myPlayerId];
        const skill = node.dataset.skill;
        if (me && me.skillPoints > 0 && me.skills && me.skills.range && !me.class) {
            socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
        }
    });
});
[...knightSkillNodes, ...summonerSkillNodes, ...mageSkillNodes, ...rogueSkillNodes].forEach(node => {
    if (!node) return;
    node.addEventListener('click', () => {
        const me = players[myPlayerId];
        const skill = node.dataset.skill;
        if (!me || me.skillPoints <= 0) return;
        if (me.class === 'knight') {
            if (!me.knightSkills || !me.knightSkills[skill]) {
                const prereq = knightSkillPrereqs[skill];
                if (!prereq || (me.knightSkills && me.knightSkills[prereq])) {
                    socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
                }
            }
        } else if (me.class === 'summoner') {
            const skills = me.summonerSkills || {};
            if (['summoner-attack', 'summoner-healer', 'summoner-ranged'].includes(skill)) {
                socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
            } else if (skill === 'summoner-ranged-stop' && skills.ranged > 0 && !skills['summoner-ranged-stop']) {
                socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
            } else if (skill === 'summoner-ranged-flee' && skills['summoner-ranged-stop'] && !skills['summoner-ranged-flee']) {
                socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
            } else if (skill === 'summoner-lockon' && !skills['summoner-lockon']) {
                socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
            }
        } else if (me.class === 'mage') {
            if (!me.mageSkills || !me.mageSkills[skill]) {
                const prereq = mageSkillPrereqs[skill];
                if (!prereq || (me.mageSkills && me.mageSkills[prereq])) {
                    socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
                }
            }
        } else if (me.class === 'rogue') {
            if (!me.rogueSkills || !me.rogueSkills[skill]) {
                socket.send(JSON.stringify({ type: 'unlock-skill', skill }));
            }
        }
    });
});