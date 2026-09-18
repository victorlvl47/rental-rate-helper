import Link from 'next/link';

export function Navigation() {
  return <header className="border-b border-slate-200 bg-white"><nav aria-label="Main navigation" className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8"><Link href="/dashboard" className="flex items-center gap-2 font-semibold text-slate-900"><span className="grid size-8 place-items-center rounded-lg bg-orange-600 text-white">R</span>RentalRateHelper</Link><div className="flex gap-1 text-sm font-medium"><Link className="nav-link" href="/dashboard">Overview</Link><Link className="nav-link" href="/properties">Properties</Link><Link className="nav-link" href="/recommendations">Recommendations</Link><Link className="nav-link" href="/evals">Evals</Link></div></nav></header>;
}
