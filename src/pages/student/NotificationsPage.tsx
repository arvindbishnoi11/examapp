import { useEffect } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import type { Announcement } from '@shared/types';

export default function NotificationsPage() {
  useDocumentTitle('Notifications');
  const { status } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<{ items: Announcement[] }>('/api/notifications', undefined, {
    auth: true,
    enabled: status === 'authenticated',
  });

  // A push that arrives while the app is in the foreground is surfaced by
  // `src/lib/messaging.ts` as a DOM event — the service worker cannot show it.
  // Refresh the feed and tell the student, rather than dropping the message.
  useEffect(() => {
    const onPush = (event: Event) => {
      const detail = (event as CustomEvent<{ notification?: { title?: string; body?: string } }>).detail;
      const title = detail?.notification?.title;
      if (title) toast.info(title);
      void refetch();
    };
    window.addEventListener('prepsetu:push', onPush);
    return () => window.removeEventListener('prepsetu:push', onPush);
  }, [refetch, toast]);

  return (
    <div className="container-app max-w-3xl space-y-4 py-4 sm:py-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-bold sm:text-2xl">Notifications</h1>
          <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Targeted updates for your class and goal.</p>
        </div>
        <Link to="/profile" className="text-[12px] font-semibold text-brand-600">Preferences</Link>
      </div>

      {status !== 'authenticated' ? (
        <EmptyState title="Sign in to see notifications" description="Notifications are personalised to your class and target exam." icon={<Bell className="h-6 w-6" aria-hidden />} action={<Link to="/login?next=/notifications" className="btn-primary">Sign in</Link>} />
      ) : loading ? <Spinner /> : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <EmptyState title="Nothing here yet" description="When your institute publishes an update for your class or exam, it will show up here." icon={<BellOff className="h-6 w-6" aria-hidden />} />
      ) : (
        <div className="space-y-2.5">
          {data.items.map((item) => (
            <div key={item.id} className="card p-3.5">
              <div className="flex items-center gap-1.5">
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{item.title}</p>
                {item.isPinned ? <Badge tone="warning">Pinned</Badge> : null}
              </div>
              <p className="mt-1 whitespace-pre-line text-[12.5px] text-slate-600 dark:text-slate-400">{item.body}</p>
              <p className="mt-1.5 text-[10.5px] uppercase tracking-wide text-slate-400">{formatRelative(item.publishAt ?? item.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
