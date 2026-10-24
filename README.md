# Awesome VTT – Phone Companion

A Foundry VTT module for players sitting at the table: each player logs in on their own phone and gets their character, chat, journals and compendium in a phone layout. The map is not shown.

- **Targets:** Foundry VTT v14 and dnd5e 6.0.x (built against 6.0.5, verified with 6.0.6).
- **Works without the table module.** It needs only the shared library [`awesome-vtt-core`](../awesome-vtt-core), and adds physical dice entry when [Awesome VTT](../awesome-vtt) is also active.
- **Input:** touch-first, with buttons at least 44 px tall.

## Shadow of the Demon Lord

The phone also runs in **Shadow of the Demon Lord** worlds (system `demonlord` 6.1.x), as the table does: health left, Defense / Perception / Speed / Healing rate and Fortune on the pill; boons or banes (−3 … +3, headed **Boons and banes**, with **Banes** and **Boons** named under the two ends) as the Next roll in the Dice tab; the sheet without Skills, with a read-only **Bio** tab (ancestry, paths, professions, languages, religion, appearance, and the description with the background tables and the interesting thing) (attributes rolled as challenges; tapping one first asks for boons or banes, preset to the Next roll, unless **Ask for boons and banes** is turned off in Settings; spells by tradition and rank with castings left, coins gc / ss / cp / bits); tapping an action rolls straight away with the Next roll (spending castings, talent uses, ammunition or a consumable); quick actions with Fortune, action statuses, damage / healing, insanity and corruption, and rests; **Fast** / **Slow** turn buttons in the combat strip; roll results.

Also:
- **Targets:** tapping a weapon or an attack spell opens the use dialog: pick the targets (shown on the table's map as you tap), then boons / banes and a whole-number modifier. One attack per weapon or spell target; talents and gear that attack also ask, and use the first target. On a chat card, **Roll damage**, **Apply damage**, healing and effect buttons (and the notice's Roll damage button) first ask who they are for, with your last targets already chosen.
- **Damage after attacks** (setting "Roll damage with attacks"), **prompts** (GM challenge requests; Fast / Slow at the start of an encounter), **favorites** (stars; tap the portrait for the row) and the **Party** tab (Shared Inventory module, a Party actor the GM creates or chooses).

## Setup

1. Copy or symlink this folder and [`awesome-vtt-core`](../awesome-vtt-core) (the shared library it requires) to `<Foundry user data>/Data/modules/`, then enable **Awesome VTT – Phone Companion** in your world. Foundry asks to enable the core library with it.
2. Give each player their own Foundry user, with their character assigned (User Configuration → Player Character). Don't use the shared table account on phones. A player's own login keeps whispers and GM-only rolls private.
3. The player opens Foundry on their phone and logs in. On a phone-sized touch screen, the module asks once whether to use phone mode. Answering yes turns the map off on that phone and reloads the page.
   - **Detection:** a phone or small tablet is recognised by a small screen plus either a mobile browser or a touch-only pointer. The browser console (`awesome-vtt-mobile | Phone check`) shows what was detected.
   - **If it isn't offered:** open Game Settings → Configure Settings → Awesome VTT – Phone Companion, and set **Phone mode** to **On**. The page reloads into phone mode.

## What the phone shows

- **Character pill** (at the bottom, above the tabs): portrait, name, level and class, HP bar, AC, initiative and speed; a gold star while the character has Inspiration.
  - **Quick actions** (bolt button): opens a bottom sheet from any tab, like the character switcher. Only one sheet is open at a time, and tapping the dimmed background or ✕ closes it. It has three tabs, at its bottom:
    - **Quick actions:** only the character's **actions** (the same rows as the Character tab's Actions);
    - **Damage & effects:** **death saves** with their tally and a Roll button (only while the character is at 0 HP), **Inspiration**, Prone, Dodging, Hiding and Invisible toggles (the full list stays in Status), **Damage / Heal / Temp** with an amount and Apply (temporary HP only replace the current amount if higher, as the rules say), **concentration** with End, **exhaustion** with − / +, and **effects** to switch on and off, such as Rage or Bladesong (effects on the character or their items that are off, timed, or were toggled this session);
    - **Rest:** **Short rest** and **Long rest**.
  - **Favorites:** tapping the portrait (it has a small ☆ badge) shows or hides a row of the character's dnd5e favorites below the pill (remembered on this device); tap one to use it. Rows in Actions, Spells and Inventory have a ☆ star to add or remove a favorite, the same favorites as dnd5e's own sheet and the table.
  - **Chevron:** opens a character switcher when the player owns more than one character.
  - **ADV / DIS chip:** shows while advantage or disadvantage is armed for the next roll; tap it to open the Dice tab.
