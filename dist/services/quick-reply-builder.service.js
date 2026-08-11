"use strict";
/**
 * QuickReplyBuilderService — Dynamic Instagram Quick Reply Mimarisi
 *
 * AI tarafından üretilen ham öneri metinlerini güvenli Quick Reply payload'larına dönüştürür.
 *
 * İki tip Quick Reply:
 * TYPE 1 — ACTION:  "Sepete ekle" → ADD_TO_CART:<validatedCode>  (CartService doğrudan çalışır)
 * TYPE 2 — TEXT:    "Başka renk var mı?" → SUGGESTED_TEXT:<encoded>  (AI buffer'a gider)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickReplyBuilderService = void 0;
const INTENT_RULES = [
    {
        patterns: ['sepete ekle', 'sepete ekleyim', 'ekle', 'ekleyeyim', 'add to cart'],
        action: 'ADD_TO_CART',
        requiresProduct: true
    },
    {
        patterns: ['sepetim', 'sepeti göster', 'sepete bak', 'sepet ne durumda', 'my cart'],
        action: 'MY_CART'
    },
    {
        patterns: ['siparişlerim', 'siparişimi sorgula', 'siparişim nerede', 'sipariş takip', 'my orders'],
        action: 'MY_ORDERS'
    },
    {
        patterns: ['ürünleri göster', 'katalog', 'ürünler', 'tüm ürünler', 'product list'],
        action: 'PRODUCT_LIST'
    },
    {
        patterns: ['destek', 'canlı destek', 'yardım', 'müşteri temsilcisi', 'support'],
        action: 'HUMAN_SUPPORT'
    }
];
class QuickReplyBuilderService {
    /**
     * AI'dan gelen ham öneri dizisini → güvenli Quick Reply payload listesine dönüştürür.
     *
     * @param suggestions   AI'ın ürettiği ham metin önerileri (max 4)
     * @param currentProductCode   Mevcut oturumdaki doğrulanmış ürün kodu (backend'den)
     */
    static buildReplies(suggestions, currentProductCode) {
        if (!suggestions || suggestions.length === 0)
            return [];
        const replies = [];
        for (const raw of suggestions.slice(0, 4)) {
            const cleaned = (raw || '').trim();
            if (!cleaned || cleaned.length < 2)
                continue;
            // Instagram Quick Reply title max 20 karakter
            const title = cleaned.length > 20 ? cleaned.slice(0, 19) + '…' : cleaned;
            const matched = this.matchIntent(cleaned.toLowerCase());
            if (matched) {
                let actionPayload = matched.action;
                // ADD_TO_CART: productCode backend'den alınır (AI'ın ürettiği kod kullanılmaz)
                if (matched.requiresProduct) {
                    if (!currentProductCode) {
                        // Ürün kodu bilinmiyorsa TEXT suggestion olarak gönder
                        replies.push({
                            title,
                            payload: this.encodeTextPayload(cleaned),
                            type: 'TEXT'
                        });
                        console.log(`[DynamicQuickReply] suggested_text="${cleaned}" (no product context, fallback to TEXT)`);
                        continue;
                    }
                    actionPayload = `${matched.action}:${currentProductCode}`;
                }
                console.log(`[DynamicQuickReply] action=${actionPayload} title="${title}"`);
                replies.push({ title, payload: actionPayload, type: 'ACTION' });
            }
            else {
                // Bilinen action yok → SUGGESTED_TEXT olarak gönder
                const textPayload = this.encodeTextPayload(cleaned);
                console.log(`[DynamicQuickReply] suggested_text="${cleaned}"`);
                replies.push({ title, payload: textPayload, type: 'TEXT' });
            }
        }
        return replies;
    }
    /**
     * Statik fallback Quick Reply'ler (AI başarısız olduğunda)
     */
    static buildFallbackReplies() {
        console.log(`[DynamicQuickReply] fallback=true`);
        return [
            { title: 'Urunler', payload: 'PRODUCT_LIST', type: 'ACTION' },
            { title: 'Sepetim', payload: 'MY_CART', type: 'ACTION' },
            { title: 'Destek', payload: 'HUMAN_SUPPORT', type: 'ACTION' }
        ];
    }
    /**
     * SUGGESTED_TEXT payload'ı çözümler
     */
    static decodeSuggestedText(payload) {
        if (!payload.startsWith('SUGGESTED_TEXT:'))
            return null;
        try {
            return Buffer.from(payload.replace('SUGGESTED_TEXT:', ''), 'base64').toString('utf8');
        }
        catch {
            return null;
        }
    }
    /**
     * SUGGESTED_TEXT payload'ı mı kontrol eder
     */
    static isSuggestedText(payload) {
        return payload.startsWith('SUGGESTED_TEXT:');
    }
    // ─────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────
    static matchIntent(lowerText) {
        for (const rule of INTENT_RULES) {
            for (const pattern of rule.patterns) {
                if (lowerText.includes(pattern)) {
                    return rule;
                }
            }
        }
        return null;
    }
    static encodeTextPayload(text) {
        return `SUGGESTED_TEXT:${Buffer.from(text, 'utf8').toString('base64')}`;
    }
}
exports.QuickReplyBuilderService = QuickReplyBuilderService;
