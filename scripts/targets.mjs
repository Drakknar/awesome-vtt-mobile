import { MODULE_ID } from "./constants.mjs";
import { getSetting } from "./settings.mjs";
import { targetOnSelect } from "../../awesome-vtt-core/scripts/demonlord.mjs";
import { visibleTokenIds } from "../../awesome-vtt-core/scripts/vision.mjs";

/**
 * Targeting without the map.
 * - The phone keeps its own set of targeted tokens from the active scene. They are picked in the use dialog when an
 *   action needs them (see use.mjs), and offered again there as "same as last time".
 * - dnd5e reads targets through TargetsField.getDescriptors(); while there is no map on this device, that call is
 *   given the phone's targets instead of core's (empty) canvas targets. Attack cards, AC comparison and damage
 *   application from the chat card then work as usual.
 * - Shadow of the Demon Lord: the use dialog passes the picked tokens to the system's attack (`targetTokens()`).
 *   The system also reads `canvas.tokens` and `game.user.targets` itself (talents, gear, chat card buttons), which
 *   don't exist without the map: installDemonlordBridge() gives it a stand-in serving the phone's targets.
 * - The targets are broadcast as the user's activity, so the table screen and the GM see them on their maps.
 * - Vision: on a scene with token vision, the use dialog lists only the creatures the character can see. The phone
 *   has no map to tell, so it asks the table screen (core vision.mjs); if nobody answers, every creature is listed
 *   and the dialog says so.
 */

const { HOVER, ALWAYS } = CONST.TOKEN_DISPLAY_MODES;

/** Targeted token ids in the target scene. */
const selected = new Set();
let sceneId = null;
const listeners = new Set();

export const onTargetsChanged = fn => listeners.add(fn);
const changed = () => {
  syncUserTargets?.();
  listeners.forEach(fn => fn());
};

/** Set by the SotDL bridge: copies the phone's targets into game.user.targets. */
let syncUserTargets = null;

/** The scene players are looking at at the table: the active scene. */
const targetScene = () => game.scenes.active ?? null;

export const targetsEnabled = () => getSetting("targetList") !== "off";

/** How long an answer about what a character can see is used before asking again (ms). */
const VISION_FRESH_MS = 5000;

/**
 * The last answer: for which scene and character, the visible token ids (null if unknown), its state, when it came,
 * and whether a newer one is being asked for (the last answer stays in use meanwhile, so the list doesn't flicker).
 */
let vision = { key: null, ids: null, state: "off", at: 0, asking: false };

const visionKey = (scene, actor) => `${scene.id}:${actor.id}`;

/**
 * Where the check of what `actor` can see stands for the target list: "off" (the scene doesn't use token vision),
 * "checking", "known" or "unknown" (no device could tell). Starts a new check when the last answer is stale.
 */
export function checkVision(actor) {
  const scene = targetScene();
  if ( !scene || !actor || !scene.tokenVision ) return "off";
  const key = visionKey(scene, actor);
  const same = vision.key === key;
  if ( same && (vision.asking || ((Date.now() - vision.at) < VISION_FRESH_MS)) ) return vision.state;
  // A first question shows "checking"; a refresh keeps the last answer until the new one comes.
  vision = same ? { ...vision, asking: true } : { key, ids: null, state: "checking", at: 0, asking: true };
  const tokenIds = scene.tokens.filter(t => !t.hidden && t.actor).map(t => t.id);
  visibleTokenIds(actor, scene.id, tokenIds).then(ids => {
    if ( vision.key !== key ) return;
    vision = { key, ids: ids ? new Set(ids) : null, state: ids ? "known" : "unknown", at: Date.now(), asking: false };
    listeners.forEach(fn => fn());
  });
  return vision.state;
}

/**
 * Tokens the user may target, with names hidden the way the token's nameplate setting hides them.
 * @param {Actor} [actor]  The character using an action: only what it can see (see checkVision), nothing while
 *   that is being checked. Without it, every creature.
 */
export function getCandidates(actor) {
  const scene = targetScene();
  if ( !scene || !targetsEnabled() ) return [];
  let tokens = scene.tokens.filter(t => !t.hidden && t.actor);
  if ( actor && scene.tokenVision && (vision.key === visionKey(scene, actor)) ) {
    if ( vision.state === "checking" ) return [];
    if ( vision.ids ) tokens = tokens.filter(t => vision.ids.has(t.id));
  }
  if ( getSetting("targetList") === "combat" ) {
    const combat = game.combats.find(c => c.active && (c.scene?.id === scene.id));
    const inCombat = new Set(combat?.combatants.map(c => c.tokenId) ?? []);
    tokens = tokens.filter(t => inCombat.has(t.id) || t.actor.hasPlayerOwner);
  }
  return tokens
    .map(t => ({
      id: t.id,
      name: (t.isOwner || [HOVER, ALWAYS].includes(t.displayName)) ? t.name : game.i18n.localize("AVTTM.Targets.Unknown"),
      img: t.texture?.src ?? t.actor.img,
      disposition: t.disposition
    }))
    .sort((a, b) => (a.disposition - b.disposition) || a.name.localeCompare(b.name));
}

/** Ids of the current targets that are still on the target scene (the "previous" targets offered again). */
export function selectedIds() {
  return selectedTokens().map(t => t.id);
}

/** Replace all targets at once (from the use dialog), and tell the other screens. */
export function setTargets(tokenIds) {
  const scene = targetScene();
  if ( !scene ) return;
  sceneId = scene.id;
  selected.clear();
  for ( const id of tokenIds ) {
    const token = scene.tokens.get(id);
    if ( token && !token.hidden ) selected.add(id);
  }
  broadcast();
  changed();
}

