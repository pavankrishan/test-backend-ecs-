/**
 * Course Model - PostgreSQL Schema
 * Stores course metadata, pricing, and basic information
 */

import type { Pool } from 'pg';

export interface Course {
  id: string;
  title: string;
  description: string;
  shortDescription?: string;
  category: string; // Direct category: AI, Robotics, Coding, etc.
  subcategory?: string; // Optional subcategory
  difficulty?: 'beginner' | 'intermediate' | 'advanced'; // Optional difficulty level (NOT curriculum level)
  price: number;
  currency: string;
  discountPrice?: number;
  thumbnailUrl?: string;
  trainerId?: string | null;
  status: 'draft' | 'published' | 'archived';
  isActive: boolean;
  duration?: number; // in minutes
  totalLessons?: number;
  totalStudents?: number;
  rating?: number;
  totalRatings?: number;
  tags?: string[];
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseCreateInput {
  title: string;
  description: string;
  shortDescription?: string;
  category: string; // Direct category: AI, Robotics, Coding, etc.
  subcategory?: string; // Optional subcategory
  difficulty?: 'beginner' | 'intermediate' | 'advanced'; // Optional difficulty level
  price: number;
  currency?: string;
  discountPrice?: number;
  thumbnailUrl?: string;
  trainerId?: string | null;
  duration?: number;
  tags?: string[];
  language?: string;
}

export interface CourseUpdateInput {
  title?: string;
  description?: string;
  shortDescription?: string;
  category?: string;
  subcategory?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced'; // Optional difficulty level
  price?: number;
  currency?: string;
  discountPrice?: number;
  thumbnailUrl?: string;
  status?: 'draft' | 'published' | 'archived';
  isActive?: boolean;
  duration?: number;
  tags?: string[];
  language?: string;
  trainerId?: string | null;
}

export interface CourseFilters {
  category?: string | undefined;
  subcategory?: string | undefined;
  difficulty?: string | undefined; // Filter by difficulty level (not curriculum level)
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  trainerId?: string | undefined;
  status?: string | undefined;
  isActive?: boolean | undefined;
  language?: string | undefined;
  tags?: string[] | undefined;
  search?: string | undefined;
  sortBy?: 'price' | 'rating' | 'createdAt' | 'totalStudents' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/**
 * Create courses table if it doesn't exist
 */
export async function createCoursesTable(pool: Pool): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS courses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      short_description TEXT,
      category VARCHAR(100) NOT NULL,
      subcategory VARCHAR(100),
      difficulty VARCHAR(20) CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
      price DECIMAL(10, 2) NOT NULL,
      currency VARCHAR(3) DEFAULT 'INR',
      discount_price DECIMAL(10, 2),
      thumbnail_url TEXT,
      trainer_id UUID,
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      is_active BOOLEAN DEFAULT true,
      duration INTEGER,
      total_lessons INTEGER DEFAULT 0,
      total_students INTEGER DEFAULT 0,
      rating DECIMAL(3, 2) DEFAULT 0,
      total_ratings INTEGER DEFAULT 0,
      tags TEXT[],
      language VARCHAR(10) DEFAULT 'en',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await pool.query(query);

  // Migration: Rename 'level' column to 'difficulty' if it exists (do this BEFORE creating indexes)
  await pool.query(`
    DO $$
    BEGIN
      -- If 'level' column exists but 'difficulty' doesn't, rename it
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'courses' AND column_name = 'level'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'courses' AND column_name = 'difficulty'
      ) THEN
        ALTER TABLE courses RENAME COLUMN level TO difficulty;
        ALTER TABLE courses ALTER COLUMN difficulty DROP NOT NULL;
      END IF;
      
      -- Ensure difficulty column exists (for new tables or if neither exists)
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'courses' AND column_name = 'difficulty'
      ) THEN
        ALTER TABLE courses ADD COLUMN difficulty VARCHAR(20) CHECK (difficulty IN ('beginner', 'intermediate', 'advanced'));
      END IF;
    END $$;
  `);

