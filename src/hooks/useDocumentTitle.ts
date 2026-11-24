import { useEffect } from 'react';
import { appConfig } from '@/config';

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${appConfig.name}` : `${appConfig.name} — Class 11, 12, JEE & NEET preparation`;
  }, [title]);
}
