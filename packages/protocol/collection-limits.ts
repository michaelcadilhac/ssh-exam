export const DEFAULT_COLLECTION_FILE_MIB = 128;
export const DEFAULT_COLLECTION_TOTAL_MIB = 512;
export const MAX_COLLECTION_FILE_MIB = 4096;
export const MAX_COLLECTION_TOTAL_MIB = 16384;

export function collectionSettings(settings: {
  collection_file_mib?: number;
  collection_total_mib?: number;
}) {
  return {
    collection_file_mib:
      settings.collection_file_mib ?? DEFAULT_COLLECTION_FILE_MIB,
    collection_total_mib:
      settings.collection_total_mib ?? DEFAULT_COLLECTION_TOTAL_MIB,
  };
}
