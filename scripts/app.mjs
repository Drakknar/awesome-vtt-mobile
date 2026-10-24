import { MODULE_ID, views } from "./constants.mjs";
import { getSetting, setSetting } from "./settings.mjs";
import sys from "../../awesome-vtt-core/scripts/system.mjs";
import { CompendiumPanel, JournalPanel } from "../../awesome-vtt-core/scripts/panels.mjs";
import { DicePanel, advModes, advModeChoices, advModeScale, advModeShort, advModeTone } from "../../awesome-vtt-core/scripts/dice.mjs";
import * as sheet from "../../awesome-vtt-core/scripts/sheet.mjs";
import { PromptQueue, abilityRollPrompt } from "../../awesome-vtt-core/scripts/prompts.mjs";
import * as coreUI from "../../awesome-vtt-core/scripts/ui.mjs";
import * as targets from "./targets.mjs";
import * as use from "./use.mjs";
import { testTurnAlert } from "./turn-alert.mjs";
import { promptInstall, canPromptInstall } from "./pwa.mjs";
import { physicalDiceActive } from "./dice.mjs";
import { renderSettingsView, homeScreenHelp } from "./views/settings-view.mjs";

const { renderTemplate } = foundry.applications.handlebars;

/**
 * A tab bar that scrolls sideways (more tabs than fit, e.g. SotDL's six sheet tabs) is drawn again with each render:
 * put back where it was scrolled to, then bring the chosen tab into view, so a tap doesn't jump back to the start.
 */
function keepTabsInView(root, scrollLeft) {
  const bar = root.querySelector(".avttm-subtabs");
  if ( !bar ) return;
  bar.scrollLeft = scrollLeft;
  const active = bar.querySelector("button.active");
  if ( !active ) return;
  const left = active.offsetLeft - bar.offsetLeft;
  if ( left < bar.scrollLeft ) bar.scrollLeft = left;
  else if ( (left + active.offsetWidth) > (bar.scrollLeft + bar.clientWidth) ) bar.scrollLeft = left + active.offsetWidth - bar.clientWidth;
}
const tpl = name => `modules/${MODULE_ID}/templates/${name}.hbs`;

/** Chat messages shown at first, and added by each "Show earlier messages". */
const CHAT_PAGE = 40;
/** How long a damage / healing result stays on screen (ms). */
const TOAST_MS = 6000;
/** A result with a button (e.g. Roll damage) stays longer, so the player has time to use it. */
const TOAST_ACTION_MS = 30000;

/** A SotDL roll modifier typed in the use dialog: a whole number (−99 … +99). */
const MODIFIER = /^[+-]?\d{1,2}$/;

/** Actions that submit something or move on; their button is disabled while they run. */
const BUSY_ACTIONS = new Set([
  "useItem", "useActivity", "usePrevious", "useNext", "promptChoice", "pickActor", "spellPrepare", "invToParty", "toggleFavorite", "trackAdjust", "turnSpeed",
  "applyHp", "toggleInspiration", "shortRest", "longRest", "deathSave", "endConcentration", "exhaustion",
  "toggleCondition", "toggleEffect", "rollAbility", "rollSave", "rollSkill", "rollInitiative", "endTurn",
  "invQty", "invEquip", "invAttune", "invDetails", "usesAdjust", "slotAdjust", "diceRoll",
  "chatSend", "chatMore", "chatMode", "compSearch", "compBrowse", "compMore", "compOpen", "compOpenSheet", "compAddItem", "compBrowser",
  "journalOpen", "journalShared", "journalPage", "journalFull", "homeScreen", "testTurnAlert", "openFoundrySettings", "logOut"
]);
// Not listed: actions that only change what's on screen (tabs, sheets, dice pool, advantage choice, going back).
/** Labels of the core's advantage modes. */
const ADV_MODES = { normal: "AVTTM.Sheet.Normal", adv: "AVTTM.Sheet.Advantage", dis: "AVTTM.Sheet.Disadvantage" };
const ADV_SHORT = { adv: "AVTTM.Dice.AdvShort", dis: "AVTTM.Dice.DisShort" };
const VIEW_ICONS = { ...coreUI.SECTION_ICONS, settings: "fa-gears" };

const { escapeHTML } = coreUI;

/**
 * The phone app: turn banner and combat strip at the top, the views (the core's sections plus Settings), the bottom
 * sheets (use dialog, switcher, quick actions, prompts), the character pill and the tab bar at the bottom.
 * All views are rendered by this module. The Chat view draws each message with Foundry's own ChatMessage#renderHTML
 * (so dnd5e card buttons work) and sends through ChatLog#processMessage (so chat commands and whispers work).
 */
export default class PhoneApp {
  state = {
    view: "character",
    sheetTab: "actions",
    // The quick actions' open tab (the core's quickTab).
    quickTab: "quick",
    advMode: "normal",
    hpMode: "damage",
    unread: 0,
    // Effects toggled from the launcher this session, kept in its list once enabled.
    toggledEffects: new Set(),
    // Bottom sheet over the app, one at a time: "use" (use an item's activity), "picker" (switch character),
    // "launcher" (quick actions), "prompt" (automation prompts, see the core's prompts.mjs) or null.
    overlay: null,
    // The use dialog: item, chosen activity, steps, and the choices made so far.
    use: null,
    // Expanded item descriptions, in Actions and Inventory (id -> enriched HTML).
    inv: { details: {} },
    // Chat: "all" visible messages or only this character's ("mine"), how many are shown, and the unsent text.
    chat: { filter: "all", limit: CHAT_PAGE, text: "" }
  };

