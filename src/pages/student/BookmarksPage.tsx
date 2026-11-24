import { Link } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui';
import type { BookmarkItem } from '@shared/types';

export default function BookmarksPage() {
  useDocumentTitle('Saved items');
  const { data, loading, error, refetch } = useApiQuery<{ items: BookmarkItem[] }>('/api/bookmarks');

  const hrefFor = (item: BookmarkItem) => {
    switch (item.itemType) {
      case 'lecture': return `/lectures/${item.itemId}`;
      case 'course': return `/courses/${item.itemId}`;
      case 'exam': return `/tests/${item.itemId}`;
      case 'test_paper': return `/papers/${item.itemId}`;
      case 'series': return `/series/${item.itemId}`;
      default: return '/';
    }
  };

  return (
    <div className="container-app max-w-3xl space-y-4 py-4 sm:py-6">
      <div>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Saved items</h1>
        <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Lectures, tests and papers you bookmarked.</p>
      </div>

      {loading ? <Spinner /> : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <EmptyState title="Nothing saved yet" description="Tap the bookmark icon on any lecture, test or paper to save it here." icon={<Bookmark className="h-6 w-6" aria-hidden />} />
      ) : (
        <div className="space-y-2">
          {data.items.map((item) => (
            <Link key={item.id} to={hrefFor(item)} className="card flex items-center gap-3 p-3.5 transition hover:shadow-card-hover">
              <Badge tone="brand">{item.itemType.replace('_', ' ')}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{item.detail?.title ?? 'Saved item'}</span>
                <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{item.itemType.replace('_', ' ')}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
