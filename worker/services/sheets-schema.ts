// =============================================================================
// Google Sheets ⇄ PrepSetu mapping
// =============================================================================
// The spreadsheet is the *content source*, not the delivery database. This
// module defines, for each worksheet, which entity it feeds and how a header row
// maps onto application fields.
//
// Robustness rules
//   * Headers are matched case/space/punct-insensitively with aliases, so an
//     owner renaming "Lecture Title" → "Title" or "duration_mins" → "Duration"
//     keeps working without code changes.
//   * A worksheet that is absent is skipped (never created, never deleted).
//   * Unknown columns are ignored and reported, never destroying data.
//   * Rows without a business key (external_id / natural key) are rejected with
//     a precise error instead of being silently imported.
//   * Nothing is ever written back to the spreadsheet from this module.
// =============================================================================

export type SheetEntity =
  | 'classes'
  | 'exam_types'
  | 'courses'
  | 'subjects'
  | 'chapters'
  | 'lecture_series'
  | 'lectures'
  | 'test_series'
  | 'exams'
  | 'exam_sections'
  | 'questions'
  | 'question_options'
  | 'answer_keys'
  | 'explanations'
  | 'announcements'
  | 'test_papers'
  | 'settings';

export type ColumnSpec = {
  /** Canonical field name used by the importer. */
  field: string;
  aliases: string[];
  required?: boolean;
};

export type SheetSpec = {
  entity: SheetEntity;
  /** Accepted worksheet names (normalised comparison). */
  sheets: string[];
  /** Order matters: parents are imported before children. */
  columns: ColumnSpec[];
  /** Human description shown in the admin Sheets manager. */
  description: string;
};

const idColumns: ColumnSpec[] = [
  { field: 'external_id', aliases: ['id', 'externalid', 'external_id', 'recordid', 'record_id', 'uid', 'code'] },
];

