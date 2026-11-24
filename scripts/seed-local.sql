-- =============================================================================
-- PrepSetu — LOCAL DEVELOPMENT DEMO DATA
-- =============================================================================
-- NEVER run this against production. `npm run db:seed:local` only targets the
-- local Miniflare D1 database (`wrangler d1 execute --local`).
--
-- What it creates
--   • 3 classes            (Class 11, Class 12, Dropper)
--   • 4 examination types  (JEE Main, JEE Advanced, NEET, CBSE Board)
--   • 4 published courses with subjects and chapters
--   • 4 lecture series + 8 lectures (real, public YouTube ids)
--   • 2 test series, 3 published exams, 12 questions with answer keys
--   • 2 announcements and 3 demo students
--
-- The IDs are fixed UUIDs so re-running the file is idempotent (INSERT OR
-- IGNORE / ON CONFLICT DO NOTHING) and so `scripts/e2e.mjs` can deep-link.
-- =============================================================================

-- ---------------------------------------------------------------- classes ---
INSERT INTO classes (id, name, slug, level, description, color, sort_order, is_active) VALUES
  ('10000000-0000-4000-8000-000000000011', 'Class 11', 'class-11', 11, 'Foundation year — Physics, Chemistry, Maths and Biology.', '#4f46e5', 1, 1),
  ('10000000-0000-4000-8000-000000000012', 'Class 12', 'class-12', 12, 'Board year + competitive preparation.', '#0ea5e9', 2, 1),
  ('10000000-0000-4000-8000-000000000013', 'Dropper',  'dropper',  0,  'Full-time repeaters preparing for JEE / NEET.', '#8b5cf6', 3, 1)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------- exam types ---
