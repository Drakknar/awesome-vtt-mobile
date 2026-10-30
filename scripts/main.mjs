import { MODULE_ID } from "./constants.mjs";
import { registerSettings, getSetting } from "./settings.mjs";
import { isPhoneMode, maybeAskPhoneMode, applyCanvasPreference, onPhoneModeChanged, dismissPhoneNotices, markLoaded, applyPhoneLink } from "./mode.mjs";
import { registerWindowAdapter } from "./windows.mjs";
import { installHomeScreenTags } from "./pwa.mjs";
import { setKeepAwake } from "../../awesome-vtt-core/scripts/wake-lock.mjs";
import { activateShareListeners } from "../../awesome-vtt-core/scripts/journal.mjs";
import { initTargets, onTargetsChanged } from "./targets.mjs";
import { registerUseHooks } from "./use.mjs";
import { initPrompts } from "../../awesome-vtt-core/scripts/prompts.mjs";
import { initRollToasts } from "./roll-toasts.mjs";
import { initTurnAlert } from "./turn-alert.mjs";
import { syncPhoneDice } from "./dice.mjs";
import sys, { isSupported, markSystem } from "../../awesome-vtt-core/scripts/system.mjs";
import PhoneApp from "./app.mjs";
import { registerCoreSettings } from "../../awesome-vtt-core/scripts/settings.mjs";
import { closeStartupUserConfig, onActorDataChange, onChatChange, actorOf } from "../../awesome-vtt-core/scripts/ui.mjs";

/** Setting of each automation prompt kind (see the core's prompts.mjs). */
const PROMPT_SETTINGS = {
  deathSave: "autoDeathSaves", concentration: "autoConcentration", save: "autoSaves",
  request: "autoRequests", initiative: "autoInitiative"
};

/** @type {PhoneApp|null} */
let app = null;

Hooks.once("init", () => {
  markSystem();
  registerSettings();
  registerCoreSettings();
  applyPhoneLink();
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/inventory.hbs`,
    `modules/${MODULE_ID}/templates/inventory-item.hbs`,
    `modules/${MODULE_ID}/templates/actions.hbs`
  ]);
  // A spell's component marks, a named partial ({{> avttmSpellTags}}) for both spell row variants.
  foundry.applications.handlebars.loadTemplates({ avttmSpellTags: `modules/${MODULE_ID}/templates/spell-tags.hbs` });
  // SotDL's "Banes … Boons" line under the Next roll choice ({{> avttmAdvScale}}): Dice view, prompts, attack options.
  foundry.applications.handlebars.loadTemplates({ avttmAdvScale: `modules/${MODULE_ID}/templates/adv-scale.hbs` });
  // Hide Foundry's desktop interface as early as possible on a phone.
  if ( isPhoneMode() ) {
    document.body.classList.add("avttm-phone");
    registerWindowAdapter();
  }
});

Hooks.once("setup", () => {
  if ( getSetting("homeScreen") ) installHomeScreenTags();
});

Hooks.on(`${MODULE_ID}.phoneMode`, onPhoneModeChanged);

// Core's User Configuration window at startup (for a player without a character) would cover the app full screen,
// and the Character tab's own picker does the same job, so it is closed in phone mode.
closeStartupUserConfig(isPhoneMode);

Hooks.once("ready", async () => {
  if ( !isSupported() ) {
    console.warn(`${MODULE_ID} | Only dnd5e and Shadow of the Demon Lord are supported; phone mode disabled.`);
    document.body.classList.remove("avttm-phone");
    return;
  }
  markLoaded(isPhoneMode());
  if ( await maybeAskPhoneMode() ) return;
  if ( await applyCanvasPreference() ) return;
  if ( !isPhoneMode() ) return;

  app = new PhoneApp();
  game.modules.get(MODULE_ID).api = { app };
  dismissPhoneNotices();

  // Targets without the map (dnd5e: through its targets field; SotDL: passed to the attack by the use dialog).
  initTargets();
  // The use dialog's roll choices reach dnd5e's rolls through its hooks.
  if ( sys.FEATURES.useSteps ) registerUseHooks();
  onTargetsChanged(() => app.onTargetsChanged());
  initTurnAlert(turn => app.showTurn(turn));
  activateShareListeners(() => app.onShared());
  setKeepAwake(getSetting("keepAwake"));
  syncPhoneDice();
  registerAppHooks();
  app.render();
  initPrompts({
    show: prompt => app.prompts.add(prompt),
    close: key => app.prompts.close(key),
    enabled: kind => getSetting(PROMPT_SETTINGS[kind]),
    isMine: actor => actor.isOwner
  });
  initRollToasts(result => app.showRollToast(result), () => app.askCardTargets());
  // Attack rolls made here are followed by their damage roll (setting, on by default; the table does the same).
  sys.rollDamageAfterAttacks(actor => getSetting("autoDamage") && actor.isOwner);
});

/**
 * Register the phone app's hooks: refreshes, settings, and the data, combat and chat the app shows.
 */
function registerAppHooks() {
  Hooks.on(`${MODULE_ID}.refresh`, () => app.render());
  Hooks.on(`${MODULE_ID}.keepAwake`, () => setKeepAwake(getSetting("keepAwake")));
  Hooks.on(`${MODULE_ID}.physicalDice`, syncPhoneDice);

  // Character data.
  onActorDataChange(doc => {
    // The picker lists every character the user owns, so it refreshes on any actor change (e.g. ownership given).
    if ( app.showsPicker || (actorOf(doc) === app.actor) ) app.render();
  });
  // A character assigned, created or removed later.
  Hooks.on("updateUser", user => user.isSelf && app.render());
  Hooks.on("createActor", () => app.render());
  Hooks.on("deleteActor", () => app.render());

  // Combat strip.
  for ( const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"] ) {
    Hooks.on(hook, () => app.renderCombat());
  }

  // The Settings tab's table seat choice (the table module's seats).
  Hooks.on("awesome-vtt.seatsChanged", () => (app.state.view === "settings") && app.renderView());

  // Chat view and unread badge.
  onChatChange((message, action) => app.onChatMessage(message, action));
}