  // Now create indexes (after ensuring difficulty column exists)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_courses_trainer_id ON courses(trainer_id);
    CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
    CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
    CREATE INDEX IF NOT EXISTS idx_courses_is_active ON courses(is_active);
    CREATE INDEX IF NOT EXISTS idx_courses_difficulty ON courses(difficulty);
    CREATE INDEX IF NOT EXISTS idx_courses_created_at ON courses(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_courses_price ON courses(price);
    CREATE INDEX IF NOT EXISTS idx_courses_rating ON courses(rating DESC);

    -- Full text search index
    CREATE INDEX IF NOT EXISTS idx_courses_search ON courses USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));
  `);

  // Ensure trainer_id remains nullable if table existed previously
  await pool.query(`
    DO $$
    BEGIN
      -- Drop NOT NULL constraint if it exists
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'courses' AND column_name = 'trainer_id' AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE courses ALTER COLUMN trainer_id DROP NOT NULL;
      END IF;
    END $$;
  `);
}

/**
 * Convert database row to Course object
 */
function rowToCourse(row: any): Course {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    shortDescription: row.short_description,
    category: row.category,
    subcategory: row.subcategory || undefined,
    difficulty: row.difficulty || (row.level ? row.level : undefined), // Support migration from 'level'
    price: parseFloat(row.price),
    currency: row.currency,
    ...(row.discount_price ? { discountPrice: parseFloat(row.discount_price) } : {}),
    thumbnailUrl: row.thumbnail_url,
    trainerId: row.trainer_id || null,
    status: row.status,
    isActive: row.is_active,
    duration: row.duration,
    totalLessons: row.total_lessons,
    totalStudents: row.total_students,
    ...(row.rating ? { rating: parseFloat(row.rating) } : {}),
    totalRatings: row.total_ratings,
    tags: row.tags || [],
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Course Repository
 */
export class CourseRepository {
  constructor(private pool: Pool) {}

  async create(data: CourseCreateInput): Promise<Course> {
    const query = `
      INSERT INTO courses (
        title, description, short_description, category, subcategory,
        difficulty, price, currency, discount_price, thumbnail_url, trainer_id,
        duration, tags, language
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const values = [
      data.title,
      data.description,
      data.shortDescription || null,
      data.category,
      data.subcategory || null,
      data.difficulty || null,
      data.price,
      data.currency || 'INR',
      data.discountPrice || null,
      data.thumbnailUrl || null,
      data.trainerId || null,
      data.duration || null,
      data.tags || [],
      data.language || 'en',
    ];

    const result = await this.pool.query(query, values);
    return rowToCourse(result.rows[0]);
  }

  async findById(id: string): Promise<Course | null> {
    const query = 'SELECT * FROM courses WHERE id = $1';
    const result = await this.pool.query(query, [id]);
    return result.rows.length > 0 ? rowToCourse(result.rows[0]) : null;
  }

  async findMany(filters: CourseFilters = {}): Promise<{ courses: Course[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (filters.category) {
      conditions.push(`category = $${paramCount++}`);
      values.push(filters.category);
    }

    if (filters.subcategory) {
      conditions.push(`subcategory = $${paramCount++}`);
      values.push(filters.subcategory);
    }

    if (filters.difficulty) {
      conditions.push(`difficulty = $${paramCount++}`);
      values.push(filters.difficulty);
    }

    if (filters.minPrice !== undefined) {
      conditions.push(`price >= $${paramCount++}`);
      values.push(filters.minPrice);
    }

    if (filters.maxPrice !== undefined) {
      conditions.push(`price <= $${paramCount++}`);
      values.push(filters.maxPrice);
    }

    if (filters.trainerId) {
      conditions.push(`trainer_id = $${paramCount++}`);
      values.push(filters.trainerId);
    }

    if (filters.status) {
      conditions.push(`status = $${paramCount++}`);
      values.push(filters.status);
    }

    if (filters.isActive !== undefined) {
      conditions.push(`is_active = $${paramCount++}`);
      values.push(filters.isActive);
    }

    if (filters.language) {
      conditions.push(`language = $${paramCount++}`);
      values.push(filters.language);
    }

    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`tags && $${paramCount++}`);
      values.push(filters.tags);
    }

