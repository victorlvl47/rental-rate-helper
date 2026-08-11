export default function Home() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#15243d]">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
          <a href="#dashboard" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="grid size-9 place-items-center rounded-xl bg-[#e45b2d] text-lg font-bold text-white">
              R
            </span>
            <span>RentalRateHelper</span>
          </a>
          <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-[#bd4b25]">
            Dashboard mockup
          </span>
        </div>
      </header>

      <main id="dashboard" className="mx-auto max-w-6xl space-y-6 px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#e05a2d]">
              Rental market intelligence
            </p>
            <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-[#15243d] sm:text-4xl">
              Your rental rate dashboard
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              RentalRateHelper will analyze rental market data and recommend competitive nightly rates by city, helping you make clearer pricing decisions.
            </p>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">Recommendations</p>
                  <h2 className="mt-1 text-xl font-semibold">Your nightly-rate outlook</h2>
                </div>
              </div>
              <div className="mt-8 grid min-h-44 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <div>
                  <p className="font-medium text-slate-700">Recommendations will appear here</p>
                </div>
              </div>
            </article>

            <aside className="rounded-3xl border border-slate-200 bg-[#eef3f8] p-6 shadow-sm sm:p-8">
              <p className="text-sm font-medium text-slate-500">Getting started</p>
              <h2 className="mt-1 text-xl font-semibold">A focused foundation</h2>
              <ul className="mt-6 space-y-4 text-sm leading-6 text-slate-600">
                <li className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-[#e05a2d]" />City market analysis</li>
                <li className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-[#e05a2d]" />Competitive nightly-rate guidance</li>
                <li className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-[#e05a2d]" />Clear pricing insights</li>
              </ul>
            </aside>
          </section>
      </main>
    </div>
  );
}
