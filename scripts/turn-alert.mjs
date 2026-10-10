import { TURN_SOUNDS } from "./constants.mjs";
import { getSetting } from "./settings.mjs";

/**
 * Your-turn alert: a banner, an optional sound and an optional vibration when a combatant this user owns starts its
 * turn, and optionally a lighter one when it is next.
 * - Vibration uses the Vibration API, which Android browsers support and iOS Safari does not.
 * - Foundry already plays its combat theme's "your turn" / "next up" sounds for owners. When a theme is selected
 *   (core setting "Combat Theme"), this alert stays silent so the sound doesn't play twice.
 */

/** @type {(state: {kind: "turn"|"next", name: string}|null) => void} */
let show = () => {};
let lastKey = null;

/** @param {function} onShow  Receives the banner state to display, or null to hide it. */
export function initTurnAlert(onShow) {
  show = onShow;
  Hooks.on("combatTurnChange", combat => check(combat));
  Hooks.on("updateCombat", (combat, change) => {
    if ( ("round" in change) || ("turn" in change) || ("started" in change) ) check(combat);
  });
  Hooks.on("deleteCombat", () => show(null));
}

const mine = combatant => !!combatant && !game.user.isGM && combatant.isOwner;

function check(combat) {
  if ( !combat?.started || !combat.active ) return show(null);
  const key = `${combat.id}:${combat.round}:${combat.turn}`;
  if ( key === lastKey ) return;
  lastKey = key;
  if ( !getSetting("turnAlert") ) return show(null);

  const current = combat.combatant;
  if ( mine(current) ) {
    show({ kind: "turn", name: current.name });
    playSound();
    vibrate([300, 150, 300]);
    return;
  }
  if ( getSetting("turnAlertNext") && mine(combat.nextCombatant) ) {
    show({ kind: "next", name: combat.nextCombatant.name });
    vibrate([150]);
    return;
  }
  show(null);
}

function playSound() {
  const choice = getSetting("turnAlertSound");
  if ( choice === "none" ) return;
  const theme = game.settings.get("core", "combatTheme");
  if ( theme && (theme !== "none") ) return;
  const src = choice === "custom" ? getSetting("turnAlertSoundPath").trim() : TURN_SOUNDS[choice];
  if ( !src ) return;
  game.audio.play(src, { context: game.audio.interface, volume: getSetting("turnAlertVolume") })
    .catch(err => console.warn("Turn alert sound could not be played", err));
}

function vibrate(pattern) {
  if ( getSetting("turnAlertVibrate") ) navigator.vibrate?.(pattern);
}

/** Play the configured alert once, so the user can check the settings. */
export function testTurnAlert() {
  show({ kind: "turn", name: game.i18n.localize("AVTTM.Turn.Test") });
  const theme = game.settings.get("core", "combatTheme");
  if ( theme && (theme !== "none") ) ui.notifications.info("AVTTM.Turn.ThemeActive", { localize: true });
  else playSound();
  vibrate([300, 150, 300]);
}
