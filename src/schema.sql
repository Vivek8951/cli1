-- Create providers table
CREATE TABLE providers (
    provider_id VARCHAR PRIMARY KEY,
    wallet_address VARCHAR NOT NULL UNIQUE,
    allocated_storage DECIMAL NOT NULL,
    price_per_gb DECIMAL NOT NULL,
    is_active BOOLEAN DEFAULT true,
    total_storage DECIMAL NOT NULL,
    available_storage DECIMAL NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create stored_files table
CREATE TABLE stored_files (
    id SERIAL PRIMARY KEY,
    cid VARCHAR NOT NULL UNIQUE,
    provider_id VARCHAR NOT NULL REFERENCES providers(provider_id),
    client_address VARCHAR NOT NULL,
    file_size DECIMAL NOT NULL,
    file_name VARCHAR NOT NULL,
    encryption_salt VARCHAR NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_provider
        FOREIGN KEY(provider_id)
        REFERENCES providers(provider_id)
        ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX idx_provider_active ON providers(is_active);
CREATE INDEX idx_provider_last_updated ON providers(last_updated);
CREATE INDEX idx_stored_files_provider ON stored_files(provider_id);
CREATE INDEX idx_stored_files_client ON stored_files(client_address);