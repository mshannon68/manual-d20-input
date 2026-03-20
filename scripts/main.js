// scripts/main.js

const MODULE_ID = "manual-d20-input";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);

  // Settings
  game.settings.register(MODULE_ID, "enabled", {
    name: "Enable Manual D20 Input",
    hint: "If enabled, d20 rolls for D&D5e will prompt for manual input instead of auto-rolling.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "playersOnly", {
    name: "Players Only",
    hint: "If enabled, only player-owned actors will use manual input. GMs can still auto-roll.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "showFormula", {
    name: "Show Formula in Dialog",
    hint: "Display the roll formula in the manual input dialog.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  if (!game.modules.get("lib-wrapper")?.active) {
    ui.notifications.error(
      "Manual D20 Input requires the 'libWrapper' module. Please install and activate it."
    );
    return;
  }

  libWrapper.register(
    MODULE_ID,
    "CONFIG.Dice.D20Roll.prototype.roll",
    manualD20Wrapper,
    "MIXED"
  );
});

/**
 * Wrapper for D20Roll.prototype.roll
 * @param {Function} wrapped - Original roll function
 * @param  {...any} args - Arguments
 * @returns {Promise<Roll>}
 */
async function manualD20Wrapper(wrapped, ...args) {
  // If disabled, just roll normally
  if (!game.settings.get(MODULE_ID, "enabled")) {
    return wrapped.apply(this, args);
  }

  // Only target D&D5e
  if (game.system.id !== "dnd5e") {
    return wrapped.apply(this, args);
  }

  // Optional: players-only mode
  const playersOnly = game.settings.get(MODULE_ID, "playersOnly");
  if (playersOnly) {
    const actor = this.options?.actor ?? this.data?.actor;
    const isGM = game.user.isGM;
    const isPlayerOwned = actor ? actor.isOwner && !isGM : false;
    if (!isPlayerOwned) {
      return wrapped.apply(this, args);
    }
  }

  // At this point, we intercept the roll.
  // "this" is the D20Roll instance.
  const roll = this;

  // Build some context for the dialog
  const formula = roll.formula;
  const showFormula = game.settings.get(MODULE_ID, "showFormula");

  // Ask the user what to do
  const choice = await showManualD20Dialog({ formula, showFormula });

  if (!choice || choice.mode === "auto") {
    // User chose auto-roll or closed dialog
    return wrapped.apply(this, args);
  }

  // We now have manual values; apply them to the roll instance
  applyManualResultToD20Roll(roll, choice);

  // Return the modified roll instance (already "evaluated")
  return roll;
}

/**
 * Show a polished dialog for manual d20 input.
 * @param {Object} options
 * @param {string} options.formula
 * @param {boolean} options.showFormula
 * @returns {Promise<{mode: "normal"|"adv"|"dis"|"auto", value1?: number, value2?: number}>}
 */
