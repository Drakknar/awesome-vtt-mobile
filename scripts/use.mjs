import { MODULE_ID } from "./constants.mjs";
import * as sys from "../../awesome-vtt-core/scripts/dnd5e.mjs";

/**
 * Using an item's activity from the phone (dnd5e 6.x), in up to four steps:
 * choose the activity (if there are several) → casting / usage (if dnd5e would ask) → targets (if it needs them)
 * → roll options (if it rolls at once).
 *
 * The choices are handed to dnd5e's own roll through its "preRoll…V2" hooks, which may change the roll
 * configuration and set `dialog.configure = false` to skip dnd5e's roll dialog.
 *
 * What dnd5e's usage dialog would ask (spell slot, concentration, resource use, scaling, profiles) is asked in the
 * usage step instead, and passed to `activity.use(usage, { configure: false })`. Cast and forward activities are
 * resolved first (resolveActivity). Placing an area (measured template) needs the map, so it is always turned off
 * while the map is off. Only activity types the step doesn't cover (e.g. bastion orders) keep dnd5e's own dialog.
 */

/** Activity types that roll straight after use (dnd5e's _triggerSubsequentActions). */
const ROLLS_ON_USE = { attack: "attack", damage: "damage", heal: "damage" };

const PENDING_MS = 2 * 60 * 1000;
export const MAX_BONUS = 40;

/** Activities of an item the user can use. */
export function usableActivities(item) {
  return (item?.system.activities?.contents ?? []).filter(a => a.canUse !== false);
}

/**
 * Does this activity need targets picked? Attacks and saves always do; others when they affect creatures other than
 * the user, or cover an area (then the player picks the creatures inside, since templates need the map).
 */
export const needsTargets = activity => sys.needsTargets(activity, { areasNeedTargets: true });

/** How many targets the activity asks for, if it's a plain number. */
export function targetCount(activity) {
  const n = Number(activity.target?.affects?.count);
  return Number.isInteger(n) && (n > 0) ? n : null;
}

/** Does the activity prefer allies (heal, ally/willing targets)? Used to order the target list. */
export const prefersAllies = activity =>
  (activity.type === "heal") || ["ally", "willing"].includes(activity.target?.affects?.type);

/**
 * Roll options offered before use, or null when the activity doesn't roll straight away.
 * @returns {{kind: "attack"|"damage", attackModes?: object[], ammunition?: object[], mastery?: object[]}|null}
 */
export function rollOptions(activity) {
  const kind = ROLLS_ON_USE[activity.type];
  if ( !kind ) return null;
  if ( kind === "damage" ) return { kind };
  const sys = activity.item.system;
  const last = key => activity.item.getFlag("dnd5e", `last.${activity.id}.${key}`);
  const options = (list, current) => (list ?? [])
    .filter(o => o && (o.value !== undefined))
    .map(o => ({ value: o.value, label: o.label ?? String(o.value), selected: o.value === current }));
  const attackModes = options(sys.attackModes, last("attackMode"));
  const ammunition = options(sys.ammunitionOptions, last("ammunition"));
  const mastery = options(sys.masteryOptions, last("mastery"));
  return {
    kind,
    attackModes: attackModes.length > 1 ? attackModes : [],
    ammunition,
    mastery: mastery.length > 1 ? mastery : []
  };
}

/** A situational bonus the player typed: a short, valid roll formula, or "". */
export function cleanBonus(text) {
  const bonus = String(text ?? "").trim().slice(0, MAX_BONUS);
  if ( !bonus ) return "";
  if ( !/^[\d\sdDkKhHlL+\-*/().@a-zA-Z_]+$/.test(bonus) ) return "";
  try { return foundry.dice.Roll.validate(bonus) ? bonus : ""; }
  catch { return ""; }
}

/* -------------------------------------------- */
/*  Casting: spell slot, concentration, resources */
/* -------------------------------------------- */

/** Areas and summoned creatures can only be placed on the map. */
const canPlaceOnMap = () => !!canvas?.ready;

/** Activity types whose usage questions the Casting step covers (others keep dnd5e's dialog, e.g. bastion orders). */
const COVERED_TYPES = new Set(["attack", "check", "damage", "enchant", "heal", "save", "summon", "transform", "utility"]);

/**
 * "Cast" and "forward" activities run another activity: the spell they cast, or a sibling activity. dnd5e would
 * ask about that one (and, for a spell with several activities, which one). Resolve it up front so the phone's
 * steps apply to it, with the same "cause" dnd5e sets, so linked levels and resources work as in dnd5e.
 * @returns {Promise<{item: Item, activity: Activity|null, base: object}|null>}
 */
