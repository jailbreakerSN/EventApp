import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t bg-teranga-navy text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-lg font-bold text-teranga-gold">Teranga</h3>
            <p className="mt-2 text-sm text-gray-300">
              La plateforme de gestion d&apos;événements pour le Sénégal et l&apos;Afrique de l&apos;Ouest.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Découvrir</h4>
            <ul className="mt-3 space-y-2">
              <li><Link href="/events" className="text-sm text-gray-300 hover:text-white transition-colors">Tous les événements</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Organisateurs</h4>
            <ul className="mt-3 space-y-2">
              <li>
                <a href={process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3001"} className="text-sm text-gray-300 hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                  Espace organisateur
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Contact</h4>
            <ul className="mt-3 space-y-2">
              <li className="text-sm text-gray-300">Dakar, Sénégal</li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-gray-700 pt-6 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} Teranga. Tous droits réservés.
        </div>
      </div>
    </footer>
  );
}