INSERT INTO exam_types (id, name, slug, short_name, description, color, sort_order, is_active) VALUES
  ('20000000-0000-4000-8000-000000000021', 'JEE Main',     'jee-main',     'JEE Main',     'NTA engineering entrance examination.', '#4f46e5', 1, 1),
  ('20000000-0000-4000-8000-000000000022', 'JEE Advanced', 'jee-advanced', 'JEE Advanced', 'IIT admission examination.', '#7c3aed', 2, 1),
  ('20000000-0000-4000-8000-000000000023', 'NEET',         'neet',         'NEET',         'Medical entrance examination.', '#059669', 3, 1),
  ('20000000-0000-4000-8000-000000000024', 'CBSE Board',   'cbse-board',   'CBSE',         'Class 11 and 12 board examinations.', '#f59e0b', 4, 1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- courses ---
INSERT INTO courses (id, name, slug, description, short_description, class_id, exam_type_id, tags, difficulty,
                     price_inr, is_free, is_featured, status, visibility, sort_order) VALUES
  ('30000000-0000-4000-8000-000000000031', 'JEE Main Physics — Class 11', 'jee-main-physics-class-11',
   'Complete Class 11 physics for JEE Main: mechanics, thermodynamics and waves, with chapter tests and mocks.',
   'Mechanics to waves, with chapter tests.', '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000021',
   'physics,mechanics,jee', 'intermediate', 0, 1, 1, 'published', 'public', 1),
  ('30000000-0000-4000-8000-000000000032', 'NEET Biology — Class 12', 'neet-biology-class-12',
   'High-yield Class 12 biology for NEET with NCERT-aligned lectures and full-length mocks.',
   'NCERT-aligned NEET biology.', '10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000023',
   'biology,neet,ncert', 'intermediate', 0, 1, 1, 'published', 'public', 2),
  ('30000000-0000-4000-8000-000000000033', 'JEE Advanced Maths Crash Course', 'jee-advanced-maths-crash',
   'Calculus, algebra and coordinate geometry in an intense revision format for JEE Advanced.',
   'Intense revision for JEE Advanced.', '10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000022',
   'maths,calculus,jee', 'advanced', 0, 1, 0, 'published', 'public', 3),
  ('30000000-0000-4000-8000-000000000034', 'Class 12 Chemistry Board Booster', 'class-12-chemistry-board',
   'Score 95+ in CBSE Class 12 chemistry with theory revision, diagrams and previous-year solutions.',
   'CBSE Class 12 chemistry revision.', '10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000024',
   'chemistry,board,cbse', 'beginner', 0, 1, 0, 'published', 'public', 4)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------- subjects ---
INSERT INTO subjects (id, course_id, name, slug, sort_order, is_active) VALUES
  ('40000000-0000-4000-8000-000000000041', '30000000-0000-4000-8000-000000000031', 'Mechanics',           'mechanics',           1, 1),
  ('40000000-0000-4000-8000-000000000042', '30000000-0000-4000-8000-000000000031', 'Thermodynamics',      'thermodynamics',      2, 1),
  ('40000000-0000-4000-8000-000000000043', '30000000-0000-4000-8000-000000000032', 'Genetics & Evolution','genetics-evolution',  1, 1),
  ('40000000-0000-4000-8000-000000000044', '30000000-0000-4000-8000-000000000033', 'Calculus',            'calculus',            1, 1),
  ('40000000-0000-4000-8000-000000000045', '30000000-0000-4000-8000-000000000034', 'Physical Chemistry',  'physical-chemistry',  1, 1)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------- chapters ---
INSERT INTO chapters (id, subject_id, course_id, name, slug, weightage, estimated_minutes, sort_order, is_active) VALUES
  ('50000000-0000-4000-8000-000000000051', '40000000-0000-4000-8000-000000000041', '30000000-0000-4000-8000-000000000031', 'Laws of Motion',        'laws-of-motion',        9, 95,  1, 1),
  ('50000000-0000-4000-8000-000000000052', '40000000-0000-4000-8000-000000000041', '30000000-0000-4000-8000-000000000031', 'Work, Energy & Power',  'work-energy-power',     8, 85,  2, 1),
  ('50000000-0000-4000-8000-000000000053', '40000000-0000-4000-8000-000000000042', '30000000-0000-4000-8000-000000000031', 'Thermodynamic Processes','thermo-processes',     7, 80,  1, 1),
  ('50000000-0000-4000-8000-000000000054', '40000000-0000-4000-8000-000000000043', '30000000-0000-4000-8000-000000000032', 'Principles of Inheritance','inheritance-principles', 11, 120, 1, 1),
  ('50000000-0000-4000-8000-000000000055', '40000000-0000-4000-8000-000000000043', '30000000-0000-4000-8000-000000000032', 'Molecular Basis of Inheritance','molecular-inheritance', 10, 110, 2, 1),
  ('50000000-0000-4000-8000-000000000056', '40000000-0000-4000-8000-000000000044', '30000000-0000-4000-8000-000000000033', 'Definite Integrals',    'definite-integrals',   10, 100, 1, 1),
  ('50000000-0000-4000-8000-000000000057', '40000000-0000-4000-8000-000000000045', '30000000-0000-4000-8000-000000000034', 'Electrochemistry',      'electrochemistry',      8, 90,  1, 1)
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------- lecture series ---
INSERT INTO lecture_series (id, course_id, chapter_id, subject_id, title, slug, description, status, sort_order) VALUES
  ('60000000-0000-4000-8000-000000000061', '30000000-0000-4000-8000-000000000031', '50000000-0000-4000-8000-000000000051', '40000000-0000-4000-8000-000000000041',
   'Newton''s Laws — Complete Playlist', 'newtons-laws-complete', 'Eight-lecture deep dive into Newton''s laws with solved JEE questions.', 'published', 1),
  ('60000000-0000-4000-8000-000000000062', '30000000-0000-4000-8000-000000000032', '50000000-0000-4000-8000-000000000054', '40000000-0000-4000-8000-000000000043',
   'Genetics Masterclass', 'genetics-masterclass', 'Mendelian genetics through to linkage and pedigree analysis for NEET.', 'published', 2),
  ('60000000-0000-4000-8000-000000000063', '30000000-0000-4000-8000-000000000033', '50000000-0000-4000-8000-000000000056', '40000000-0000-4000-8000-000000000044',
   'Integration Techniques', 'integration-techniques', 'Substitution, by parts and partial fractions with JEE Advanced patterns.', 'published', 3),
  ('60000000-0000-4000-8000-000000000064', '30000000-0000-4000-8000-000000000034', '50000000-0000-4000-8000-000000000057', '40000000-0000-4000-8000-000000000045',
   'Electrochemistry for Boards', 'electrochemistry-boards', 'Nernst equation, conductance and batteries for CBSE Class 12.', 'published', 4)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------- lectures ---
-- Public, embeddable YouTube ids (Khan Academy / NCERT-style explainers).
INSERT INTO lectures (id, course_id, subject_id, chapter_id, series_id, title, description, youtube_video_id, youtube_url,
                      thumbnail_url, channel_name, duration_seconds, published_at, lecture_number, language, tags,
                      is_free, status, visibility, sort_order, view_count) VALUES
  ('70000000-0000-4000-8000-000000000071', '30000000-0000-4000-8000-000000000031', '40000000-0000-4000-8000-000000000041', '50000000-0000-4000-8000-000000000051', '60000000-0000-4000-8000-000000000061',
   'Newton''s First Law — Intuition', 'Why an object keeps doing what it is doing, and how inertia shows up in JEE questions.',
   'kKKM8Y-u7ds', 'https://www.youtube.com/watch?v=kKKM8Y-u7ds', 'https://i.ytimg.com/vi/kKKM8Y-u7ds/hqdefault.jpg', 'Khan Academy', 1080,
   '2026-01-10T09:00:00.000Z', 1, 'en', 'physics,newton,inertia', 1, 'published', 'public', 1, 1240),
  ('70000000-0000-4000-8000-000000000072', '30000000-0000-4000-8000-000000000031', '40000000-0000-4000-8000-000000000041', '50000000-0000-4000-8000-000000000051', '60000000-0000-4000-8000-000000000061',
   'Newton''s Second Law — F = ma in action', 'Free-body diagrams and multi-body problems where the system accelerates together.',
   '3uCiRNVLBzE', 'https://www.youtube.com/watch?v=3uCiRNVLBzE', 'https://i.ytimg.com/vi/3uCiRNVLBzE/hqdefault.jpg', 'Khan Academy', 1320,
   '2026-01-12T09:00:00.000Z', 2, 'en', 'physics,newton,free-body', 1, 'published', 'public', 2, 980),
  ('70000000-0000-4000-8000-000000000073', '30000000-0000-4000-8000-000000000031', '40000000-0000-4000-8000-000000000041', '50000000-0000-4000-8000-000000000052', '60000000-0000-4000-8000-000000000061',
   'Work-Energy Theorem Explained', 'The fastest route from a messy force diagram to a clean energy equation.',
   'kw_4Loo1HR4', 'https://www.youtube.com/watch?v=kw_4Loo1HR4', 'https://i.ytimg.com/vi/kw_4Loo1HR4/hqdefault.jpg', 'Khan Academy', 960,
   '2026-01-15T09:00:00.000Z', 3, 'en', 'physics,work,energy', 0, 'published', 'public', 3, 760),
  ('70000000-0000-4000-8000-000000000074', '30000000-0000-4000-8000-000000000031', '40000000-0000-4000-8000-000000000042', '50000000-0000-4000-8000-000000000053', '60000000-0000-4000-8000-000000000061',
   'First Law of Thermodynamics', 'Internal energy, heat and work with sign conventions that match JEE marking schemes.',
   'NyOaOZuBBlQ', 'https://www.youtube.com/watch?v=NyOaOZuBBlQ', 'https://i.ytimg.com/vi/NyOaOZuBBlQ/hqdefault.jpg', 'Khan Academy', 1200,
   '2026-01-18T09:00:00.000Z', 4, 'en', 'physics,thermodynamics', 0, 'published', 'public', 4, 640),
  ('70000000-0000-4000-8000-000000000075', '30000000-0000-4000-8000-000000000032', '40000000-0000-4000-8000-000000000043', '50000000-0000-4000-8000-000000000054', '60000000-0000-4000-8000-000000000062',
   'Mendel''s Laws of Inheritance', 'Dominance, segregation and independent assortment with worked Punnett squares.',
   'c7K5k6BQ5nw', 'https://www.youtube.com/watch?v=c7K5k6BQ5nw', 'https://i.ytimg.com/vi/c7K5k6BQ5nw/hqdefault.jpg', 'Khan Academy', 1140,
   '2026-02-02T09:00:00.000Z', 1, 'en', 'biology,genetics,mendel', 1, 'published', 'public', 1, 1580),
  ('70000000-0000-4000-8000-000000000076', '30000000-0000-4000-8000-000000000032', '40000000-0000-4000-8000-000000000043', '50000000-0000-4000-8000-000000000055', '60000000-0000-4000-8000-000000000062',
   'DNA Replication — NEET Essentials', 'Semi-conservative replication, enzymes and the experiments that proved the mechanism.',
   'TNKY8D2R2z0', 'https://www.youtube.com/watch?v=TNKY8D2R2z0', 'https://i.ytimg.com/vi/TNKY8D2R2z0/hqdefault.jpg', 'Khan Academy', 1260,
   '2026-02-05T09:00:00.000Z', 2, 'en', 'biology,dna,replication', 1, 'published', 'public', 2, 1120),
  ('70000000-0000-4000-8000-000000000077', '30000000-0000-4000-8000-000000000033', '40000000-0000-4000-8000-000000000044', '50000000-0000-4000-8000-000000000056', '60000000-0000-4000-8000-000000000063',
   'Definite Integrals — Properties That Save Time', 'Symmetry, periodicity and substitution tricks for JEE Advanced.',
   'Q7D1Xf9YbRk', 'https://www.youtube.com/watch?v=Q7D1Xf9YbRk', 'https://i.ytimg.com/vi/Q7D1Xf9YbRk/hqdefault.jpg', 'Khan Academy', 1500,
   '2026-03-01T09:00:00.000Z', 1, 'en', 'maths,integration,calculus', 0, 'published', 'public', 1, 890),
  ('70000000-0000-4000-8000-000000000078', '30000000-0000-4000-8000-000000000034', '40000000-0000-4000-8000-000000000045', '50000000-0000-4000-8000-000000000057', '60000000-0000-4000-8000-000000000064',
   'Electrochemistry — Nernst Equation', 'Cell potentials, concentration effects and board-style numericals.',
   'x4d0FZ2tR0Y', 'https://www.youtube.com/watch?v=x4d0FZ2tR0Y', 'https://i.ytimg.com/vi/x4d0FZ2tR0Y/hqdefault.jpg', 'Khan Academy', 1020,
   '2026-03-08T09:00:00.000Z', 1, 'en', 'chemistry,electrochemistry,boards', 1, 'published', 'public', 1, 540)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ test series ---
INSERT INTO test_series (id, name, slug, description, course_id, exam_type_id, is_free, status, sort_order) VALUES
  ('80000000-0000-4000-8000-000000000081', 'JEE Main 2026 Full Mocks', 'jee-main-2026-full-mocks',
   'Ten full-length mocks on the real JEE Main pattern with ranks and percentiles.',
   '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021', 1, 'published', 1),
  ('80000000-0000-4000-8000-000000000082', 'NEET 2026 Biology Tests', 'neet-2026-biology-tests',
   'Chapter and full-length biology tests aligned to the NEET blueprint.',
   '30000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000023', 1, 'published', 2)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ exams ---
INSERT INTO exams (id, test_series_id, title, slug, description, instructions, exam_kind, course_id, exam_type_id,
                   subject_id, chapter_id, duration_minutes, marks_per_question, negative_marks, negative_marking_enabled,
                   shuffle_questions, shuffle_options, allow_section_navigation, max_attempts, result_publish_mode,
                   passing_percentage, rank_enabled, is_free, status) VALUES
  ('90000000-0000-4000-8000-000000000091', '80000000-0000-4000-8000-000000000081', 'JEE Main Full Mock 1 — Physics', 'jee-main-full-mock-1-physics',
   'Full-length physics section on the JEE Main pattern.',
   'The timer starts on the server when the attempt begins. Answers autosave every few seconds; submit before the deadline.',
   'full_mock', '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021',
   '40000000-0000-4000-8000-000000000041', NULL, 45, 4, 1, 1, 0, 0, 1, 3, 'immediate', 40, 1, 1, 'published'),
  ('90000000-0000-4000-8000-000000000092', '80000000-0000-4000-8000-000000000082', 'NEET Biology — Genetics Chapter Test', 'neet-biology-genetics-chapter',
   'Chapter test on inheritance and the molecular basis of inheritance.',
   'Twenty questions in thirty minutes. Negative marking applies.',
   'chapter', '30000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000023',
   '40000000-0000-4000-8000-000000000043', '50000000-0000-4000-8000-000000000054', 30, 4, 1, 1, 1, 1, 0, 2, 'immediate', 50, 1, 1, 'published'),
  ('90000000-0000-4000-8000-000000000093', NULL, 'Calculus Practice — Definite Integrals', 'calculus-practice-definite-integrals',
   'Short practice set on definite integrals and their properties.',
   'No negative marking. Retake as often as you like.',
   'practice', '30000000-0000-4000-8000-000000000033', '20000000-0000-4000-8000-000000000022',
   '40000000-0000-4000-8000-000000000044', '50000000-0000-4000-8000-000000000056', 20, 4, 0, 0, 1, 1, 1, 10, 'immediate', 30, 0, 1, 'published')
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------- questions ---
INSERT INTO questions (id, subject_id, chapter_id, course_id, exam_type_id, question_type, difficulty, question_text,
                       marks, negative_marks, source, year, status) VALUES
  ('a0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000041', '50000000-0000-4000-8000-000000000051', '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021',
   'single_correct', 'easy', 'A body of mass 2 kg is pushed with a constant force of 10 N on a frictionless surface. What is its acceleration?', 4, 1, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000041', '50000000-0000-4000-8000-000000000051', '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021',
   'single_correct', 'medium', 'A block slides down a 30° incline without friction. Taking g = 10 m/s², its acceleration along the incline is closest to:', 4, 1, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000041', '50000000-0000-4000-8000-000000000052', '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021',
   'single_correct', 'medium', 'A 1 kg ball is dropped from 5 m. Taking g = 10 m/s² and ignoring air resistance, its kinetic energy just before impact is:', 4, 1, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000042', '50000000-0000-4000-8000-000000000053', '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021',
   'single_correct', 'hard', 'In an isothermal reversible expansion of an ideal gas, which quantity is zero?', 4, 1, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000043', '50000000-0000-4000-8000-000000000054', '30000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000023',
   'single_correct', 'easy', 'In a monohybrid cross between two heterozygous tall plants (Tt × Tt), the expected phenotypic ratio is:', 4, 1, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000043', '50000000-0000-4000-8000-000000000055', '30000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000023',
   'single_correct', 'medium', 'Which enzyme unwinds the DNA double helix during replication?', 4, 1, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000044', '50000000-0000-4000-8000-000000000056', '30000000-0000-4000-8000-000000000033', '20000000-0000-4000-8000-000000000022',
   'single_correct', 'medium', 'Evaluate the definite integral ∫₀¹ 2x dx.', 4, 0, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000044', '50000000-0000-4000-8000-000000000056', '30000000-0000-4000-8000-000000000033', '20000000-0000-4000-8000-000000000022',
   'single_correct', 'hard', 'If ∫₀ᵃ x² dx = 9 for a > 0, then a equals:', 4, 0, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-000000000009', '40000000-0000-4000-8000-000000000045', '50000000-0000-4000-8000-000000000057', '30000000-0000-4000-8000-000000000034', '20000000-0000-4000-8000-000000000024',
   'numerical', 'medium', 'The oxidation state of chromium in K₂Cr₂O₇ is:', 4, 0, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000041', '50000000-0000-4000-8000-000000000051', '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021',
   'integer', 'easy', 'How many fundamental SI base units are there?', 4, 0, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-000000000043', '50000000-0000-4000-8000-000000000054', '30000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000023',
   'multiple_correct', 'hard', 'Which of the following are components of a nucleotide? (Select all that apply.)', 4, 1, 'Demo set', 2026, 'published'),
  ('a0000000-0000-4000-8000-00000000000c', '40000000-0000-4000-8000-000000000042', '50000000-0000-4000-8000-000000000053', '30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000021',
   'single_correct', 'medium', 'The SI unit of the universal gas constant R is:', 4, 1, 'Demo set', 2026, 'published')
ON CONFLICT (id) DO NOTHING;

-- Options (MCQ questions only).
INSERT INTO question_options (id, question_id, option_key, option_text, is_correct, sort_order) VALUES
  ('b0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000001', 'A', '2 m/s²',  0, 0),
  ('b0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000001', 'B', '5 m/s²',  1, 1),
  ('b0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000001', 'C', '10 m/s²', 0, 2),
  ('b0000000-0000-4000-8000-000000000104', 'a0000000-0000-4000-8000-000000000001', 'D', '20 m/s²', 0, 3),

  ('b0000000-0000-4000-8000-000000000105', 'a0000000-0000-4000-8000-000000000002', 'A', '5.0 m/s²', 1, 0),
  ('b0000000-0000-4000-8000-000000000106', 'a0000000-0000-4000-8000-000000000002', 'B', '8.7 m/s²', 0, 1),
  ('b0000000-0000-4000-8000-000000000107', 'a0000000-0000-4000-8000-000000000002', 'C', '10 m/s²', 0, 2),
  ('b0000000-0000-4000-8000-000000000108', 'a0000000-0000-4000-8000-000000000002', 'D', '0 m/s²',  0, 3),

  ('b0000000-0000-4000-8000-000000000109', 'a0000000-0000-4000-8000-000000000003', 'A', '25 J', 0, 0),
  ('b0000000-0000-4000-8000-00000000010a', 'a0000000-0000-4000-8000-000000000003', 'B', '50 J', 1, 1),
  ('b0000000-0000-4000-8000-00000000010b', 'a0000000-0000-4000-8000-000000000003', 'C', '75 J', 0, 2),
  ('b0000000-0000-4000-8000-00000000010c', 'a0000000-0000-4000-8000-000000000003', 'D', '100 J', 0, 3),

  ('b0000000-0000-4000-8000-00000000010d', 'a0000000-0000-4000-8000-000000000004', 'A', 'Change in internal energy', 1, 0),
  ('b0000000-0000-4000-8000-00000000010e', 'a0000000-0000-4000-8000-000000000004', 'B', 'Work done by the gas', 0, 1),
  ('b0000000-0000-4000-8000-00000000010f', 'a0000000-0000-4000-8000-000000000004', 'C', 'Heat absorbed', 0, 2),
  ('b0000000-0000-4000-8000-000000000110', 'a0000000-0000-4000-8000-000000000004', 'D', 'Enthalpy change', 0, 3),

  ('b0000000-0000-4000-8000-000000000111', 'a0000000-0000-4000-8000-000000000005', 'A', '1 : 1', 0, 0),
  ('b0000000-0000-4000-8000-000000000112', 'a0000000-0000-4000-8000-000000000005', 'B', '3 : 1', 1, 1),
  ('b0000000-0000-4000-8000-000000000113', 'a0000000-0000-4000-8000-000000000005', 'C', '1 : 3', 0, 2),
  ('b0000000-0000-4000-8000-000000000114', 'a0000000-0000-4000-8000-000000000005', 'D', '9 : 1', 0, 3),

  ('b0000000-0000-4000-8000-000000000115', 'a0000000-0000-4000-8000-000000000006', 'A', 'Ligase',   0, 0),
  ('b0000000-0000-4000-8000-000000000116', 'a0000000-0000-4000-8000-000000000006', 'B', 'Helicase', 1, 1),
  ('b0000000-0000-4000-8000-000000000117', 'a0000000-0000-4000-8000-000000000006', 'C', 'Primase',  0, 2),
  ('b0000000-0000-4000-8000-000000000118', 'a0000000-0000-4000-8000-000000000006', 'D', 'Exonuclease', 0, 3),

  ('b0000000-0000-4000-8000-000000000119', 'a0000000-0000-4000-8000-000000000007', 'A', '0', 0, 0),
  ('b0000000-0000-4000-8000-00000000011a', 'a0000000-0000-4000-8000-000000000007', 'B', '1', 1, 1),
  ('b0000000-0000-4000-8000-00000000011b', 'a0000000-0000-4000-8000-000000000007', 'C', '2', 0, 2),
  ('b0000000-0000-4000-8000-00000000011c', 'a0000000-0000-4000-8000-000000000007', 'D', '1/2', 0, 3),

  ('b0000000-0000-4000-8000-00000000011d', 'a0000000-0000-4000-8000-000000000008', 'A', '2',   0, 0),
  ('b0000000-0000-4000-8000-00000000011e', 'a0000000-0000-4000-8000-000000000008', 'B', '3',   1, 1),
  ('b0000000-0000-4000-8000-00000000011f', 'a0000000-0000-4000-8000-000000000008', 'C', '3/2', 0, 2),
  ('b0000000-0000-4000-8000-000000000120', 'a0000000-0000-4000-8000-000000000008', 'D', '9',   0, 3),

  ('b0000000-0000-4000-8000-000000000121', 'a0000000-0000-4000-8000-00000000000b', 'A', 'A phosphate group', 1, 0),
  ('b0000000-0000-4000-8000-000000000122', 'a0000000-0000-4000-8000-00000000000b', 'B', 'A pentose sugar',   1, 1),
  ('b0000000-0000-4000-8000-000000000123', 'a0000000-0000-4000-8000-00000000000b', 'C', 'A nitrogenous base',1, 2),
  ('b0000000-0000-4000-8000-000000000124', 'a0000000-0000-4000-8000-00000000000b', 'D', 'An amino acid',     0, 3),

  ('b0000000-0000-4000-8000-000000000125', 'a0000000-0000-4000-8000-00000000000c', 'A', 'J/mol', 0, 0),
  ('b0000000-0000-4000-8000-000000000126', 'a0000000-0000-4000-8000-00000000000c', 'B', 'J/(mol·K)', 1, 1),
  ('b0000000-0000-4000-8000-000000000127', 'a0000000-0000-4000-8000-00000000000c', 'C', 'L·atm', 0, 2),
  ('b0000000-0000-4000-8000-000000000128', 'a0000000-0000-4000-8000-00000000000c', 'D', 'K/mol', 0, 3)
ON CONFLICT (id) DO NOTHING;

-- Answer keys.
INSERT INTO answer_keys (id, question_id, answer_type, correct_options, numeric_answer, numeric_tolerance, integer_answer) VALUES
  ('c0000000-0000-4000-8000-000000000131', 'a0000000-0000-4000-8000-000000000001', 'single',   '["B"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000132', 'a0000000-0000-4000-8000-000000000002', 'single',   '["A"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000133', 'a0000000-0000-4000-8000-000000000003', 'single',   '["B"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000134', 'a0000000-0000-4000-8000-000000000004', 'single',   '["A"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000135', 'a0000000-0000-4000-8000-000000000005', 'single',   '["B"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000136', 'a0000000-0000-4000-8000-000000000006', 'single',   '["B"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000137', 'a0000000-0000-4000-8000-000000000007', 'single',   '["B"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000138', 'a0000000-0000-4000-8000-000000000008', 'single',   '["B"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-000000000139', 'a0000000-0000-4000-8000-000000000009', 'numeric',  NULL, 6, 0.01, NULL),
  ('c0000000-0000-4000-8000-00000000013a', 'a0000000-0000-4000-8000-00000000000a', 'integer',  NULL, NULL, 0, 7),
  ('c0000000-0000-4000-8000-00000000013b', 'a0000000-0000-4000-8000-00000000000b', 'multiple', '["A","B","C"]', NULL, 0, NULL),
  ('c0000000-0000-4000-8000-00000000013c', 'a0000000-0000-4000-8000-00000000000c', 'single',   '["B"]', NULL, 0, NULL)
ON CONFLICT (id) DO NOTHING;

-- Explanations.
INSERT INTO explanations (id, question_id, explanation_text) VALUES
  ('d0000000-0000-4000-8000-000000000141', 'a0000000-0000-4000-8000-000000000001', 'a = F/m = 10/2 = 5 m/s².'),
  ('d0000000-0000-4000-8000-000000000142', 'a0000000-0000-4000-8000-000000000002', 'a = g·sin30° = 10 × 0.5 = 5 m/s².'),
  ('d0000000-0000-4000-8000-000000000143', 'a0000000-0000-4000-8000-000000000003', 'KE = mgh = 1 × 10 × 5 = 50 J.'),
  ('d0000000-0000-4000-8000-000000000144', 'a0000000-0000-4000-8000-000000000004', 'Isothermal means ΔT = 0, so ΔU = 0 for an ideal gas.'),
  ('d0000000-0000-4000-8000-000000000145', 'a0000000-0000-4000-8000-000000000005', 'Tt × Tt gives 3 tall : 1 short.'),
  ('d0000000-0000-4000-8000-000000000146', 'a0000000-0000-4000-8000-000000000006', 'Helicase separates the two strands at the replication fork.'),
  ('d0000000-0000-4000-8000-000000000147', 'a0000000-0000-4000-8000-000000000007', '∫₀¹ 2x dx = [x²]₀¹ = 1.'),
  ('d0000000-0000-4000-8000-000000000148', 'a0000000-0000-4000-8000-000000000008', '∫₀ᵃ x² dx = a³/3 = 9 → a³ = 27 → a = 3.'),
  ('d0000000-0000-4000-8000-000000000149', 'a0000000-0000-4000-8000-000000000009', '2(+1) + 2x + 7(−2) = 0 → 2x = 12 → x = +6.'),
  ('d0000000-0000-4000-8000-00000000014a', 'a0000000-0000-4000-8000-00000000000a', 'Metre, kilogram, second, ampere, kelvin, mole and candela — seven base units.'),
  ('d0000000-0000-4000-8000-00000000014b', 'a0000000-0000-4000-8000-00000000000b', 'A nucleotide is a phosphate group, a pentose sugar and a nitrogenous base.'),
  ('d0000000-0000-4000-8000-00000000014c', 'a0000000-0000-4000-8000-00000000000c', 'R = 8.314 J/(mol·K).')
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------- exam questions ---
-- Exam 1: six physics questions. Exam 2: four biology questions.
-- Exam 3: two calculus questions.
INSERT INTO exam_questions (id, exam_id, section_id, question_id, marks, negative_marks, sort_order) VALUES
  ('e0000000-0000-4000-8000-000000000151', '90000000-0000-4000-8000-000000000091', NULL, 'a0000000-0000-4000-8000-000000000001', 4, 1, 0),
  ('e0000000-0000-4000-8000-000000000152', '90000000-0000-4000-8000-000000000091', NULL, 'a0000000-0000-4000-8000-000000000002', 4, 1, 1),
  ('e0000000-0000-4000-8000-000000000153', '90000000-0000-4000-8000-000000000091', NULL, 'a0000000-0000-4000-8000-000000000003', 4, 1, 2),
  ('e0000000-0000-4000-8000-000000000154', '90000000-0000-4000-8000-000000000091', NULL, 'a0000000-0000-4000-8000-000000000004', 4, 1, 3),
  ('e0000000-0000-4000-8000-000000000155', '90000000-0000-4000-8000-000000000091', NULL, 'a0000000-0000-4000-8000-00000000000a', 4, 1, 4),
  ('e0000000-0000-4000-8000-000000000156', '90000000-0000-4000-8000-000000000091', NULL, 'a0000000-0000-4000-8000-00000000000c', 4, 1, 5),

  ('e0000000-0000-4000-8000-000000000157', '90000000-0000-4000-8000-000000000092', NULL, 'a0000000-0000-4000-8000-000000000005', 4, 1, 0),
  ('e0000000-0000-4000-8000-000000000158', '90000000-0000-4000-8000-000000000092', NULL, 'a0000000-0000-4000-8000-000000000006', 4, 1, 1),
  ('e0000000-0000-4000-8000-000000000159', '90000000-0000-4000-8000-000000000092', NULL, 'a0000000-0000-4000-8000-00000000000b', 4, 1, 2),
  ('e0000000-0000-4000-8000-00000000015a', '90000000-0000-4000-8000-000000000092', NULL, 'a0000000-0000-4000-8000-000000000009', 4, 1, 3),

  ('e0000000-0000-4000-8000-00000000015b', '90000000-0000-4000-8000-000000000093', NULL, 'a0000000-0000-4000-8000-000000000007', 4, 0, 0),
  ('e0000000-0000-4000-8000-00000000015c', '90000000-0000-4000-8000-000000000093', NULL, 'a0000000-0000-4000-8000-000000000008', 4, 0, 1)
ON CONFLICT (id) DO NOTHING;

-- Keep the denormalised totals in sync with the rows above.
UPDATE exams SET
  total_questions = (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = exams.id),
  total_marks     = (SELECT COALESCE(SUM(eq.marks), 0) FROM exam_questions eq WHERE eq.exam_id = exams.id)
WHERE id IN (
  '90000000-0000-4000-8000-000000000091',
  '90000000-0000-4000-8000-000000000092',
  '90000000-0000-4000-8000-000000000093'
);

-- ----------------------------------------------------------- announcements ---
INSERT INTO announcements (id, title, body, link_url, target_audience, priority, is_pinned, status, publish_at, created_by) VALUES
  ('f0000000-0000-4000-8000-000000000161', 'JEE Main 2026 mock series is live',
   'Ten full-length mocks with server-timed attempts, negative marking and percentile ranking. Start with Full Mock 1 — Physics.',
   '/tests', 'all', 'high', 1, 'published', '2026-11-01T06:00:00.000Z', NULL),
  ('f0000000-0000-4000-8000-000000000162', 'New NEET biology masterclass',
   'Genetics and molecular inheritance are now covered end-to-end with chapter tests and explanations.',
   '/courses/30000000-0000-4000-8000-000000000032', 'all', 'normal', 0, 'published', '2026-11-10T06:00:00.000Z', NULL)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ demo users ---
-- These accounts are promoted on first dev-login by the server (the profile and
-- role assignment happen in `POST /api/auth/dev-login`). The rows below only
-- pre-create the extra students so the admin student list is not empty.
INSERT INTO users (id, email, display_name, email_verified, auth_provider, status, last_login_at) VALUES
  ('f1000000-0000-4000-8000-000000000171', 'aarav.sharma@prepsetu.test',  'Aarav Sharma', 1, 'dev', 'active', '2026-11-20T10:15:00.000Z'),
  ('f1000000-0000-4000-8000-000000000172', 'diya.patel@prepsetu.test',    'Diya Patel',   1, 'dev', 'active', '2026-11-22T18:40:00.000Z'),
  ('f1000000-0000-4000-8000-000000000173', 'kabir.singh@prepsetu.test',   'Kabir Singh',  0, 'dev', 'active', '2026-11-19T07:05:00.000Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (user_id, full_name, class_id, target_exam_type_id, study_goal_minutes, onboarding_completed, streak_days, last_active_at) VALUES
  ('f1000000-0000-4000-8000-000000000171', 'Aarav Sharma', '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000021', 120, 1, 6,  '2026-11-20T10:15:00.000Z'),
  ('f1000000-0000-4000-8000-000000000172', 'Diya Patel',   '10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000023', 90,  1, 12, '2026-11-22T18:40:00.000Z'),
  ('f1000000-0000-4000-8000-000000000173', 'Kabir Singh',  '10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000022', 60,  1, 2,  '2026-11-19T07:05:00.000Z')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.key = 'student'
WHERE u.id IN (
  'f1000000-0000-4000-8000-000000000171',
  'f1000000-0000-4000-8000-000000000172',
  'f1000000-0000-4000-8000-000000000173'
)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ---------------------------------------------------------------- progress ---
INSERT INTO lecture_progress (id, user_id, lecture_id, watched_seconds, duration_seconds, percent, completed, last_position, created_at, updated_at) VALUES
  ('f2000000-0000-4000-8000-000000000181', 'f1000000-0000-4000-8000-000000000171', '70000000-0000-4000-8000-000000000071', 1080, 1080, 100, 1, 1080, '2026-11-18T09:00:00.000Z', '2026-11-20T09:30:00.000Z'),
  ('f2000000-0000-4000-8000-000000000182', 'f1000000-0000-4000-8000-000000000171', '70000000-0000-4000-8000-000000000072', 620,  1320, 47,  0, 620,  '2026-11-20T10:00:00.000Z', '2026-11-20T10:15:00.000Z'),
  ('f2000000-0000-4000-8000-000000000183', 'f1000000-0000-4000-8000-000000000172', '70000000-0000-4000-8000-000000000075', 1140, 1140, 100, 1, 1140, '2026-11-21T17:00:00.000Z', '2026-11-22T18:40:00.000Z'),
  ('f2000000-0000-4000-8000-000000000184', 'f1000000-0000-4000-8000-000000000173', '70000000-0000-4000-8000-000000000077', 300,  1500, 20,  0, 300,  '2026-11-19T07:00:00.000Z', '2026-11-19T07:05:00.000Z')
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------- bookmarks ---
INSERT INTO bookmarks (id, user_id, item_type, item_id, created_at) VALUES
  ('f3000000-0000-4000-8000-000000000191', 'f1000000-0000-4000-8000-000000000171', 'lecture', '70000000-0000-4000-8000-000000000073', '2026-11-20T11:00:00.000Z'),
  ('f3000000-0000-4000-8000-000000000192', 'f1000000-0000-4000-8000-000000000172', 'exam',    '90000000-0000-4000-8000-000000000092', '2026-11-22T19:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------- done ---
SELECT 'seed complete' AS status,
       (SELECT COUNT(*) FROM courses)  AS courses,
       (SELECT COUNT(*) FROM lectures) AS lectures,
       (SELECT COUNT(*) FROM questions) AS questions,
       (SELECT COUNT(*) FROM exams)    AS exams;