    if (filters.search) {
      conditions.push(`to_tsvector('english', title || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', $${paramCount++})`);
      values.push(filters.search);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countQuery = `SELECT COUNT(*) FROM courses ${whereClause}`;
    const countResult = await this.pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // Build sort clause
    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'desc';
    const sortMap: Record<string, string> = {
      price: 'price',
      rating: 'rating',
      createdAt: 'created_at',
      created_at: 'created_at',
      totalStudents: 'total_students',
      total_students: 'total_students',
    };
    // Only use columns that exist in the sortMap, default to created_at
    const sortColumn = sortMap[sortBy] || 'created_at';
    // Validate sortOrder
    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const orderBy = `ORDER BY ${sortColumn} ${validSortOrder}`;

    // Pagination
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    const limitClause = `LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    values.push(limit, offset);

    const query = `SELECT * FROM courses ${whereClause} ${orderBy} ${limitClause}`;
    const result = await this.pool.query(query, values);

    return {
      courses: result.rows.map(rowToCourse),
      total,
    };
  }

  async update(id: string, data: CourseUpdateInput): Promise<Course | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(data.title);
    }

    if (data.description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(data.description);
    }

    if (data.shortDescription !== undefined) {
      updates.push(`short_description = $${paramCount++}`);
      values.push(data.shortDescription);
    }

    if (data.category !== undefined) {
      updates.push(`category = $${paramCount++}`);
      values.push(data.category);
    }

    if (data.subcategory !== undefined) {
      updates.push(`subcategory = $${paramCount++}`);
      values.push(data.subcategory);
    }

    if (data.difficulty !== undefined) {
      updates.push(`difficulty = $${paramCount++}`);
      values.push(data.difficulty);
    }

    if (data.price !== undefined) {
      updates.push(`price = $${paramCount++}`);
      values.push(data.price);
    }

    if (data.currency !== undefined) {
      updates.push(`currency = $${paramCount++}`);
      values.push(data.currency);
    }

    if (data.discountPrice !== undefined) {
      updates.push(`discount_price = $${paramCount++}`);
      values.push(data.discountPrice);
    }

    if (data.thumbnailUrl !== undefined) {
      updates.push(`thumbnail_url = $${paramCount++}`);
      values.push(data.thumbnailUrl);
    }

    if (data.trainerId !== undefined) {
      updates.push(`trainer_id = $${paramCount++}`);
      values.push(data.trainerId);
    }

    if (data.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(data.status);
    }

    if (data.isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(data.isActive);
    }

    if (data.duration !== undefined) {
      updates.push(`duration = $${paramCount++}`);
      values.push(data.duration);
    }

    if (data.tags !== undefined) {
      updates.push(`tags = $${paramCount++}`);
      values.push(data.tags);
    }

    if (data.language !== undefined) {
      updates.push(`language = $${paramCount++}`);
      values.push(data.language);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE courses
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);
    return result.rows.length > 0 ? rowToCourse(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM courses WHERE id = $1';
    const result = await this.pool.query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async incrementStudents(id: string): Promise<void> {
    const query = 'UPDATE courses SET total_students = total_students + 1 WHERE id = $1';
    await this.pool.query(query, [id]);
  }

  async updateRating(id: string, rating: number, totalRatings: number): Promise<void> {
    const query = 'UPDATE courses SET rating = $1, total_ratings = $2 WHERE id = $3';
    await this.pool.query(query, [rating, totalRatings, id]);
  }
}

