-- Student Credentials Table
CREATE TABLE IF NOT EXISTS student_credentials (
    id SERIAL PRIMARY KEY,
    student_id UUID NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255),
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP,
    last_login TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Student Refresh Tokens Table
CREATE TABLE IF NOT EXISTS student_refresh_tokens (
    id SERIAL PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES student_credentials(student_id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    device_info JSONB,
    is_revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT fk_student_credentials
        FOREIGN KEY(student_id)
        REFERENCES student_credentials(student_id)
        ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_student_credentials_email ON student_credentials(email);
CREATE INDEX IF NOT EXISTS idx_student_credentials_verification_token ON student_credentials(verification_token);
CREATE INDEX IF NOT EXISTS idx_student_refresh_tokens_token ON student_refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_student_refresh_tokens_student_id ON student_refresh_tokens(student_id);

-- Add trigger for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_student_credentials_updated_at
    BEFORE UPDATE ON student_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();