import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Search, X } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { CardSkeletonGrid, EmptyState, ErrorState, Pagination } from '@/components/ui';
import { Card } from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { Paginated, TestPaper } from '@shared/types';

type PapersPayload = Paginated<TestPaper> & { years: number[] };

export default function PapersPage() {
  useDocumentTitle('Question papers');
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const debounced = useDebouncedValue(query, 350);
  const year = searchParams.get('year') ?? '';
  const page = Number(searchParams.get('page') ?? 1) || 1;
  const [category, setCategory] = useState('');

  const papers = useApiQuery<PapersPayload>(
    '/api/test-papers',
    { q: debounced.trim() || undefined, year: year || undefined, category: category || undefined, page, pageSize: 24 },
    { auth: false, deps: [debounced, year, category, page] },
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="container-app space-y-4 py-4 sm:py-6">
      <div>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Question papers</h1>
        <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Previous-year papers, sample papers and their answer keys.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search papers" className="input pl-9" aria-label="Search papers" />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Clear search">
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <select className="input w-auto" value={year} onChange={(e) => setParam('year', e.target.value)} aria-label="Filter by year">
          <option value="">All years</option>
          {(papers.data?.years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          <option value="previous_year">Previous year</option>
          <option value="sample">Sample paper</option>
          <option value="mock">Mock paper</option>
          <option value="board">Board paper</option>
        </select>
      </div>

      {papers.loading && !papers.data ? (
        <CardSkeletonGrid count={6} />
      ) : papers.error ? (
        <ErrorState message={papers.error} onRetry={papers.refetch} />
      ) : !papers.data?.items.length ? (
        <EmptyState title="No papers found" description="Papers published by your institute will appear here." icon={<FileText className="h-6 w-6" aria-hidden />} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {papers.data.items.map((paper) => (
              <Link key={paper.id} to={`/papers/${paper.id}`} className="card card-hover flex gap-3 p-3">
                <div className="grid h-16 w-14 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                  <FileText className="h-6 w-6" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2-safe text-[13.5px] font-semibold leading-snug">{paper.title}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {[paper.examTypeName, paper.className, paper.year, paper.category?.replace('_', ' ')].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-[10.5px] text-slate-400">
                    <span>{paper.downloadCount} downloads</span>
                    {paper.answerKeyUrl ? <span>· Answer key</span> : null}
                    <span className="ml-auto">{formatDate(paper.createdAt)}</span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
          <Pagination page={papers.data.page} totalPages={papers.data.totalPages} onChange={(next) => {
            const params = new URLSearchParams(searchParams);
            params.set('page', String(next));
            setSearchParams(params);
          }} />
        </>
      )}
    </div>
  );
}
