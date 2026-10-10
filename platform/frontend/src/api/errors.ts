import { ApiError, isApiError } from './client';

// Only business-rule messages are translated. Validation messages (zod,
// class-validator) are shown as the backend sends them, under a Turkish title.
const BUSINESS_MESSAGES: Array<[RegExp, string]> = [
  [/^Invalid username or password$/i, 'Kullanıcı adı veya parola hatalı.'],
  [
    /^The last admin cannot be removed or demoted$/i,
    'Son yönetici silinemez veya rolü düşürülemez.',
  ],
  [/^You cannot delete your own account$/i, 'Kendi hesabınızı silemezsiniz.'],
  [/^Username already exists$/i, 'Bu kullanıcı adı zaten kullanılıyor.'],
  [
    /^A device with this name already exists$/i,
    'Bu isimde bir cihaz zaten var.',
  ],
  [
    /^protocol cannot be changed/i,
    'Protokol değiştirilemez; cihazı silip yeniden oluşturun.',
  ],
];

/** Translates known business-rule messages; anything else is returned unchanged. */
export function translateApiMessage(message: string): string {
  for (const [pattern, translation] of BUSINESS_MESSAGES) {
    if (pattern.test(message)) {
      return translation;
    }
  }
  return message;
}

export function errorTitle(status: number): string {
  if (status === 0) return 'Sunucuya ulaşılamadı';
  if (status === 400) return 'Geçersiz istek';
  if (status === 401) return 'Oturum gerekli';
  if (status === 403) return 'Yetkiniz yok';
  if (status === 404) return 'Bulunamadı';
  if (status === 409) return 'Çakışma';
  if (status >= 500) return 'Sunucu hatası';
  return 'İstek başarısız';
}

export interface ErrorDescription {
  title: string;
  message: string;
}

export function describeError(error: unknown): ErrorDescription {
  if (!isApiError(error)) {
    return {
      title: 'Beklenmeyen hata',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { title: errorTitle(error.status), message: describeApiMessage(error) };
}

function describeApiMessage(error: ApiError): string {
  if (error.status === 0) {
    return 'Ağ bağlantısını ve sunucunun çalıştığını kontrol edin.';
  }
  if (error.messages && error.messages.length > 0) {
    return error.messages.map(translateApiMessage).join('\n');
  }
  return translateApiMessage(error.message);
}