  constructor() {
    this.render = foundry.utils.debounce(this.#renderNow.bind(this), 50);
    // Dice view (the core's): real dice when physical dice are on for this phone; a single d20 uses the Next roll.
    this.dice = new DicePanel({
      render: () => this.renderDice(),
      physicalAvailable: physicalDiceActive,
      advMode: () => this.state.advMode,
      actor: () => this.actor,
      flavor: game.i18n.localize("AVTTM.Dice.Flavor"),
      onRolled: usedAdvantage => usedAdvantage && this.#setAdvMode("normal")
    });
    this.element = this.#build();
    this.compendium = new CompendiumPanel({
      render: () => this.renderCompendium(), root: () => this.#view("compendium"), actor: () => this.actor
    });
    this.journal = new JournalPanel({ render: () => this.renderJournal(), root: () => this.#view("journal") });
    // The party's shared inventory (its own module, optional), drawn into the Party view.
    const partyView = this.#view("party");
    this.party = partyView ? coreUI.sharedInventory()?.mount(partyView, { actor: () => this.actor, device: "phone" }) : null;
    this.tabbar = this.#buildTabbar();
    document.body.append(this.element, this.tabbar);
    // The result notice sits just above the character pill, which changes height with its content.
    const pill = this.element.querySelector(".avttm-pill");
    new ResizeObserver(() => {
      document.body.style.setProperty("--avttm-pill-height", `${pill.offsetHeight}px`);
    }).observe(pill);
    this.#sizeTabs();
    document.fonts?.ready.then(() => this.#sizeTabs());
  }

  #lastSheetTab = null;

  /* -------------------------------------------- */
  /*  Character                                   */
  /* -------------------------------------------- */

  /** Characters this user can play (the GM owns, and so sees, every character). */
  get ownedCharacters() {
    return game.actors
      .filter(a => (a.type === "character") && a.isOwner)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Is a character list showing (no character chosen yet, or the switcher open)? */
  get showsPicker() {
    return !this.actor || (this.state.overlay === "picker");
  }

  /** The chosen character, else the user's assigned character, else their only character. */
  get actor() {
    const chosen = game.actors.get(getSetting("actorId"));
    if ( chosen?.isOwner ) return chosen;
    if ( game.user.character?.isOwner ) return game.user.character;
    const owned = this.ownedCharacters;
    return owned.length === 1 ? owned[0] : null;
  }

  /* -------------------------------------------- */
  /*  DOM                                         */
  /* -------------------------------------------- */

  #build() {
    const el = document.createElement("div");
    el.id = "avttm-app";
    el.innerHTML = `
      <button type="button" class="avttm-turn" data-action="dismissTurn" hidden></button>
      <div class="avttm-combat" hidden></div>
      <main class="avttm-main">
        ${views().map(v => `<section class="avttm-view" data-view="${v}" ${v === this.state.view ? "" : "hidden"}></section>`).join("")}
      </main>
      <footer class="avttm-top avttm-pill"></footer>
      <div class="avttm-overlay" data-action="overlay" hidden></div>
      <div class="avttm-toast-box">
        <button type="button" class="avttm-toast" data-action="dismissToast" role="status" aria-live="polite" hidden></button>
        <button type="button" class="avttm-toast-action" data-action="toastAction" hidden></button>
      </div>`;
    el.addEventListener("click", this.#onClick.bind(this));
    // Before the system's own listeners on chat card buttons (capture phase): ask for targets first.
    if ( sys.CARD_TARGET_BUTTONS ) el.addEventListener("click", this.#onCardTargetClick.bind(this), { capture: true });
    el.addEventListener("change", this.#onChange.bind(this));
    el.addEventListener("input", this.#onInput.bind(this));
    el.addEventListener("keydown", this.#onKeyDown.bind(this));
    return el;
  }

  /**
   * The tab bar is a separate top-level element, so it can sit above Foundry's windows (which would otherwise cover
   * it, as they are stacked above the phone app). Full-screen windows end just above it.
   */
  #buildTabbar() {
    const nav = document.createElement("nav");
    nav.id = "avttm-tabbar";
    nav.className = "avttm-tabbar";
    // The placement that keeps it visible is also set inline, so it holds even with an older cached stylesheet.
    Object.assign(nav.style, { position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "2000000000" });
    nav.ariaLabel = game.i18n.localize("AVTTM.Tabs.Label");
    nav.innerHTML = views().map(v => `
      <button type="button" data-action="view" data-view="${v}" class="${v === this.state.view ? "active" : ""}">
        <i class="fa-solid ${VIEW_ICONS[v]}" inert></i><span>${escapeHTML(game.i18n.localize(`AVTTM.Tabs.${v}`))}</span>
        ${v === "chat" ? '<em class="avttm-badge" hidden></em>' : ""}
      </button>`).join("");
    nav.addEventListener("click", this.#onClick.bind(this));
    new ResizeObserver(() => {
      document.body.style.setProperty("--avttm-tabbar-height", `${nav.offsetHeight}px`);
    }).observe(nav);
    return nav;
  }

  /**
   * Give every tab the same width: the widest tab's natural width (its label, in any language). The tabs then share
   * spare room equally, and the bar scrolls sideways when even that width doesn't fit.
   */
  #sizeTabs() {
    const nav = this.tabbar;
    nav.classList.add("avttm-measuring");
    const widest = Math.max(0, ...[...nav.querySelectorAll("button")].map(b => b.scrollWidth));
    nav.classList.remove("avttm-measuring");
    if ( widest ) nav.style.setProperty("--avttm-tab-width", `${Math.ceil(widest)}px`);
  }

  /**
   * Leaving for another view closes Foundry's full-screen windows (sheets, journals, the compendium browser, settings)
   * so the chosen view is visible. Dialogs and the dice entry window stay open: closing them would cancel a roll or
   * roll the dice digitally.
   */
  #closeFullScreenWindows() {
    const { DialogV2 } = foundry.applications.api;
    const RollResolver = foundry.applications.dice.RollResolver;
    for ( const app of foundry.applications.instances.values() ) {
      if ( !app.hasFrame || !app.rendered || (app instanceof DialogV2) || (app instanceof RollResolver) ) continue;
      app.close();
    }
    for ( const app of Object.values(ui.windows ?? {}) ) app.close?.();
  }

  #view(name) {
    return this.element.querySelector(`.avttm-view[data-view="${name}"]`);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async #renderNow() {
    await Promise.all([this.renderHeader(), this.renderCombat(), this.renderView()]);
    if ( this.state.overlay ) await this.renderOverlay();
  }

  async renderHeader() {
    const actor = this.actor;
    this.element.querySelector(".avttm-top").innerHTML = await renderTemplate(tpl("header"), {
      actor: actor ? sys.getSummary(actor) : null,
      world: game.world.title,
      canSwitch: this.ownedCharacters.length > 1,
      launcherOpen: this.state.overlay === "launcher",
      // The character's dnd5e favorites, in a row the pill's star button shows or hides.
      canFavorite: !!actor && sys.canFavorite(actor),
      favoritesOpen: getSetting("favoritesOpen"),
      favorites: actor ? sys.getFavoriteActions(actor) : [],
      rollMode: this.state.advMode === "normal" ? null : {
        id: this.state.advMode,
        tone: advModeTone(this.state.advMode),
        short: advModeShort(ADV_SHORT, this.state.advMode),
        label: sys.rollModeLabel(this.state.advMode) ?? game.i18n.localize(ADV_MODES[this.state.advMode])
      },
    });
  }

  /** Data for the quick actions sheet. */
  #launcherContext(actor) {
    const context = sheet.quickActionsContext(actor, {
      tab: this.state.quickTab, tabLabel: id => `AVTTM.Launcher.Tab.${id}`,
      toggled: this.state.toggledEffects, hpMode: this.state.hpMode, hpLabel: id => `AVTTM.Launcher.Hp.${id}`
    });
    // The action rows read the open descriptions from the state, as in the Character tab.
    return { ...context, state: this.state };
  }

  /** The active encounter, if it has started. */
  get combat() {
    const combat = game.combats.find(c => c.active) ?? game.combat;
    return combat?.started ? combat : null;
  }

  async renderCombat() {
    const el = this.element.querySelector(".avttm-combat");
    const combat = this.combat;
    el.hidden = !combat;
    if ( !combat ) return;
    const current = combat.combatant;
    const mine = c => !!c?.isOwner && !game.user.isGM;
    el.innerHTML = await renderTemplate(tpl("combat"), {
      round: combat.round,
      turns: combat.turns.filter(c => c.visible).map(c => ({
        name: c.name,
        img: c.img ?? c.actor?.img,
        // As text, so an initiative of 0 still shows ({{#if}} hides the number 0).
        initiative: Number.isFinite(c.initiative) ? String(c.initiative) : "",
        current: c.id === current?.id,
        mine: mine(c),
        defeated: c.isDefeated
      })),
      // Roll initiative for the character shown (other owned creatures get their own prompt).
      // SotDL's default mode: a fast or slow turn instead of a roll.
      speed: game.user.isGM ? null : sys.turnSpeed(this.actor),
      canRoll: !game.user.isGM && !sys.turnSpeed(this.actor) && (sys.initiativeDue(this.actor, combat).length > 0),
      canEndTurn: mine(current)
    });
    el.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  /** Banner from the turn alert; null hides it. */
  showTurn(turn) {
    const el = this.element.querySelector(".avttm-turn");
    el.hidden = !turn;
    el.classList.toggle("next", turn?.kind === "next");
    if ( turn ) el.textContent = game.i18n.format(turn.kind === "next" ? "AVTTM.Turn.Next" : "AVTTM.Turn.Now", { name: turn.name });
  }

  async renderView() {
    switch ( this.state.view ) {
      case "character": return this.renderCharacter();
      case "dice": return this.renderDice();
      case "chat": return this.renderChat();
      case "journal": return this.renderJournal();
      case "compendium": return this.renderCompendium();
      case "party": return this.party?.render();
      case "settings": return renderSettingsView(this.#view("settings"), this.actor);
    }
  }

  async setView(view) {
    if ( !views().includes(view) ) return;
    this.state.view = view;
    for ( const section of this.element.querySelectorAll(".avttm-view") ) section.hidden = section.dataset.view !== view;
    for ( const b of this.tabbar.querySelectorAll('[data-action="view"]') ) {
      b.classList.toggle("active", b.dataset.view === view);
    }
    // When the tab bar scrolls (narrow screens), keep the chosen tab in sight.
    this.tabbar.querySelector(".active")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return this.renderView();
  }

  /* -------------------------------------------- */
  /*  Chat                                        */
  /* -------------------------------------------- */

  get #chatLog() {
    return this.#view("chat").querySelector(".avttm-chat-log");
  }

  get #chatActorId() {
    return sheet.chatActorId(this.state.chat.filter, this.actor);
  }

  #chatContext() {
    const current = game.settings.get("core", "messageMode");
    const modes = Object.entries(CONFIG.ChatMessage.modes ?? {}).map(([id, { label, icon }]) => ({
      id, icon, label: game.i18n.localize(label), active: id === current
    }));
    const { messages, hasMore } = sheet.chatMessages({ actorId: this.#chatActorId, limit: this.state.chat.limit });
    return {
      filters: sheet.CHAT_FILTERS.map(id => ({ id, label: game.i18n.localize(`AVTTM.Chat.Filter.${id}`), active: id === this.state.chat.filter })),
      modes,
      modeLabel: modes.find(m => m.active)?.label ?? "",
      text: this.state.chat.text,
      maxLength: sheet.MAX_CHAT_TEXT,
      hasMore,
      messages
    };
  }

  /** Draw the chat view: the most recent visible messages and the composer. */
  async renderChat() {
    this.state.unread = 0;
    this.#updateBadge();
    const view = this.#view("chat");
    const context = this.#chatContext();
    view.innerHTML = await renderTemplate(tpl("chat"), context);
    const log = this.#chatLog;
    const items = await Promise.all(context.messages.map(m => coreUI.renderMessage(m)));
    log.append(...items.filter(Boolean));
    log.scrollTop = log.scrollHeight;
  }

  /**
   * Keep an open chat view in step with new, changed and deleted messages; count unread ones otherwise.
   * @param {ChatMessage} message
   * @param {"create"|"update"|"delete"} action
   */
  async onChatMessage(message, action) {
    if ( this.state.view !== "chat" ) {
      if ( (action === "create") && sheet.chatShows(message, this.#chatActorId) ) {
        this.state.unread = Math.min(this.state.unread + 1, 99);
        this.#updateBadge();
      }
      return;
    }
    const log = this.#chatLog;
    if ( !log ) return;
    const atBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 80;
    const result = await coreUI.syncMessage(log, message, action, sheet.chatShows(message, this.#chatActorId));
    if ( !["added", "replaced"].includes(result) ) return;
    if ( atBottom || (message.author?.id === game.user.id) ) log.scrollTop = log.scrollHeight;
  }

  /**
   * Send the composed text through Foundry's chat processing, as the character shown on this phone.
   * Enter and the Send button share one guard, so a message isn't sent twice.
   */
  #sendChat = coreUI.exclusive(async () => {
    const input = this.#view("chat").querySelector('textarea[name="chatText"]');
    try {
      if ( !(await sheet.sendChat(input?.value, this.actor)) ) return;
      this.state.chat.text = "";
      if ( input ) input.value = "";
    } catch(err) {
      ui.notifications.error(err.message);
    }
  });

  async #setMessageMode(mode) {
    const config = CONFIG.ChatMessage.modes?.[mode];
    if ( !config ) return;
    await game.settings.set("core", "messageMode", mode);
    const view = this.#view("chat");
    coreUI.markChoice(view, "chatMode", "mode", mode);
    const label = view.querySelector(".avttm-chat-mode-label");
    if ( label ) label.textContent = game.i18n.localize(config.label);
  }

  #updateBadge() {
    const badge = this.tabbar.querySelector(".avttm-badge");
    badge.hidden = !this.state.unread;
    badge.textContent = this.state.unread ? String(this.state.unread) : "";
  }

  async renderCharacter() {
    const view = this.#view("character");
    const actor = this.actor;
    if ( !actor ) {
      // "picking" is explicit: an empty list is falsy in Handlebars and would skip the "no character" message.
      view.innerHTML = await renderTemplate(tpl("character"), {
        picking: true,
        pick: this.ownedCharacters.map(a => ({ id: a.id, name: a.name, img: a.img }))
      });
      return;
    }
    const context = { ...sheet.sheetContext(actor, this.state.sheetTab, id => `AVTTM.Sheet.Tab.${id}`), state: this.state };
    await sheet.enrichSheet(context, actor);
    const tab = context.tab;
    const scroll = view.querySelector(".avttm-sheet-body")?.scrollTop ?? 0;
    const sameTab = this.#lastSheetTab === tab;
    const tabsScroll = view.querySelector(".avttm-subtabs")?.scrollLeft ?? 0;
    view.innerHTML = await renderTemplate(tpl("character"), context);
    keepTabsInView(view, tabsScroll);
    // Keep the list's scroll position across data updates (a new section starts at the top).
    const body = view.querySelector(".avttm-sheet-body");
    if ( body && sameTab ) body.scrollTop = scroll;
    this.#lastSheetTab = tab;
  }

  /* -------------------------------------------- */
  /*  Bottom sheets                               */
  /* -------------------------------------------- */

  /** The bottom sheet: the use dialog, the character switcher, the quick actions (launcher) or a prompt. */
  async renderOverlay() {
    const overlay = this.element.querySelector(".avttm-overlay");
    const kind = this.state.overlay;
    overlay.hidden = !kind;
    // Keep the scroll position of the same sheet (and step) across redraws, e.g. when a token changes.
    const scroller = overlay.querySelector("[data-scroll]");
    const scrolled = scroller ? { key: scroller.dataset.scroll, top: scroller.scrollTop } : null;
    try {
      await this.#drawOverlay(overlay, kind);
    } finally {
      const next = overlay.querySelector("[data-scroll]");
      if ( next && scrolled && (next.dataset.scroll === scrolled.key) ) next.scrollTop = scrolled.top;
    }
  }

  async #drawOverlay(overlay, kind) {
    if ( kind === "use" ) overlay.innerHTML = await renderTemplate(tpl("use"), this.#useContext());
    else if ( kind === "prompt" ) {
      const context = this.prompts.context(this.#advModes());
      if ( !context ) return this.#setOverlay(null);
      overlay.innerHTML = await renderTemplate(tpl("prompt"), context);
    }
    else if ( kind === "launcher" ) {
      const actor = this.actor;
      if ( !actor ) return this.#setOverlay(null);
      // A typed damage/heal amount survives data updates.
      const amount = overlay.querySelector('input[name="hpAmount"]')?.value ?? "";
      const tabsScroll = overlay.querySelector(".avttm-subtabs")?.scrollLeft ?? 0;
      overlay.innerHTML = await renderTemplate(tpl("launcher"), this.#launcherContext(actor));
      keepTabsInView(overlay, tabsScroll);
      const input = overlay.querySelector('input[name="hpAmount"]');
      if ( input ) input.value = amount;
    }
    else if ( kind === "picker" ) {
      const current = this.actor;
      overlay.innerHTML = await renderTemplate(tpl("picker"), {
        characters: this.ownedCharacters.map(a => ({ id: a.id, name: a.name, img: a.img, current: a === current }))
      });
    }
    else overlay.replaceChildren();
  }

  /** Open one bottom sheet (closing any other) or, with null, close it; the pill shows which one is open. */
  async #setOverlay(kind) {
    if ( kind !== "use" ) {
      // Targets shown on the map while picking, but not used: show the ones in use again.
      if ( this.state.use?.previewed ) targets.restoreTargets();
      // A targets-only pick (askCardTargets) closed without confirming.
      this.state.use?.resolve?.(false);
      this.state.use = null;
    }
    this.state.overlay = kind;
    await this.renderOverlay();
    return this.renderHeader();
  }

  /* -------------------------------------------- */
  /*  Roll result notice                          */
  /* -------------------------------------------- */

  #toastTimer = null;

  /**
   * Show a roll result for a few seconds; tapping it dismisses it (see roll-toasts.mjs). With `notice.action`
   * ({label, run}), a button under it (e.g. Roll damage) runs it and closes the toast.
   * Drawn by the core's fillNotice, with the classes avttm-toast-damage / -healing / -roll, avttm-toast-text,
   * avttm-toast-detail and avttm-toast-close; the button by the core's fillNoticeAction.
   * @param {ReturnType<import("../../awesome-vtt-core/scripts/dnd5e.mjs").rollNotice>} notice
   */
  showRollToast(notice) {
    const el = this.element.querySelector(".avttm-toast");
    coreUI.fillNotice(el, "avttm-toast", notice, game.i18n.localize("AVTTM.Toast.Dismiss"));
    coreUI.fillNoticeAction(this.element.querySelector(".avttm-toast-action"), notice.action);
    window.clearTimeout(this.#toastTimer);
    this.#toastTimer = window.setTimeout(() => this.#hideToast(), notice.action ? TOAST_ACTION_MS : TOAST_MS);
  }

  #hideToast() {
    window.clearTimeout(this.#toastTimer);
    for ( const el of this.element.querySelectorAll(".avttm-toast, .avttm-toast-action") ) el.hidden = true;
  }

  /* -------------------------------------------- */
  /*  Automation prompts                          */
  /* -------------------------------------------- */

  /**
   * Prompts (death save, concentration, saving throw, GM request, initiative), one at a time. They open over anything
   * else, since they are usually time-sensitive; several are shown one after another.
   */
  prompts = new PromptQueue(() => this.#onPromptsChanged());

  #onPromptsChanged() {
    if ( this.prompts.current ) return (this.state.overlay === "prompt") ? this.renderOverlay() : this.#setOverlay("prompt");
    if ( this.state.overlay === "prompt" ) return this.#setOverlay(null);
  }

  /**
   * SotDL without the map: the targets a chat card button acts on (damage, healing, effects) are picked on the
   * phone first, with the last ones already chosen. Resolves true when there is nothing to ask (dnd5e, the map is
   * shown, the GM turned the target list off, no tokens) or once picked (they become the phone's targets), false
   * when the dialog is closed.
   * @param {string} [title]
   * @returns {Promise<boolean>}
   */
  askCardTargets(title = "") {
    // getCandidates is empty when the GM turned the target list off.
    if ( !this.#cardTargetsHere || !targets.getCandidates().length ) return Promise.resolve(true);
    this.state.use?.resolve?.(false);
    return new Promise(resolve => {
      this.state.use = {
        resolve, simple: true, title: title || game.i18n.localize("AVTTM.Use.Steps.targets"),
        steps: ["targets"], step: "targets", selected: targets.selectedIds()
      };
      this.#setOverlay("use");
    });
  }

  /** Card buttons that act on targets are picked for on the phone (the adapter's CARD_TARGET_BUTTONS, no map). */
  get #cardTargetsHere() {
    return !!sys.CARD_TARGET_BUTTONS && !canvas?.ready;
  }

  /** A tap on a SotDL card button in the Chat view: ask for its targets, then let the system's listener run. */
  #onCardTargetClick(event) {
    const button = event.target.closest?.(sys.CARD_TARGET_BUTTONS);
    const li = button?.closest(".avttm-chat-log .chat-message");
    if ( !li ) return;
    if ( button.dataset.avttmTargeted ) {
      delete button.dataset.avttmTargeted;
      return;
    }
    if ( !this.#cardTargetsHere ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // The message may be drawn again while the dialog is open: find the button again by its place in the card.
    const { messageId } = li.dataset;
    const index = [...li.querySelectorAll(sys.CARD_TARGET_BUTTONS)].indexOf(button);
    this.askCardTargets(button.textContent.trim()).then(ok => {
      if ( !ok ) return;
      const again = button.isConnected ? button
        : this.#chatLog?.querySelector(`[data-message-id="${messageId}"]`)?.querySelectorAll(sys.CARD_TARGET_BUTTONS)[index];
      if ( !again ) return;
      again.dataset.avttmTargeted = "1";
      again.click();
    });
  }

  /** Tokens added, removed or hidden: refresh an open target step. */
  onTargetsChanged() {
    if ( (this.state.overlay === "use") && (this.state.use?.step === "targets") ) this.renderOverlay();
  }

  /* -------------------------------------------- */
  /*  Using items: activity → targets → options   */
  /* -------------------------------------------- */

  get #useItem() {
    return this.actor?.items.get(this.state.use?.itemId) ?? null;
  }

  get #useActivityDoc() {
    return this.#useItem?.system.activities?.get(this.state.use?.activityId) ?? null;
  }

  /** Tap on an item: open the use dialog when there is something to choose, otherwise use it straight away. */
  async #startUse(itemId) {
    const actor = this.actor;
    const item = actor?.items.get(itemId);
    if ( !item ) return;
    // Systems without dnd5e's activities (SotDL): targets and roll options for an attack, otherwise straight away.
    if ( !sys.FEATURES.useSteps ) return this.#startItemUse(item);
    const activities = use.usableActivities(item);
    if ( !activities.length ) return sys.useItem(actor, itemId);
    this.state.use = {
      itemId, startItemId: itemId, activityId: null, step: null, steps: [], selected: [], mode: this.state.advMode, bonus: "", base: {}
    };
    if ( activities.length > 1 ) {
      this.state.use.step = "activity";
      return this.#setOverlay("use");
    }
    return this.#chooseActivity(activities[0].id);
  }

  /**
   * SotDL: an attack (weapon, attack spell) asks for its targets (unless the GM turned the list off) and roll
   * options (boons or banes, a modifier), like a dnd5e attack; anything else is used at once with the Next roll.
   */
  #startItemUse(item) {
    if ( !sys.itemNeedsTargets(item) ) return this.#d20(mode => sys.useItem(this.actor, item.id, mode));
    const steps = targets.targetsEnabled() ? ["targets", "options"] : ["options"];
    this.state.use = {
      itemId: item.id, startItemId: item.id, simple: true, activityId: null, steps, step: steps[0], selected: [],
      mode: this.state.advMode, bonus: "", base: {}
    };
    return this.#setOverlay("use");
  }

  async #chooseActivity(activityId) {
    const u = this.state.use;
    if ( !u ) return;
    u.activityId = activityId;
    let activity = this.#useActivityDoc;
    if ( !activity ) return this.#closeUse();

    // A "cast" or "forward" activity runs another activity (a spell, or a sibling): ask about that one instead.
    if ( ["cast", "forward"].includes(activity.type) ) {
      const resolved = await use.resolveActivity(activity);
      if ( !resolved ) return this.#closeUse();
      u.base = foundry.utils.mergeObject(u.base, resolved.base);
      u.itemId = resolved.item.id;
      if ( !resolved.activity ) {
        // A spell with several activities: choose one, as dnd5e would.
        Object.assign(u, { step: "activity", activityId: null, steps: [] });
        return this.#setOverlay("use");
      }
      u.activityId = resolved.activity.id;
      activity = resolved.activity;
    }

    const steps = [];
    // Casting first (what dnd5e's usage dialog would ask), then targets, then roll options.
    const usage = await use.usageOptions(activity, u.base);
    u.usage = { ...usage, consumeResources: true, concentrate: true };
    if ( usage.needed && usage.supported ) steps.push("usage");
    if ( targets.targetsEnabled() && use.needsTargets(activity) ) steps.push("targets");
    const options = use.rollOptions(activity);
    if ( options ) steps.push("options");
    const pick = list => list?.find(o => o.selected)?.value ?? list?.[0]?.value;
    Object.assign(u, {
      steps,
      attackMode: pick(options?.attackModes),
      ammunition: pick(options?.ammunition),
      mastery: pick(options?.mastery)
    });
    if ( !steps.length ) return this.#performUse(activity);
    u.step = steps[0];
    return this.#setOverlay("use");
  }

  #useContext() {
    const u = this.state.use;
    const item = this.#useItem;
    const activity = this.#useActivityDoc;
    const activities = u.simple ? [] : use.usableActivities(item);
    const index = u.steps.indexOf(u.step);
    const context = {
      simple: !!u.simple,
      title: u.title ?? (activity && (activities.length > 1) ? `${item.name} · ${activity.name}` : (item?.name ?? "")),
      img: item?.img,
      confirm: game.i18n.localize(u.resolve ? "AVTTM.Use.ConfirmTargets" : "AVTTM.Use.Confirm"),
      step: u.step,
      canBack: (index > 0) || ((u.step !== "activity") && (activities.length > 1)),
      stepLabel: ((u.step !== "activity") && (u.steps.length > 1))
        ? game.i18n.format("AVTTM.Use.Step", { n: index + 1, total: u.steps.length, name: game.i18n.localize(`AVTTM.Use.Steps.${u.step}`) })
        : "",
      last: index === (u.steps.length - 1)
    };
    if ( u.step === "activity" ) {
      context.activities = activities.map(a => ({ id: a.id, name: a.name, img: a.img }));
    }
    else if ( u.step === "targets" ) {
      const count = activity ? use.targetCount(activity) : null;
      const allies = activity ? use.prefersAllies(activity) : false;
      // On a scene with token vision, only what the character can see (asked of the table screen).
      const vision = targets.checkVision(this.actor);
      const list = targets.getCandidates(this.actor).map(t => ({ ...t, selected: u.selected.includes(t.id) }));
      context.checking = vision === "checking";
      // A creature picked earlier that the character can no longer see isn't targeted.
      if ( !context.checking ) u.selected = u.selected.filter(id => list.some(t => t.id === id));
      context.targetNote = game.i18n.format(`AVTTM.Targets.Vision.${vision}`, { name: this.actor?.name ?? "" });
      if ( allies ) list.sort((a, b) => (b.disposition - a.disposition) || a.name.localeCompare(b.name));
      context.targets = list;
      context.hint = activity?.target?.template?.type ? game.i18n.localize("AVTTM.Use.AreaHint")
        : count ? game.i18n.format(count === 1 ? "AVTTM.Use.OneTarget" : "AVTTM.Use.TargetCount", { count }) : "";
      const previous = targets.selectedIds().filter(id => list.some(t => t.id === id));
      const sameAsNow = (previous.length === u.selected.length) && previous.every(id => u.selected.includes(id));
      if ( previous.length && !sameAsNow ) {
        context.previous = previous.map(id => list.find(t => t.id === id)?.name).join(", ");
      }
    }
    else if ( u.step === "usage" ) {
      const c = u.usage;
      context.usage = {
        slots: (c.slots ?? []).map(o => ({ ...o, selected: o.value === c.slot, disabled: o.empty && c.consumeSlot })),
        showConsumeSlot: c.showConsumeSlot,
        consumeSlot: c.consumeSlot,
        concentration: c.concentration && {
          concentrate: c.concentrate,
          endOptions: c.concentration.endOptions.map(o => ({ ...o, selected: o.id === c.concentration.end }))
        },
        hasResources: c.hasResources,
        consumeResources: c.consumeResources,
        linkedResources: c.linkedResources && { name: c.linkedResources.name, use: c.useLinked !== false },
        scaling: c.scaling,
        choices: [
          ["enchantment", "AVTTM.Use.Enchantment"], ["summonProfile", "AVTTM.Use.Summon"],
          ["summonSize", "AVTTM.Use.SummonSize"], ["summonType", "AVTTM.Use.SummonType"],
          ["transformProfile", "AVTTM.Use.Transform"]
        ].filter(([key]) => c[key]).map(([key, label]) => ({
          key, label: game.i18n.localize(label),
          options: c[key].options.map(o => ({ ...o, selected: o.value === c[key].value }))
        })),
        templateSkipped: c.templateSkipped,
        summonsSkipped: c.summonsSkipped
      };
    }
    else if ( u.step === "options" ) {
      const options = (activity ? use.rollOptions(activity) : null) ?? { kind: u.simple ? "attack" : "damage" };
      const mark = (list, value) => (list ?? []).map(o => ({ ...o, selected: o.value === value }));
      context.options = {
        kind: options.kind,
        attackModes: mark(options.attackModes, u.attackMode),
        ammunition: mark(options.ammunition, u.ammunition),
        mastery: mark(options.mastery, u.mastery)
      };
      context.modes = this.#advModes(u.mode);
      context.scale = advModeScale();
      context.bonus = u.bonus;
    }
    return context;
  }

  /** Tap on a target: update the list in place, so it doesn't jump back to the top. */
  #toggleUseTarget(tokenId) {
    const u = this.state.use;
    if ( !u ) return;
    const activity = this.#useActivityDoc;
    const count = activity ? use.targetCount(activity) : null;
    const picked = !u.selected.includes(tokenId);
    if ( !picked ) u.selected = u.selected.filter(id => id !== tokenId);
    else u.selected = (count === 1) ? [tokenId] : [...u.selected, tokenId];
    // Show the picked creatures on the table's (and the GM's) map as they are tapped, with a ping on a new one.
    targets.previewTargets(u.selected, picked ? tokenId : null);
    u.previewed = true;
    const overlay = this.element.querySelector(".avttm-overlay");
    for ( const button of overlay.querySelectorAll('[data-action="useTarget"]') ) {
      const selected = u.selected.includes(button.dataset.tokenId);
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
      const icon = button.querySelector("i");
      icon?.classList.toggle("fa-circle-dot", selected);
      icon?.classList.toggle("fa-circle", !selected);
    }
  }