export async function resolveActivity(activity) {
  if ( activity.type === "cast" ) {
    let spell = activity.cachedSpell;
    // As dnd5e's CastActivity#use does: the spell is created on the actor the first time it's cast.
    if ( !spell ) [spell] = await activity.actor.createEmbeddedDocuments("Item", [await activity.getCachedSpellData()]);
    if ( !spell ) return null;
    const activities = usableActivities(spell);
    return { item: spell, activity: activities.length === 1 ? activities[0] : null, base: { cause: { activity: activity.relativeUUID } } };
  }
  if ( activity.type === "forward" ) {
    const target = activity.item.system.activities.get(activity.activity?.id);
    if ( !target ) return null;
    return {
      item: activity.item, activity: target,
      base: { cause: { activity: activity.relativeUUID }, consume: { resources: false, spellSlot: false } }
    };
  }
  return { item: activity.item, activity, base: {} };
}

/** Label for a summon / transform / enchantment profile, using dnd5e's own dialog class when it has one. */
async function profileLabel(activity, profile, rollData) {
  const Dialog = activity.metadata?.usage?.dialog;
  if ( typeof Dialog?.prototype?.getProfileLabel === "function" ) {
    try {
      return Dialog.prototype.getProfileLabel.call({ activity }, profile, rollData);
    } catch { /* fall through */ }
  }
  const effect = await profile.getEffect?.();
  return profile.name || effect?.name || fromUuidSync(profile.uuid ?? "", { strict: false })?.name || "—";
}

/**
 * What dnd5e's usage dialog would ask for this activity, as options for the Casting step.
 * Uses dnd5e's own defaults (`_prepareUsageConfig`) and its test for when the dialog is needed.
 * @param {Activity} activity
 * @param {object} [base]  Usage config from a cast / forward activity (see resolveActivity).
 */
