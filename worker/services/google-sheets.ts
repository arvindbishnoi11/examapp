// =============================================================================
// Google Sheets client (read-only)
// =============================================================================
// Read-only on purpose: sync must never overwrite an owner's spreadsheet.
// Values API with UNFORMATTED_VALUE so numbers stay numeric.
// =============================================================================

import type { Env } from '../env';
import { getGoogleAccessToken, SCOPES } from './google-auth';
import { withRetry } from '../lib/util';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function sheetsSpreadsheetId(env: Env): string {
  return env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || '1tNqp66KgAnnhCRceOPkZubl1C-pMK_olzJkBlKGEnE4';
}

export function sheetsConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
}

async function sheetsToken(env: Env): Promise<string> {
  return getGoogleAccessToken('google-sheets', env.GOOGLE_SERVICE_ACCOUNT_JSON, SCOPES.sheets);
}

async function call<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const token = await sheetsToken(env);
  const response = await withRetry(
    async () => {
      const res = await fetch(`${SHEETS_API}/${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(init.headers ?? {}),
        },
      });
      if (res.ok) return res;
      const text = await res.text().catch(() => '');
      const error = new Error(`Sheets API ${res.status}: ${text.slice(0, 400)}`);
      (error as unknown as { status: number }).status = res.status;
      throw error;
    },
    {
      attempts: 4,
      shouldRetry: (err) => {
        const status = (err as { status?: number }).status ?? 0;
        return status === 429 || status >= 500 || status === 0;
      },
    },
  );
  return (await response.json()) as T;
}

export type SpreadsheetMeta = {
  spreadsheetId: string;
  title: string;
  sheets: {
    title: string;
    sheetId: number;
    rowCount: number;
    columnCount: number;
    gridProperties?: { rowCount: number; columnCount: number };
  }[];
};

export async function getSpreadsheetMeta(env: Env, spreadsheetId = sheetsSpreadsheetId(env)): Promise<SpreadsheetMeta> {
  const data = await call<{
    spreadsheetId: string;
    properties?: { title?: string };
    sheets?: {
      properties?: {
        title?: string;
        sheetId?: number;
        gridProperties?: { rowCount: number; columnCount: number };
      };
    }[];
  }>(env, `${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`);

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? '',
    sheets: (data.sheets ?? []).map((s) => ({
      title: s.properties?.title ?? 'Sheet',
      sheetId: s.properties?.sheetId ?? 0,
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      columnCount: s.properties?.gridProperties?.columnCount ?? 0,
    })),
  };
}

/**
 * Fetches all values for a worksheet. Returns a 2-D array with the header row
 * first. Empty trailing rows are trimmed.
 */
export async function getSheetValues(
  env: Env,
  sheetTitle: string,
  spreadsheetId = sheetsSpreadsheetId(env),
  range = 'A1:AZ3000',
): Promise<string[][]> {
  const quoted = `'${sheetTitle.replace(/'/g, "''")}'!${range}`;
  const data = await call<{ values?: (string | number | boolean)[][] }>(
    env,
    `${spreadsheetId}/values/${encodeURIComponent(quoted)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  );
  const values = data.values ?? [];
  // Trim fully-empty trailing rows/columns but keep interior blanks (they are
  // legitimate empty cells and removing them would misalign columns).
  while (values.length && values[values.length - 1].every((c) => c === '' || c === null || c === undefined)) {
    values.pop();
  }
  return values.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
}

export function describeSheetsError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'google_credentials_missing') {
    return 'GOOGLE_SERVICE_ACCOUNT_JSON is not set. Add the service-account key as a Cloudflare secret to enable synchronisation.';
  }
  if (/403/.test(message)) {
    return 'Google refused the request (403). Share the spreadsheet with the service-account email as an Editor, and check that the Google Sheets API is enabled for the project.';
  }
  if (/404/.test(message)) {
    return 'Spreadsheet or worksheet not found (404). Verify GOOGLE_SHEETS_SPREADSHEET_ID and worksheet names.';
  }
  if (/401/.test(message)) {
    return 'Google rejected the service-account credential (401). The private key may be rotated or malformed.';
  }
  if (/429/.test(message)) {
    return 'Google API quota exceeded (429). Synchronisation will retry automatically.';
  }
  return `Google Sheets request failed: ${message.slice(0, 300)}`;
}
