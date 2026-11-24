import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import type { ClassRef, ExamTypeRef } from '@shared/types';

type TaxonomyValue = {
  classes: (ClassRef & { isActive?: boolean })[];
  examTypes: ExamTypeRef[];
  loading: boolean;
  reload: () => void;
};

const TaxonomyContext = createContext<TaxonomyValue>({ classes: [], examTypes: [], loading: true, reload: () => undefined });

/**
 * Reference data used by nearly every admin form (class + exam dropdowns).
 * Fetched once per session instead of per page.
 */
export function AdminTaxonomyProvider({ children }: { children: ReactNode }) {
  const classes = useApiQuery<{ items: (ClassRef & { isActive?: boolean })[] }>('/api/admin/classes', { pageSize: 100 }, { auth: true });
  const examTypes = useApiQuery<{ items: ExamTypeRef[] }>('/api/admin/exam-types', { pageSize: 100 }, { auth: true });
  const [classes2, setClasses] = useState<TaxonomyValue['classes']>([]);
  const [examTypes2, setExamTypes] = useState<TaxonomyValue['examTypes']>([]);

  useEffect(() => {
    if (classes.data?.items) setClasses(classes.data.items);
  }, [classes.data]);
  useEffect(() => {
    if (examTypes.data?.items) setExamTypes(examTypes.data.items);
  }, [examTypes.data]);

  const value = useMemo<TaxonomyValue>(
    () => ({
      classes: classes2,
      examTypes: examTypes2,
      loading: classes.loading || examTypes.loading,
      reload: () => {
        classes.refetch();
        examTypes.refetch();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classes2, examTypes2, classes.loading, examTypes.loading],
  );

  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>;
}

export function useAdminTaxonomy(): TaxonomyValue {
  return useContext(TaxonomyContext);
}
