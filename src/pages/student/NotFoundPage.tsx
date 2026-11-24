import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="grid min-h-[70dvh] place-items-center px-4">
      <div className="text-center">
        <Compass className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" aria-hidden />
        <h1 className="mt-3 font-display text-2xl font-bold">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The page you are looking for may have moved or been unpublished.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link to="/" className="btn-primary">Go home</Link>
          <Link to="/lectures" className="btn-secondary">Browse lectures</Link>
        </div>
      </div>
    </div>
  );
}