- **Turn banner and combat strip** (at the top): during combat, the turn order, **Roll initiative** and **End turn**. Roll initiative rolls without dnd5e's dialog, with the Next roll choice (Normal / Advantage / Disadvantage) on top of the character's own modifiers, for that character's tokens still without initiative, the same as at the table; other creatures you own get their own prompt.
- **Dice:** the **Next roll** choice (Normal / Advantage / Disadvantage) for the next d20 roll, which then goes back to Normal. Also a quick dice roller: tap dice to build a pool, set a modifier, and roll as the shown character. With physical dice on, choose **Real dice** or **Foundry rolls**.
- **Character:**
  - **Sections:** Actions, Skills, Spells, Abilities, Inventory and Status (conditions), with their tabs at the bottom of the screen, above the pill. (The basics are on the pill, quick actions in its launcher, and the advantage choice in the Dice tab.)
  - **Using an action, spell or item** opens a short dialog only when there's something to choose (see *Using actions and spells* below).
  - **Actions:** favorites, weapons, spells that can be cast now with slots, features, consumables. Slots left and item uses left have − / + buttons, to undo an accidental use. The ⓘ button on each row shows what the action does (the item's description) under it.
  - **Spells:** every spell by level with slots: cast it (when it can be cast now), prepare or unprepare it (book button; always-prepared spells show a pin), C / R marks for concentration and ritual, and its description.
  - **Inventory:** currency, weight, attunement, and items with quantity, equip, attune, use and (with the Shared Inventory module) **Give to the party**.
  - **Abilities, Skills and Status:** Status lists the conditions; rests and death saves are in Quick actions.
  - If the user owns several characters, the pill's chevron picks which one to show. The list updates as soon as a character is assigned or given to the user. Foundry's own User Configuration, which opens on every load for players without an assigned character, is closed in phone mode, because this picker replaces it.
- **Chat:** drawn by the phone app itself (Foundry's sidebar isn't used). Each message is drawn by Foundry and dnd5e, so card buttons (attack, damage, saves) work, and tapping a roll shows its dice. Buttons choose who sees your messages and rolls (public, GM only, blind, self, in character). Messages are sent through Foundry's chat, so commands such as `/r 1d20` and `/w Name` work, as the character shown on the phone. "Show earlier messages" loads older ones. **All / Mine** at the top shows every message, or only those of the character shown (as on the table). A badge counts new messages while another tab is open. Right-click menus on messages and popping the chat out aren't available.
- **Journal:** the journals the player can view, with pages inline. **Recently shared** lists what the GM showed to players.
- **Compendium:** with an empty search box, a browser of the compendiums the player can see (grouped by origin; open one to go through its folders and entries). Typing searches them all live, from 2 characters on, and a Clear button returns to browsing. Tap an entry for an inline preview. On an opened weapon, armour or other gear item, **Add to inventory** adds it to the character (dnd5e and SotDL; the same item stacks; the GM can turn this off with the core library's world setting **Players may add items from compendiums**). **Browse compendiums** opens dnd5e's Compendium Browser with its filters.
- **Party** (only with the [Shared Inventory](../awesome-vtt-shared-inventory) module): the party's shared coins and items.
- **Settings:** this module's options for the device (and the GM options for the GM). Also: test the turn alert, add to home screen, Foundry settings, and log out.

Every Foundry window, such as roll dialogs, activity and spell-slot choices, rest dialogs and journals, fills the screen above the tab bar. Small dialogs slide up from the bottom. Buttons that submit something (use, roll, apply, rest, send…) are disabled and pulse until the action has finished, so a slow connection doesn't invite repeated taps. Views whose content is shorter than the screen sit at the bottom, next to the pill and tabs. The tab bar always stays on top; on narrow screens it scrolls sideways, keeping the chosen tab in sight. Tapping a tab closes full-screen windows such as a journal or the Compendium Browser, and shows that view. Roll dialogs and the dice entry window stay open, so a roll in progress isn't lost.

## Options

All options appear in the phone's Settings tab and in Foundry's settings window.

| Option | Scope | Default |
|---|---|---|
| Phone mode (Ask on phones / On / Off) | device | Ask on phones |
| Turn off the map (Foundry's No-Canvas mode while in phone mode) | device | on |
| Keep the screen on | device | on |
| Your-turn alert, Alert when you're next, Vibrate | device | on |
| Sound (None, Notification, Drum hit, Voice, Custom file), Custom sound file, Volume | device | Notification, 0.8 |
| Physical dice on this phone | device | off |
| Roll damage with attacks | device | on |
| Table seat of the shown character (needs Awesome VTT; a taken seat is swapped; a GM must be logged in) | world, via the GM | — |
| Phone target list (All / Combatants and player characters / Off) | world, GM | All |
| Home screen shortcut | world, GM | on |

## Using actions and spells

Tapping something to use (a weapon, spell, feature or consumable) asks only what that use needs, in up to four steps. Steps that don't apply are skipped, so a simple feature is still used with one tap.

1. **Choose the action:** only when the item has more than one (for example, a weapon's attack and a special ability).
2. **Casting:** only when dnd5e would otherwise open its usage window. It asks the same questions:
   - **Cast at level** with the slots left, and **Use a spell slot**. For a spell cast from an item (a wand or scroll, say), it offers the levels that item allows.
   - **Use at**, for features that can be used for more effect.
   - **Concentrate on it**, and which effect to stop if the character is already at their concentration limit.
   - **Use resources and item uses**, and **Use (item)'s charges or uses** for a spell cast from an item.
   - **Enchantment**, **Creature** (with **Size** and **Creature type**) and **Form**, for enchant, summon and transform actions with several choices.

   Items that cast a spell, or pass their use on to another action, are resolved first. If the spell has several actions, the dialog asks which one. Placing an area or summoned creatures needs the map, so both are turned off while the map is off, with a note: the GM or the table screen places them (for summons, with Summon on the chat card). Only bastion facility orders still open dnd5e's own window.
3. **Targets:** only when the action needs them. That covers attacks, saving throws, and effects on creatures other than yourself, such as healing an ally or Sacred Flame.
   - **Previous targets:** **Same as last time** reselects them in one tap.
   - **Single target:** when the action takes one target, tapping another creature replaces the choice.
   - **Areas** (e.g. Fireball): pick the creatures inside, since the map can't be used to place the area on the phone.
4. **Roll options:** only when the action rolls straight away.
   - **Attacks:** Normal / Advantage / Disadvantage (defaulting to the Dice tab's **Next roll** choice), a situational bonus, and the attack mode, ammunition and weapon mastery when the item offers a choice.
   - **Direct damage or healing:** a situational bonus.
   - The choices are passed into dnd5e's own roll, and its roll dialog is skipped. Advantage or disadvantage the character already has from features or effects is kept.

**Damage after an attack** is rolled straight after the attack roll, hit or miss (critical damage on a critical hit), without dnd5e's damage dialog. Turn off **Roll damage with attacks** to roll it from the result's **Roll damage** button (shown when the attack didn't miss) or the chat card instead.

### How targets work without the map

- **Attack cards:** dnd5e receives the chosen targets when it builds the roll. Attack cards then list them, a single target's AC decides hit or miss, and damage cards can be applied to them.
- **Shared screens:** while you pick targets, each tap shows them on the table screen's and the GM's maps (target markers in your colour) and pings the creature you just picked, so everyone sees who you mean. Closing the dialog without using the action shows your previous targets again.
- **Names:** a token's name is shown only if its nameplate would be visible to that player; otherwise it reads "Unknown creature".
- **Line of sight:** on a scene with token vision, the target list shows only the creatures your character can see. Without the map the phone can't work that out, so it asks the table screen (Awesome VTT), which draws every seated character's vision. If the table screen isn't open, every creature is listed and the dialog says so. The GM can also limit the list with **Phone target list** (all visible tokens, or combatants and player characters) or turn target picking off.

## Automation

- **Show roll results** (on by default): after you roll (checks, saves, attacks, initiative, damage, healing, the dice pool), with Foundry or real dice, the result shows at the bottom, just above the character pill, for a few seconds: damage and healing totals split by type when there are several, other rolls with what was rolled, "Critical" or "Fumble" on a natural 20 or 1, **Pass** or **Fail** when a check or save has a DC (dnd5e always shows that to the player who rolled), and **Hit** or **Miss** against targets with a known AC when dnd5e's *attack roll visibility* isn't "None" (its default). The DC and AC themselves are never shown. With Dice So Nice, the result appears when the dice stop. Blind rolls are not shown. Tap it (or its ✕) to dismiss. An attack, a spell or another action that didn't miss (it hit, or there was no target to tell) gets a **Roll damage** button under the result, unless its damage is already rolled with the attack (**Roll damage with attacks**); tap it to roll the damage, whose total then shows the same way. A result with this button stays up for 30 seconds. In Shadow of the Demon Lord, a spell cast without an attack roll shows its name, so its damage can be rolled the same way.

Optional prompts, each turned on separately in **Settings → Automation** (per device, all off by default). A prompt opens as a bottom sheet over whatever is on screen. Several are shown one after another ("2 more waiting"), and **Not now** (✕) skips one. The rolls are dnd5e's own, made the same way as its chat buttons, so results, DCs and card outcomes work as usual. Prompts with a d20 roll offer Normal / Advantage / Disadvantage.

| Option | When the prompt appears | What the button does |
|---|---|---|
| Prompt for death saves | At the start of your turn in combat, if your character is at 0 HP and neither stable nor dead | Rolls the death saving throw (the sheet shows the success / failure tally) |
| Prompt for concentration checks | Your concentrating character takes damage (dnd5e posts its concentration check) | Rolls the concentration save with dnd5e's DC |
| Prompt for saving throws | A spell or ability that calls for a save targets your character | Rolls that save (one button per ability if it offers several), linked to its card |
| Prompt for GM requests | The GM asks the party to rest, or to make a group check or save | Takes part, as the request card's own button does |
| Prompt to roll initiative | Your character is in the active encounter without an initiative roll | Rolls initiative for that character's combatants still missing it, with Normal / Advantage / Disadvantage (one prompt per character) |

The same prompts are available at the table (Awesome VTT). When a player has both, answering or skipping a prompt on one device closes it on the other, so the roll isn't made twice.

Prompts are only shown for characters the player owns, never to the GM, and each at most once.

## Your-turn alert

A banner appears when a combatant the player owns starts its turn, and a lighter one when it's next.

- **Sound:** plays on your turn. If Foundry's own **Combat Theme** is set on that phone, Foundry already plays turn sounds, so this alert stays silent.
- **Vibration:** works on Android. iPhones don't let websites vibrate.

## Physical dice

With Awesome VTT active, turn on **Physical dice on this phone** to enter real dice results on the phone. It uses Awesome VTT's entry window, full screen. Awesome VTT's **Physical dice** world setting still decides whether the player, the GM, or either one enters the results.

## Home screen shortcut

The module adds a web app manifest and Apple's home-screen tags, so the phone can add Foundry as an icon that opens full screen.

- **Android (Chrome):** Settings → **Add to home screen** shows the browser's install prompt, when the browser offers one.
- **iPhone (Safari):** Share → **Add to Home Screen**. Safari may only read these tags when the page first loads; to be confirmed on a device.

No service worker is installed, so there's no offline mode. Foundry needs the server anyway.

## Known limits / to check on first run

These parts are based on the Foundry 14.368 and dnd5e 6.0.5 source but have not yet run on a phone:

- **Right-click menus:** Foundry and the sheets use right-click menus. Android usually opens them with a long-press; iOS Safari may not.
- **Phone notices:** in phone mode, three Foundry messages are dismissed automatically:
  - the screen-resolution error;
  - "Scene … is not displayed because the game Canvas is disabled";
  - the browser-version error, which can misread a phone browser (it reported "Safari 12.0" in testing). If the browser really is out of date, some features may not work; Foundry still logs the message in the browser console.

  Other notifications are left alone.

## Structure

```
module.json, manifest.webmanifest, icons/
scripts/
  main.mjs            startup and hooks
  constants.mjs, settings.mjs
  mode.mjs            phone detection, No-Canvas switch, dismissing Foundry's phone notices
  app.mjs             the phone app (banner, views, bottom sheets, pill, tab bar, actions)
  views/settings-view.mjs
  windows.mjs         full-screen Foundry windows
  targets.mjs         target list, dnd5e bridge, broadcast
  use.mjs             use dialog steps, and passing choices into dnd5e's rolls
  roll-toasts.mjs     roll result notice
  turn-alert.mjs      banner, sound, vibration
  dice.mjs            physical dice via awesome-vtt
  pwa.mjs             home screen shortcut
templates/, styles/mobile.css, lang/en.json
```