export const SHEET_SPECS: SheetSpec[] = [
  {
    entity: 'classes',
    sheets: ['classes', 'class'],
    description: 'Class 11, Class 12 and any other class-level grouping.',
    columns: [
      ...idColumns,
      { field: 'name', aliases: ['name', 'class', 'classname', 'title'], required: true },
      { field: 'slug', aliases: ['slug', 'key'] },
      { field: 'level', aliases: ['level', 'grade', 'classlevel'] },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'color', aliases: ['color', 'colour'] },
      { field: 'icon', aliases: ['icon'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position', 'srno', 'sr_no', 'serial'] },
      { field: 'is_active', aliases: ['isactive', 'active', 'enabled', 'status'] },
    ],
  },
  {
    entity: 'exam_types',
    sheets: ['examtypes', 'exam_types', 'exams_types', 'targetexams', 'goals'],
    description: 'JEE Main, JEE Advanced, NEET, Board and any future examination type.',
    columns: [
      ...idColumns,
      { field: 'name', aliases: ['name', 'examtype', 'exam', 'target', 'goal'], required: true },
      { field: 'slug', aliases: ['slug', 'key'] },
      { field: 'short_name', aliases: ['shortname', 'abbr', 'abbreviation'] },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'color', aliases: ['color', 'colour'] },
      { field: 'icon', aliases: ['icon'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
      { field: 'is_active', aliases: ['isactive', 'active', 'enabled', 'status'] },
    ],
  },
  {
    entity: 'courses',
    sheets: ['courses', 'course'],
    description: 'Top-level courses (e.g. "Class 11 Physics", "JEE Main Complete").',
    columns: [
      ...idColumns,
      { field: 'name', aliases: ['name', 'course', 'coursename', 'title'], required: true },
      { field: 'slug', aliases: ['slug', 'key'] },
      { field: 'description', aliases: ['description', 'desc', 'details'] },
      { field: 'short_description', aliases: ['shortdescription', 'summary', 'shortdesc'] },
      { field: 'cover_image_url', aliases: ['coverimage', 'coverimageurl', 'cover', 'image', 'imageurl', 'thumbnail', 'thumbnailurl', 'banner'] },
      { field: 'class_ref', aliases: ['class', 'classname', 'classid', 'class_id'] },
      { field: 'exam_type_ref', aliases: ['examtype', 'exam', 'targetexam', 'examtypeid', 'exam_type_id', 'goal'] },
      { field: 'tags', aliases: ['tags', 'keywords'] },
      { field: 'difficulty', aliases: ['difficulty', 'level'] },
      { field: 'price_inr', aliases: ['price', 'priceinr', 'fee', 'amount'] },
      { field: 'is_free', aliases: ['isfree', 'free'] },
      { field: 'is_featured', aliases: ['isfeatured', 'featured'] },
      { field: 'status', aliases: ['status', 'state', 'published'] },
      { field: 'visibility', aliases: ['visibility', 'access'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
    ],
  },
  {
    entity: 'subjects',
    sheets: ['subjects', 'subject'],
    description: 'Physics, Chemistry, Mathematics, Biology per course.',
    columns: [
      ...idColumns,
      { field: 'name', aliases: ['name', 'subject', 'subjectname', 'title'], required: true },
      { field: 'slug', aliases: ['slug', 'key'] },
      { field: 'course_ref', aliases: ['course', 'coursename', 'courseid', 'course_id'], required: true },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'color', aliases: ['color', 'colour'] },
      { field: 'icon', aliases: ['icon'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
      { field: 'is_active', aliases: ['isactive', 'active', 'enabled', 'status'] },
    ],
  },
  {
    entity: 'chapters',
    sheets: ['chapters', 'chapter', 'topics'],
    description: 'Chapters inside a subject.',
    columns: [
      ...idColumns,
      { field: 'name', aliases: ['name', 'chapter', 'chaptername', 'title', 'topic'], required: true },
      { field: 'slug', aliases: ['slug', 'key'] },
      { field: 'subject_ref', aliases: ['subject', 'subjectname', 'subjectid', 'subject_id'], required: true },
      { field: 'course_ref', aliases: ['course', 'coursename', 'courseid', 'course_id'] },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'weightage', aliases: ['weightage', 'weight', 'marks'] },
      { field: 'estimated_minutes', aliases: ['estimatedminutes', 'duration', 'estimatedtime'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position', 'srno', 'sr_no'] },
      { field: 'is_active', aliases: ['isactive', 'active', 'enabled', 'status'] },
    ],
  },
  {
    entity: 'lecture_series',
    sheets: ['lectureseries', 'lecture_series', 'series', 'playlists'],
    description: 'Lecture series / playlists (e.g. "Rotational Motion — Full Chapter").',
    columns: [
      ...idColumns,
      { field: 'title', aliases: ['title', 'name', 'series', 'seriestitle'], required: true },
      { field: 'course_ref', aliases: ['course', 'coursename', 'courseid', 'course_id'], required: true },
      { field: 'chapter_ref', aliases: ['chapter', 'chaptername', 'chapterid', 'chapter_id'] },
      { field: 'subject_ref', aliases: ['subject', 'subjectname', 'subjectid', 'subject_id'] },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'thumbnail_url', aliases: ['thumbnail', 'thumbnailurl', 'image', 'imageurl'] },
      { field: 'youtube_playlist_id', aliases: ['playlistid', 'youtubeplaylistid', 'playlist'] },
      { field: 'is_free', aliases: ['isfree', 'free'] },
      { field: 'status', aliases: ['status', 'state', 'published'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
    ],
  },
  {
    entity: 'lectures',
    sheets: ['lectures', 'lecture', 'videos', 'youtube'],
    description: 'Individual YouTube lectures.',
    columns: [
      ...idColumns,
      { field: 'title', aliases: ['title', 'name', 'lecture', 'lecturetitle', 'videotitle'], required: true },
      { field: 'youtube_url', aliases: ['youtubeurl', 'url', 'link', 'videourl', 'youtubelink'] },
      { field: 'youtube_video_id', aliases: ['youtubeid', 'videoid', 'youtubevideoid'] },
      { field: 'course_ref', aliases: ['course', 'coursename', 'courseid', 'course_id'] },
      { field: 'subject_ref', aliases: ['subject', 'subjectname', 'subjectid', 'subject_id'] },
      { field: 'chapter_ref', aliases: ['chapter', 'chaptername', 'chapterid', 'chapter_id'] },
      { field: 'series_ref', aliases: ['series', 'seriestitle', 'lectureseries', 'seriesid', 'series_id'] },
      { field: 'description', aliases: ['description', 'desc', 'notes'] },
      { field: 'thumbnail_url', aliases: ['thumbnail', 'thumbnailurl', 'image', 'imageurl'] },
      { field: 'duration_seconds', aliases: ['duration', 'durationseconds', 'durationmins', 'length'] },
      { field: 'lecture_number', aliases: ['lecturenumber', 'lecture_no', 'lectureno', 'number', 'sequence'] },
      { field: 'language', aliases: ['language', 'lang'] },
      { field: 'is_free', aliases: ['isfree', 'free'] },
      { field: 'status', aliases: ['status', 'state', 'published'] },
      { field: 'visibility', aliases: ['visibility', 'access'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
      { field: 'published_at', aliases: ['publishedat', 'publishedon', 'date', 'uploaddate'] },
    ],
  },
  {
    entity: 'test_series',
    sheets: ['testseries', 'test_series'],
    description: 'Groups of examinations (e.g. "JEE Main 2026 Full Mocks").',
    columns: [
      ...idColumns,
      { field: 'name', aliases: ['name', 'title', 'testseries'], required: true },
      { field: 'slug', aliases: ['slug', 'key'] },
      { field: 'course_ref', aliases: ['course', 'coursename', 'courseid', 'course_id'] },
      { field: 'exam_type_ref', aliases: ['examtype', 'exam', 'targetexam', 'goal'] },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'thumbnail_url', aliases: ['thumbnail', 'thumbnailurl', 'image'] },
      { field: 'is_free', aliases: ['isfree', 'free'] },
      { field: 'status', aliases: ['status', 'state'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
    ],
  },
  {
    entity: 'exams',
    sheets: ['exams', 'exam', 'examinations', 'tests'],
    description: 'Examinations / mock tests.',
    columns: [
      ...idColumns,
      { field: 'title', aliases: ['title', 'name', 'exam', 'test', 'examname'], required: true },
      { field: 'test_series_ref', aliases: ['testseries', 'series', 'testseriesid'] },
      { field: 'course_ref', aliases: ['course', 'coursename', 'courseid', 'course_id'] },
      { field: 'exam_type_ref', aliases: ['examtype', 'exam', 'targetexam', 'goal'] },
      { field: 'subject_ref', aliases: ['subject', 'subjectname', 'subjectid'] },
      { field: 'chapter_ref', aliases: ['chapter', 'chaptername', 'chapterid'] },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'instructions', aliases: ['instructions', 'notes'] },
      { field: 'exam_kind', aliases: ['examkind', 'type', 'testtype', 'kind'] },
      { field: 'duration_minutes', aliases: ['duration', 'durationminutes', 'time', 'timemins'] },
      { field: 'total_marks', aliases: ['totalmarks', 'marks', 'maxmarks'] },
      { field: 'marks_per_question', aliases: ['marksperquestion', 'marksperq'] },
      { field: 'negative_marks', aliases: ['negativemarks', 'negativemarking', 'negative'] },
      { field: 'negative_marking_enabled', aliases: ['negativemarkingenabled', 'hasnegative'] },
      { field: 'shuffle_questions', aliases: ['shufflequestions', 'shuffle'] },
      { field: 'shuffle_options', aliases: ['shuffleoptions'] },
      { field: 'start_at', aliases: ['startat', 'startdate', 'start'] },
      { field: 'end_at', aliases: ['endat', 'enddate', 'end'] },
      { field: 'max_attempts', aliases: ['maxattempts', 'attempts'] },
      { field: 'result_publish_mode', aliases: ['resultpublishmode', 'resultmode', 'publishmode'] },
      { field: 'passing_percentage', aliases: ['passingpercentage', 'passingmarks', 'passpercent'] },
      { field: 'is_free', aliases: ['isfree', 'free'] },
      { field: 'status', aliases: ['status', 'state', 'published'] },
    ],
  },
  {
    entity: 'exam_sections',
    sheets: ['examsections', 'exam_sections', 'sections'],
    description: 'Subject-wise sections inside an examination.',
    columns: [
      ...idColumns,
      { field: 'exam_ref', aliases: ['exam', 'examid', 'examtitle', 'exam_id'], required: true },
      { field: 'title', aliases: ['title', 'name', 'section'], required: true },
      { field: 'subject_ref', aliases: ['subject', 'subjectname', 'subjectid'] },
      { field: 'chapter_ref', aliases: ['chapter', 'chaptername', 'chapterid'] },
      { field: 'instructions', aliases: ['instructions', 'notes'] },
      { field: 'is_optional', aliases: ['isoptional', 'optional'] },
      { field: 'max_questions', aliases: ['maxquestions', 'questioncount', 'questions'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
    ],
  },
  {
    entity: 'questions',
    sheets: ['questions', 'question', 'questionbank', 'qb'],
    description: 'Question bank. Answer keys may live here or in AnswerKeys.',
    columns: [
      ...idColumns,
      { field: 'question_text', aliases: ['question', 'questiontext', 'text', 'body'], required: true },
      { field: 'question_type', aliases: ['type', 'questiontype', 'qtype'] },
      { field: 'difficulty', aliases: ['difficulty', 'level'] },
      { field: 'option_a', aliases: ['optiona', 'a', 'opta'] },
      { field: 'option_b', aliases: ['optionb', 'b', 'optb'] },
      { field: 'option_c', aliases: ['optionc', 'c', 'optc'] },
      { field: 'option_d', aliases: ['optiond', 'd', 'optd'] },
      { field: 'option_e', aliases: ['optione', 'e', 'opte'] },
      { field: 'correct_answer', aliases: ['correctanswer', 'answer', 'correct', 'correctoption', 'ans'] },
      { field: 'numerical_answer', aliases: ['numericanswer', 'numericalanswer', 'numeric', 'value'] },
      { field: 'explanation', aliases: ['explanation', 'solution', 'reason'] },
      { field: 'subject_ref', aliases: ['subject', 'subjectname', 'subjectid'] },
      { field: 'chapter_ref', aliases: ['chapter', 'chaptername', 'chapterid'] },
      { field: 'exam_type_ref', aliases: ['examtype', 'exam', 'targetexam'] },
      { field: 'course_ref', aliases: ['course', 'coursename', 'courseid'] },
      { field: 'question_image_url', aliases: ['questionimage', 'image', 'imageurl'] },
      { field: 'passage_text', aliases: ['passage', 'passagetext', 'paragraph'] },
      { field: 'marks', aliases: ['marks', 'mark'] },
      { field: 'negative_marks', aliases: ['negativemarks', 'negative'] },
      { field: 'source', aliases: ['source', 'book', 'reference'] },
      { field: 'year', aliases: ['year'] },
      { field: 'tags', aliases: ['tags', 'keywords'] },
      { field: 'status', aliases: ['status', 'state'] },
    ],
  },
  {
    entity: 'question_options',
    sheets: ['questionoptions', 'question_options', 'options'],
    description: 'Optional explicit option rows (use when options need images or more than five choices).',
    columns: [
      ...idColumns,
      { field: 'question_ref', aliases: ['question', 'questionid', 'question_id'], required: true },
      { field: 'option_key', aliases: ['key', 'option', 'optionkey', 'label'], required: true },
      { field: 'option_text', aliases: ['text', 'optiontext', 'value'] },
      { field: 'option_image_url', aliases: ['image', 'imageurl', 'optionimage'] },
      { field: 'is_correct', aliases: ['iscorrect', 'correct'] },
      { field: 'sort_order', aliases: ['sortorder', 'order', 'position'] },
    ],
  },
  {
    entity: 'answer_keys',
    sheets: ['answerkeys', 'answer_keys', 'keys'],
    description: 'Optional separate answer-key sheet. Overrides inline answers when present.',
    columns: [
      ...idColumns,
      { field: 'question_ref', aliases: ['question', 'questionid', 'question_id'], required: true },
      { field: 'answer_type', aliases: ['answertype', 'type'] },
      { field: 'correct_options', aliases: ['correctoptions', 'answer', 'correctanswer', 'key'] },
      { field: 'numeric_answer', aliases: ['numericanswer', 'numeric', 'value'] },
      { field: 'numeric_tolerance', aliases: ['tolerance', 'numerictolerance'] },
      { field: 'integer_answer', aliases: ['integeranswer', 'integer'] },
    ],
  },
  {
    entity: 'explanations',
    sheets: ['explanations', 'explanation', 'solutions'],
    description: 'Optional separate explanations sheet.',
    columns: [
      ...idColumns,
      { field: 'question_ref', aliases: ['question', 'questionid', 'question_id'], required: true },
      { field: 'explanation_text', aliases: ['explanation', 'text', 'solution'] },
      { field: 'video_url', aliases: ['videourl', 'url', 'video'] },
      { field: 'image_url', aliases: ['image', 'imageurl'] },
    ],
  },
  {
    entity: 'announcements',
    sheets: ['announcements', 'announcement', 'notices'],
    description: 'Student-facing announcements.',
    columns: [
      ...idColumns,
      { field: 'title', aliases: ['title', 'name', 'heading'], required: true },
      { field: 'body', aliases: ['body', 'message', 'content', 'text'], required: true },
      { field: 'image_url', aliases: ['image', 'imageurl'] },
      { field: 'link_url', aliases: ['link', 'url'] },
      { field: 'priority', aliases: ['priority', 'importance'] },
      { field: 'is_pinned', aliases: ['ispinned', 'pinned'] },
      { field: 'target_audience', aliases: ['targetaudience', 'audience', 'target'] },
      { field: 'class_ref', aliases: ['class', 'classname'] },
      { field: 'exam_type_ref', aliases: ['examtype', 'exam'] },
      { field: 'publish_at', aliases: ['publishat', 'publishdate', 'date'] },
      { field: 'expires_at', aliases: ['expiresat', 'expiry', 'expires'] },
      { field: 'status', aliases: ['status', 'state', 'published'] },
    ],
  },
  {
    entity: 'test_papers',
    sheets: ['testpapers', 'test_papers', 'papers', 'pdfs'],
    description: 'PDF test papers (metadata only; the PDF itself lives in storage).',
    columns: [
      ...idColumns,
      { field: 'title', aliases: ['title', 'name', 'paper'], required: true },
      { field: 'description', aliases: ['description', 'desc'] },
      { field: 'file_url', aliases: ['fileurl', 'url', 'link', 'pdf', 'pdfurl'], required: true },
      { field: 'class_ref', aliases: ['class', 'classname'] },
      { field: 'exam_type_ref', aliases: ['examtype', 'exam'] },
      { field: 'subject_ref', aliases: ['subject', 'subjectname'] },
      { field: 'year', aliases: ['year'] },
      { field: 'category', aliases: ['category', 'type'] },
      { field: 'cover_image_url', aliases: ['cover', 'image', 'thumbnail'] },
      { field: 'answer_key_url', aliases: ['answerkeyurl', 'answerkey', 'solutionurl', 'solution'] },
      { field: 'visibility', aliases: ['visibility', 'access'] },
      { field: 'is_free', aliases: ['isfree', 'free'] },
      { field: 'status', aliases: ['status', 'state', 'published'] },
    ],
  },
  {
    entity: 'settings',
    sheets: ['settings', 'config', 'platformsettings'],
    description: 'Optional platform settings overrides (key/value rows).',
    columns: [
      ...idColumns,
      { field: 'key', aliases: ['key', 'name', 'setting'], required: true },
      { field: 'value', aliases: ['value', 'val'] },
      { field: 'category', aliases: ['category', 'group'] },
      { field: 'description', aliases: ['description', 'notes', 'label'] },
      { field: 'is_public', aliases: ['ispublic', 'public'] },
    ],
  },
];

/** Normalises a header cell for fuzzy matching. */
export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export type ColumnMap = {
  /** canonical field → 0-based column index */
  mapping: Record<string, number>;
  /** header text that was matched for each field */
  matchedHeaders: Record<string, string>;
  /** columns present in the sheet that this spec ignores */
  ignoredHeaders: string[];
  missingRequired: string[];
};

export function buildColumnMap(headerRow: string[], spec: SheetSpec): ColumnMap {
  const normalised = headerRow.map((h) => normaliseHeader(String(h ?? '')));
  const mapping: Record<string, number> = {};
  const matchedHeaders: Record<string, string> = {};
  const usedIndexes = new Set<number>();

  for (const column of spec.columns) {
    const candidates = [column.field, ...column.aliases].map(normaliseHeader);
    let found = -1;
    // Exact match first, then startsWith for flexibility ("questiontext" vs "question").
    for (const candidate of candidates) {
      found = normalised.findIndex((h, i) => !usedIndexes.has(i) && h === candidate);
      if (found !== -1) break;
    }
    if (found === -1) {
      for (const candidate of candidates) {
        if (candidate.length < 4) continue;
        found = normalised.findIndex((h, i) => !usedIndexes.has(i) && h.length >= 3 && (h.startsWith(candidate) || candidate.startsWith(h)));
        if (found !== -1) break;
      }
    }
    if (found !== -1) {
      mapping[column.field] = found;
      matchedHeaders[column.field] = String(headerRow[found] ?? '');
      usedIndexes.add(found);
    }
  }

  const ignoredHeaders = headerRow
    .map((h, i) => ({ h: String(h ?? '').trim(), i }))
    .filter(({ h, i }) => h && !usedIndexes.has(i))
    .map(({ h }) => h);

  const missingRequired = spec.columns.filter((c) => c.required && mapping[c.field] === undefined).map((c) => c.field);

  return { mapping, matchedHeaders, ignoredHeaders, missingRequired };
}

export function findSheetSpec(sheetTitle: string): SheetSpec | null {
  const normalised = normaliseHeader(sheetTitle);
  return (
    SHEET_SPECS.find((spec) => spec.sheets.some((name) => normaliseHeader(name) === normalised)) ??
    SHEET_SPECS.find((spec) => spec.sheets.some((name) => normalised.startsWith(normaliseHeader(name)))) ??
    null
  );
}

/** Converts the spreadsheet's loose cell values into typed values. */
export function coerceCell(raw: unknown, field: string): unknown {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;

  if (/^(is_|has_)/.test(field)) {
    const lower = text.toLowerCase();
    if (['true', 'yes', '1', 'y', 'active', 'published', 'enabled', 'on'].includes(lower)) return true;
    if (['false', 'no', '0', 'n', 'inactive', 'draft', 'disabled', 'off'].includes(lower)) return false;
    return null;
  }

  if (['level', 'sort_order', 'weightage', 'estimated_minutes', 'price_inr', 'duration_minutes', 'duration_seconds', 'total_marks', 'marks', 'marks_per_question', 'negative_marks', 'max_attempts', 'passing_percentage', 'max_questions', 'year', 'lecture_number', 'numeric_answer', 'numeric_tolerance', 'integer_answer'].includes(field)) {
    // "1:30" or "90 sec" or "12 min" → minutes/seconds heuristics
    const colon = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
    if (colon) {
      if (field === 'duration_seconds') {
        return Number(colon[1]) * 60 + Number(colon[2]);
      }
      return Number(colon[1]) + Number(colon[2]) / 60;
    }
    const withUnit = /^([\d.]+)\s*(sec|secs|second|seconds|s|min|mins|minute|minutes|m|hr|hrs|hour|hours|h)$/i.exec(text);
    if (withUnit) {
      const value = Number(withUnit[1]);
      const unit = withUnit[2].toLowerCase();
      if (field === 'duration_seconds') {
        if (unit.startsWith('h')) return Math.round(value * 3600);
        if (unit.startsWith('m') && unit !== 'm' && !unit.startsWith('min')) return Math.round(value * 60);
        if (unit.startsWith('m')) return Math.round(value * 60);
        return Math.round(value);
      }
      if (field === 'duration_minutes') {
        if (unit.startsWith('h')) return Math.round(value * 60);
        if (unit.startsWith('s')) return Math.round(value / 60);
        return Math.round(value);
      }
    }
    const num = Number(text.replace(/[₹,\s]/g, ''));
    return Number.isFinite(num) ? num : null;
  }

  return text;
}
