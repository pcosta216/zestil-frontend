export function RecipeGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-white border border-[rgba(0,0,0,0.07)] rounded-2xl overflow-hidden"
        >
          <div className="w-full h-28 bg-green-light animate-pulse" />
          <div className="p-3 flex flex-col gap-2">
            <div className="h-3 bg-[rgba(0,0,0,0.06)] rounded-full animate-pulse w-3/4" />
            <div className="h-3 bg-[rgba(0,0,0,0.04)] rounded-full animate-pulse w-1/2" />
            <div className="h-4 bg-green-light rounded-full animate-pulse w-16 mt-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecipeDetailSkeleton() {
  return (
    <div className="flex flex-col max-w-2xl mx-auto">
      <div className="w-full h-52 bg-green-light animate-pulse" />
      <div className="px-5 py-5 flex flex-col gap-4">
        <div className="h-7 bg-[rgba(0,0,0,0.06)] rounded-full animate-pulse w-2/3" />
        <div className="h-4 bg-[rgba(0,0,0,0.04)] rounded-full animate-pulse w-full" />
        <div className="h-4 bg-[rgba(0,0,0,0.04)] rounded-full animate-pulse w-5/6" />
        <div className="flex gap-2 mt-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-6 w-20 bg-green-light rounded-full animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
