import { getSetting } from "./settings.mjs";
import sys, { damageAction } from "../../awesome-vtt-core/scripts/system.mjs";

/**
 * A short, dismissible notice with the result of each roll made by this phone's player ("Show roll results"):
 * checks, saves, attacks, damage, healing and the dice pool, whether Foundry rolled the dice or their results were
 * entered from real dice. It comes from the core's onRollResult, which waits for Dice So Nice and skips blind rolls;
 * the text is the core's rollNotice, as in the table's seats. The phone is the roller's own screen, so pass / fail
 * against a DC always shows, as dnd5e shows it to the roller. An attack, spell or other action that didn't miss gets
 * a "Roll damage" button (the core's damageAction), unless its damage is already rolled after the
 * attack ("Roll damage after attacks"); the damage roll's own message then shows the damage. `askTargets` runs
 * first (SotDL without the map: pick who the damage is for).
 */
export function initRollToasts(show, askTargets = async () => true) {
  sys.onRollResult((result, message) => {
    const notice = sys.rollNotice(result, TOAST_LABELS);
    // SotDL without the map: who the damage is for, as for the card's own button (app.askCardTargets).
    notice.action = damageAction(result, message, getSetting("autoDamage"), game.i18n.localize("AVTTM.Toast.RollDamage"), askTargets);
    show(notice);
  }, { enabled: () => getSetting("rollToasts") });
}

/** Label keys for the words of a roll notice. */
const TOAST_LABELS = id => ({
  damage: "AVTTM.Toast.Damage", healing: "AVTTM.Toast.Healing", critical: "AVTTM.Toast.Critical", fumble: "AVTTM.Toast.Fumble",
  success: "AVTTM.Toast.Success", failure: "AVTTM.Toast.Failure", hit: "AVTTM.Toast.Hit", miss: "AVTTM.Toast.Miss",
  hitCount: "AVTTM.Toast.HitCount"
})[id];
