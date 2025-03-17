import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Provider management functions
export async function createProvider(providerData) {
  const { data, error } = await supabase
    .from('providers')
    .insert([
      {
        provider_id: providerData.id,
        wallet_address: providerData.address,
        allocated_storage: providerData.storage,
        price_per_gb: providerData.price,
        is_active: true,
        total_storage: providerData.totalStorage,
        available_storage: providerData.availableStorage
      }
    ]);

  if (error) throw error;
  return data;
}

export async function updateProviderStorage(providerId, storageData) {
  const { data, error } = await supabase
    .from('providers')
    .update({
      allocated_storage: storageData.allocated,
      available_storage: storageData.available,
      price_per_gb: storageData.price,
      is_active: storageData.is_active !== undefined ? storageData.is_active : true,
      last_updated: new Date().toISOString()
    })
    .eq('provider_id', providerId);

  if (error) throw error;
  return data;
}

export async function getActiveProviders() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .eq('is_active', true)
    .gte('last_updated', fiveMinutesAgo)
    .order('last_updated', { ascending: false });

  if (error) throw error;
  
  // Additional validation to ensure providers are truly active
  const validProviders = data?.filter(provider => 
    provider.allocated_storage > 0 && 
    provider.available_storage > 0 && 
    provider.price_per_gb > 0 && 
    provider.wallet_address
  ) || [];

  return validProviders;
}

// File storage tracking functions
export async function trackFileStorage(fileData) {
  const { data, error } = await supabase
    .from('stored_files')
    .insert([
      {
        cid: fileData.cid,
        provider_id: fileData.providerId,
        client_address: fileData.clientAddress,
        file_size: fileData.fileSize,
        file_name: fileData.fileName,
        encryption_salt: fileData.salt
      }
    ]);

  if (error) throw error;
  return data;
}

export async function getProviderFiles(providerId) {
  const { data, error } = await supabase
    .from('stored_files')
    .select('*')
    .eq('provider_id', providerId);

  if (error) throw error;
  return data;
}