export async function usageOptions(activity, base = {}) {
  let config;
  try {
    config = activity._prepareUsageConfig(foundry.utils.deepClone(base));
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not read the usage options of ${activity.uuid}`, err);
    return { needed: false, supported: false, base };
  }
  const onMap = canPlaceOnMap();
  const templateSkipped = !onMap && !!config.create?.measuredTemplate;
  const summonsSkipped = !onMap && !!config.create?.summons;
  if ( config.create ) {
    if ( templateSkipped ) config.create.measuredTemplate = false;
    if ( summonsSkipped ) config.create.summons = false;
  }
  const options = { needed: false, supported: true, templateSkipped, summonsSkipped, base, config };
  if ( !activity._requiresConfigurationDialog?.(config) ) return options;
  options.needed = true;
  if ( !COVERED_TYPES.has(activity.type) ) {
    options.supported = false;
    return options;
  }

  const { actor, item } = activity;
  const linked = activity.getLinkedActivity?.(config.cause?.activity);
  const scale = (linked ?? activity).consumption?.scaling ?? {};
  const rollData = (linked ?? activity).getRollData?.({ deterministic: true }) ?? {};
  const simplify = value => globalThis.dnd5e?.utils?.simplifyBonus?.(value, rollData) ?? (Number(value) || 0);

  // Spell level. Cast through another activity: the levels it allows. Otherwise: the character's slots.
  if ( activity.requiresSpellSlot && (config.scaling !== false) ) {
    if ( linked ) {
      const minimumLevel = linked.spell?.level ?? item.system.level ?? 1;
      const maximumLevel = scale.allowed ? (scale.max ? minimumLevel + simplify(scale.max) - 1 : Infinity) : minimumLevel;
      options.slots = Object.entries(CONFIG.DND5E.spellLevels ?? {})
        .filter(([level]) => (Number(level) >= minimumLevel) && (Number(level) <= maximumLevel))
        .map(([level, label]) => ({ value: `spell${level}`, label: game.i18n.localize(label), empty: false }));
      options.slot = options.slots.find(o => o.value === config.spell?.slot)?.value ?? options.slots[0]?.value;
      options.showConsumeSlot = false;
    } else {
      const minimumLevel = item.system.level ?? 1;
      const spellMethod = CONFIG.DND5E.spellcasting?.[item.system.method];
      options.slots = Object.entries(actor.system.spells ?? {}).map(([value, slot]) => {
        if ( !slot.max || (slot.level < minimumLevel) || !slot.type ) return null;
        if ( spellMethod?.exclusive?.spells && (item.system.method !== slot.type) ) return null;
        const model = CONFIG.DND5E.spellcasting?.[slot.type];
        if ( model?.exclusive?.slots && (item.system.method !== slot.type) ) return null;
        return {
          value,
          label: game.i18n.format(`DND5E.SpellLevel${slot.type.capitalize()}`, {
            level: model?.isSingleLevel ? slot.level : slot.label, n: slot.value
          }),
          empty: !slot.value
        };
      }).filter(Boolean);
      const preferred = options.slots.find(o => (o.value === config.spell?.slot) && !o.empty)
        ?? options.slots.find(o => !o.empty) ?? options.slots[0];
      options.slot = preferred?.value;
      options.showConsumeSlot = !!activity.consumption?.spellSlot;
      options.consumeSlot = !!config.consume?.spellSlot;
    }
  }
  // Other scaling (e.g. a feature used for more effect): a number, as in dnd5e's dialog (value = increase + 1).
  else if ( scale.allowed && (config.scaling !== false) ) {
    const max = scale.max ? simplify(scale.max) : Infinity;
    if ( max > 1 ) options.scaling = { value: Math.clamp((config.scaling ?? 0) + 1, 1, max), max: Number.isFinite(max) ? max : null };
  }

  if ( config.concentration?.begin ) {
    options.concentration = {
      endOptions: [...(actor.concentration?.effects ?? [])].map(e => ({ id: e.id, name: e.name })),
      end: config.concentration.end ?? null
    };
  }
  options.hasResources = !!config.hasConsumption && (!!config.consume?.resources?.length || !!config.consume?.action);
  if ( linked && config.cause?.resources ) options.linkedResources = { name: linked.item?.name ?? linked.name };

  // Profiles: enchantment, summoned creature (and its size / type), transformation.
  const choice = async (list, current, extra = []) => {
    const opts = [...extra];
    for ( const p of list ) opts.push({ value: p._id, label: await profileLabel(activity, p, rollData) });
    return opts.length > 1 ? { value: current ?? opts[0]?.value, options: opts } : null;
  };
  if ( activity.type === "enchant" ) {
    const list = [];
    for ( const e of activity.availableEnchantments ?? [] ) {
      const effect = await e.getEffect?.();
      if ( effect ) list.push({ value: e._id, label: effect.name });
    }
    if ( list.length > 1 ) options.enchantment = { value: config.enchantmentProfile ?? list[0].value, options: list };
  }
  if ( activity.type === "summon" ) {
    options.summonProfile = await choice(activity.availableProfiles ?? [], config.summons?.profile);
    const sizes = [...(activity.creatureSizes ?? [])];
    const types = [...(activity.creatureTypes ?? [])];
    if ( sizes.length > 1 ) options.summonSize = {
      value: config.summons?.creatureSize ?? sizes[0],
      options: sizes.map(v => ({ value: v, label: game.i18n.localize(CONFIG.DND5E.actorSizes?.[v]?.label ?? v) }))
    };
    if ( types.length > 1 ) options.summonType = {
      value: config.summons?.creatureType ?? types[0],
      options: types.map(v => ({ value: v, label: game.i18n.localize(CONFIG.DND5E.creatureTypes?.[v]?.label ?? v) }))
    };
  }
  if ( activity.type === "transform" ) {
    const formless = (activity.transform?.mode === "form") && activity.transform?.formless;
    options.transformProfile = await choice(activity.availableProfiles ?? [], config.transform?.profile,
      formless ? [{ value: "", label: game.i18n.localize("DND5E.TRANSFORM.NoForm") }] : []);
  }
  return options;
}

/**
 * The usage configuration and dialog options for `activity.use()`, from the Casting step's choices.
 * Without the step (nothing to ask, or a case it doesn't cover), only placing on the map is turned off when needed.
 */
function usageFor(activity, choices) {
  const base = foundry.utils.deepClone(choices?.base ?? {});
  const offMap = canPlaceOnMap() ? {} : { create: { measuredTemplate: false, summons: false } };
  if ( !choices?.needed || !choices.supported ) return { usage: foundry.utils.mergeObject(base, offMap), dialog: {} };
  const config = choices.config ?? {};
  const usage = foundry.utils.mergeObject(base, {
    ...offMap,
    consume: {
      ...(config.consume ?? {}),
      spellSlot: choices.showConsumeSlot ? !!choices.consumeSlot : !!config.consume?.spellSlot,
      resources: choices.consumeResources === false ? [] : (config.consume?.resources ?? []),
      action: choices.consumeResources === false ? false : config.consume?.action
    }
  });
  if ( choices.slot ) usage.spell = { slot: choices.slot };
  if ( choices.scaling ) usage.scaling = Math.max(0, (Number(choices.scaling.value) || 1) - 1);
  if ( choices.concentration ) {
    usage.concentration = { begin: choices.concentrate !== false, end: choices.concentrate === false ? null : (choices.concentration.end || null) };
  }
  if ( choices.linkedResources ) usage.cause = { ...(usage.cause ?? {}), resources: choices.useLinked !== false };
  if ( choices.enchantment ) usage.enchantmentProfile = choices.enchantment.value;
  if ( choices.summonProfile || choices.summonSize || choices.summonType ) usage.summons = {
    ...(config.summons ?? {}),
    ...(choices.summonProfile ? { profile: choices.summonProfile.value } : {}),
    ...(choices.summonSize ? { creatureSize: choices.summonSize.value } : {}),
    ...(choices.summonType ? { creatureType: choices.summonType.value } : {})
  };
  if ( choices.transformProfile ) usage.transform = { ...(config.transform ?? {}), profile: choices.transformProfile.value };
  return { usage, dialog: { configure: false } };
}

/* -------------------------------------------- */
/*  Handing choices to dnd5e's roll             */
/* -------------------------------------------- */

/** @type {{activityUuid: string, itemUuid: string, attack?: object, damage?: object, until: number}|null} */
let pending = null;

/**
 * Remember the choices for the roll that follows this activity's use.
 * @param {Activity} activity
 * @param {object} choices  `{attack: {mode, bonus, attackMode, ammunition, mastery}}` or `{damage: {bonus}}`.
 */
export function setPendingRoll(activity, choices) {
  pending = { activityUuid: activity.uuid, itemUuid: activity.item.uuid, ...choices, until: Date.now() + PENDING_MS };
}

/**
 * The pending choices for this roll, used once. Matches the activity, or its item (a spell's own activity when it
 * is cast through a "cast" or "forward" activity).
 */
function take(config, kind) {
  if ( !pending || (Date.now() > pending.until) ) {
    pending = null;
    return null;
  }
  const subject = config.subject;
  const matches = subject && ((subject.uuid === pending.activityUuid) || (subject.item?.uuid === pending.itemUuid));
  if ( !matches || !pending[kind] ) return null;
  const choices = pending[kind];
  pending[kind] = null;
  if ( !pending.attack && !pending.damage ) pending = null;
  return choices;
}

function addBonus(roll, bonus) {
  if ( !roll || !bonus ) return;
  roll.parts = [...(roll.parts ?? []), "@situational"];
  roll.data = { ...(roll.data ?? {}), situational: bonus };
}

/** Register the dnd5e roll hooks once. */
export function registerUseHooks() {
  Hooks.on("dnd5e.preRollAttackV2", (config, dialog) => {
    const choices = take(config, "attack");
    if ( !choices ) return;
    if ( choices.attackMode ) config.attackMode = choices.attackMode;
    if ( choices.ammunition !== undefined ) config.ammunition = choices.ammunition;
    if ( choices.mastery ) config.mastery = choices.mastery;
    const roll = config.rolls?.[0];
    if ( roll ) {
      roll.options ??= {};
      // Only adds advantage / disadvantage; any the character already has (effects, features) is kept.
      if ( choices.mode === "adv" ) roll.options.advantage = true;
      if ( choices.mode === "dis" ) roll.options.disadvantage = true;
      addBonus(roll, choices.bonus);
    }
    dialog.configure = false;
  });
  Hooks.on("dnd5e.preRollDamageV2", (config, dialog) => {
    const choices = take(config, "damage");
    if ( !choices ) return;
    addBonus(config.rolls?.[0], choices.bonus);
    dialog.configure = false;
  });
}

/**
 * Use the activity through dnd5e's usage workflow, with the Casting step's choices (see usageFor).
 * dnd5e's usage dialog then only appears for the cases the step doesn't cover.
 */
export async function useActivity(activity, choices) {
  const { usage, dialog } = usageFor(activity, choices);
  try {
    return await activity.use(usage, dialog);
  } catch(err) {
    console.error(`${MODULE_ID} | Using ${activity.uuid} failed`, err);
    ui.notifications.error(err.message);
    pending = null;
  }
}
