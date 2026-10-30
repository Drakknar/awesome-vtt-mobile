import { sectionList } from "../../awesome-vtt-core/scripts/ui.mjs";

export const MODULE_ID = "awesome-vtt-mobile";

/** Built-in sounds offered for the your-turn alert (paths inside Foundry's public folder). */
export const TURN_SOUNDS = {
  notify: "sounds/notify.wav",
  horn: "sounds/combat/epic-turn-1hit.ogg",
  voice: "sounds/combat/mc-next-youare.ogg"
};

/**
 * Views of the phone app, in tab bar order: the core's shared sections (with Party while the shared inventory module
 * is active), then the phone's own Settings. Read once the game is ready.
 * @returns {string[]}
 */
export const views = () => [...sectionList(), "settings"];
