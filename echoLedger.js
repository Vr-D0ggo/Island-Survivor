class SkillTree {
  constructor() {
    this.nodes = new Map();
  }

  addForm(form, cost = 1) {
    this.nodes.set(form, { cost, unlocked: false });
  }

  unlock(form) {
    const node = this.nodes.get(form);
    if (!node) {
      throw new Error('Unknown form');
    }
    node.unlocked = true;
  }

  isUnlocked(form) {
    const node = this.nodes.get(form);
    return !!node && node.unlocked;
  }

  getCost(form) {
    const node = this.nodes.get(form);
    if (!node) {
      throw new Error('Unknown form');
    }
    return node.cost;
  }
}

class EchoLedger {
  constructor() {
    this.availableSkillPoints = 0;
    this.harvestedEchoes = new Set();
    this.skillTree = new SkillTree();
    this.currentForm = null;
    this.mana = 200;
    this.maxMana = 200;
  }

  harvestEcho(form, cost = 1) {
    this.harvestedEchoes.add(form);
    this.skillTree.addForm(form, cost);
  }

  addSkillPoints(points) {
    this.availableSkillPoints += points;
  }

  unlockForm(form) {
    if (!this.harvestedEchoes.has(form)) {
      throw new Error('Echo for this form has not been harvested');
    }
    const cost = this.skillTree.getCost(form);
    if (this.availableSkillPoints < cost) {
      throw new Error('Not enough skill points');
    }
    this.availableSkillPoints -= cost;
    this.skillTree.unlock(form);
  }

  canMorph(form) {
    return this.skillTree.isUnlocked(form) && this.mana >= this.maxMana;
  }

  morph(form) {
    if (!this.canMorph(form)) {
      throw new Error('Form not unlocked or mana not full');
    }
    this.currentForm = form;
    this.mana = 0; // consume full mana pool
  }

  regenerateMana(amount) {
    this.mana = Math.min(this.maxMana, this.mana + amount);
  }
}

module.exports = { EchoLedger, SkillTree };
