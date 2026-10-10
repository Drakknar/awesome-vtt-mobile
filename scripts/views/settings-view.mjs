import { MODULE_ID } from "../constants.mjs";
import { physicalDiceRegistered } from "../../../awesome-vtt-core/scripts/dice.mjs";
import { wakeLockSupported } from "../../../awesome-vtt-core/scripts/wake-lock.mjs";
import { canPromptInstall, isStandalone, isIOS } from "../pwa.mjs";

/** Settings shown in the phone's Settings tab, grouped; the same settings appear in Foundry's settings window. */
const SECTIONS = [
  { label: "AVTTM.SettingsView.Phone", keys: ["phoneMode", "disableMap", "keepAwake"] },
  { label: "AVTTM.SettingsView.Turn", keys: ["turnAlert", "turnAlertNext", "turnAlertVibrate", "turnAlertSound", "turnAlertSoundPath", "turnAlertVolume"] },
  { label: "AVTTM.SettingsView.Automation", keys: ["rollToasts", "autoDamage", "autoDeathSaves", "autoConcentration", "autoSaves", "autoRequests", "autoInitiative"] },
  { label: "AVTTM.SettingsView.Dice", keys: ["physicalDice"] },
  { label: "AVTTM.SettingsView.GM", keys: ["targetList", "homeScreen"] }
];

/** The table module's seat choice (its API), when it is active in this world. */
const tableSeats = () => {
  const table = game.modules.get("awesome-vtt");
  return (table?.active && table.api?.moveSeat) ? table.api : null;
};

/**
 * Build the Settings tab. Only settings the user may change are listed: all device (client) settings, and world
 * settings for users who may modify them (the GM).
 * @param {HTMLElement} container
 * @param {Actor|null} actor  The character shown, whose table seat can be chosen here.
 */
export function renderSettingsView(container, actor) {
  const canWorld = game.user.can("SETTINGS_MODIFY");
  container.replaceChildren();

  for ( const section of SECTIONS ) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "avttm-card avttm-settings";
    const legend = document.createElement("legend");
    legend.textContent = game.i18n.localize(section.label);
    fieldset.append(legend);
    for ( const key of section.keys ) {
      const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if ( !setting || ((setting.scope === CONST.SETTING_SCOPES.WORLD) && !canWorld) ) continue;
      const group = setting.type.toFormGroup(
        { label: game.i18n.localize(setting.name), hint: game.i18n.localize(setting.hint), localize: true },
        { name: key, value: game.settings.get(MODULE_ID, key), localize: true }
      );
      if ( (key === "physicalDice") && !physicalDiceRegistered() ) disable(group, "AVTTM.SettingsView.NeedsTableModule");
      if ( (key === "keepAwake") && !wakeLockSupported() ) disable(group, "AVTTM.SettingsView.WakeLockUnsupported");
      fieldset.append(group);
    }
    if ( fieldset.children.length > 1 ) container.append(fieldset);
  }

  const seat = seatSection(actor);
  // Right after "This device".
  if ( seat ) container.insertBefore(seat, container.children[1] ?? null);

  const actions = document.createElement("div");
  actions.className = "avttm-card avttm-button-column";
  actions.innerHTML = [
    button("testTurnAlert", "fa-bell", "AVTTM.SettingsView.TestAlert"),
    game.settings.get(MODULE_ID, "homeScreen") && !isStandalone()
      ? button("homeScreen", "fa-mobile-screen", "AVTTM.SettingsView.HomeScreen") : "",
    button("openFoundrySettings", "fa-gears", "AVTTM.SettingsView.FoundrySettings"),
    button("logOut", "fa-right-from-bracket", "AVTTM.SettingsView.LogOut")
  ].join("");
  container.append(actions);

  // The loaded version, to spot an outdated copy cached by the browser.
  const version = document.createElement("p");
  version.className = "avttm-muted avttm-small";
  version.textContent = `${game.modules.get(MODULE_ID)?.title ?? MODULE_ID} ${game.modules.get(MODULE_ID)?.version ?? ""}`;
  container.append(version);

  container.onchange = event => onChange(event);
}

/**
 * "Table seat": where the character sits around the table screen (the table module's seat choice). A taken seat is
 * swapped; a character that isn't seated can only take a free seat. Players' choices are saved by the GM.
 */
function seatSection(actor) {
  const seats = tableSeats();
  if ( !seats || !actor || !seats.movableActors().includes(actor) ) return null;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "avttm-card avttm-settings";
  const legend = document.createElement("legend");
  legend.textContent = game.i18n.localize("AVTTM.SettingsView.Seat");
  const select = document.createElement("select");
  select.name = "avttmSeat";
  select.dataset.actorId = actor.id;
  const options = seats.seatOptions(actor);
  if ( !options.some(o => o.current) ) select.append(new Option(game.i18n.localize("AVTTM.SettingsView.NotSeated"), "", true, true));
  for ( const o of options ) {
    const option = new Option(o.occupant ? `${o.label} — ${o.occupant}` : o.label, o.key, o.current, o.current);
    option.disabled = o.disabled;
    select.append(option);
  }
  const group = document.createElement("div");
  group.className = "form-group";
  const label = document.createElement("label");
  label.textContent = actor.name;
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.append(select);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = game.i18n.localize("AVTTM.SettingsView.SeatHint");
  group.append(label, fields, hint);
  fieldset.append(legend, group);
  return fieldset;
}

const button = (action, icon, label) =>
  `<button type="button" data-action="${action}"><i class="fa-solid ${icon}" inert></i> ${game.i18n.localize(label)}</button>`;

function disable(group, hintKey) {
  for ( const input of group.querySelectorAll("input, select") ) input.disabled = true;
  const hint = document.createElement("p");
  hint.className = "hint avttm-warning";
  hint.textContent = game.i18n.localize(hintKey);
  group.append(hint);
}

/** Save a changed setting. Values are cleaned by the setting's own field, so they keep their type and limits. */
async function onChange(event) {
  // Compound inputs (e.g. the range slider) may report the change from an unnamed inner input.
  const input = event.target.closest("[name]");
  const key = input?.getAttribute("name");
  if ( key === "avttmSeat" ) return onSeatChange(input);
  const setting = key && game.settings.settings.get(`${MODULE_ID}.${key}`);
  if ( !setting ) return;
  const raw = input.type === "checkbox" ? input.checked : input.value;
  // Disabled while saving, so a slow server doesn't invite changing it again half way.
  input.disabled = true;
  try {
    await game.settings.set(MODULE_ID, key, setting.type.clean(raw));
  } catch(err) {
    ui.notifications.error(err.message);
  } finally {
    input.disabled = false;
  }
}

/** Move the character; a saved move re-renders this tab (seatsChanged, main.mjs). */
function onSeatChange(select) {
  const actor = game.actors.get(select.dataset.actorId);
  if ( actor && select.value ) return tableSeats()?.moveSeat(actor, select.value);
}

/** Home screen instructions: the install prompt where the browser offers one, otherwise how to add it by hand. */
export function homeScreenHelp() {
  if ( canPromptInstall() ) return null;
  return game.i18n.localize(isIOS() ? "AVTTM.SettingsView.HomeScreenIOS" : "AVTTM.SettingsView.HomeScreenOther");
}
