/** Leave video usable on phones; CSS reapplies this cap after rotation. */
export function clampAndroidChatWidth(desired: number, layoutWidth: number): number {
  return Math.round(Math.min(620, layoutWidth * 0.6, Math.max(180, desired)));
}
