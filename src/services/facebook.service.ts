import { InstagramMessageService } from './instagram-message.service';

/**
 * Facebook / Instagram Direct Message Bridge
 */
export class FacebookService {
  /**
   * Müşteriye yanıt mesajı gönderir (Tüm yanıtlar etkileşimli Quick Reply butonları ile zenginleştirilir).
   */
  public static async sendMessage(recipientId: string, text: string): Promise<boolean> {
    const res = await InstagramMessageService.sendMainMenu(recipientId, text);
    return res.success;
  }
}
