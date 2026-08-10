import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  fbVerifyToken: process.env.FB_VERIFY_TOKEN || 'demo_secure_verify_token_2026',
  fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || '',
  fbApiVersion: process.env.FB_API_VERSION || 'v21.0',
  instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '7659971499',
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || process.env.N8N_ORDER_APPROVED_WEBHOOK_URL || '',
  aiMessageBufferMs: parseInt(process.env.AI_MESSAGE_BUFFER_MS || '1500', 10)
};
