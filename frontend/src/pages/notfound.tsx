import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[calc(100svh-120px)] flex-col items-center justify-center gap-4 text-center px-4">
      <h1 className="text-6xl font-bold text-white/90">404</h1>
      <h2 className="text-xl font-semibold text-white">Page not found</h2>
      <p className="text-sm text-white/50">The page you're looking for doesn't exist.</p>
      <Link
        to="/"
        className="mt-2 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
      >
        Go home
      </Link>
    </div>
  );
}