  /** "Same as last time": take the previous targets and go on. */
  #usePrevious() {
    const u = this.state.use;
    if ( !u ) return;
    const candidates = new Set(targets.getCandidates(this.actor).map(t => t.id));
    u.selected = targets.selectedIds().filter(id => candidates.has(id));
    return this.#useNext();
  }

  #useNext() {
    const u = this.state.use;
    const activity = this.#useActivityDoc;
    if ( !u || (!activity && !u.simple) ) return this.#closeUse();
    if ( (u.step === "options") && u.bonus.trim() ) {
      // SotDL takes a whole-number modifier; dnd5e a roll formula.
      const ok = u.simple ? MODIFIER.test(u.bonus.trim()) : !!use.cleanBonus(u.bonus);
      if ( !ok ) {
        ui.notifications.warn(u.simple ? "AVTTM.Use.BadModifier" : "AVTTM.Use.BadBonus", { localize: true });
        return;
      }
    }
    const index = u.steps.indexOf(u.step);
    if ( index >= u.steps.length - 1 ) {
      if ( u.resolve ) return this.#performPick();
      return u.simple ? this.#performItemUse() : this.#performUse(activity);
    }
    u.step = u.steps[index + 1];
    return this.renderOverlay();
  }

  #useBack() {
    const u = this.state.use;
    if ( !u ) return;
    const index = u.steps.indexOf(u.step);
    if ( index > 0 ) u.step = u.steps[index - 1];
    else if ( use.usableActivities(this.#useItem).length > 1 ) Object.assign(u, { step: "activity", activityId: null, steps: [] });
    else if ( u.startItemId && (u.itemId !== u.startItemId) ) {
      // Back from a cast spell to the item that casts it.
      Object.assign(u, { itemId: u.startItemId, base: {}, step: "activity", activityId: null, steps: [] });
    }
    return this.renderOverlay();
  }

  /** Closing the use dialog (like any other bottom sheet) also forgets its choices; see #setOverlay. */
  #closeUse() {
    return this.#setOverlay(null);
  }

  /** Apply the choices (targets now; roll options when dnd5e rolls) and use the activity. */
  async #performUse(activity) {
    const u = this.state.use;
    const usageChoices = u.usage;
    if ( u.steps.includes("targets") ) targets.setTargets(u.selected);
    u.previewed = false;
    const options = use.rollOptions(activity);
    if ( options ) {
      const bonus = use.cleanBonus(u.bonus);
      if ( options.kind === "attack" ) {
        use.setPendingRoll(activity, { attack: { mode: u.mode, bonus, attackMode: u.attackMode, ammunition: u.ammunition, mastery: u.mastery } });
        // The "Next roll" choice was used by this attack.
        if ( this.state.advMode !== "normal" ) this.#setAdvMode("normal");
      }
      else use.setPendingRoll(activity, { damage: { bonus } });
    }
    await this.#closeUse();
    return use.useActivity(activity, usageChoices);
  }

  /** A targets-only pick (askCardTargets): keep the picked targets and go on with the card button. */
  async #performPick() {
    const u = this.state.use;
    const resolve = u.resolve;
    u.resolve = null;
    targets.setTargets(u.selected);
    u.previewed = false;
    await this.#closeUse();
    resolve(true);
  }

  /** SotDL: use the item with the picked targets (token documents), boons or banes and modifier. */
  async #performItemUse() {
    const u = this.state.use;
    const actor = this.actor;
    const asked = u.steps.includes("targets");
    if ( asked ) targets.setTargets(u.selected);
    u.previewed = false;
    const options = { targets: asked ? targets.selectedTokens() : [], modifier: parseInt(u.bonus) || 0 };
    const { itemId, mode } = u;
    // The "Next roll" choice was used by this attack.
    if ( this.state.advMode !== "normal" ) this.#setAdvMode("normal");
    await this.#closeUse();
    return sys.useItem(actor, itemId, mode, options);
  }

  /* -------------------------------------------- */
  /*  Dice                                        */
  /* -------------------------------------------- */

  async renderDice() {
    this.#view("dice").innerHTML = await renderTemplate(tpl("dice"), { ...this.dice.context(), advModes: this.#advModes(), advScale: advModeScale() });
  }

  /** The Normal / Advantage / Disadvantage choice (Dice view, prompts, attack options). */
  #advModes(active = this.state.advMode) {
    return advModeChoices(ADV_MODES, active);
  }

  /** Arm (or clear) advantage / disadvantage for the next d20 roll; shown as a chip on the pill. */
  #setAdvMode(mode) {
    if ( !advModes().includes(mode) ) return;
    this.state.advMode = mode;
    this.renderHeader();
    if ( this.state.view === "dice" ) this.renderDice();
  }

  /* -------------------------------------------- */
  /*  Journal                                     */
  /* -------------------------------------------- */

  async renderJournal() {
    this.#view("journal").innerHTML = await renderTemplate(tpl("journal"), await this.journal.context());
  }

  /** The GM shared something: refresh the journal list, and badge the Journal tab. */
  onShared() {
    if ( (this.state.view === "journal") && this.journal.showsList ) this.renderJournal();
    else this.tabbar.querySelector('[data-view="journal"]')?.classList.add("avttm-attention");
  }

  /* -------------------------------------------- */
  /*  Compendium                                  */
  /* -------------------------------------------- */

  async renderCompendium() {
    this.#view("compendium").innerHTML = await renderTemplate(tpl("compendium"), {
      ...(await this.compendium.context()),
      hasBrowser: !!globalThis.dnd5e?.applications?.CompendiumBrowser
    });
  }

  /* -------------------------------------------- */
  /*  Events                                      */
  /* -------------------------------------------- */

  async #onClick(event) {
    const target = event.target.closest("[data-action]");
    if ( !target || !(this.element.contains(target) || this.tabbar.contains(target)) ) return;
    if ( coreUI.handleMessageClick(event, target, ".avttm-chat-log .chat-message") ) return;
    // The overlay itself closes the targets panel, but only for taps outside the panel.
    if ( (target.dataset.action === "overlay") && (event.target !== target) ) return;
    event.preventDefault();
    return coreUI.runAction(target, BUSY_ACTIONS, () => this.#dispatch(target.dataset.action, target), `${MODULE_ID} | Action`);
  }

  /** Run one action of the app (buttons with data-action). */
  async #dispatch(action, target) {
    if ( action === "journalShared" ) this.tabbar.querySelector('[data-view="journal"]')?.classList.remove("avttm-attention");
    if ( CompendiumPanel.ACTIONS.has(action) ) return this.compendium.handle(action, target);
    if ( JournalPanel.ACTIONS.has(action) ) return this.journal.handle(action, target);
    if ( DicePanel.ACTIONS.has(action) ) return this.dice.handle(action, target.dataset);
    // SotDL: an attribute asks for boons or banes first (per-browser setting), in a prompt preset to the Next roll;
    // an attribute the prompt can't name rolls straight away below.
    if ( (action === "rollAbility") && sys.FEATURES.abilityRollPrompt && getSetting("askBoons") ) {
      const prompt = abilityRollPrompt(this.actor, target.dataset.ability);
      if ( prompt ) return this.prompts.add(prompt);
    }
    if ( sheet.D20_ACTIONS.has(action) ) return this.#d20(mode => sheet.runSheetAction(this.actor, action, target.dataset, mode));
    if ( sheet.SHEET_ACTIONS.has(action) ) {
      return sheet.runSheetAction(this.actor, action, target.dataset, "normal", { toggled: this.state.toggledEffects });
    }
    const actor = this.actor;
    const s = this.state;
    switch ( action ) {
      case "view":
        this.#closeFullScreenWindows();
        return this.setView(target.dataset.view);
      case "dismissTurn": return this.showTurn(null);
      case "dismissToast": return this.#hideToast();
      case "toastAction": {
        const run = coreUI.takeNoticeAction(target);
        this.#hideToast();
        return run?.();
      }

      // Character selection
      case "pickActor":
        // Close the switcher (hides the overlay element), then show the chosen character.
        await this.#setOverlay(null);
        await setSetting("actorId", target.dataset.actorId);
        return this.render();
      case "openPicker": return this.#setOverlay("picker");

      // Sheet
      case "sheetTab": s.sheetTab = sheet.sheetTab(target.dataset.tab); return this.renderCharacter();
      case "quickTab": s.quickTab = sheet.quickTab(target.dataset.tab); return this.renderOverlay();
      case "advMode":
        this.#setAdvMode(target.dataset.mode);
        if ( s.overlay === "prompt" ) return this.renderOverlay();
        return;
      case "promptChoice": return this.prompts.choose(target.dataset.index, roll => this.#d20(roll));
      case "hpMode": return this.#setHpMode(target.dataset.mode);
      case "applyHp": return this.#applyHp();
      case "useItem": return this.#startUse(target.dataset.itemId);
      case "useActivity": return this.#chooseActivity(target.dataset.activityId);
      case "useTarget": return this.#toggleUseTarget(target.dataset.tokenId);
      case "usePrevious": return this.#usePrevious();
      case "useMode": if ( s.use ) s.use.mode = target.dataset.mode; return this.renderOverlay();
      case "useNext": return this.#useNext();
      case "useBack": return this.#useBack();
      case "toggleFavorites":
        await setSetting("favoritesOpen", !getSetting("favoritesOpen"));
        return this.renderHeader();
      case "toggleLauncher": return this.#setOverlay(s.overlay === "launcher" ? null : "launcher");

      // Inventory
      case "invDetails": return this.#toggleDetails(target.dataset.itemId);

      // Combat
      case "endTurn": return this.combat?.nextTurn();
      case "turnSpeed": return sys.setTurnSpeed(actor, target.dataset.fast === "true");

      // Bottom sheets
      case "overlay":
      case "closeOverlay":
        // "Not now" on a prompt moves on to the next waiting prompt.
        if ( s.overlay === "prompt" ) return this.prompts.dismiss();
        return this.#setOverlay(null);

      // Compendium: dnd5e's own browser, when available (the rest is handled by this.compendium).
      case "compBrowser": return new globalThis.dnd5e.applications.CompendiumBrowser().render({ force: true });


      // Chat
      case "chatSend": return this.#sendChat();
      case "chatMode": return this.#setMessageMode(target.dataset.mode);
      case "chatMore": s.chat.limit += CHAT_PAGE; return this.renderChat();
      case "chatFilter":
        if ( sheet.CHAT_FILTERS.includes(target.dataset.filter) ) Object.assign(s.chat, { filter: target.dataset.filter, limit: CHAT_PAGE });
        return this.renderChat();

      // Settings
      case "testTurnAlert": return testTurnAlert();
      case "homeScreen": return this.#homeScreen();
      case "openFoundrySettings":
        return new foundry.applications.settings.SettingsConfig({ initialCategory: MODULE_ID }).render({ force: true });
      case "logOut": return game.logOut();
    }
  }

  #onChange(event) {
    const { name, value } = event.target;
    const u = this.state.use;
    if ( u && (name === "useAttackMode") ) u.attackMode = value;
    if ( u && (name === "useAmmunition") ) u.ammunition = value;
    if ( u && (name === "useMastery") ) u.mastery = value;
    // Casting step
    if ( u?.usage && name?.startsWith("useCast.") ) {
      const c = u.usage;
      const checked = event.target.checked;
      switch ( name ) {
        case "useCast.slot": c.slot = value; break;
        case "useCast.consumeSlot": c.consumeSlot = checked; this.renderOverlay(); break;
        case "useCast.concentrate": c.concentrate = checked; this.renderOverlay(); break;
        case "useCast.end": if ( c.concentration ) c.concentration.end = value || null; break;
        case "useCast.consumeResources": c.consumeResources = checked; break;
        case "useCast.useLinked": c.useLinked = checked; break;
        case "useCast.scaling":
          if ( c.scaling ) c.scaling.value = Math.clamp(Math.floor(Number(value) || 1), 1, c.scaling.max ?? 99);
          break;
        default: {
          // Profile choices: useCast.choice.<key>
          const key = name.slice("useCast.choice.".length);
          if ( name.startsWith("useCast.choice.") && c[key] ) c[key].value = value;
        }
      }
    }
    if ( name === "hpAmount" ) event.target.value = sys.hpAmount(value) || "";
    sheet.onSheetChange(this.actor, name, value);
  }

  #onInput(event) {
    const { name, value } = event.target;
    if ( name === "compQuery" ) this.compendium.onInput(value);
    if ( name === "chatText" ) this.state.chat.text = value.slice(0, sheet.MAX_CHAT_TEXT);
    if ( (name === "useBonus") && this.state.use ) this.state.use.bonus = value.slice(0, use.MAX_BONUS);
    if ( name === "journalQuery" ) this.journal.onInput(value);
  }

  #onKeyDown(event) {
    if ( event.key !== "Enter" ) return;
    // Enter sends; Shift+Enter starts a new line.
    if ( (event.target.name === "chatText") && !event.shiftKey ) {
      event.preventDefault();
      this.#sendChat();
      return;
    }
    if ( event.target.name === "compQuery" ) {
      event.preventDefault();
      this.compendium.search();
    }
    if ( event.target.name === "hpAmount" ) {
      event.preventDefault();
      this.#applyHp();
    }
  }

  /** Run a d20 roll with the armed advantage choice, then reset it so it doesn't carry over to the next roll. */
  async #d20(roll) {
    await roll(this.state.advMode);
    if ( this.state.advMode !== "normal" ) this.#setAdvMode("normal");
  }

  /** Switch between damage, heal and temp HP without re-rendering, so a typed amount is kept. */
  #setHpMode(mode) {
    if ( !sys.HP_MODES.includes(mode) ) return;
    this.state.hpMode = mode;
    coreUI.markChoice(this.element, "hpMode", "mode", mode);
  }

  /** Enter and the Apply button share one guard, so an amount isn't applied twice. */
  #applyHp = coreUI.exclusive(async () => {
    const input = this.element.querySelector('input[name="hpAmount"]');
    const amount = sys.hpAmount(input?.value);
    if ( !amount || !this.actor ) return;
    await sys.applyHpChange(this.actor, this.state.hpMode, amount);
    if ( input ) input.value = "";
  });

  async #toggleDetails(itemId) {
    await sheet.toggleItemDetails(this.state.inv.details, this.actor, itemId,
      game.i18n.localize("AVTTM.Inventory.NoDescription"), "avttm-muted");
    // Action rows show in the Character tab and in the quick actions sheet.
    return Promise.all([this.renderCharacter(), (this.state.overlay === "launcher") ? this.renderOverlay() : null]);
  }

  async #homeScreen() {
    if ( canPromptInstall() ) {
      await promptInstall();
      return renderSettingsView(this.#view("settings"), this.actor);
    }
    const help = homeScreenHelp();
    if ( help ) return foundry.applications.api.DialogV2.prompt({
      window: { title: "AVTTM.SettingsView.HomeScreen" },
      content: `<p>${escapeHTML(help)}</p>`,
      ok: { label: "AVTTM.Close" }
    });
  }
}
