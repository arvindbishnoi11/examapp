import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, FileText, KeyRound, Lightbulb, Lock } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorState, Spinner } from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { TestPaper } from '@shared/types';

type PaperPayload = { paper: TestPaper; canDownload: boolean };

export default function PaperDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<PaperPayload>(id ? `/api/test-papers/${id}` : null, undefined, {
    auth: status === 'authenticated',
  });
  const [requesting, setRequesting] = useState(false);

  useDocumentTitle(data?.paper?.title ?? 'Question paper');

  if (loading && !data) return <div className="container-app py-10"><Spinner /></div>;
  if (error) return <div className="container-app py-10"><ErrorState message={error} onRetry={refetch} /></div>;
  if (!data) return null;

  const { paper } = data;

  const download = async () => {
    if (status !== 'authenticated' && !data.canDownload) {
      toast.info('Sign in to download this paper.');
      return;
    }
    setRequesting(true);
    try {
      const result = await api.post<{ fileUrl: string; title: string }>(`/api/test-papers/${paper.id}/download`);
      window.open(result.fileUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="container-app max-w-3xl space-y-4 py-4 sm:py-6">
      <Link to="/papers" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All papers
      </Link>

      <div className="card p-5">
        <div className="flex flex-wrap gap-1.5">
          {paper.examTypeName ? <Badge tone="brand">{paper.examTypeName}</Badge> : null}
          {paper.className ? <Badge tone="neutral">{paper.className}</Badge> : null}
          {paper.year ? <Badge tone="neutral">{paper.year}</Badge> : null}
          {paper.category ? <Badge tone="warning">{paper.category.replace('_', ' ')}</Badge> : null}
          {paper.visibility === 'restricted' ? <Badge tone="danger"><Lock className="h-3 w-3" aria-hidden /> Restricted</Badge> : null}
        </div>
        <h1 className="mt-2 font-display text-xl font-bold">{paper.title}</h1>
        {paper.description ? <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-400">{paper.description}</p> : null}
        <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">
          {formatDate(paper.createdAt)} · {paper.downloadCount} downloads
          {paper.fileSizeBytes ? ` · ${(paper.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button icon={<Download className="h-4 w-4" aria-hidden />} loading={requesting} onClick={download} disabled={!data.canDownload}>
            Download PDF
          </Button>
          {paper.fileUrl ? (
            <a href={paper.fileUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              <ExternalLink className="h-4 w-4" aria-hidden /> Open in browser
            </a>
          ) : null}
          {paper.answerKeyUrl ? (
            <a href={paper.answerKeyUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              <KeyRound className="h-4 w-4" aria-hidden /> Answer key
            </a>
          ) : null}
          {paper.solutionUrl ? (
            <a href={paper.solutionUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              <Lightbulb className="h-4 w-4" aria-hidden /> Solutions
            </a>
          ) : null}
        </div>
        {!data.canDownload ? (
          <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">This paper is restricted. Sign in with an enrolled account to download it.</p>
        ) : null}
      </div>

      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><FileText className="h-4 w-4 text-brand-600" aria-hidden /> How to use this paper</h2>
        <ol className="mt-2 list-inside list-decimal space-y-1.5 text-[13px] text-slate-600 dark:text-slate-400">
          <li>Attempt the paper in one sitting under exam conditions — keep a timer.</li>
          <li>Mark only the answers you are confident about, exactly like the real exam.</li>
          <li>Check the answer key, then read the solutions for every wrong answer.</li>
          <li>Log the chapters where you lost marks and revise them the same day.</li>
        </ol>
      </div>
    </div>
  );
}
