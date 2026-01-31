
CREATE TABLE IF NOT EXISTS public.courses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  trainer_id UUID,
  price NUMERIC(10,2) DEFAULT 0.00,
  published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Optional: a simple index for searching by trainer
CREATE INDEX IF NOT EXISTS idx_courses_trainer_id ON public.courses(trainer_id);