import { MODULE_ID } from "./constants.mjs";

/**
 * Home screen shortcut. A web app manifest and Apple's home screen tags are added to the page, so "Add to Home
 * Screen" / "Install app" creates an icon that opens Foundry full screen.
 * - Android Chrome fires "beforeinstallprompt"; it is kept so the Settings tab can offer an Install button.
 * - iOS Safari has no install prompt: the user adds it from the Share menu. Safari may only read these tags when
 *   the page first loads, so this is to be confirmed on a device.
 * No service worker is registered: a module can't serve one for the whole site, and none is needed for a shortcut.
 */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});

export const canPromptInstall = () => !!installPrompt;

export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches
  || (window.navigator.standalone === true);

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || ((navigator.platform === "MacIntel") && (navigator.maxTouchPoints > 1));

export async function promptInstall() {
  if ( !installPrompt ) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === "accepted";
}

/** Add the manifest and home screen tags to the page head. */
export function installHomeScreenTags() {
  const path = file => foundry.utils.getRoute(`modules/${MODULE_ID}/${file}`);
  const add = (tag, attrs) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    document.head.append(el);
  };
  if ( !document.querySelector('link[rel="manifest"]') ) add("link", { rel: "manifest", href: path("manifest.webmanifest") });
  add("link", { rel: "apple-touch-icon", href: path("icons/apple-touch-icon.png") });
  add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
  add("meta", { name: "apple-mobile-web-app-title", content: "Foundry" });
  add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
  add("meta", { name: "theme-color", content: "#16161d" });
}
