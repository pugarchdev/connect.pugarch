import axios from 'axios';

export function isWithin24Hours(lastUserMessageTimestamp?: Date | string | null): boolean {
  if (!lastUserMessageTimestamp) return false;

  const timestamp = new Date(lastUserMessageTimestamp);
  if (Number.isNaN(timestamp.getTime())) return false;

  return (Date.now() - timestamp.getTime()) <= 24 * 60 * 60 * 1000;
}

export function parseWhatsAppApiError(error: any): {
  status?: number;
  code?: number;
  message: string;
  details?: string;
  fbtraceId?: string;
  isTransient: boolean;
  shouldRetry: boolean;
} {
  const metaError = error?.response?.data?.error;
  const status = error?.response?.status;
  const code = metaError?.code;
  const message = metaError?.message || error?.message || 'Unknown WhatsApp API error';
  const details = metaError?.error_data?.details || metaError?.details;
  const fbtraceId = metaError?.fbtrace_id;

  const transientCodes = new Set([1, 2, 4, 17, 341, 80007, 131016, 131049, 131056]);
  const nonRetryableCodes = new Set([100, 190, 131008, 132000, 132001, 132012, 132015]);
  const isTransient = (status >= 500) || transientCodes.has(code);
  const shouldRetry = isTransient && !nonRetryableCodes.has(code);

  return {
    status,
    code,
    message,
    details,
    fbtraceId,
    isTransient,
    shouldRetry
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendTemplateRequest(options: {
  url: string;
  headers: Record<string, string>;
  payload: any;
  logContext: Record<string, any>;
  retryCount?: number;
}): Promise<any> {
  const retryCount = Math.max(0, options.retryCount ?? 2);
  let attempt = 0;

  while (true) {
    try {
      const response = await axios.post(options.url, options.payload, { headers: options.headers });
      
      // ✅ Essential Success Log
      console.log(`🚀 WhatsApp template "${options.logContext.templateName}" successfully sent to ${options.logContext.to} (${options.logContext.company || 'System'})`);
      
      return response;
    } catch (error: any) {
      const parsed = parseWhatsAppApiError(error);
      const isRetrying = attempt < retryCount && parsed.shouldRetry;

      // ❌ Essential Error Log
      console.error(`❌ WhatsApp template "${options.logContext.templateName}" FAILED for ${options.logContext.to}: ${parsed.message}${isRetrying ? ' (Retrying...)' : ''}`);

      if (!parsed.shouldRetry || attempt >= retryCount) {
        throw error;
      }

      attempt += 1;
      await wait(400 * attempt);
    }
  }
}