function showManualD20Dialog({ formula, showFormula }) {
  return new Promise((resolve) => {
    const id = randomID();

    const content = `
      <style>
        #${id} .manual-d20-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          font-size: 14px;
        }
        #${id} .manual-d20-header {
          font-weight: bold;
          font-size: 15px;
          margin-bottom: 0.25rem;
        }
        #${id} .manual-d20-formula {
          font-family: monospace;
          background: rgba(0,0,0,0.05);
          padding: 4px 6px;
          border-radius: 3px;
        }
        #${id} .manual-d20-row {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 0.5rem;
        }
        #${id} .manual-d20-row label {
          flex: 0 0 110px;
          font-weight: 500;
        }
        #${id} .manual-d20-row input[type="number"] {
          width: 60px;
          text-align: center;
        }
        #${id} .manual-d20-note {
          font-size: 12px;
          color: #666;
        }
        #${id} .manual-d20-buttons {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }
        #${id} .manual-d20-buttons button {
          flex: 1 1 auto;
        }
      </style>
      <div id="${id}" class="manual-d20-container">
        <div class="manual-d20-header">Manual d20 Result</div>
        ${
          showFormula
            ? `<div class="manual-d20-formula">Formula: ${formula}</div>`
            : ""
        }
        <div class="manual-d20-row">
          <label>Normal:</label>
          <input type="number" min="1" max="20" step="1" class="manual-d20-normal" placeholder="1-20">
        </div>
        <div class="manual-d20-row">
          <label>Advantage:</label>
          <input type="number" min="1" max="20" step="1" class="manual-d20-adv1" placeholder="1-20">
          <span>and</span>
          <input type="number" min="1" max="20" step="1" class="manual-d20-adv2" placeholder="1-20">
        </div>
        <div class="manual-d20-row">
          <label>Disadvantage:</label>
          <input type="number" min="1" max="20" step="1" class="manual-d20-dis1" placeholder="1-20">
          <span>and</span>
          <input type="number" min="1" max="20" step="1" class="manual-d20-dis2" placeholder="1-20">
        </div>
        <div class="manual-d20-note">
          Enter values for the mode you intend to use. Leave others blank.
        </div>
      </div>
    `;

    const dialog = new Dialog({
      title: "Manual d20 Input",
      content,
      buttons: {
        normal: {
          label: "Use Normal",
          icon: '<i class="fas fa-dice-d20"></i>',
          callback: (html) => {
            const root = html.find(`#${id}`);
            const v = parseInt(root.find(".manual-d20-normal").val(), 10);
            if (!Number.isInteger(v) || v < 1 || v > 20) {
              ui.notifications.warn("Please enter a valid normal roll between 1 and 20.");
              return false;
            }
            resolve({ mode: "normal", value1: v });
          }
        },
        adv: {
          label: "Use Advantage",
          icon: '<i class="fas fa-arrow-up"></i>',
          callback: (html) => {
            const root = html.find(`#${id}`);
            const v1 = parseInt(root.find(".manual-d20-adv1").val(), 10);
            const v2 = parseInt(root.find(".manual-d20-adv2").val(), 10);
            if (
              !Number.isInteger(v1) || v1 < 1 || v1 > 20 ||
              !Number.isInteger(v2) || v2 < 1 || v2 > 20
            ) {
              ui.notifications.warn("Please enter two valid advantage rolls between 1 and 20.");
              return false;
            }
            resolve({ mode: "adv", value1: v1, value2: v2 });
          }
        },
        dis: {
          label: "Use Disadvantage",
          icon: '<i class="fas fa-arrow-down"></i>',
          callback: (html) => {
            const root = html.find(`#${id}`);
            const v1 = parseInt(root.find(".manual-d20-dis1").val(), 10);
            const v2 = parseInt(root.find(".manual-d20-dis2").val(), 10);
            if (
              !Number.isInteger(v1) || v1 < 1 || v1 > 20 ||
              !Number.isInteger(v2) || v2 < 1 || v2 > 20
            ) {
              ui.notifications.warn("Please enter two valid disadvantage rolls between 1 and 20.");
              return false;
            }
            resolve({ mode: "dis", value1: v1, value2: v2 });
          }
        },
        auto: {
          label: "Auto Roll",
          icon: '<i class="fas fa-magic"></i>',
          callback: () => {
            resolve({ mode: "auto" });
          }
        }
      },
      default: "normal",
      close: () => {
        // If closed without choosing, fall back to auto
        resolve({ mode: "auto" });
      }
    });

    dialog.render(true);
  });
}

/**
 * Apply the manual result to the D20Roll instance so that
 * downstream chat cards look like a normal roll.
 * @param {CONFIG.Dice.D20Roll} roll
 * @param {{mode: "normal"|"adv"|"dis", value1: number, value2?: number}} choice
 */
function applyManualResultToD20Roll(roll, choice) {
  const DieTerm = foundry.dice.terms.Die;

  let final;
  let results = [];

  if (choice.mode === "normal") {
    final = choice.value1;
    results = [{ result: final, active: true }];
  } else if (choice.mode === "adv") {
    const v1 = choice.value1;
    const v2 = choice.value2;
    final = Math.max(v1, v2);
    results = [
      { result: v1, active: v1 >= v2 },
      { result: v2, active: v2 > v1 }
    ];
  } else if (choice.mode === "dis") {
    const v1 = choice.value1;
    const v2 = choice.value2;
    final = Math.min(v1, v2);
    results = [
      { result: v1, active: v1 <= v2 },
      { result: v2, active: v2 < v1 }
    ];
  } else {
    // Should not happen; fallback
    return;
  }

  // Replace the terms with a single d20 die term that has our results
  const die = new DieTerm({
    number: results.length,
    faces: 20,
    results
  });

  roll.terms = [die];
  roll._total = final;
  roll._evaluated = true;

  // Clear any cached data
  roll._formula = roll.formula; // keep original formula string
  roll._rolled = true;
}