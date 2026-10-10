/**
 * In phone mode every Foundry window (roll dialogs, journals, settings) fills the screen,
 * and small dialogs slide up from the bottom. Positions are forced with CSS, so windows can't be dragged off screen.
 */
export function registerWindowAdapter() {
  Hooks.on("renderApplicationV2", (app, element) => {
    if ( !app.hasFrame ) return;
    element.classList.add("avttm-window");
    if ( app instanceof foundry.applications.api.DialogV2 ) element.classList.add("avttm-dialog");
  });
  // Older (V1) applications some modules still use.
  Hooks.on("renderApplication", (app, html) => {
    const el = html instanceof HTMLElement ? html : html?.[0];
    (el?.closest?.(".app") ?? el)?.classList?.add("avttm-window");
  });
}
