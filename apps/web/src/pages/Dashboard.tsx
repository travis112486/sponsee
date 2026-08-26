export default function Dashboard() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <img src="/empty-state.svg" alt="" className="mb-6 h-32 w-32 opacity-60" />
      <h2 className="text-lg font-semibold text-ink">Welcome to Sponsee</h2>
      <p className="mt-2 max-w-sm text-[13px] text-ink-3">
        Your dashboard is empty. Add your first deal to start tracking your sponsorship pipeline.
      </p>
    </div>
  );
}
