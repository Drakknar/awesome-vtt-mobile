import { getSetting, setSetting } from "./settings.mjs";

/**
 * What the browser reports about this device; logged to the console to help when detection guesses wrong.
 * @returns {{coarsePointer: boolean, anyFinePointer: boolean, mobileBrowser: boolean, shortSide: number}}
 */
function deviceInfo() {
  return {
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    anyFinePointer: window.matchMedia("(any-pointer: fine)").matches,
    mobileBrowser: (navigator.userAgentData?.mobile === true)
      || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
    shortSide: Math.min(window.screen.width, window.screen.height)
  };
}

/**
 * A phone or small tablet: a small screen, and either a mobile browser or a touch-only pointer.
 * Pointer media queries alone aren't reliable (some Android browsers also report a fine pointer), so the
 * browser's own "mobile" signal is accepted too.
 * @param {object} info
 * @returns {boolean}
 */
function looksLikePhone(info = deviceInfo()) {
  const touchOnly = info.coarsePointer && !info.anyFinePointer;
  return (info.shortSide <= 900) && (info.mobileBrowser || touchOnly);
}

/** Delay before asking whether to use phone mode (ms). */
const ASK_DELAY_MS = 1500;

/** Phone mode asked for by the page address (`?phone=on|off`), used until the setting has been saved. */
let linkMode = null;

/**
 * Is the phone app shown on this device? "auto" becomes "on" or "off" once the user has answered.
 * @returns {boolean}
 */
export const isPhoneMode = () => (linkMode ?? getSetting("phoneMode")) === "on";

/**
 * A `?phone=on|off` link (the SSO join page's "Join" / "Join on phone" buttons) sets phone mode for this device and
 * counts as the answer to the phone-mode question. Call it at init: `isPhoneMode()` follows the link at once, while
 * the settings are saved in the background. The parameter is removed from the address, so a later reload keeps
 * whatever the user picks in the settings.
 */
export function applyPhoneLink() {
  const url = new URL(window.location.href);
  const value = url.searchParams.get("phone");
  if ( value === null ) return;
  url.searchParams.delete("phone");
  window.history.replaceState(window.history.state, "", url);
  if ( !["on", "off"].includes(value) ) return;
  linkMode = value;
  (async () => {
    await setSetting("asked", true);
    if ( getSetting("phoneMode") !== value ) await setSetting("phoneMode", value);
  })().catch(err => console.error("awesome-vtt-mobile | Couldn't save phone mode from the link", err));
}

/** Whether the phone app was started for this page load; a change of phone mode reloads the page. */
let activeAtLoad = false;
export const markLoaded = active => activeAtLoad = active;

/**
 * On a phone-like device with the default "auto" setting, ask once whether to use phone mode.
 * @returns {Promise<boolean>}  Whether the page is reloading.
 */
export async function maybeAskPhoneMode() {
  const info = deviceInfo();
  const phone = looksLikePhone(info);
  console.info("awesome-vtt-mobile | Phone check", { ...info, phone, phoneMode: getSetting("phoneMode"), asked: getSetting("asked") });
  if ( linkMode || (getSetting("phoneMode") !== "auto") || getSetting("asked") || !phone ) return false;
  // Other modules often open welcome windows on "ready"; ask a moment later so this question opens after them.
  await new Promise(resolve => window.setTimeout(resolve, ASK_DELAY_MS));
  const yes = await foundry.applications.api.DialogV2.confirm({
    // A modal dialog is shown in the browser's top layer, above ordinary windows whatever their z-index.
    modal: true,
    window: { title: "AVTTM.Mode.AskTitle" },
    content: `<p>${game.i18n.localize("AVTTM.Mode.AskContent")}</p>`,
    yes: { label: "AVTTM.Mode.AskYes" },
    no: { label: "AVTTM.Mode.AskNo" }
  });
  // Closed without an answer (e.g. dismissed or hidden): ask again on the next load.
  if ( yes === null ) return false;
  await setSetting("asked", true);
  // The setting's change handler reloads the page when phone mode is turned on.
  await setSetting("phoneMode", yes ? "on" : "off");
  return yes === true;
}

/**
 * Keep core's No-Canvas mode in line with phone mode: on while phone mode and "Turn off the map" are on.
 * It is only turned off again if this module turned it on, so a user's own choice is kept.
 * @returns {Promise<boolean>}  Whether the page is reloading.
 */
export async function applyCanvasPreference() {
  const want = isPhoneMode() && getSetting("disableMap");
  const current = game.settings.get("core", "noCanvas");
  if ( want && !current ) {
    await setSetting("managedNoCanvas", true);
    await game.settings.set("core", "noCanvas", true);
    return reload();
  }
  if ( !want && current && getSetting("managedNoCanvas") ) {
    await setSetting("managedNoCanvas", false);
    await game.settings.set("core", "noCanvas", false);
    return reload();
  }
  return false;
}

/**
 * Reload the page shortly, after telling the user why.
 * @returns {boolean}
 */
function reload() {
  ui.notifications?.info("AVTTM.Mode.Reloading", { localize: true });
  window.setTimeout(() => window.location.reload(), 500);
  return true;
}

/** Switching phone mode on or off rebuilds the whole interface, so the page is reloaded when it changes. */
export async function onPhoneModeChanged() {
  // A change before "ready" comes from applyPhoneLink; the page is built for it already.
  if ( !game.ready ) return;
  if ( await applyCanvasPreference() ) return;
  if ( isPhoneMode() !== activeAtLoad ) reload();
}

/**
 * Messages core shows on every phone that don't apply in phone mode:
 * - the screen-resolution error (screen, zoom or window size),
 * - "Scene is viewed but not displayed because the game Canvas is disabled" (No-Canvas mode), and
 * - the browser-version error. Core's check reads the browser's version from its user agent; on phones this can be
 *   misread (it reported "Safari 12.0" in testing). Core still logs the message to the console.
 */
const PHONE_NOTICES = [
  "ERROR.RESOLUTION.Screen", "ERROR.RESOLUTION.Scale", "ERROR.RESOLUTION.Window",
  "INFO.SceneViewCanvasDisabled",
  "ERROR.BrowserVersion"
];

/**
 * A pattern matching a localized message as plain text, with its {placeholders} as wildcards.
 * @param {string|undefined} text
 * @returns {RegExp|null}
 */
function noticePattern(text) {
  if ( !text ) return null;
  const escaped = text.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\{[^}]+\}/g, ".*")}$`, "s");
}

/**
 * Dismiss those messages whenever they appear (also after rotating the phone, when core checks the size again).
 * They are removed through core's notifications API, using the notification id on each element.
 */
export function dismissPhoneNotices() {
  const patterns = PHONE_NOTICES
    .filter(key => game.i18n.has(key))
    .map(key => noticePattern(game.i18n.localize(key)))
    .filter(Boolean);
  const container = document.getElementById("notifications");
  if ( !container || !patterns.length ) return;
  // Core renders each message in a <p>; its text content is the message with any HTML escaping undone.
  const matches = li => {
    const text = li.querySelector("p")?.textContent.trim() ?? "";
    return patterns.some(p => p.test(text));
  };
  const sweep = () => {
    for ( const li of [...container.children] ) {
      const id = Number(li.dataset.id);
      if ( !(id > 0) || !matches(li) ) continue;
      try { ui.notifications.remove(id); }
      catch { li.remove(); }
    }
  };
  sweep();
  new MutationObserver(sweep).observe(container, { childList: true });
}
