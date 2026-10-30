import type { ComponentType } from "react";
import { ArrowLeftRight, Ban, Check, Info, Pencil, Plus, ToggleRight, Trash2, TriangleAlert, Undo2, X } from "@/lib/icons";

// The look of the app's action buttons, shared so the snack and side rows (UiBodyBlocks) and the plan
// cards (WeekdayRecipeCard) draw the same buttons from one place and cannot drift apart.

export const PILL = "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed";
// A group's buttons share one row as equal-width cells, icon over label: four labelled pills need
// ~350px, so in a phone-width bubble they wrapped into rows of different lengths.
export const CELL = "flex flex-col items-center justify-center gap-0.5 min-w-0 px-1 py-1.5 rounded-lg text-[10px] font-medium leading-tight text-center whitespace-nowrap border transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed";
// The same cell for labels that may need two lines ("Remove from my sides"): they wrap, and the icons stay
// level at the top so a row of cells lines up.
export const CELL_TALL = "flex flex-col items-center justify-start gap-0.5 min-w-0 px-1 py-1.5 rounded-lg text-[10px] font-medium leading-tight text-center border transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed";
export const GROUP_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };
export const PILL_SECONDARY = "bg-green-light border-green-border text-green-primary enabled:hover:bg-green-border";
export const PILL_PRIMARY = "bg-green-primary border-green-primary text-white enabled:hover:bg-green-dark";
// The recipe card's action colours: delete red, info blue, "more" grey. The yellow is the one
// WeekdayGrid's rings turn at 115% of a goal.
export const RED = "bg-red-500 border-red-500 text-white enabled:hover:bg-red-600 enabled:hover:border-red-600";
export const BLUE = "bg-[#23BCFD] border-[#23BCFD] text-white enabled:hover:bg-[#0ea5d6] enabled:hover:border-[#0ea5d6]";
export const GREY = "bg-gray-400 border-gray-400 text-white enabled:hover:bg-gray-500 enabled:hover:border-gray-500";
export const ORANGE = "bg-orange-500 border-orange-500 text-white enabled:hover:bg-orange-600 enabled:hover:border-orange-600";
export const YELLOW = "bg-[#f9cb16] border-[#f9cb16] text-text-main enabled:hover:bg-[#e6b800] enabled:hover:border-[#e6b800]";
// The colour follows the icon's meaning, never the payload (contract §3.2): trash red, edit grey,
// info blue, alert yellow. The rest (toggle, undo, check, cross, plus, swap, block) are "open" there
// and keep the green style. It replaces the style's green, so a `trash` button is red whether primary
// or not.
export const TONES: Record<string, string> = { trash: RED, edit: GREY, info: BLUE, alert: YELLOW };
export const CARD = "bg-[#faf9f6] border border-[rgba(0,0,0,0.07)] rounded-lg";

// The closed icon set (contract §3.2), by the name an agent sends. An unknown name renders no icon.
export const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  trash: Trash2, edit: Pencil, toggle: ToggleRight, undo: Undo2, info: Info,
  check: Check, cross: X, alert: TriangleAlert, plus: Plus, swap: ArrowLeftRight, block: Ban,
};

// A switch's track and knob: the snack list's Auto switch (UiBodyBlocks) and the recipe page's
// planning switch (PlanningSwitch) draw the same one.
export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-block w-[26px] h-[14px] rounded-full transition-colors ${on ? "bg-green-primary" : "bg-gray-300"}`}>
      <span className={`absolute top-[2px] left-[2px] w-[10px] h-[10px] rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[12px]" : ""}`} />
    </span>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return <span className="rounded-full border-[1.5px] border-current border-t-transparent animate-spin inline-block" style={{ width: size, height: size }} />;
}
