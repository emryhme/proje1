"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookService = void 0;
const instagram_message_service_1 = require("./instagram-message.service");
/**
 * Facebook / Instagram Direct Message Bridge
 */
class FacebookService {
    /**
     * Müşteriye yanıt mesajı gönderir (Tüm yanıtlar etkileşimli Quick Reply butonları ile zenginleştirilir).
     */
    static async sendMessage(recipientId, text) {
        const res = await instagram_message_service_1.InstagramMessageService.sendMainMenu(recipientId, text);
        return res.success;
    }
}
exports.FacebookService = FacebookService;
