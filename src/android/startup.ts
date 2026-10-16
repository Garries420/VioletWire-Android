let finishing = false;
const startedAt = performance.now();

/** Reveal one settled Following feed rather than the authentication intermediates. */
export async function finishStartup() {
  if (finishing) return;
  finishing = true;
  const splash = document.getElementById("android-startup");
  if (!splash) return;
  const images = [...document.querySelectorAll<HTMLImageElement>(".mobile-feed img")].slice(0, 6);
  await Promise.race([
    Promise.allSettled([document.fonts.ready, ...images.map(image => image.decode())]),
    new Promise(resolve => setTimeout(resolve, 900)),
  ]);
  const remaining = Math.max(0, 550 - (performance.now() - startedAt));
  if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    splash.classList.add("startup-finished");
    setTimeout(() => splash.remove(), 400);
  }));
}
export function startupFailed() {
  const splash = document.getElementById("android-startup");
  if (!splash) return;
  splash.querySelector("p")!.textContent = "VioletWire could not start. Please try again.";
  const button = splash.querySelector<HTMLButtonElement>("button")!;
  button.hidden = false;
  button.addEventListener("click", () => location.reload(), { once: true });
}
