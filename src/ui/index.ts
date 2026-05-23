/**
 * DOM overlays drawn over the game canvas. Each component is self-
 * contained (own CSS injection + DOM scaffolding) and exposes an `unmount`
 * affordance so `runMain`'s teardown can return the page to a clean state.
 */
export { mountSidePanel } from "./side_panel.js";
export type {
  SidePanelAction,
  SidePanelHandle,
  SidePanelOptions,
} from "./side_panel.js";
export { mountInventoryUi } from "./inventory/index.js";
export type {
  InventoryUiHandle,
  InventoryUiOptions,
} from "./inventory/index.js";
export { mountCraftingUi } from "./crafting/index.js";
export type {
  CraftingUiHandle,
  CraftingUiOptions,
} from "./crafting/index.js";
export { mountChestUi } from "./chest/index.js";
export type {
  ChestUiHandle,
  ChestUiOptions,
} from "./chest/index.js";
export { showRegisterModal, MIN_PASSWORD_LEN } from "./register_modal.js";
export type {
  RegisterModalHandle,
  RegisterModalOptions,
} from "./register_modal.js";
export { attachInputGate } from "./input_gate.js";
export type { InputGateHandle } from "./input_gate.js";
export { mountCoordsHud, formatCoords } from "./coords_hud.js";
export type { CoordsHudHandle } from "./coords_hud.js";
export {
  mountPlayerListHud,
  formatRosterLabel,
  sortedRosterEntries,
} from "./player_list_hud.js";
export type {
  PlayerListHudHandle,
  PlayerListHudOptions,
} from "./player_list_hud.js";
export {
  mountHpBar,
  hpFillColorFor,
  hpFillWidthPx,
  HP_FLASH_DURATION_MS,
  HP_THRESHOLD_HIGH,
  HP_THRESHOLD_LOW,
} from "./hp_bar.js";
export type { HpBarHandle } from "./hp_bar.js";
export { attachTooltip } from "./tooltip.js";
export type { TooltipContent, TooltipHandle } from "./tooltip.js";
export {
  mountCooldownRing,
  mountSwordCooldownRing,
  ATTACK_COOLDOWN_DURATION_MS,
  dashOffsetForRemainingFrac,
} from "./sword_cooldown_ring.js";
export type { SwordCooldownRingHandle } from "./sword_cooldown_ring.js";
export {
  mountDeathOverlay,
  BLACK_FADE_SECONDS,
  TITLE_FADE_SECONDS,
} from "./death_overlay.js";
export type {
  DeathOverlayHandle,
  DeathOverlayState,
} from "./death_overlay.js";
export {
  mountConnectionErrorOverlay,
  CONNECTION_ERROR_TITLE,
  CONNECTION_ERROR_BODY,
  CONNECTION_ERROR_RELOAD_LABEL,
} from "./connection_error_overlay.js";
export type {
  ConnectionErrorOverlayHandle,
  ConnectionErrorOverlayOptions,
} from "./connection_error_overlay.js";
export { mountXpLabel } from "./xp_label.js";
export type { XpLabelHandle } from "./xp_label.js";
export {
  detectKeyboardLayoutFallback,
  mountOnboardingHint,
  DISMISS_DELAY_MS as ONBOARDING_DISMISS_DELAY_MS,
  FADE_DURATION_MS as ONBOARDING_FADE_DURATION_MS,
  ONBOARDING_SEEN_STORAGE_KEY,
} from "./onboarding_hint.js";
export type {
  KeyboardLayout,
  OnboardingHintHandle,
  OnboardingHintOptions,
} from "./onboarding_hint.js";
export {
  mountChatHud,
  CHAT_HUD_ADMIN_COLOR,
  CHAT_HUD_MAX_LINES,
} from "./chat_hud.js";
export type { ChatHudHandle, ChatLine } from "./chat_hud.js";
export { mountChatInput, CHAT_INPUT_MAX_LEN } from "./chat_input.js";
export type { ChatInputHandle, ChatInputOptions } from "./chat_input.js";
export { mountLeaderboardHud, formatFactionCoords } from "./leaderboard_hud.js";
export type {
  LeaderboardHudHandle,
  LeaderboardHudOptions,
} from "./leaderboard_hud.js";
export {
  createFactionErrorMessage,
  showCreateFactionDialog,
} from "./create_faction_dialog.js";
export type {
  CreateFactionDialogHandle,
  CreateFactionDialogOptions,
} from "./create_faction_dialog.js";
export { mountHelp, mountHowToPlayButton } from "./help_button.js";
export type { HelpHandle, HowToPlayButtonHandle } from "./help_button.js";
export { showHelpDialog } from "./help_dialog.js";
export type { HelpDialogHandle, HelpDialogOptions } from "./help_dialog.js";
