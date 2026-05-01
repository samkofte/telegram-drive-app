type UploadFileInput = {
  uri?: string | null;
  name?: string | null;
  mimeType?: string | null;
};

function normalizeUploadUri(uri: string) {
  const trimmed = uri.trim();

  if (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('ph://') ||
    trimmed.startsWith('assets-library://')
  ) {
    return trimmed;
  }

  return `file://${trimmed}`;
}

function buildFallbackFileName(inputName?: string | null) {
  const trimmedName = inputName?.trim();
  if (trimmedName) {
    return trimmedName;
  }

  return `upload-${Date.now()}.bin`;
}

export function appendUploadFile(formData: FormData, file: UploadFileInput, fieldName = 'file') {
  if (!file.uri?.trim()) {
    throw new Error('Secilen dosya okunamadi.');
  }

  formData.append(fieldName, {
    uri: normalizeUploadUri(file.uri),
    name: buildFallbackFileName(file.name),
    type: file.mimeType?.trim() || 'application/octet-stream',
  } as any);
}