function clearTargets() {
  const had = selected.size;
  selected.clear();
  if ( had ) broadcast();
  changed();
}

function broadcast() {
  const scene = targetScene();
  if ( !scene ) return;
  game.user.broadcastActivity({ sceneId: scene.id, targets: [...selected] });
}

/** How long the phone user's pointer stays on the other screens' maps after a ping (ms). */
const PING_CURSOR_MS = 1500;
let cursorTimer = null;

/** The centre of a token on its scene (the phone has no map to ask). */
function tokenCenter(token) {
  if ( typeof token.getCenterPoint === "function" ) return token.getCenterPoint();
  const size = token.parent?.grid?.size ?? 100;
  return { x: token.x + ((token.width * size) / 2), y: token.y + ((token.height * size) / 2) };
}

/**
 * While targets are being picked in the use dialog: show them on the other screens' maps (core's target markers in
 * this user's colour), and ping a creature as it is picked, so the table sees who is meant. Nothing is used yet:
 * restoreTargets() shows the targets in use again if the dialog closes without using the action.
 * @param {string[]} tokenIds
 * @param {string|null} pingId  The token just picked.
 */
export function previewTargets(tokenIds, pingId = null) {
  const scene = targetScene();
  if ( !scene ) return;
  const ids = tokenIds.filter(id => { const t = scene.tokens.get(id); return t && !t.hidden; });
  const activity = { sceneId: scene.id, targets: ids };
  const token = pingId ? scene.tokens.get(pingId) : null;
  if ( token && !token.hidden ) {
    if ( token.level ) activity.levelId = token.level;
    activity.cursor = tokenCenter(token);
    activity.ping = { scene: scene.id, style: "pulse" };
  }
  game.user.broadcastActivity(activity);
  if ( activity.cursor ) {
    window.clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(() => game.user.broadcastActivity({ cursor: null }), PING_CURSOR_MS);
  }
}

/** Show the targets in use again (after a preview that wasn't used). */
export function restoreTargets() {
  broadcast();
}

/** Token documents of the current targets that still exist and are visible. */
export function selectedTokens() {
  const scene = targetScene();
  if ( !scene || (scene.id !== sceneId) ) return [];
  return [...selected].map(id => scene.tokens.get(id)).filter(t => t && !t.hidden);
}

function installDnd5eBridge() {
  const TargetsField = globalThis.dnd5e?.dataModels?.chatMessage?.fields?.TargetsField;
  if ( !TargetsField?.getDescriptors ) {
    console.warn(`${MODULE_ID} | dnd5e TargetsField not found; targets from the phone won't reach roll cards.`);
    return;
  }
  const original = TargetsField.getDescriptors;
  TargetsField.getDescriptors = function(tokens) {
    // Only when called for "the user's targets" and there is no map to hold them.
    if ( (tokens === undefined) && !canvas?.ready && selected.size ) tokens = selectedTokens();
    return original.call(this, tokens);
  };
}

/** A target as SotDL reads a map token: id, name, document, actor and centre (no map methods). */
function tokenLike(doc) {
  return {
    id: doc.id,
    name: doc.name,
    document: doc,
    get actor() { return doc.actor; },
    get center() { return tokenCenter(doc); }
  };
}

/**
 * SotDL reads targets through its TokenManager: `canvas.tokens.controlled` (with "target on select") or
 * `game.user.targets`, and looks up tokens in `canvas.tokens.placeables`. Without the map `canvas.tokens` is
 * undefined (core creates the layers only when the map is drawn), so every talent, item and card button failed.
 * Here, only while core's No-Canvas mode is on: a stand-in layer with no placeables, whose `controlled` holds the
 * phone's targets in "target on select" mode, and game.user.targets filled with them (without core's targetToken
 * hook, whose SotDL handler measures on the map).
 */
function installDemonlordBridge() {
  if ( !game.settings.get("core", "noCanvas") || canvas?.ready || !canvas || (canvas.tokens !== undefined) ) return;
  // The phone's targets as map tokens, rebuilt only when they change (syncUserTargets).
  let tokens = [];
  const layer = {
    placeables: [],
    get controlled() { return targetOnSelect() ? [...tokens] : []; },
    get: () => undefined,
    setTargets: async ids => setTargets(ids ?? []),
    recalculatePlannedMovementPaths: () => {}
  };
  Object.defineProperty(canvas, "tokens", { value: layer, configurable: true, writable: false });
  syncUserTargets = () => {
    tokens = selectedTokens().map(tokenLike);
    const set = game.user.targets;
    Set.prototype.clear.call(set);
    for ( const token of tokens ) Set.prototype.add.call(set, token);
  };
}

/** Install the system bridge (dnd5e's targets field, SotDL's token layer) and follow scene changes. */
export function initTargets() {
  if ( game.system.id === "dnd5e" ) installDnd5eBridge();
  else if ( game.system.id === "demonlord" ) installDemonlordBridge();

  // A different active scene, or a removed or hidden token, drops targets that no longer apply.
  Hooks.on("updateScene", (scene, change) => {
    if ( ("active" in change) && (scene.id !== sceneId) && selected.size ) clearTargets();
  });
  Hooks.on("deleteToken", token => {
    if ( selected.delete(token.id) ) { broadcast(); changed(); }
  });
  Hooks.on("updateToken", (token, change) => {
    if ( change.hidden && selected.delete(token.id) ) { broadcast(); changed(); }
    else if ( token.parent?.id === targetScene()?.id ) changed();
  });
  Hooks.on("createToken", () => changed());
}
