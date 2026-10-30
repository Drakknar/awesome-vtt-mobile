import { MODULE_ID } from "./constants.mjs";

const { BooleanField, NumberField, StringField } = foundry.data.fields;

const refresh = () => Hooks.callAll(`${MODULE_ID}.refresh`);

/**
 * All options are registered with config: true, so they appear both in Foundry's settings window and in the phone
 * app's own Settings tab (which lists this module's settings the user may change).
 */
export function registerSettings() {
  const client = (key, type, extra = {}) => game.settings.register(MODULE_ID, key, {
    name: `AVTTM.Settings.${key}.Name`,
    hint: `AVTTM.Settings.${key}.Hint`,
    scope: "client",
    config: true,
    type,
    ...extra
  });
  const world = (key, type, extra = {}) => client(key, type, { scope: "world", ...extra });

  // Phone mode
  client("phoneMode", new StringField({
    required: true, blank: false, initial: "auto",
    choices: {
      auto: "AVTTM.Settings.phoneMode.Choices.auto",
      on: "AVTTM.Settings.phoneMode.Choices.on",
      off: "AVTTM.Settings.phoneMode.Choices.off"
    }
  }), { onChange: () => Hooks.callAll(`${MODULE_ID}.phoneMode`) });
  client("disableMap", new BooleanField({ initial: true }), { onChange: () => Hooks.callAll(`${MODULE_ID}.phoneMode`) });
  client("keepAwake", new BooleanField({ initial: true }), { onChange: () => Hooks.callAll(`${MODULE_ID}.keepAwake`) });

  // Your-turn alert
  client("turnAlert", new BooleanField({ initial: true }));
  client("turnAlertNext", new BooleanField({ initial: true }));
  client("turnAlertVibrate", new BooleanField({ initial: true }));
  client("turnAlertSound", new StringField({
    required: true, blank: false, initial: "notify",
    choices: {
      none: "AVTTM.Settings.turnAlertSound.Choices.none",
      notify: "AVTTM.Settings.turnAlertSound.Choices.notify",
      horn: "AVTTM.Settings.turnAlertSound.Choices.horn",
      voice: "AVTTM.Settings.turnAlertSound.Choices.voice",
      custom: "AVTTM.Settings.turnAlertSound.Choices.custom"
    }
  }));
  client("turnAlertSoundPath", new StringField({ blank: true, initial: "" }));
  client("turnAlertVolume", new NumberField({ initial: 0.8, min: 0, max: 1, step: 0.05 }));

  // A roll from the sheet asks first: SotDL attributes for boons or banes (on by default), dnd5e checks, saves and
  // skills for advantage (off by default). The key is the same in both systems.
  const sotdl = game.system.id === "demonlord";
  client("askBoons", new BooleanField({ initial: sotdl }), sotdl ? {} : {
    name: "AVTTM.Settings.askAdvantage.Name", hint: "AVTTM.Settings.askAdvantage.Hint"
  });

  // Damage / healing result notice.
  client("rollToasts", new BooleanField({ initial: true }));

  // Roll an attack's damage right after its attack roll.
  client("autoDamage", new BooleanField({ initial: true }));

  // Automation: prompts on this phone, each off by default.
  client("autoDeathSaves", new BooleanField({ initial: false }));
  client("autoConcentration", new BooleanField({ initial: false }));
  client("autoSaves", new BooleanField({ initial: false }));
  client("autoRequests", new BooleanField({ initial: false }));
  client("autoInitiative", new BooleanField({ initial: false }));

  // Physical dice (needs the awesome-vtt module)
  client("physicalDice", new BooleanField({ initial: false }), { onChange: () => Hooks.callAll(`${MODULE_ID}.physicalDice`) });

  // GM options
  world("targetList", new StringField({
    required: true, blank: false, initial: "all",
    choices: {
      all: "AVTTM.Settings.targetList.Choices.all",
      combat: "AVTTM.Settings.targetList.Choices.combat",
      off: "AVTTM.Settings.targetList.Choices.off"
    }
  }), { onChange: refresh });
  world("homeScreen", new BooleanField({ initial: true }), { requiresReload: true });

  // The character shown when the user has no assigned character (or several).
  game.settings.register(MODULE_ID, "actorId", {
    scope: "client", config: false, type: new StringField({ blank: true, initial: "" }), onChange: refresh
  });
  // Whether this module turned on core's No-Canvas mode, so it only turns it off again if it did.
  game.settings.register(MODULE_ID, "managedNoCanvas", {
    scope: "client", config: false, type: new BooleanField({ initial: false })
  });
  // Whether the favorites row below the character pill is shown (per device).
  game.settings.register(MODULE_ID, "favoritesOpen", {
    scope: "client", config: false, type: new BooleanField({ initial: false })
  });
  // Answer to the "use phone mode?" question, so it is asked once per device.
  game.settings.register(MODULE_ID, "asked", {
    scope: "client", config: false, type: new BooleanField({ initial: false })
  });
}

export const getSetting = key => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
