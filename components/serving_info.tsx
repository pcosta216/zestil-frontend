"use client";

interface Props {
  servingMultiplier: number;
  servingsValue: number;
}

export function ServingInfo({ servingMultiplier, servingsValue }: Props) {
  return (
    <div
      className="inline-flex items-center h-[20px] w-[40px] border border-yellow-200 rounded-full overflow-hidden text-text-muted text-[10px] font-medium"
      aria-label={`${servingMultiplier} of ${servingsValue} servings`}
    >
      <span className="size-[20px] flex-shrink-0 bg-yellow-400 rounded-full flex items-center justify-center text-white text-xs font-semibold leading-none">
        {servingMultiplier}
      </span>
      <span className="flex-1 flex items-center justify-center leading-none">
        {servingsValue}
      </span>
    </div>
  );
}
