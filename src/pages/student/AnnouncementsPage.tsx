import { Link } from 'react-router-dom';
import { Megaphone, Pin } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import type { Announcement } from '@shared/types';

const PRIORITY_TONE = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' } as const;

export default function AnnouncementsPage() {
  useDocumentTitle('Announcements');
  const { data, loading, error, refetch } = useApiQuery<{ items: Announcement[] }>('/api/announcements', { pageSize: 50 }, { auth: false });

  return (
    <div className="container-app max-w-3xl space-y-4 py-4 sm:py-6">
      <div>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Announcements</h1>
        <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Updates from your institute — schedules, results and new content.</p>
      </div>

      {loading ? <Spinner /> : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <EmptyState title="No announcements yet" description="Announcements published by your institute will appear here." icon={<Megaphone className="h-6 w-6" aria-hidden />} />
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => (
            <article key={item.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {item.isPinned ? <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase text-amber-600"><Pin className="h-3 w-3" aria-hidden /> Pinned</span> : null}
                <Badge tone={PRIORITY_TONE[item.priority] ?? 'neutral'}>{item.priority}</Badge>
                <span className="ml-auto text-[10.5px] uppercase tracking-wide text-slate-400">{formatRelative(item.publishAt ?? item.createdAt)}</span>
              </div>
              <h2 className="mt-1.5 text-[15px] font-semibold">{item.title}</h2>
              <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{item.body}</p>
              {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" className="mt-2 max-h-72 rounded-lg object-cover" /> : null}
              {item.linkUrl ? (
                <Link to={item.linkUrl} className="mt-2 inline-block text-[12.5px] font-semibold text-brand-600 hover:underline">
                  Open link →
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
