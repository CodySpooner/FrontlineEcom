// ponytail: hand-built approximation of the owner's logo (white italic FRONTL1NE, red bolt, red pulse line, ECOM).
// Swap for the original art at apps/web/public/brand/logo.png once that file is in the repo.
export function BrandLogo() {
  return (
    <div className="select-none leading-none" aria-label="Frontline Ecom">
      <div className="font-logo text-[44px] font-bold tracking-wide text-white -skew-x-12">
        FRONTL<span className="text-red drop-shadow-[0_0_10px_rgba(255,42,58,.65)]">1</span>NE
      </div>
      <div className="-mt-1 flex items-center gap-2">
        <svg viewBox="0 0 120 14" className="h-3 flex-1" aria-hidden="true">
          <path d="M0 9H68l6-8 5 12 4-4h37" fill="none" stroke="#ff2a3a" strokeWidth="2.5" />
        </svg>
        <span className="font-logo text-sm tracking-[.5em] text-white">ECOM</span>
        <span className="h-[2.5px] w-6 bg-red" />
      </div>
    </div>
  );
}
