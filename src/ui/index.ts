/**
 * DOM overlays drawn over the game canvas. Each component is self-
 * contained (own CSS injection + DOM scaffolding) and exposes an `unmount`
 * affordance so `runMain`'s teardown can return the page to a clean state.
 */
export { mountCornerActions } from "./corner_actions.js";
export type { CornerAction } from "./corner_actions.js";
export { mountInventoryUi } from "./inventory/index.js";
export type { InventoryUiHandle } from "./inventory/index.js";
export { mountCraftingUi } from "./crafting/index.js";
export type { CraftingUiHandle } from "./crafting/index.js";
export { mountChestUi } from "./chest/index.js";
export { showRegisterModal } from "./register_modal.js";
export type { RegisterModalHandle } from "./register_modal.js";
export { mountCoordsHud } from "./coords_hud.js";
export { mountPlayerListHud } from "./player_list_hud.js";
export { mountHpBar } from "./hp_bar.js";
export {
  mountCooldownRing,
  mountSwordCooldownRing,
  ATTACK_COOLDOWN_DURATION_MS,
} from "./sword_cooldown_ring.js";
export { mountDeathOverlay } from "./death_overlay.js";
export type { DeathOverlayState } from "./death_overlay.js";
export { mountConnectionErrorOverlay } from "./connection_error_overlay.js";
export type { ConnectionErrorOverlayHandle } from "./connection_error_overlay.js";
export { mountXpLabel } from "./xp_label.js";
export { mountOnboardingHint } from "./onboarding_hint.js";
export { mountChatHud } from "./chat_hud.js";
export type { ChatHudHandle, ChatLine } from "./chat_hud.js";
export { mountChatInput } from "./chat_input.js";
export type { ChatInputHandle } from "./chat_input.js";
export { mountLeaderboardHud } from "./leaderboard_hud.js";
export { showCreateFactionDialog } from "./create_faction_dialog.js";
export { mountHelp, mountHowToPlayButton } from "./help_button.js";
