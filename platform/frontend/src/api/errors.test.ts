import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { describeError, translateApiMessage } from './errors';

describe('translateApiMessage', () => {
  it.each([
    ['Invalid username or password', 'Kullanıcı adı veya parola hatalı.'],
    ['The last admin cannot be removed or demoted', 'Son yönetici silinemez veya rolü düşürülemez.'],
    ['You cannot delete your own account', 'Kendi hesabınızı silemezsiniz.'],
    ['Username already exists', 'Bu kullanıcı adı zaten kullanılıyor.'],
    ['A device with this name already exists', 'Bu isimde bir cihaz zaten var.'],
    ['protocol cannot be changed; delete and recreate the device', 'Protokol değiştirilemez; cihazı silip yeniden oluşturun.'],
  ])('translates "%s"', (message, expected) => {
    expect(translateApiMessage(message)).toBe(expected);
  });

  it('leaves validation and unknown messages unchanged', () => {
    expect(translateApiMessage('brokerUrl must be a valid URL starting with mqtt://')).toBe(
      'brokerUrl must be a valid URL starting with mqtt://',
    );
    expect(translateApiMessage('Something else')).toBe('Something else');
  });
});

describe('describeError', () => {
  it('uses a Turkish title by status and the (translated) message', () => {
    expect(describeError(new ApiError(409, 'The last admin cannot be removed or demoted'))).toEqual({
      title: 'Çakışma',
      message: 'Son yönetici silinemez veya rolü düşürülemez.',
    });
    expect(describeError(new ApiError(400, 'x', undefined, ['password must be 8-72 bytes long']))).toEqual({
      title: 'Geçersiz istek',
      message: 'password must be 8-72 bytes long',
    });
    expect(describeError(new ApiError(0, 'Network error')).title).toBe('Sunucuya ulaşılamadı');
  });
});
