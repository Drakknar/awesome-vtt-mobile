import { getSetting } from "./settings.mjs";
import { physicalDiceRegistered, syncDefaultDiceMethod } from "../../awesome-vtt-core/scripts/dice.mjs";

/**
 * Physical dice on the phone. The awesome-vtt module registers the "Physical dice" method and its entry window;
 * this module only makes it the default method on this phone while the option is on. The window then opens full
 * screen here, and awesome-vtt's own "Physical dice" world setting still decides whether the GM enters results.
 */

/** Physical dice are on for this phone and available. */
export const physicalDiceActive = () => !!getSetting("physicalDice") && physicalDiceRegistered();


/** Make Physical dice this phone's default dice method while the option is on (per-die choices still win). */
export const syncPhoneDice = () => syncDefaultDiceMethod(physicalDiceActive());
